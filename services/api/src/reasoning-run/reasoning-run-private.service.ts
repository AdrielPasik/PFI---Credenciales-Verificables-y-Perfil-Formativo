/**
 * Capa de aplicación de la API privada de ReasoningRuns — slice F3.7.
 *
 * TRES RESPONSABILIDADES, y ninguna de dominio:
 *
 *     1. resolver el run ACOTADO POR DUEÑO, y traducir "no es tuyo" y "no existe"
 *        al MISMO 404
 *     2. releer y REVERIFICAR la historia persistida antes de mostrarla
 *     3. traducir desenlaces cerrados de dominio a semántica HTTP segura
 *
 * NO ejecuta etapas, no aplica policy, no toca artifacts. La ejecución es de
 * `ReasoningRunExecutionService` y no se duplica acá.
 *
 * LA AUTORIZACIÓN OCURRE ANTES DE LA CLAIM, y ése es el punto de seguridad del
 * slice. Primero se resuelve la fila por `(id, ownerUserId)`; recién si aparece
 * se llama al orquestador. Al revés —ejecutar y después mirar de quién era— un
 * usuario podría gastar las llamadas al proveedor de otro y dejarle el run
 * `running`, aunque la respuesta terminara siendo 404.
 *
 * LOS ERRORES INTERNOS NO SE PROPAGAN. Los errores de etapa son `HttpException`
 * con estado y mensaje propios —`PROVIDER_TRANSPORT_FAILURE: …`, 502, 424—, así
 * que dejarlos salir publicaría la proveniencia operativa. Todo lo que sale de
 * `executeReasoningRun` se captura y se re-mapea a un vocabulario propio.
 */

import { Injectable } from '@nestjs/common';
import { ReasoningRunStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { verifyObjectiveDefinitionArtifact } from '../objectives/objective-definition.validator';
import {
  type ReasoningRunDetailResponseDto,
  type ReasoningRunSummaryResponseDto
} from './dto/reasoning-run.dto';
import {
  failReasoningRunApi,
  ReasoningRunApiError
} from './reasoning-run-api.errors';
import {
  mapReasoningRunDetail,
  mapReasoningRunSummary,
  type ReasoningRunView
} from './reasoning-run.mapper';
import { ReasoningRunExecutionService } from './reasoning-run-execution.service';
import { ReasoningRunExecutionError } from './reasoning-run-execution.errors';
import { ReasoningRunInputFreezeService } from './reasoning-run-input-freeze.service';
import { ReasoningRunInputFreezeError } from './reasoning-run-input-freeze.errors';
import { verifyReasoningRunResultArtifact } from './reasoning-run-result-artifact.validator';

/**
 * Columnas que la API necesita. Explícitas, no `select: *`: una columna futura
 * no entra sola en el alcance de esta capa.
 */
const RUN_SELECT = {
  id: true,
  objectiveId: true,
  objectiveTitleSnapshot: true,
  objectiveDefinitionSnapshot: true,
  status: true,
  failureCode: true,
  resultArtifact: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
  failedAt: true
} as const;

/**
 * Códigos de etapa REINTENTABLES.
 *
 * Cerrado a propósito: sólo estos tres dejan el run reintentable, y son los
 * mismos que el orquestador usa para decidir `running → pending`. Un error
 * desconocido NO cae acá — que la fila haya quedado en `pending` no lo convierte
 * en transitorio.
 */
const RETRYABLE_STAGE_CODES: ReadonlySet<string> = new Set([
  'PROVIDER_TRANSPORT_FAILURE',
  'INTERNAL_AI_SERVICE_FAILURE',
  'EXECUTION_CONFIGURATION_MISSING'
]);

@Injectable()
export class ReasoningRunPrivateService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly freeze: ReasoningRunInputFreezeService,
    private readonly execution: ReasoningRunExecutionService
  ) {}

  // -------------------------------------------------------------------------
  // Creación
  // -------------------------------------------------------------------------

  /**
   * Congela el universo de evidencia y crea el run. NO ejecuta.
   *
   * Congelar es una acción de dominio barata y reversible por creación de otro
   * run; ejecutar compra observaciones externas. Se mantienen separadas para que
   * nadie gaste llamadas al proveedor sin pedirlo explícitamente.
   *
   * UN RUN RECIÉN CREADO PUEDE NACER `failed`: si el inventario congelado tiene
   * filas bloqueadas, F3.2 persiste el run con ese estado. Eso NO es un fallo de
   * la operación de creación —el recurso existe y es consultable—, así que la
   * respuesta es la del recurso creado, con su `status`. Sólo cuando el freeze
   * aborta ANTES de persistir se responde con un error, y nunca se inventa un id
   * ni un DTO sintético.
   */
  public async createForUser(
    ownerUserId: string,
    objectiveId: string
  ): Promise<ReasoningRunDetailResponseDto> {
    let reasoningRunId: string;
    try {
      const frozen = await this.freeze.createFrozenReasoningRunForUser(
        ownerUserId,
        objectiveId
      );
      reasoningRunId = frozen.reasoningRunId;
    } catch (error: unknown) {
      throw this.toCreationApiError(error);
    }

    // Se relee por el mismo camino acotado por dueño que usa `GET`: una sola
    // autoridad sobre qué se puede mostrar y sobre qué se reverifica.
    return this.getForUser(ownerUserId, reasoningRunId);
  }

  // -------------------------------------------------------------------------
  // Lectura
  // -------------------------------------------------------------------------

  /**
   * Historia del usuario. Sólo suya, y sin efectos.
   *
   * Leer NUNCA ejecuta, ni refresca evidencia, ni recalcula nada: un run es una
   * observación fechada, y consultarlo no puede cambiar lo que observó.
   */
  public async listForUser(
    ownerUserId: string
  ): Promise<readonly ReasoningRunSummaryResponseDto[]> {
    const rows = await this.prisma.reasoningRun.findMany({
      where: { ownerUserId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: RUN_SELECT
    });

    return Object.freeze(
      rows.map((row) => mapReasoningRunSummary(this.toVerifiedView(row)))
    );
  }

  public async getForUser(
    ownerUserId: string,
    reasoningRunId: string
  ): Promise<ReasoningRunDetailResponseDto> {
    return mapReasoningRunDetail(
      this.toVerifiedView(await this.requireOwnedRun(ownerUserId, reasoningRunId))
    );
  }

  // -------------------------------------------------------------------------
  // Ejecución
  // -------------------------------------------------------------------------

  /**
   * Ejecuta un run PROPIO a través del orquestador de más alto nivel.
   *
   * Es también el camino de REINTENTO: un run que quedó `pending` tras un fallo
   * transitorio se reintenta con este mismo comando. No hay `/retry`, porque
   * sería un segundo nombre para la misma operación.
   *
   * Y es IDEMPOTENTE sobre un run ya completado: el orquestador devuelve lo
   * persistido con cero llamadas al proveedor, así que repetir la petición no es
   * un error ni cuesta nada.
   */
  public async executeForUser(
    ownerUserId: string,
    reasoningRunId: string
  ): Promise<ReasoningRunDetailResponseDto> {
    // AUTORIZACIÓN PRIMERO. Si no es suyo, el orquestador no llega a ejecutarse
    // y no se intenta ninguna claim.
    await this.requireOwnedRun(ownerUserId, reasoningRunId);

    try {
      await this.execution.executeReasoningRun(reasoningRunId);
    } catch (error: unknown) {
      throw this.toExecutionApiError(error);
    }

    // Se relee la fila autoritativa en vez de proyectar el outcome en memoria:
    // el estado del recurso lo dice la base, no el valor de retorno.
    return this.getForUser(ownerUserId, reasoningRunId);
  }

  // -------------------------------------------------------------------------
  // Autoridad de la fila
  // -------------------------------------------------------------------------

  /**
   * Consulta ACOTADA POR DUEÑO, en la consulta misma.
   *
   * `findFirst({ id, ownerUserId })` y no "buscar por id y comparar después": la
   * segunda forma deja el filtro a merced de que alguien recuerde escribirlo, y
   * es la que produce fugas cuando el código crece.
   *
   * Un run ajeno y uno inexistente producen el MISMO 404, con el mismo cuerpo.
   * No se convierte en 403: eso confirmaría que el id existe.
   */
  private async requireOwnedRun(ownerUserId: string, reasoningRunId: string) {
    const row = await this.prisma.reasoningRun.findFirst({
      where: { id: reasoningRunId, ownerUserId },
      select: RUN_SELECT
    });
    if (row === null) {
      failReasoningRunApi('REASONING_RUN_NOT_FOUND');
    }
    return row;
  }

  /**
   * Relee y REVERIFICA la historia antes de dejar que se muestre.
   *
   * Que un artifact esté en la fila no prueba que siga siendo legible. Se
   * verifica el snapshot con el validador de F2 y, si el run completó, el
   * resultado con el de F3.1, más el cruce de que los Requirements del resultado
   * sean EXACTAMENTE los del snapshot y en el mismo orden.
   *
   * Esto es VERIFICACIÓN DE HISTORIA, no recomputación: no corre Objective
   * Analysis, ni EvidenceUnits, ni razonamiento contextual, ni la policy.
   *
   * Ante cualquier inconsistencia FALLA CERRADO. No se repara, no se sobreescribe
   * y no se devuelve un resultado a medias: un resultado parcialmente confiable
   * presentado como confiable es peor que no poder mostrarlo.
   */
  private toVerifiedView(row: {
    id: string;
    objectiveId: string;
    objectiveTitleSnapshot: string;
    objectiveDefinitionSnapshot: unknown;
    status: ReasoningRunStatus;
    failureCode: string | null;
    resultArtifact: unknown;
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
    failedAt: Date | null;
  }): ReasoningRunView {
    let definition;
    try {
      definition = verifyObjectiveDefinitionArtifact(row.objectiveDefinitionSnapshot);
    } catch {
      failReasoningRunApi('REASONING_RUN_HISTORY_UNREADABLE');
    }

    let result = null;
    if (row.status === ReasoningRunStatus.completed) {
      try {
        result = verifyReasoningRunResultArtifact(row.resultArtifact);
      } catch {
        // `completed` sin resultado legible es una inconsistencia histórica.
        failReasoningRunApi('REASONING_RUN_HISTORY_UNREADABLE');
      }

      const snapshotIds = definition.requirements.map((item) => item.requirementId);
      const resultIds = result.requirementResults.map((item) => item.requirementId);
      if (
        resultIds.length !== snapshotIds.length ||
        resultIds.some((id, index) => id !== snapshotIds[index])
      ) {
        // El resultado no responde por los Requirements de SU propio Objective.
        failReasoningRunApi('REASONING_RUN_HISTORY_UNREADABLE');
      }
    }

    return {
      id: row.id,
      objectiveId: row.objectiveId,
      objectiveTitleSnapshot: row.objectiveTitleSnapshot,
      status: row.status,
      failureCode: row.failureCode,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      failedAt: row.failedAt,
      definition,
      result
    };
  }

  // -------------------------------------------------------------------------
  // Traducción de desenlaces cerrados a HTTP
  // -------------------------------------------------------------------------

  /**
   * Se clasifica por el CÓDIGO CERRADO del error tipado.
   *
   * Nunca por `error.message`, ni por el status del proveedor, ni por el
   * `failureCode` de la fila, ni por el `status` que quedó después: el estado del
   * recurso es parte de su representación, no la proveniencia del fallo de ESTA
   * petición.
   */
  private toCreationApiError(error: unknown): unknown {
    if (error instanceof ReasoningRunApiError) return error;
    if (error instanceof ReasoningRunInputFreezeError) {
      return error.code === 'OBJECTIVE_NOT_FOUND'
        ? new ReasoningRunApiError('OBJECTIVE_NOT_FOUND')
        : new ReasoningRunApiError('OBJECTIVE_UNREADABLE');
    }
    // Desconocido: genérico. No se deduce nada de un error que no declaramos.
    return new ReasoningRunApiError('EXECUTION_FAILED');
  }

  private toExecutionApiError(error: unknown): unknown {
    if (error instanceof ReasoningRunApiError) return error;

    if (error instanceof ReasoningRunExecutionError) {
      switch (error.code) {
        case 'EXECUTION_ALREADY_CLAIMED':
          return new ReasoningRunApiError('EXECUTION_ALREADY_RUNNING');
        case 'RUN_TERMINALLY_FAILED':
          return new ReasoningRunApiError('RUN_TERMINALLY_FAILED');
        case 'REASONING_RUN_NOT_FOUND':
          return new ReasoningRunApiError('REASONING_RUN_NOT_FOUND');
        default:
          // Deriva de policy, corrupción, resultado no persistible: todos son
          // fallos NUESTROS y ninguno le dice al cliente cuál fue.
          return new ReasoningRunApiError('EXECUTION_FAILED');
      }
    }

    // Errores de etapa: sólo el conjunto cerrado de reintentables se anuncia como
    // temporal. Todo lo demás —incluido lo que no reconocemos— es genérico.
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && RETRYABLE_STAGE_CODES.has(code)) {
      return new ReasoningRunApiError('EXECUTION_TEMPORARILY_UNAVAILABLE');
    }

    return new ReasoningRunApiError('EXECUTION_FAILED');
  }
}

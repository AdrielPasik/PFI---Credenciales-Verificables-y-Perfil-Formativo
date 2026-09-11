/**
 * Claim exclusiva de ejecución de un ReasoningRun — slice F3.6.
 *
 * PROBLEMA. Antes de que F3.7 exponga un disparador de usuario hace falta que
 * valga:
 *
 *     SINGLE_ACTIVE_ORCHESTRATOR_PER_RUN
 *
 *     a lo sumo UN orquestador activo puede comprar observaciones del proveedor
 *     para un ReasoningRun dado
 *
 * No alcanza con que la escritura final sea única: dos llamantes que observan
 * `pending` y ambos ejecutan gastan DOS veces las llamadas al proveedor aunque
 * después sólo una gane el CAS final. La exclusión tiene que ocurrir ANTES de la
 * primera llamada.
 *
 * MECANISMO. El compare-and-set `pending → running`, que es el primitivo de
 * concurrencia que este repositorio ya usa en producción: `AnalysisRunExecutionService`
 * reclama con exactamente el mismo `updateMany` + `count !== 1`. No se inventa
 * nada nuevo ni se agrega una columna.
 *
 *     ganador   count === 1  → obtiene la claim, puede ejecutar
 *     perdedor  count === 0  → 0 llamadas al proveedor, no ejecuta etapas
 *
 * RECUPERACIÓN — LIMITACIÓN CONSCIENTE Y DOCUMENTADA.
 *
 *     NON_RECOVERABLE_RUNNING_CLAIM
 *
 * El schema de `ReasoningRun` NO tiene token de dueño, epoch, lease ni heartbeat.
 * Auditado columna por columna: `status`, `startedAt`, `completedAt`, `failedAt`,
 * `failureCode` y los cuatro slots `Json?`. Con eso NO se puede distinguir
 * "el dueño sigue vivo y su llamada al proveedor está tardando" de "el dueño
 * murió", así que cualquier reclamo por TTL sería robar un run que quizá sigue
 * ejecutando —y comprar sus observaciones dos veces—.
 *
 * Por eso una claim NUNCA se roba. Si el proceso muere con el run en `running`,
 * el run queda en `running` y una nueva ejecución exige un ReasoningRun NUEVO.
 * Es coherente con el contrato epistemológico del proyecto: cada ejecución
 * materialmente nueva es un run nuevo. Se sacrifica la recuperación del mismo run
 * para no introducir TTLs arbitrarios, maquinaria de lease ni escrituras de
 * dueños zombis.
 *
 * `startedAt` NO SIRVE PARA DETECTAR DUEÑOS MUERTOS, y además tiene una semántica
 * propia bajo reintento técnico del mismo run:
 *
 *     startedAt = primer intento productivo de ESTE ReasoningRun
 *
 *     primera claim pending → running     se fija si es NULL
 *     reset transitorio running → pending se preserva
 *     reclaim posterior pending → running NO se sobreescribe
 *
 * Es la única lectura compatible con el modelo actual, que no guarda historial de
 * intentos: interpretarlo como "el intento en curso empezó acá" afirmaría algo
 * que la fila no puede sostener.
 */

import { Injectable } from '@nestjs/common';
import { Prisma, ReasoningRunStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Testigo de que ESTA ejecución ganó el CAS.
 *
 * NO ES UN BOOLEAN DE CONFIANZA. Un `claimed=true` que el llamante arma solo no
 * prueba nada; esto sólo se obtiene volviendo `running` la fila, que es una
 * transición que exactamente un llamante puede hacer.
 *
 * La garantía REAL vive en la base, no en el tipo: una etapa ejecutada bajo claim
 * exige `status = running`, y la fila sólo llega a `running` por este CAS. Aunque
 * alguien fabricara el objeto, no conseguiría que la etapa escriba: se encontraría
 * con una fila `pending` y fallaría por no elegible. El tipo documenta la
 * frontera; la base la hace cumplir.
 */
export class ReasoningRunExecutionClaim {
  private constructor(
    public readonly reasoningRunId: string,
    /** Primer intento productivo del run, no el de este intento. */
    public readonly startedAt: Date
  ) {}

  /** @internal Sólo `ReasoningRunExecutionClaimService` posee el token. */
  public static mint(
    token: symbol,
    reasoningRunId: string,
    startedAt: Date
  ): ReasoningRunExecutionClaim {
    if (token !== MINT_TOKEN) {
      throw new Error('reasoning_run_execution_claim_cannot_be_forged');
    }
    return new ReasoningRunExecutionClaim(reasoningRunId, startedAt);
  }
}

/** Privado del módulo: no se exporta, así que nadie más puede acuñar una claim. */
const MINT_TOKEN = Symbol('reasoning_run_execution_claim_mint');

/**
 * El estado que la fila debe tener para que una etapa pueda leer y escribir.
 *
 * SIN CLAIM la etapa conserva EXACTAMENTE su semántica anterior: `pending`. Los
 * entrypoints directos de F3.3/F3.4/F3.5 siguen siendo lo que eran, y sus tests
 * congelados siguen valiendo. La guarda no se ensancha globalmente: se desplaza
 * sólo para quien probó ser el dueño.
 */
export function eligibleRunStatusFor(
  claim: ReasoningRunExecutionClaim | undefined
): ReasoningRunStatus {
  return claim === undefined
    ? ReasoningRunStatus.pending
    : ReasoningRunStatus.running;
}

/** Desenlace del intento de reclamar. */
export type ClaimOutcome =
  | { readonly kind: 'CLAIMED'; readonly claim: ReasoningRunExecutionClaim }
  /** Otro orquestador tiene la claim, o el run ya no es reclamable. */
  | { readonly kind: 'NOT_CLAIMABLE'; readonly status: ReasoningRunStatus }
  | { readonly kind: 'RUN_NOT_FOUND' };

@Injectable()
export class ReasoningRunExecutionClaimService {
  public constructor(private readonly prisma: PrismaService) {}

  /**
   * CAS `pending → running`. Exactamente un llamante concurrente gana.
   *
   * `failureCode: null` entra en la condición: un run que ya falló no vuelve a
   * ejecutarse aunque alguien lo dejara en `pending`.
   *
   * `startedAt` se fija SÓLO si está vacío, para que un reintento técnico del
   * mismo run no reescriba cuándo empezó realmente.
   */
  public async claim(reasoningRunId: string): Promise<ClaimOutcome> {
    const claimedAt = new Date();
    const won = await this.prisma.reasoningRun.updateMany({
      where: {
        id: reasoningRunId,
        status: ReasoningRunStatus.pending,
        failureCode: null,
        resultArtifact: { equals: Prisma.DbNull }
      },
      data: { status: ReasoningRunStatus.running }
    });

    if (won.count !== 1) {
      const run = await this.prisma.reasoningRun.findUnique({
        where: { id: reasoningRunId },
        select: { status: true }
      });
      if (run === null) return { kind: 'RUN_NOT_FOUND' };
      return { kind: 'NOT_CLAIMABLE', status: run.status };
    }

    // Segundo write, y a propósito separado: `startedAt` es SET-IF-NULL y Prisma
    // no expresa eso en el mismo `updateMany` que ya usa `status` como condición.
    // Es seguro porque sólo el ganador llega acá y nadie más puede estar en
    // `running` para esta fila.
    await this.prisma.reasoningRun.updateMany({
      where: {
        id: reasoningRunId,
        status: ReasoningRunStatus.running,
        startedAt: null
      },
      data: { startedAt: claimedAt }
    });

    const run = await this.prisma.reasoningRun.findUnique({
      where: { id: reasoningRunId },
      select: { startedAt: true }
    });

    return {
      kind: 'CLAIMED',
      claim: ReasoningRunExecutionClaim.mint(
        MINT_TOKEN,
        reasoningRunId,
        run?.startedAt ?? claimedAt
      )
    };
  }

  /**
   * Devuelve el run a `pending` tras un fallo TRANSITORIO.
   *
   * Es la ÚLTIMA acción del intento: quien la llama ya terminó y no vuelve a
   * escribir. Eso es lo que hace que un dueño anterior no pueda pisar al
   * siguiente —no hay ventana en la que el intento viejo siga trabajando después
   * de soltar la claim—, y es una propiedad de la ESTRUCTURA del orquestador, no
   * algo que la base pueda hacer cumplir sin un token de intento.
   *
   * `startedAt` se preserva: el run ya empezó, y esto es un reintento del mismo.
   */
  public async releaseForRetry(
    claim: ReasoningRunExecutionClaim
  ): Promise<void> {
    await this.prisma.reasoningRun.updateMany({
      where: {
        id: claim.reasoningRunId,
        status: ReasoningRunStatus.running,
        failureCode: null,
        resultArtifact: { equals: Prisma.DbNull }
      },
      data: { status: ReasoningRunStatus.pending }
    });
  }

  /**
   * Transición terminal del run reclamado.
   *
   * Condicional sobre `running` + sin fallo + sin resultado: un éxito final ya
   * persistido nunca puede ser degradado a `failed` por un fallo tardío.
   */
  public async failClaimed(
    claim: ReasoningRunExecutionClaim,
    failureCode: string
  ): Promise<void> {
    await this.prisma.reasoningRun.updateMany({
      where: {
        id: claim.reasoningRunId,
        status: ReasoningRunStatus.running,
        failureCode: null,
        resultArtifact: { equals: Prisma.DbNull }
      },
      data: {
        status: ReasoningRunStatus.failed,
        failureCode,
        failedAt: new Date()
      }
    });
  }
}

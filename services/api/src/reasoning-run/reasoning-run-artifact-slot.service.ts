/**
 * Slots de etapa del ReasoningRun — slice F3.1.
 *
 * Tres slots `MONOTONIC_FILL_ONCE` mas `executionMetadata`, con la MISMA
 * disciplina que `SourceExtractionSlotService` de F1.2:
 *
 *   ABSENT                        -> valida, verifica cruzado, compare-and-set
 *   PRESENT con el mismo artifact -> exito idempotente, CERO escrituras
 *   PRESENT con otro artifact     -> conflicto determinista, sin escribir
 *   PRESENT pero corrupto         -> fallo de corrupcion, NUNCA se sobreescribe
 *
 * LA AUTORIDAD SE CARGA DE LA BASE, NUNCA DEL LLAMANTE. Es la misma disciplina
 * causal de F0.5/F1.4: cada metodo productivo recibe SOLO `(runId, artifact)`. El
 * snapshot del Objective, el inventario congelado y los artifacts de etapas
 * previas se leen de persistencia, asi que un llamante no puede redefinir la
 * autoridad contra la cual va a ser validado. Pasar "el inventario que yo creo
 * que tiene este run" no es representable.
 *
 * IGUALDAD ESTRUCTURAL VERIFICADA, no hashes. Los dos lados se validan primero y
 * se comparan por su JSON canonico —el mismo `canonicalJson` de F0—. No se agrega
 * ninguna columna de fingerprint: un hash aca solo serviria para idempotencia y
 * terminaria leyendose como una garantia de integridad que no existe.
 *
 * NO IMPLEMENTA LIFECYCLE. Que existan `status`, `startedAt` o `failureCode` no
 * autoriza a construir aca un `startRun`/`completeRun`: eso es F3.2/F3.6.
 */

import { Injectable } from '@nestjs/common';
import { Prisma, ReasoningRunStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { canonicalJson } from '../source-extraction/canonical-json';
import { verifyObjectiveDefinitionArtifact } from '../objectives/objective-definition.validator';
import { verifyEvidenceUnitsArtifact } from './evidence-units-artifact.validator';
import { verifyObjectiveAnalysisArtifact } from './objective-analysis-artifact.validator';
import { verifyReasoningExecutionMetadata } from './reasoning-execution-metadata.validator';
import { verifyReasoningRunResultArtifact } from './reasoning-run-result-artifact.validator';
import { failSlot } from './reasoning-run-artifact-slot.errors';
import {
  eligibleRunStatusFor,
  type ReasoningRunExecutionClaim
} from './reasoning-run-execution-claim.service';
import {
  verifyEvidenceUnitsAgainstRunInventory,
  verifyObjectiveAnalysisAgainstObjectiveSnapshot,
  verifyReasoningResultReferences,
  type ConfirmedObjectiveSnapshot,
  type FrozenInventoryItem
} from './reasoning-run-cross-artifact.verifier';
import {
  type VerifiedEvidenceUnits,
  type VerifiedObjectiveAnalysis,
  type VerifiedReasoningExecutionMetadata,
  type VerifiedReasoningRunResult
} from './reasoning-run-artifact.types';

const RUN_SELECT = {
  id: true,
  // F3.3B: el estado del run entra en el CAS del slot de la etapa 1. No es
  // lifecycle generico: es la unica forma de que un exito y un fallo terminal
  // concurrentes compitan por el MISMO estado elegible.
  status: true,
  failureCode: true,
  objectiveDefinitionSnapshot: true,
  objectiveAnalysisArtifact: true,
  evidenceUnitsArtifact: true,
  resultArtifact: true,
  executionMetadata: true
} as const;

const INVENTORY_SELECT = {
  disposition: true,
  runLocalSourceId: true,
  sourceSha256: true
} as const;

interface RunRow {
  id: string;
  status: string;
  failureCode: string | null;
  objectiveDefinitionSnapshot: unknown;
  objectiveAnalysisArtifact: unknown;
  evidenceUnitsArtifact: unknown;
  resultArtifact: unknown;
  executionMetadata: unknown;
}

/**
 * Lo que hay en los slots de un run, ya verificado.
 *
 * `null` significa ABSENT, y ABSENT no es un error: significa que esa etapa no
 * termino. Distinguirlo de "termino y salio vacio" es justamente el punto de que
 * los slots sean fill-once.
 */
export interface ReasoningRunArtifacts {
  readonly reasoningRunId: string;
  readonly objectiveAnalysis: VerifiedObjectiveAnalysis | null;
  readonly evidenceUnits: VerifiedEvidenceUnits | null;
  readonly result: VerifiedReasoningRunResult | null;
  readonly executionMetadata: VerifiedReasoningExecutionMetadata | null;
}

type SlotColumn =
  | 'objectiveAnalysisArtifact'
  | 'evidenceUnitsArtifact'
  | 'resultArtifact'
  | 'executionMetadata';

@Injectable()
export class ReasoningRunArtifactSlotService {
  public constructor(private readonly prisma: PrismaService) {}

  /**
   * Lee los cuatro slots y los verifica.
   *
   * Un slot presente que no supera su verificador es CORRUPCION y se lanza: leer
   * "lo que haya" convertiria un artifact roto en un input aceptable.
   */
  public async readReasoningRunArtifacts(
    reasoningRunId: string
  ): Promise<ReasoningRunArtifacts> {
    const run = await this.loadRun(reasoningRunId);
    return {
      reasoningRunId,
      objectiveAnalysis: this.verifyPersistedSlot(
        reasoningRunId,
        'objectiveAnalysisArtifact',
        run.objectiveAnalysisArtifact,
        verifyObjectiveAnalysisArtifact
      ),
      evidenceUnits: this.verifyPersistedSlot(
        reasoningRunId,
        'evidenceUnitsArtifact',
        run.evidenceUnitsArtifact,
        verifyEvidenceUnitsArtifact
      ),
      result: this.verifyPersistedSlot(
        reasoningRunId,
        'resultArtifact',
        run.resultArtifact,
        verifyReasoningRunResultArtifact
      ),
      executionMetadata: this.verifyPersistedSlot(
        reasoningRunId,
        'executionMetadata',
        run.executionMetadata,
        verifyReasoningExecutionMetadata
      )
    };
  }

  /**
   * Etapa 1. Autoridad: el snapshot del Objective congelado en ESTA fila.
   *
   * No depende del catalogo de EvidenceUnits, asi que puede llenarse antes o
   * despues de el.
   */
  public async fillObjectiveAnalysisArtifact(
    reasoningRunId: string,
    candidate: unknown,
    /** F3.6: presente cuando la etapa corre bajo una claim exclusiva. */
    claim?: ReasoningRunExecutionClaim
  ): Promise<VerifiedObjectiveAnalysis> {
    const run = await this.loadRun(reasoningRunId);
    const analysis = verifyObjectiveAnalysisArtifact(candidate);

    verifyObjectiveAnalysisAgainstObjectiveSnapshot(
      analysis,
      this.confirmedObjectiveSnapshot(run)
    );

    // Con guarda de estado de run: esta etapa tiene un fallo terminal compitiendo
    // contra su exito en la misma fila. `resultArtifact` la tendra cuando F3.5
    // exista; adelantarla ahora seria construir lifecycle sin caso de uso.
    return this.fill(
      reasoningRunId,
      'objectiveAnalysisArtifact',
      analysis,
      verifyObjectiveAnalysisArtifact,
      eligibleRunStatusFor(claim)
    );
  }

  /**
   * Etapa 2. Autoridad: el inventario congelado de ESTE run.
   *
   * Independiente del Objective Analysis — F3.0 audito que
   * `sourceObservabilityFacts` no depende de el—, asi que tampoco exige que el
   * otro slot este lleno.
   */
  public async fillEvidenceUnitsArtifact(
    reasoningRunId: string,
    candidate: unknown,
    /**
     * Verificacion ADICIONAL, inyectada por F3.4.
     *
     * F3.1 dejo diferida la comprobacion de coordenadas porque necesita el
     * artifact de extraccion, que este servicio no carga. Se recibe como funcion
     * —no como datos— para que la autoridad siga siendo de quien la resolvio
     * desde persistencia, y corre DESPUES de la verificacion contra el inventario
     * y ANTES del compare-and-set.
     */
    verifyGrounding?: (evidenceUnits: VerifiedEvidenceUnits) => void,
    /** F3.6: presente cuando la etapa corre bajo una claim exclusiva. */
    claim?: ReasoningRunExecutionClaim
  ): Promise<VerifiedEvidenceUnits> {
    await this.loadRun(reasoningRunId);
    const evidenceUnits = verifyEvidenceUnitsArtifact(candidate);

    verifyEvidenceUnitsAgainstRunInventory(
      evidenceUnits,
      await this.loadInventory(reasoningRunId)
    );
    verifyGrounding?.(evidenceUnits);

    // Con guarda de estado de run desde F3.4: esta etapa ya tiene fallos
    // terminales compitiendo contra su exito en la misma fila.
    return this.fill(
      reasoningRunId,
      'evidenceUnitsArtifact',
      evidenceUnits,
      verifyEvidenceUnitsArtifact,
      eligibleRunStatusFor(claim)
    );
  }

  /**
   * Etapa 3. Exige que las DOS anteriores esten PRESENTES y verificadas.
   *
   * No es burocracia de orden: el resultado no recopia ni el analisis ni el
   * catalogo, asi que sin ellos sus referencias no se pueden resolver y el
   * artifact seria imposible de auditar.
   */
  public async fillResultArtifact(
    reasoningRunId: string,
    candidate: unknown
  ): Promise<VerifiedReasoningRunResult> {
    const result = await this.verifyResultArtifactCandidate(
      reasoningRunId,
      candidate
    );
    return this.fill(
      reasoningRunId,
      'resultArtifact',
      result,
      verifyReasoningRunResultArtifact
    );
  }

  /**
   * TODO lo que hace falta comprobar antes de persistir un resultado, SIN escribir.
   *
   * Existe porque F3.6 no puede usar `fillResultArtifact`: ese metodo escribe el
   * slot y nada mas, y la finalizacion del run necesita que el artifact, el
   * `status` y `completedAt` cambien en UNA sola transicion. Separar la
   * verificacion de la escritura deja UNA sola autoridad sobre que hace valido a
   * un resultado para este run, en vez de dos copias que pueden divergir.
   */
  public async verifyResultArtifactCandidate(
    reasoningRunId: string,
    candidate: unknown
  ): Promise<VerifiedReasoningRunResult> {
    const run = await this.loadRun(reasoningRunId);

    const analysis = this.verifyPersistedSlot(
      reasoningRunId,
      'objectiveAnalysisArtifact',
      run.objectiveAnalysisArtifact,
      verifyObjectiveAnalysisArtifact
    );
    const evidenceUnits = this.verifyPersistedSlot(
      reasoningRunId,
      'evidenceUnitsArtifact',
      run.evidenceUnitsArtifact,
      verifyEvidenceUnitsArtifact
    );

    if (analysis === null || evidenceUnits === null) {
      failSlot('PREVIOUS_STAGE_ARTIFACT_MISSING', {
        invariant: 'result_requires_objective_analysis_and_evidence_units',
        reasoningRunId,
        slot: analysis === null ? 'objectiveAnalysisArtifact' : 'evidenceUnitsArtifact'
      });
    }

    const result = verifyReasoningRunResultArtifact(candidate);
    verifyReasoningResultReferences(result, analysis, evidenceUnits);
    return result;
  }

  /**
   * Configuracion de ejecucion. Fill-once igual que los slots, pero NO es un
   * cuarto stage artifact y no participa del orden de etapas.
   */
  public async fillExecutionMetadata(
    reasoningRunId: string,
    candidate: unknown
  ): Promise<VerifiedReasoningExecutionMetadata> {
    await this.loadRun(reasoningRunId);
    const metadata = verifyReasoningExecutionMetadata(candidate);
    return this.fill(
      reasoningRunId,
      'executionMetadata',
      metadata,
      verifyReasoningExecutionMetadata
    );
  }

  // -------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------

  private async loadRun(reasoningRunId: string): Promise<RunRow> {
    const run = await this.prisma.reasoningRun.findUnique({
      where: { id: reasoningRunId },
      select: RUN_SELECT
    });
    if (!run) {
      failSlot('REASONING_RUN_NOT_FOUND', {
        invariant: 'reasoning_run_does_not_exist',
        reasoningRunId
      });
    }
    return run as RunRow;
  }

  private async loadInventory(
    reasoningRunId: string
  ): Promise<readonly FrozenInventoryItem[]> {
    const items = await this.prisma.reasoningRunInventoryItem.findMany({
      where: { reasoningRunId },
      select: INVENTORY_SELECT
    });
    return items.map((item) => ({
      disposition: String(item.disposition),
      runLocalSourceId: item.runLocalSourceId,
      sourceSha256: item.sourceSha256
    }));
  }

  /**
   * El Objective confirmado, EN SU ORDEN DE PERSISTENCIA.
   *
   * Se re-verifica el snapshot con el verificador productivo de F2 en vez de
   * leerlo crudo: si lo persistido no es un `objective_definition_v1` valido, el
   * run no tiene contra que validar nada y eso es corrupcion, no un caso a
   * tolerar.
   *
   * Se extraen `requirementText` y `objectiveContext` ademas de los ids porque
   * son las ANCLAS del anclaje de qualifiers. Nunca se leen del Objective
   * vigente: el snapshot de ESTA fila es la autoridad del run.
   */
  private confirmedObjectiveSnapshot(run: RunRow): ConfirmedObjectiveSnapshot {
    try {
      const definition = verifyObjectiveDefinitionArtifact(
        run.objectiveDefinitionSnapshot
      );
      return {
        objectiveContext: definition.objectiveContext,
        requirements: definition.requirements.map((item) => ({
          requirementId: item.requirementId,
          requirementText: item.requirementText
        }))
      };
    } catch {
      failSlot('OBJECTIVE_SNAPSHOT_CORRUPT', {
        invariant: 'persisted_objective_snapshot_must_verify',
        reasoningRunId: run.id,
        slot: 'objectiveDefinitionSnapshot'
      });
    }
  }

  private verifyPersistedSlot<T>(
    reasoningRunId: string,
    slot: SlotColumn,
    persisted: unknown,
    verify: (input: unknown) => T
  ): T | null {
    if (persisted === null || persisted === undefined) return null;
    try {
      return verify(persisted);
    } catch {
      // Se pierde el error interno a proposito: podria llevar rutas con
      // contenido, y el llamante solo necesita saber QUE slot esta corrupto.
      failSlot('STAGE_ARTIFACT_CORRUPT', {
        invariant: 'persisted_stage_artifact_must_verify',
        reasoningRunId,
        slot
      });
    }
  }

  /**
   * Compare-and-set sobre el slot: solo escribe si sigue ABSENT.
   *
   * Mismo patron condicional que `SourceExtractionSlotService.fillExtractionSlot`
   * y que la transicion `pending -> running` de `AnalysisRunExecutionService`.
   *
   * `requireEligibleRun` agrega el ESTADO DEL RUN al mismo CAS. Sin eso, un
   * fallo terminal concurrente y este exito escribirian columnas distintas de la
   * misma fila sin verse, y quedaria un run `failed` con artifact de etapa. No
   * alcanza con mirar `status` antes de la llamada al proveedor: entre esa
   * lectura y esta escritura hay una llamada de red entera.
   */
  private async fill<T>(
    reasoningRunId: string,
    slot: SlotColumn,
    verified: T,
    verify: (input: unknown) => T,
    /**
     * Estado que la fila debe tener para admitir esta escritura, o `null` para no
     * mirar el lifecycle.
     *
     * F3.6 lo volvio un ESTADO en vez de un booleano: una etapa ejecutada bajo
     * claim exclusiva corre con la fila en `running`, no en `pending`, y el CAS
     * tiene que exigir ese mismo estado. La guarda no se ensancha —sigue habiendo
     * exactamente un estado elegible por llamada—, sino que se desplaza junto con
     * quien probo ser el duenio.
     */
    eligibleStatus: ReasoningRunStatus | null = null
  ): Promise<T> {
    const eligible =
      eligibleStatus === null ? {} : { status: eligibleStatus, failureCode: null };

    // `Prisma.DbNull`, NO `null`. Las cuatro columnas de slot son `Json?`, y para
    // ese tipo Prisma NO acepta `null` como filtro: exige el sentinel. Con clave
    // computada TypeScript no lo veia —la clave ensancha el tipo—, asi que el
    // CAS habria fallado en runtime en vez de en compilacion.
    const filled = await this.prisma.reasoningRun.updateMany({
      where: { id: reasoningRunId, [slot]: { equals: Prisma.DbNull }, ...eligible },
      data: { [slot]: verified as never }
    });

    if (filled.count === 1) return verified;

    // count === 0 NO significa "ya estaba lleno": tambien puede ser que la fila
    // ya no exista, o —con guarda— que el run haya terminado. Se relee de forma
    // autoritativa y se clasifica.
    const run = await this.loadRun(reasoningRunId);
    const persisted = this.verifyPersistedSlot(
      reasoningRunId,
      slot,
      (run as unknown as Record<SlotColumn, unknown>)[slot],
      verify
    );

    if (persisted === null) {
      // Slot ABSENT y run no elegible: carrera perdida contra un fallo terminal.
      // Es un desenlace legitimo, no una imposibilidad, y por eso NO comparte
      // codigo con la inconsistencia de abajo.
      if (
        eligibleStatus !== null &&
        (run.status !== eligibleStatus || run.failureCode !== null)
      ) {
        failSlot('RUN_NOT_ELIGIBLE_FOR_STAGE_WRITE', {
          invariant: 'terminal_run_state_cannot_gain_a_stage_artifact',
          reasoningRunId,
          slot
        });
      }

      failSlot('STAGE_ARTIFACT_SLOT_INCONSISTENT', {
        invariant: 'conditional_fill_did_not_apply_on_an_absent_slot',
        reasoningRunId,
        slot
      });
    }

    if (canonicalJson(persisted) === canonicalJson(verified)) {
      // Convergencia idempotente. NO viola fill-once: el estado PRESENT nunca se
      // reescribio, el reintento simplemente encontro su propio resultado.
      return persisted;
    }

    failSlot('STAGE_ARTIFACT_CONFLICT', {
      invariant: 'stage_slot_already_filled_with_a_different_artifact',
      reasoningRunId,
      slot
    });
  }
}

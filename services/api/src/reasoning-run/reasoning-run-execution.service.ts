/**
 * Orquestación de la ejecución completa de un ReasoningRun — slice F3.6.
 *
 * Cierra Evidence Reasoning de punta a punta:
 *
 *     preflight determinista (sin claim, sin proveedor)
 *          ↓
 *     claim exclusiva  pending → running
 *          ↓
 *     asegurar objective_analysis_v1      (F3.3)
 *          ↓
 *     asegurar evidence_units_v1          (F3.4)
 *          ↓
 *     razonamiento contextual             (F3.5, transitorio)
 *          ↓
 *     policy epistemológica determinista  (F3.6, 0 llamadas)
 *          ↓
 *     verificar reasoning_run_result_v1
 *          ↓
 *     finalización ATÓMICA  running → completed + resultArtifact + completedAt
 *
 * SIN CONTROLLER. F3.6 es interno: no hay endpoint, no hay disparador de
 * frontend y no hay autorización de usuario acá. `ownerUserId` NO es un
 * parámetro: la frontera de autorización es F3.7, y meterla en un servicio de
 * dominio interno crearía una segunda autoridad sobre quién puede ver qué.
 *
 * AUTORIDAD ÚNICA DEL LIFECYCLE. Una vez adquirida la claim, este servicio es el
 * único que mueve `status`. Las etapas siguen teniendo su transición terminal
 * condicionada a `pending`, así que bajo claim afecta 0 filas y no compiten con
 * el orquestador: se limitan a lanzar su error tipado.
 *
 * PRIVACIDAD. Los `logs` seguros de este slice son ids, conteos y tokens
 * cerrados. Nunca el Objective, un Requirement, una proposición, una cita, un
 * rationale ni la explicación final.
 */

import { Injectable } from '@nestjs/common';
import { ReasoningRunStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { canonicalJson } from '../source-extraction/canonical-json';
import { verifyObjectiveDefinitionArtifact } from '../objectives/objective-definition.validator';
import { applyDeterministicReasoningPolicy, DeterministicPolicyInputError } from './deterministic-epistemic-policy';
import { PRODUCT_DETERMINISTIC_POLICY_VERSION } from './product-stage-identity';
import { ReasoningRunArtifactSlotService } from './reasoning-run-artifact-slot.service';
import { ReasoningRunContextualReasoningService } from './reasoning-run-contextual-reasoning.service';
import { ReasoningRunEvidenceUnitsService } from './reasoning-run-evidence-units.service';
import { ReasoningRunObjectiveAnalysisService } from './reasoning-run-objective-analysis.service';
import {
  ReasoningRunExecutionClaimService,
  type ReasoningRunExecutionClaim
} from './reasoning-run-execution-claim.service';
import {
  failExecution,
  REASONING_FINAL_RESULT_NOT_PERSISTABLE,
  REASONING_POLICY_INPUT_INCONSISTENT
} from './reasoning-run-execution.errors';
import { REASONING_EXECUTION_PLAN_MISMATCH } from './reasoning-run-objective-analysis.errors';
import { verifyReasoningRunResultArtifact } from './reasoning-run-result-artifact.validator';
import { type VerifiedReasoningRunResult } from './reasoning-run-artifact.types';

/** Códigos de etapa que dejan el run REINTENTABLE en vez de matarlo. */
const RETRYABLE_STAGE_CODES: ReadonlySet<string> = new Set([
  'PROVIDER_TRANSPORT_FAILURE',
  'INTERNAL_AI_SERVICE_FAILURE',
  'EXECUTION_CONFIGURATION_MISSING'
]);

/** Códigos de etapa que matan el run, con el `failureCode` que persiste cada uno. */
const TERMINAL_STAGE_FAILURE_CODES: Readonly<Record<string, string>> = {
  EXECUTION_PLAN_MISMATCH: REASONING_EXECUTION_PLAN_MISMATCH,
  PROVIDER_CONFIGURATION_FAILURE: 'reasoning_provider_configuration_invalid',
  PROVIDER_INVALID_OUTPUT: 'reasoning_provider_invalid_output',
  PERSISTED_AUTHORITY_UNUSABLE: 'reasoning_contextual_authority_unusable',
  GROUNDING_UNUSABLE: 'reasoning_evidence_units_grounding_unusable',
  PREVIOUS_STAGE_ARTIFACT_MISSING: 'reasoning_previous_stage_artifact_missing'
};

export interface ReasoningRunExecutionOutcome {
  readonly reasoningRunId: string;
  readonly result: VerifiedReasoningRunResult;
  /** `false` cuando el run ya estaba `completed` y se devolvió lo persistido. */
  readonly executed: boolean;
  /** Llamadas lógicas al proveedor de ESTA ejecución. La policy nunca suma. */
  readonly providerLogicalCalls: number;
  readonly requirementCount: number;
}

@Injectable()
export class ReasoningRunExecutionService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly claims: ReasoningRunExecutionClaimService,
    private readonly slots: ReasoningRunArtifactSlotService,
    private readonly objectiveAnalysis: ReasoningRunObjectiveAnalysisService,
    private readonly evidenceUnits: ReasoningRunEvidenceUnitsService,
    private readonly contextual: ReasoningRunContextualReasoningService
  ) {}

  /**
   * Ejecuta el run entero, o devuelve el resultado que ya tenía.
   *
   * `runId` y nada más: el snapshot, el inventario, el plan y los artifacts se
   * leen de persistencia. Un llamante no puede redefinir la autoridad contra la
   * que este run se evalúa.
   */
  public async executeReasoningRun(
    reasoningRunId: string
  ): Promise<ReasoningRunExecutionOutcome> {
    // --- 1. PREFLIGHT: todo lo que no necesita claim ni proveedor -----------
    const terminal = await this.preflight(reasoningRunId);
    if (terminal !== null) return terminal;

    // --- 2. CLAIM EXCLUSIVA, antes de la primera observación ----------------
    const outcome = await this.claims.claim(reasoningRunId);
    if (outcome.kind === 'RUN_NOT_FOUND') {
      failExecution('REASONING_RUN_NOT_FOUND', {
        invariant: 'reasoning_run_does_not_exist',
        reasoningRunId
      });
    }
    if (outcome.kind === 'NOT_CLAIMABLE') {
      // El perdedor de la carrera NO ejecuta ninguna etapa: 0 llamadas.
      failExecution('EXECUTION_ALREADY_CLAIMED', {
        invariant: 'another_execution_owns_this_run',
        reasoningRunId,
        observedStatus: outcome.status
      });
    }

    return await this.runClaimed(outcome.claim);
  }

  // -------------------------------------------------------------------------
  // Preflight
  // -------------------------------------------------------------------------

  /**
   * Todo lo determinista que se puede resolver SIN reclamar y SIN proveedor.
   *
   * Devuelve un desenlace terminal-idempotente cuando el run ya terminó, o
   * `null` cuando corresponde intentar la claim.
   *
   * LA CLAIM NO SUSTITUYE LA VALIDACIÓN DE ENTRADAS, y el preflight tampoco
   * sustituye la relectura autoritativa posterior: lo que se lee acá se vuelve a
   * leer bajo la claim antes de comprar nada.
   */
  private async preflight(
    reasoningRunId: string
  ): Promise<ReasoningRunExecutionOutcome | null> {
    const run = await this.prisma.reasoningRun.findUnique({
      where: { id: reasoningRunId },
      select: {
        id: true,
        status: true,
        failureCode: true,
        resultArtifact: true,
        executionMetadata: true,
        objectiveDefinitionSnapshot: true
      }
    });
    if (run === null) {
      failExecution('REASONING_RUN_NOT_FOUND', {
        invariant: 'reasoning_run_does_not_exist',
        reasoningRunId
      });
    }

    // --- lectura terminal idempotente ---------------------------------------
    if (run.status === ReasoningRunStatus.completed) {
      let result: VerifiedReasoningRunResult;
      try {
        result = verifyReasoningRunResultArtifact(run.resultArtifact);
      } catch {
        // Fallo CERRADO: un `completed` sin resultado legible es una
        // inconsistencia histórica y no se repara recalculando.
        failExecution('COMPLETED_RUN_RESULT_UNUSABLE', {
          invariant: 'a_completed_run_must_carry_a_verifiable_result',
          reasoningRunId
        });
      }
      return {
        reasoningRunId,
        result,
        executed: false,
        providerLogicalCalls: 0,
        requirementCount: result.requirementResults.length
      };
    }

    if (run.status === ReasoningRunStatus.failed || run.failureCode !== null) {
      failExecution('RUN_TERMINALLY_FAILED', {
        invariant: 'a_failed_run_is_not_restarted_in_place',
        reasoningRunId,
        observedStatus: run.status
      });
    }

    // Un `resultArtifact` presente sin `completed` es incoherencia persistida:
    // no se pisa, no se completa por las suyas y no se ejecuta encima.
    if (run.resultArtifact !== null) {
      failExecution('COMPLETED_RUN_RESULT_UNUSABLE', {
        invariant: 'a_result_artifact_may_not_exist_outside_a_completed_run',
        reasoningRunId,
        observedStatus: run.status
      });
    }

    // El snapshot tiene que ser legible antes de gastar nada.
    try {
      verifyObjectiveDefinitionArtifact(run.objectiveDefinitionSnapshot);
    } catch {
      failExecution('POLICY_INPUT_INCONSISTENT', {
        invariant: 'persisted_objective_snapshot_must_verify',
        reasoningRunId
      });
    }

    // --- deriva de versión de policy ----------------------------------------
    //
    // El plan congelado es autoritativo para el run. Si este proceso ejecuta otra
    // versión de policy, el run muere ANTES de la claim y sin comprar nada: correr
    // una policy nueva contra un plan viejo produciría un resultado que el plan no
    // describe.
    await this.assertPolicyVersionMatchesPlan(reasoningRunId, run.executionMetadata);

    return null;
  }

  private async assertPolicyVersionMatchesPlan(
    reasoningRunId: string,
    executionMetadata: Prisma.JsonValue | null
  ): Promise<void> {
    if (executionMetadata === null) return; // Todavía no hay plan: lo congela F3.3.

    const artifacts = await this.slots.readReasoningRunArtifacts(reasoningRunId);
    const planned = artifacts.executionMetadata?.deterministicPolicyVersion;
    if (planned === undefined) return;

    if (planned !== PRODUCT_DETERMINISTIC_POLICY_VERSION) {
      await this.prisma.reasoningRun.updateMany({
        where: {
          id: reasoningRunId,
          status: ReasoningRunStatus.pending,
          failureCode: null,
          resultArtifact: { equals: Prisma.DbNull }
        },
        data: {
          status: ReasoningRunStatus.failed,
          failureCode: REASONING_EXECUTION_PLAN_MISMATCH,
          failedAt: new Date()
        }
      });
      failExecution('DETERMINISTIC_POLICY_VERSION_MISMATCH', {
        invariant: 'frozen_plan_policy_version_must_match_this_process',
        reasoningRunId
      });
    }
  }

  // -------------------------------------------------------------------------
  // Ejecución reclamada
  // -------------------------------------------------------------------------

  private async runClaimed(
    claim: ReasoningRunExecutionClaim
  ): Promise<ReasoningRunExecutionOutcome> {
    const reasoningRunId = claim.reasoningRunId;
    let providerLogicalCalls = 0;

    try {
      // --- etapas semánticas, en el orden de dependencia congelado ----------
      //
      // F3.3 y F3.4 son semánticamente independientes; se ejecutan en este orden
      // porque es el de los slots y el de las etapas 1 y 2 del contrato. Ninguna
      // se re-compra si su artifact fill-once ya existe.
      const analysis = await this.objectiveAnalysis.ensureObjectiveAnalysisForRun(
        reasoningRunId,
        claim
      );
      if (analysis.providerCalled) providerLogicalCalls += 1;

      const evidence = await this.evidenceUnits.ensureEvidenceUnitsForRun(
        reasoningRunId,
        claim
      );
      if (evidence.providerCalled) providerLogicalCalls += 1;

      // FAIL_FAST intacto: si un Requirement corta, F3.5 lanza y acá NO se
      // construye un agregado parcial.
      const contextual = await this.contextual.generateContextualReasoningForRun(
        reasoningRunId,
        claim
      );
      providerLogicalCalls += contextual.providerCallsMade;

      // --- policy determinista: CERO llamadas ------------------------------
      //
      // Relectura AUTORITATIVA bajo la claim. El snapshot se relee de la fila y
      // los dos artifacts del servicio de slots, que los revalida: entre el
      // preflight y este punto hubo llamadas de red enteras.
      const run = await this.prisma.reasoningRun.findUnique({
        where: { id: reasoningRunId },
        select: { objectiveDefinitionSnapshot: true }
      });
      if (run === null) {
        failExecution('REASONING_RUN_NOT_FOUND', {
          invariant: 'reasoning_run_disappeared_during_execution',
          reasoningRunId
        });
      }

      let candidate: unknown;
      try {
        candidate = applyDeterministicReasoningPolicy({
          definition: verifyObjectiveDefinitionArtifact(
            run.objectiveDefinitionSnapshot
          ),
          objectiveAnalysis: analysis.artifact,
          evidenceUnits: evidence.artifact,
          contextualReasoning: contextual.contextualReasoning
        });
      } catch (error: unknown) {
        if (error instanceof DeterministicPolicyInputError) {
          await this.claims.failClaimed(claim, REASONING_POLICY_INPUT_INCONSISTENT);
          failExecution('POLICY_INPUT_INCONSISTENT', {
            invariant: error.invariant,
            reasoningRunId,
            requirementId: error.requirementId
          });
        }
        throw error;
      }

      const result = await this.finalize(claim, candidate);
      return {
        reasoningRunId,
        result,
        executed: true,
        providerLogicalCalls,
        requirementCount: result.requirementResults.length
      };
    } catch (error: unknown) {
      await this.resolveLifecycleFor(claim, error);
      throw error;
    }
  }

  /**
   * Traduce un error de etapa al lifecycle del run reclamado.
   *
   * Es la contracara de que las etapas ya no muevan el estado bajo claim: acá se
   * decide, en un solo lugar, si el intento fue transitorio o terminal.
   */
  private async resolveLifecycleFor(
    claim: ReasoningRunExecutionClaim,
    error: unknown
  ): Promise<void> {
    // Ya resuelto por quien lo lanzó — `failClaimed`/`failExecution` de policy.
    if (
      error instanceof Error &&
      error.name === 'ReasoningRunExecutionError'
    ) {
      return;
    }

    const code = (error as { code?: unknown }).code;
    if (typeof code !== 'string') {
      // Error no tipado: NO se adivina. El run vuelve a `pending` porque no hay
      // evidencia de que sea un desenlace epistemológico del run, y dejarlo
      // `running` para siempre por un error desconocido sería peor.
      await this.claims.releaseForRetry(claim);
      return;
    }

    if (RETRYABLE_STAGE_CODES.has(code)) {
      // running → pending, por el dueño actual y como ÚLTIMA acción del intento.
      await this.claims.releaseForRetry(claim);
      return;
    }

    const failureCode = TERMINAL_STAGE_FAILURE_CODES[code];
    if (failureCode !== undefined) {
      await this.claims.failClaimed(claim, failureCode);
      return;
    }

    // Códigos de etapa sin desenlace terminal declarado —`RUN_NOT_ELIGIBLE`,
    // `REASONING_RUN_NOT_FOUND`— no describen un fallo epistemológico del run:
    // se suelta la claim sin marcar nada.
    await this.claims.releaseForRetry(claim);
  }

  // -------------------------------------------------------------------------
  // Finalización atómica
  // -------------------------------------------------------------------------

  /**
   * `resultArtifact` + `status` + `completedAt` en UNA transición.
   *
   * NO es `fillResultArtifact()` seguido de `markCompleted()`, ni al revés: entre
   * las dos escrituras existiría una fila con resultado y sin `completed`, o
   * `completed` sin resultado, y las dos combinaciones están prohibidas por el
   * contrato. El CAS incluye la condición de propiedad del modelo de claim
   * elegido —`status = running`—, así que un intento que ya soltó la claim no
   * puede finalizar.
   *
   *     COMPLETED  ↔  resultArtifact PRESENTE Y VÁLIDO
   */
  private async finalize(
    claim: ReasoningRunExecutionClaim,
    candidate: unknown
  ): Promise<VerifiedReasoningRunResult> {
    const reasoningRunId = claim.reasoningRunId;

    // Verificación completa —forma + referencias cruzadas contra los dos
    // artifacts persistidos— con la MISMA autoridad que usa el slot, sin escribir.
    let verified: VerifiedReasoningRunResult;
    try {
      verified = await this.slots.verifyResultArtifactCandidate(
        reasoningRunId,
        candidate
      );
    } catch (error: unknown) {
      await this.claims.failClaimed(claim, REASONING_FINAL_RESULT_NOT_PERSISTABLE);
      throw error;
    }

    const completed = await this.prisma.reasoningRun.updateMany({
      where: {
        id: reasoningRunId,
        status: ReasoningRunStatus.running,
        failureCode: null,
        resultArtifact: { equals: Prisma.DbNull }
      },
      data: {
        resultArtifact: verified as never,
        status: ReasoningRunStatus.completed,
        completedAt: new Date()
      }
    });
    if (completed.count === 1) return verified;

    // --- CAS = 0: se relee y se CLASIFICA, sin sobreescribir nada -----------
    const run = await this.prisma.reasoningRun.findUnique({
      where: { id: reasoningRunId },
      select: { status: true, failureCode: true, resultArtifact: true }
    });
    if (run === null) {
      failExecution('REASONING_RUN_NOT_FOUND', {
        invariant: 'reasoning_run_disappeared_before_completion',
        reasoningRunId
      });
    }

    if (run.resultArtifact !== null) {
      // Otra finalización ganó. FILL-ONCE: no se pisa, se converge si es el mismo
      // resultado —la policy es determinista, así que dos intentos con las mismas
      // entradas producen exactamente lo mismo— y se falla si no lo es.
      const persisted = verifyReasoningRunResultArtifact(run.resultArtifact);
      if (canonicalJson(persisted) === canonicalJson(verified)) return persisted;

      failExecution('FINAL_RESULT_NOT_PERSISTABLE', {
        invariant: 'a_persisted_final_result_is_never_overwritten',
        reasoningRunId,
        observedStatus: run.status
      });
    }

    // Sin resultado y sin haber ganado: o un fallo terminal se adelantó, o esta
    // ejecución ya no es la dueña. En ninguno de los dos casos se escribe.
    failExecution('FINAL_RESULT_NOT_PERSISTABLE', {
      invariant:
        run.failureCode !== null
          ? 'a_terminal_failure_won_the_race'
          : 'execution_ownership_was_lost_before_completion',
      reasoningRunId,
      observedStatus: run.status
    });
  }
}

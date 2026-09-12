/**
 * Ejecución productiva del Objective Analysis — slice F3.3B.
 *
 * Una etapa, un run, una llamada lógica al proveedor:
 *
 *     artifact PRESENTE            -> éxito idempotente, CERO llamadas
 *     run no elegible              -> se rechaza, sin tocar la fila
 *     plan ABSENTE                 -> se congela COMPLETO, antes de llamar
 *     plan ≠ configuración         -> fallo TERMINAL, CERO llamadas
 *     proveedor rechaza el plan    -> fallo TERMINAL, sin reintento
 *     salida completa e inválida   -> fallo TERMINAL, sin volver a preguntar
 *     sin respuesta utilizable     -> run intacto, reintentable
 *
 * LA AUTORIDAD SE CARGA DE LA FILA. `ensureObjectiveAnalysisForRun` recibe SÓLO
 * el id del run. No hay parámetro de ownership, ni de Requirements, ni de
 * configuración: si el llamante pudiera pasar el Objective, podría pasar OTRO
 * Objective, y el snapshot congelado dejaría de ser la autoridad del run. El
 * ownership ya quedó decidido cuando F3.2 creó la fila.
 *
 * SIN CONTROLLER. F3.3B no expone superficie HTTP; la API privada sigue siendo
 * F3.7. Y sin lifecycle genérico: las dos transiciones que existen acá son
 * condicionales, específicas de esta etapa, y no hay `startRun`/`completeRun`.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Prisma, ReasoningRunStatus } from '@prisma/client';

import { AiServiceClient } from '../ai/ai-service.client';
import {
  ObjectiveAnalysisTransportError,
  type AnalyzeObjectiveExecutionPlan
} from '../ai/ai-service.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  eligibleRunStatusFor,
  type ReasoningRunExecutionClaim
} from './reasoning-run-execution-claim.service';
import { verifyObjectiveDefinitionArtifact } from '../objectives/objective-definition.validator';
import { ReasoningRunArtifactSlotService } from './reasoning-run-artifact-slot.service';
import { ReasoningRunArtifactError } from './reasoning-run-artifact.errors';
import {
  REASONING_EXECUTION_METADATA_SCHEMA_VERSION,
  type StageExecutionPlan,
  type VerifiedObjectiveAnalysis,
  type VerifiedReasoningExecutionMetadata
} from './reasoning-run-artifact.types';
import {
  CONTEXTUAL_REASONING_STAGE_IDENTITY,
  EVIDENCE_UNITS_STAGE_IDENTITY,
  OBJECTIVE_ANALYSIS_REQUEST_SCHEMA_VERSION,
  OBJECTIVE_ANALYSIS_RESPONSE_SCHEMA_VERSION,
  OBJECTIVE_ANALYSIS_STAGE_IDENTITY,
  PRODUCT_DETERMINISTIC_POLICY_VERSION,
  PRODUCT_EXECUTION_PROVIDER,
  PRODUCT_REASONER_CONTRACT_VERSION,
  PRODUCT_REASONING_EFFORT,
  configuredExecutionModel
} from './product-stage-identity';
import {
  REASONING_EXECUTION_PLAN_MISMATCH,
  REASONING_OBJECTIVE_ANALYSIS_INVALID_OUTPUT,
  REASONING_PROVIDER_CONFIGURATION_INVALID,
  failStage
} from './reasoning-run-objective-analysis.errors';
import { UNKNOWN_INVALID_OUTPUT_SUBCODE } from '../ai/ai-service-invalid-output-diagnostics';
import { logReasoningAiServiceFailure } from './reasoning-run-diagnostics';

const RUN_SELECT = {
  id: true,
  status: true,
  failureCode: true,
  objectiveDefinitionSnapshot: true,
  objectiveAnalysisArtifact: true,
  executionMetadata: true
} as const;

interface RunRow {
  id: string;
  status: ReasoningRunStatus;
  failureCode: string | null;
  objectiveDefinitionSnapshot: unknown;
  objectiveAnalysisArtifact: unknown;
  executionMetadata: unknown;
}

/** Observación del modelo efectivo, tal como la informó el AI service. */
export type EffectiveModelVerification = 'MATCH' | 'UNAVAILABLE';

export interface ObjectiveAnalysisOutcome {
  readonly reasoningRunId: string;
  readonly artifact: VerifiedObjectiveAnalysis;
  /** `false` cuando el artifact ya estaba persistido: el reintento no llama. */
  readonly providerCalled: boolean;
  /**
   * Sólo cuando hubo llamada. NO se persiste: es una observación de ejecución,
   * no parte del artifact ni del plan, y `executionMetadata` es un plan.
   */
  readonly effectiveModelVerification: EffectiveModelVerification | null;
}

@Injectable()
export class ReasoningRunObjectiveAnalysisService {
  private readonly logger = new Logger(ReasoningRunObjectiveAnalysisService.name);

  public constructor(
    private readonly prisma: PrismaService,
    private readonly slots: ReasoningRunArtifactSlotService,
    private readonly ai: AiServiceClient
  ) {}

  /**
   * Garantiza que el run tenga su `objective_analysis_v1` persistido.
   *
   * "Ensure" y no "create": llamar dos veces no produce dos artifacts, y la
   * segunda vez no llama al proveedor. La honestidad de esa afirmación tiene un
   * límite conocido y documentado —si el proceso cae DESPUÉS de recibir la
   * respuesta y ANTES de persistir, un reintento produce una segunda observación
   * física del proveedor—. Lo que sí queda garantizado es lo que importa:
   * exactamente UN artifact persistido.
   */
  public async ensureObjectiveAnalysisForRun(
    reasoningRunId: string,
    /**
     * F3.6. Presente SOLO cuando esta etapa corre dentro de una ejecucion que ya
     * gano la claim exclusiva del run. Sin ella, la etapa conserva exactamente su
     * semantica anterior de entrypoint directo.
     */
    claim?: ReasoningRunExecutionClaim
  ): Promise<ObjectiveAnalysisOutcome> {
    const run = await this.loadRun(reasoningRunId);

    const existing = await this.readPersistedArtifact(run);
    if (existing !== null) {
      return {
        reasoningRunId,
        artifact: existing,
        providerCalled: false,
        effectiveModelVerification: null
      };
    }

    this.assertEligible(run, claim);

    const metadata = await this.ensureExecutionPlan(run);
    const plan = await this.requireMatchingObjectiveAnalysisPlan(
      reasoningRunId,
      metadata.objectiveAnalysis
    );

    const definition = this.confirmedObjective(run);

    let envelope: unknown;
    try {
      envelope = await this.ai.analyzeObjective({
        schemaVersion: OBJECTIVE_ANALYSIS_REQUEST_SCHEMA_VERSION,
        executionPlan: plan,
        objectiveType: definition.objectiveType,
        objectiveContext: definition.objectiveContext,
        // Sólo id y texto. El transporte no tiene forma de llevar evidencia.
        requirements: definition.requirements.map((item) => ({
          requirementId: item.requirementId,
          requirementText: item.requirementText
        })),
        correlationId: reasoningRunId
      });
    } catch (error: unknown) {
      return await this.handleTransportFailure(reasoningRunId, error);
    }

    const { artifact: candidate, verification } = this.readEnvelope(
      reasoningRunId,
      envelope
    );

    // La verificación de anclaje y del conjunto de Requirements corre acá otra
    // vez, contra el snapshot PERSISTIDO. No es redundancia: el AI service
    // verificó contra lo que dijo haber recibido; esto verifica contra la
    // autoridad del run.
    const artifact = await this.persistArtifact(reasoningRunId, candidate, claim);

    return {
      reasoningRunId,
      artifact,
      providerCalled: true,
      effectiveModelVerification: verification
    };
  }

  // -------------------------------------------------------------------------
  // Estado del run
  // -------------------------------------------------------------------------

  private async loadRun(reasoningRunId: string): Promise<RunRow> {
    const run = await this.prisma.reasoningRun.findUnique({
      where: { id: reasoningRunId },
      select: RUN_SELECT
    });
    if (!run) {
      failStage('REASONING_RUN_NOT_FOUND', {
        invariant: 'reasoning_run_does_not_exist',
        reasoningRunId
      });
    }
    return run as RunRow;
  }

  private async readPersistedArtifact(
    run: RunRow
  ): Promise<VerifiedObjectiveAnalysis | null> {
    if (run.objectiveAnalysisArtifact === null) return null;
    // Se relee por el servicio de slots para que un artifact corrupto sea
    // CORRUPCIÓN y no un input aceptable.
    const artifacts = await this.slots.readReasoningRunArtifacts(run.id);
    return artifacts.objectiveAnalysis;
  }

  /**
   * Elegibilidad ANTES de gastar una llamada al proveedor.
   *
   * No alcanza por sí sola: entre esta lectura y la escritura del artifact hay
   * una llamada de red entera, y por eso el CAS del slot vuelve a exigir el mismo
   * estado. Ésta evita el trabajo; aquélla garantiza la coherencia de la fila.
   */
  private assertEligible(
    run: RunRow,
    claim: ReasoningRunExecutionClaim | undefined
  ): void {
    if (claim !== undefined && claim.reasoningRunId !== run.id) {
      // Una claim de OTRO run no autoriza nada acá: la capability nombra la
      // fila que reclamó, no "alguna fila".
      failStage('RUN_NOT_ELIGIBLE', {
        invariant: 'execution_claim_must_name_this_reasoning_run',
        reasoningRunId: run.id
      });
    }
    if (run.status !== eligibleRunStatusFor(claim) || run.failureCode !== null) {
      failStage('RUN_NOT_ELIGIBLE', {
        invariant: 'objective_analysis_requires_an_eligible_run_without_failure',
        reasoningRunId: run.id
      });
    }
  }

  private confirmedObjective(run: RunRow) {
    try {
      return verifyObjectiveDefinitionArtifact(run.objectiveDefinitionSnapshot);
    } catch {
      // Un snapshot ilegible no es un fallo del proveedor ni del plan: es
      // corrupción, y no se le manda nada a nadie con ella.
      failStage('INTERNAL_AI_SERVICE_FAILURE', {
        invariant: 'persisted_objective_snapshot_must_verify',
        reasoningRunId: run.id
      });
    }
  }

  // -------------------------------------------------------------------------
  // Plan de ejecución
  // -------------------------------------------------------------------------

  /**
   * El plan COMPLETO, congelado antes de la primera llamada.
   *
   * Si ya está persistido, ÉSE es el plan: no se recalcula ni se "actualiza" con
   * la configuración de hoy. Un plan que se reescribe solo no es un compromiso.
   */
  private async ensureExecutionPlan(
    run: RunRow
  ): Promise<VerifiedReasoningExecutionMetadata> {
    if (run.executionMetadata !== null) {
      const artifacts = await this.slots.readReasoningRunArtifacts(run.id);
      if (artifacts.executionMetadata !== null) return artifacts.executionMetadata;
    }

    const model = configuredExecutionModel();
    if (model === null) {
      // NO se escribe un plan incompleto para salir del paso: con fill-once, una
      // etapa indeterminada no podría completarse nunca.
      failStage('EXECUTION_CONFIGURATION_MISSING', {
        invariant: 'requested_model_must_be_configured_before_freezing_a_plan',
        reasoningRunId: run.id
      });
    }

    return this.slots.fillExecutionMetadata(run.id, {
      schemaVersion: REASONING_EXECUTION_METADATA_SCHEMA_VERSION,
      reasonerContractVersion: PRODUCT_REASONER_CONTRACT_VERSION,
      deterministicPolicyVersion: PRODUCT_DETERMINISTIC_POLICY_VERSION,
      // Las tres etapas se nombran ahora aunque dos todavía no existan. Es lo que
      // hace que un run creado en esta ventana falle cerrado si F3.4/F3.5 llegan
      // con otras identidades — y ese run no podía completarse igual.
      objectiveAnalysis: this.stagePlan(OBJECTIVE_ANALYSIS_STAGE_IDENTITY, model),
      evidenceUnits: this.stagePlan(EVIDENCE_UNITS_STAGE_IDENTITY, model),
      contextualReasoning: this.stagePlan(CONTEXTUAL_REASONING_STAGE_IDENTITY, model)
    });
  }

  private stagePlan(
    identity: { artifactSchemaVersion: string; promptVersion: string; adapterVersion: string },
    model: string
  ) {
    return {
      artifactSchemaVersion: identity.artifactSchemaVersion,
      promptVersion: identity.promptVersion,
      adapterVersion: identity.adapterVersion,
      provider: {
        provider: PRODUCT_EXECUTION_PROVIDER,
        model,
        reasoningEffort: PRODUCT_REASONING_EFFORT
      }
    };
  }

  /**
   * `CONFIG_DRIFT_POLICY: FAIL_CLOSED`, del lado de NestJS.
   *
   * El AI service comparará otra vez desde el suyo. Los dos comparan a propósito:
   * NestJS es dueño del plan congelado y el AI service es dueño de la
   * implementación, y ninguno confía en el otro por convención.
   */
  private async requireMatchingObjectiveAnalysisPlan(
    reasoningRunId: string,
    plan: StageExecutionPlan
  ): Promise<AnalyzeObjectiveExecutionPlan> {
    const model = configuredExecutionModel();
    const matches =
      plan.artifactSchemaVersion ===
        OBJECTIVE_ANALYSIS_STAGE_IDENTITY.artifactSchemaVersion &&
      plan.promptVersion === OBJECTIVE_ANALYSIS_STAGE_IDENTITY.promptVersion &&
      plan.adapterVersion === OBJECTIVE_ANALYSIS_STAGE_IDENTITY.adapterVersion &&
      plan.provider !== null &&
      plan.provider.provider === PRODUCT_EXECUTION_PROVIDER &&
      plan.provider.reasoningEffort === PRODUCT_REASONING_EFFORT &&
      model !== null &&
      plan.provider.model === model;

    if (!matches || plan.provider === null) {
      return await this.failTerminally(
        reasoningRunId,
        REASONING_EXECUTION_PLAN_MISMATCH,
        'EXECUTION_PLAN_MISMATCH',
        'frozen_plan_must_match_the_deployed_configuration'
      );
    }

    return {
      artifactSchemaVersion: plan.artifactSchemaVersion,
      // Ya se comprobo la igualdad; se usa la constante porque `promptVersion` es
      // `string | null` en el contrato y el guard no estrecha ese tipo. El valor
      // es el mismo — si no lo fuera, no se habria llegado hasta aca.
      promptVersion: OBJECTIVE_ANALYSIS_STAGE_IDENTITY.promptVersion,
      adapterVersion: plan.adapterVersion,
      provider: plan.provider.provider,
      model: plan.provider.model,
      reasoningEffort: PRODUCT_REASONING_EFFORT
    };
  }

  // -------------------------------------------------------------------------
  // Respuesta
  // -------------------------------------------------------------------------

  private async handleTransportFailure(
    reasoningRunId: string,
    error: unknown
  ): Promise<never> {
    if (!(error instanceof ObjectiveAnalysisTransportError)) throw error;

    switch (error.code) {
      case 'EXECUTION_PLAN_MISMATCH':
        return await this.failTerminally(
          reasoningRunId,
          REASONING_EXECUTION_PLAN_MISMATCH,
          'EXECUTION_PLAN_MISMATCH',
          'ai_service_rejected_the_frozen_plan'
        );
      case 'PROVIDER_INVALID_OUTPUT':
        // Diagnostico interno. NO cambia la clasificacion ni el desenlace:
        // el `failTerminally` de abajo es exactamente el que ya estaba.
        logReasoningAiServiceFailure(this.logger, {
          stage: 'objective_analysis',
          operationalCode: REASONING_OBJECTIVE_ANALYSIS_INVALID_OUTPUT,
          upstreamCode: 'PROVIDER_INVALID_OUTPUT',
          upstreamSubcode: error.invalidOutputSubcode ?? UNKNOWN_INVALID_OUTPUT_SUBCODE,
          reasoningRunReference: reasoningRunId,
        });
        return await this.failTerminally(
          reasoningRunId,
          REASONING_OBJECTIVE_ANALYSIS_INVALID_OUTPUT,
          'PROVIDER_INVALID_OUTPUT',
          'provider_responded_in_full_with_a_non_conforming_output'
        );
      case 'PROVIDER_CONFIGURATION_FAILURE':
        // Terminal: el plan congelado es insatisfacible tal como está. Corregir
        // la configuración necesita un run nuevo, no un reintento de éste.
        return await this.failTerminally(
          reasoningRunId,
          REASONING_PROVIDER_CONFIGURATION_INVALID,
          'PROVIDER_CONFIGURATION_FAILURE',
          'provider_deterministically_rejected_the_frozen_plan'
        );
      case 'PROVIDER_TRANSPORT_FAILURE':
        // El run queda INTACTO: sigue pending, el artifact sigue ABSENT y el plan
        // sigue coincidiendo, así que el reintento en la misma fila es legítimo.
        failStage('PROVIDER_TRANSPORT_FAILURE', {
          invariant: 'no_usable_semantic_response_was_obtained',
          reasoningRunId
        });
      default:
        failStage('INTERNAL_AI_SERVICE_FAILURE', {
          invariant: 'ai_service_failed_for_a_reason_that_is_not_a_run_outcome',
          reasoningRunId
        });
    }
  }

  /**
   * Lee el envelope del AI service.
   *
   * Un envelope que no se entiende NO es salida inválida del proveedor: es un
   * desajuste de despliegue entre los dos servicios. Se trata como reintentable
   * para no matar runs por un deploy a medias.
   */
  private readEnvelope(
    reasoningRunId: string,
    envelope: unknown
  ): { artifact: unknown; verification: EffectiveModelVerification | null } {
    if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) {
      failStage('INTERNAL_AI_SERVICE_FAILURE', {
        invariant: 'objective_analysis_response_must_be_an_object',
        reasoningRunId
      });
    }

    const body = envelope as Record<string, unknown>;
    if (body.schemaVersion !== OBJECTIVE_ANALYSIS_RESPONSE_SCHEMA_VERSION) {
      failStage('INTERNAL_AI_SERVICE_FAILURE', {
        invariant: 'objective_analysis_response_schema_version_unsupported',
        reasoningRunId
      });
    }

    const execution = body.execution;
    const reported =
      typeof execution === 'object' && execution !== null
        ? (execution as Record<string, unknown>).effectiveModelVerification
        : null;

    return {
      artifact: body.artifact,
      verification: reported === 'MATCH' || reported === 'UNAVAILABLE' ? reported : null
    };
  }

  /**
   * Persiste con el CAS endurecido del slot.
   *
   * Un artifact que no supera la validación o la verificación cruzada es
   * `ReasoningRunArtifactError` y significa una cosa concreta: el proveedor
   * respondió entero y su salida no sirve. Eso mata el run. Un error de SLOT
   * —conflicto, corrupción, run no elegible— es otra cosa y se propaga tal cual:
   * no es un juicio sobre la salida del modelo.
   */
  private async persistArtifact(
    reasoningRunId: string,
    candidate: unknown,
    claim: ReasoningRunExecutionClaim | undefined
  ): Promise<VerifiedObjectiveAnalysis> {
    try {
      return await this.slots.fillObjectiveAnalysisArtifact(
        reasoningRunId,
        candidate,
        claim
      );
    } catch (error: unknown) {
      if (error instanceof ReasoningRunArtifactError) {
        return await this.failTerminally(
          reasoningRunId,
          REASONING_OBJECTIVE_ANALYSIS_INVALID_OUTPUT,
          'PROVIDER_INVALID_OUTPUT',
          'provider_output_does_not_verify_against_the_frozen_snapshot'
        );
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Transiciones terminales — condicionales y específicas de esta etapa
  // -------------------------------------------------------------------------

  /**
   * Marca el fallo terminal y lanza el código cerrado.
   *
   * La transición es CONDICIONAL sobre el mismo estado elegible que el CAS del
   * artifact: `pending`, sin `failureCode` y con el slot ABSENT. Así el éxito y
   * el fallo terminal compiten por el mismo estado en vez de escribir columnas
   * distintas sin verse, y `failed` CON artifact de etapa deja de ser alcanzable
   * por este camino de escritura.
   *
   * Si la transición no aplica, NO se pisa nada. La fila ya dijo otra cosa —o
   * ganó un éxito concurrente, o ya había fallado— y la fila es la autoridad.
   */
  private async failTerminally(
    reasoningRunId: string,
    failureCode: string,
    stageCode:
      | 'EXECUTION_PLAN_MISMATCH'
      | 'PROVIDER_INVALID_OUTPUT'
      | 'PROVIDER_CONFIGURATION_FAILURE',
    invariant: string
  ): Promise<never> {
    await this.markTerminalFailure(reasoningRunId, failureCode);
    failStage(stageCode, { invariant, reasoningRunId });
  }

  /**
   * Transicion terminal CONDICIONAL sobre `pending`.
   *
   * BAJO UNA CLAIM EXCLUSIVA ESTO NO HACE NADA, Y ES DELIBERADO: la fila esta en
   * `running`, el CAS afecta 0 filas, y el lifecycle del intento reclamado lo
   * decide el orquestador de F3.6, que es su unica autoridad. La etapa se limita
   * a lanzar su error tipado. Sin claim —entrypoint directo— sigue siendo la
   * transicion terminal de siempre.
   */
  private async markTerminalFailure(
    reasoningRunId: string,
    failureCode: string
  ): Promise<void> {
    await this.prisma.reasoningRun.updateMany({
      where: {
        id: reasoningRunId,
        status: ReasoningRunStatus.pending,
        failureCode: null,
        // `Json?`: Prisma exige el sentinel, no `null`.
        objectiveAnalysisArtifact: { equals: Prisma.DbNull }
      },
      data: {
        status: ReasoningRunStatus.failed,
        failureCode,
        failedAt: new Date()
      }
    });
  }
}

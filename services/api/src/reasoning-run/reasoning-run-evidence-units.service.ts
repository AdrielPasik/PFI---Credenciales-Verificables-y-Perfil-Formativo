/**
 * Ejecución productiva del catálogo de EvidenceUnits — slice F3.4.
 *
 *     artifact PRESENTE                 -> éxito idempotente, CERO llamadas
 *     run no elegible                   -> se rechaza, sin tocar la fila
 *     grounding set inutilizable        -> fallo TERMINAL, CERO llamadas
 *     plan ≠ configuración              -> fallo TERMINAL, CERO llamadas
 *     salida completa e inválida        -> fallo TERMINAL, sin volver a preguntar
 *     sin respuesta utilizable          -> run intacto, reintentable
 *
 * EL GROUNDING SET SE VERIFICA ENTERO ANTES DE LA PRIMERA LLAMADA. No alcanza con
 * verificar cada fuente a medida que se usa: si la quinta fuente resultara
 * corrupta después de haber llamado al proveedor, el run habría gastado una
 * observación sobre un universo que no era el suyo, y el catálogo describiría un
 * conjunto de fuentes que nadie congeló. O sirve todo, o no se llama.
 *
 * LA AUTORIDAD SE CARGA DE LA FILA. Se recibe SÓLO el id del run. Ni fuentes, ni
 * extracciones, ni SHAs, ni configuración: el universo de evidencia ya quedó
 * congelado por F3.2 y volver a elegirlo acá lo convertiría en otro run.
 *
 * INDEPENDENCIA DE ETAPAS. NO se exige `objectiveAnalysisArtifact`: F3.1 congeló
 * las dos etapas como artifacts independientes, y este stage es
 * objective-independent — no mira el Objective ni podría.
 *
 * SIN CONTROLLER. La API privada sigue siendo F3.7.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Prisma, ReasoningRunStatus } from '@prisma/client';

import { AiServiceClient } from '../ai/ai-service.client';
import {
  ObjectiveAnalysisTransportError,
  type AnalyzeEvidenceUnitsSource,
  type AnalyzeObjectiveExecutionPlan
} from '../ai/ai-service.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  eligibleRunStatusFor,
  type ReasoningRunExecutionClaim
} from './reasoning-run-execution-claim.service';
import { type VerifiedSourceExtractionArtifact } from '../source-extraction/source-extraction-artifact.types';
import {
  GroundingUnusableError,
  ReasoningRunGroundingLoader,
  type GroundedSource
} from './reasoning-run-grounding.loader';
import { ReasoningRunArtifactSlotService } from './reasoning-run-artifact-slot.service';
import { ReasoningRunArtifactError } from './reasoning-run-artifact.errors';
import {
  REASONING_EXECUTION_METADATA_SCHEMA_VERSION,
  type StageExecutionPlan,
  type VerifiedEvidenceUnits,
  type VerifiedReasoningExecutionMetadata
} from './reasoning-run-artifact.types';
import {
  CONTEXTUAL_REASONING_STAGE_IDENTITY,
  EVIDENCE_UNITS_REQUEST_SCHEMA_VERSION,
  EVIDENCE_UNITS_RESPONSE_SCHEMA_VERSION,
  EVIDENCE_UNITS_STAGE_IDENTITY,
  OBJECTIVE_ANALYSIS_STAGE_IDENTITY,
  PRODUCT_DETERMINISTIC_POLICY_VERSION,
  PRODUCT_EXECUTION_PROVIDER,
  PRODUCT_REASONER_CONTRACT_VERSION,
  PRODUCT_REASONING_EFFORT,
  configuredExecutionModel
} from './product-stage-identity';
import {
  REASONING_EVIDENCE_UNITS_GROUNDING_UNUSABLE,
  REASONING_EVIDENCE_UNITS_INVALID_OUTPUT,
  failEvidenceUnitsStage
} from './reasoning-run-evidence-units.errors';
import {
  REASONING_EXECUTION_PLAN_MISMATCH,
  REASONING_PROVIDER_CONFIGURATION_INVALID
} from './reasoning-run-objective-analysis.errors';
import {
  verifyEvidenceUnitsAgainstSourceExtractions,
  type VerifiedExtractionsByRunLocalSourceId
} from './evidence-units-source-addressable.verifier';
import { UNKNOWN_INVALID_OUTPUT_SUBCODE } from '../ai/ai-service-invalid-output-diagnostics';
import { logReasoningAiServiceFailure } from './reasoning-run-diagnostics';

const INCLUDED = 'INCLUDED';

const RUN_SELECT = {
  id: true,
  status: true,
  failureCode: true,
  evidenceUnitsArtifact: true,
  executionMetadata: true
} as const;

interface RunRow {
  id: string;
  status: ReasoningRunStatus;
  failureCode: string | null;
  evidenceUnitsArtifact: unknown;
  executionMetadata: unknown;
}

export type EffectiveModelVerification = 'MATCH' | 'UNAVAILABLE';

export interface EvidenceUnitsOutcome {
  readonly reasoningRunId: string;
  readonly artifact: VerifiedEvidenceUnits;
  /** `false` con el artifact ya persistido, y también con cero fuentes incluidas. */
  readonly providerCalled: boolean;
  readonly effectiveModelVerification: EffectiveModelVerification | null;
  readonly includedSourceCount: number;
}

@Injectable()
export class ReasoningRunEvidenceUnitsService {
  private readonly logger = new Logger(ReasoningRunEvidenceUnitsService.name);

  public constructor(
    private readonly prisma: PrismaService,
    private readonly slots: ReasoningRunArtifactSlotService,
    private readonly grounding: ReasoningRunGroundingLoader,
    private readonly ai: AiServiceClient
  ) {}

  public async ensureEvidenceUnitsForRun(
    reasoningRunId: string,
    /**
     * F3.6. Presente SOLO cuando esta etapa corre dentro de una ejecucion que ya
     * gano la claim exclusiva del run. Sin ella, la etapa conserva exactamente su
     * semantica anterior de entrypoint directo.
     */
    claim?: ReasoningRunExecutionClaim
  ): Promise<EvidenceUnitsOutcome> {
    const run = await this.loadRun(reasoningRunId);

    if (run.evidenceUnitsArtifact !== null) {
      const artifacts = await this.slots.readReasoningRunArtifacts(reasoningRunId);
      const existing = artifacts.evidenceUnits;
      if (existing !== null) {
        return {
          reasoningRunId,
          artifact: existing,
          providerCalled: false,
          effectiveModelVerification: null,
          includedSourceCount: existing.sources.length
        };
      }
    }

    this.assertEligible(run, claim);

    // El grounding set COMPLETO, verificado, antes de mirar siquiera el plan del
    // proveedor. Si algo del universo congelado ya no sirve, no hay etapa.
    const grounded = await this.loadVerifiedGroundingSet(reasoningRunId);

    const metadata = await this.ensureExecutionPlan(run);
    const plan = await this.requireMatchingEvidenceUnitsPlan(
      reasoningRunId,
      metadata.evidenceUnits
    );

    let envelope: unknown;
    try {
      envelope = await this.ai.analyzeEvidenceUnits({
        schemaVersion: EVIDENCE_UNITS_REQUEST_SCHEMA_VERSION,
        executionPlan: plan,
        sources: grounded.map((item) => this.toTransportSource(item)),
        correlationId: reasoningRunId
      });
    } catch (error: unknown) {
      return await this.handleTransportFailure(reasoningRunId, error);
    }

    const { artifact: candidate, verification, providerCalled } = this.readEnvelope(
      reasoningRunId,
      envelope
    );

    const artifact = await this.persistArtifact(
      reasoningRunId,
      candidate,
      grounded,
      claim
    );

    return {
      reasoningRunId,
      artifact,
      providerCalled,
      effectiveModelVerification: verification,
      includedSourceCount: grounded.length
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
      failEvidenceUnitsStage('REASONING_RUN_NOT_FOUND', {
        invariant: 'reasoning_run_does_not_exist',
        reasoningRunId
      });
    }
    return run as RunRow;
  }

  /**
   * NO exige `objectiveAnalysisArtifact`: las dos etapas son independientes.
   */
  private assertEligible(
    run: RunRow,
    claim: ReasoningRunExecutionClaim | undefined
  ): void {
    if (claim !== undefined && claim.reasoningRunId !== run.id) {
      // Una claim de OTRO run no autoriza nada acá: la capability nombra la
      // fila que reclamó, no "alguna fila".
      failEvidenceUnitsStage('RUN_NOT_ELIGIBLE', {
        invariant: 'execution_claim_must_name_this_reasoning_run',
        reasoningRunId: run.id
      });
    }
    if (run.status !== eligibleRunStatusFor(claim) || run.failureCode !== null) {
      failEvidenceUnitsStage('RUN_NOT_ELIGIBLE', {
        invariant: 'evidence_units_require_an_eligible_run_without_failure',
        reasoningRunId: run.id
      });
    }
  }

  // -------------------------------------------------------------------------
  // Grounding set
  // -------------------------------------------------------------------------

  /**
   * Carga y verifica TODAS las fuentes INCLUIDAS del run.
   *
   * Delega en el cargador compartido: F3.5 hace exactamente la misma
   * verificación antes de razonar, y dos copias de este camino terminarían
   * verificando cosas distintas.
   *
   * El cargador lanza un error NEUTRO; el `failureCode` del run lo decide esta
   * etapa, que es la que descubrió el problema.
   */
  private async loadVerifiedGroundingSet(
    reasoningRunId: string
  ): Promise<readonly GroundedSource[]> {
    try {
      return await this.grounding.loadVerifiedGroundingSet(reasoningRunId);
    } catch (error: unknown) {
      if (error instanceof GroundingUnusableError) {
        return await this.failGrounding(
          reasoningRunId,
          error.invariant,
          error.runLocalSourceId
        );
      }
      throw error;
    }
  }

  /**
   * Fallo TERMINAL de grounding.
   *
   * No se toca la disposición del inventario: `INCLUDED` afirma lo que se observó
   * cuando el run se congeló, y reescribirlo ahora borraría ese hecho para hacer
   * que el run "cierre bien".
   */
  private async failGrounding(
    reasoningRunId: string,
    invariant: string,
    runLocalSourceId?: string
  ): Promise<never> {
    await this.markTerminalFailure(
      reasoningRunId,
      REASONING_EVIDENCE_UNITS_GROUNDING_UNUSABLE
    );
    failEvidenceUnitsStage('GROUNDING_INPUT_UNUSABLE', {
      invariant,
      reasoningRunId,
      runLocalSourceId
    });
  }

  /**
   * Proyecta la fuente verificada al contrato de transporte.
   *
   * Sólo material source-addressable: NO viaja `credentialId`,
   * `documentEvidenceId`, `textEvidenceId`, el id del `AnalysisRunSource` ni el
   * `artifactBlobSha256`. Los diagnósticos viajan como sus CÓDIGOS cerrados, no
   * como su detalle, que puede llevar texto.
   */
  private toTransportSource(source: GroundedSource): AnalyzeEvidenceUnitsSource {
    const artifact = source.artifact;
    return {
      sourceId: source.runLocalSourceId,
      sourceSha256: source.sourceSha256,
      coverageStatus: artifact.coverageStatus,
      canonicalText: artifact.documentCanonicalText,
      // `pageIndex` viaja porque es el CONTENEDOR de `charStart`/`charEnd`. Se
      // copia del artifact verificado; no se convierte a coordenadas globales
      // aca. Traducirlas dejaria un `segmentId` `p1:0-55` junto a offsets
      // globales, o sea identidad y coordenadas en marcos distintos.
      segments: artifact.segments.map((segment) => ({
        segmentId: segment.segmentId,
        pageIndex: segment.pageIndex,
        charStart: segment.charStart,
        charEnd: segment.charEnd,
        exactExcerpt: segment.exactExcerpt
      })),
      pages: artifact.pages.map((page) => ({
        pageNumber: page.pageNumber,
        pageOffsetStart: page.pageOffsetStart,
        pageOffsetEnd: page.pageOffsetEnd
      })),
      diagnostics: artifact.diagnostics.map((diagnostic) => diagnostic.code)
    };
  }

  // -------------------------------------------------------------------------
  // Plan de ejecución
  // -------------------------------------------------------------------------

  private async ensureExecutionPlan(
    run: RunRow
  ): Promise<VerifiedReasoningExecutionMetadata> {
    if (run.executionMetadata !== null) {
      const artifacts = await this.slots.readReasoningRunArtifacts(run.id);
      if (artifacts.executionMetadata !== null) return artifacts.executionMetadata;
    }

    const model = configuredExecutionModel();
    if (model === null) {
      failEvidenceUnitsStage('EXECUTION_CONFIGURATION_MISSING', {
        invariant: 'requested_model_must_be_configured_before_freezing_a_plan',
        reasoningRunId: run.id
      });
    }

    return this.slots.fillExecutionMetadata(run.id, {
      schemaVersion: REASONING_EXECUTION_METADATA_SCHEMA_VERSION,
      reasonerContractVersion: PRODUCT_REASONER_CONTRACT_VERSION,
      deterministicPolicyVersion: PRODUCT_DETERMINISTIC_POLICY_VERSION,
      objectiveAnalysis: this.stagePlan(OBJECTIVE_ANALYSIS_STAGE_IDENTITY, model),
      evidenceUnits: this.stagePlan(EVIDENCE_UNITS_STAGE_IDENTITY, model),
      contextualReasoning: this.stagePlan(CONTEXTUAL_REASONING_STAGE_IDENTITY, model)
    });
  }

  private stagePlan(
    identity: {
      artifactSchemaVersion: string;
      promptVersion: string;
      adapterVersion: string;
    },
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

  private async requireMatchingEvidenceUnitsPlan(
    reasoningRunId: string,
    plan: StageExecutionPlan
  ): Promise<AnalyzeObjectiveExecutionPlan> {
    const model = configuredExecutionModel();
    const matches =
      plan.artifactSchemaVersion === EVIDENCE_UNITS_STAGE_IDENTITY.artifactSchemaVersion &&
      plan.promptVersion === EVIDENCE_UNITS_STAGE_IDENTITY.promptVersion &&
      plan.adapterVersion === EVIDENCE_UNITS_STAGE_IDENTITY.adapterVersion &&
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
      promptVersion: EVIDENCE_UNITS_STAGE_IDENTITY.promptVersion,
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
          stage: 'evidence_units',
          operationalCode: REASONING_EVIDENCE_UNITS_INVALID_OUTPUT,
          upstreamCode: 'PROVIDER_INVALID_OUTPUT',
          upstreamSubcode: error.invalidOutputSubcode ?? UNKNOWN_INVALID_OUTPUT_SUBCODE,
          reasoningRunReference: reasoningRunId,
        });
        return await this.failTerminally(
          reasoningRunId,
          REASONING_EVIDENCE_UNITS_INVALID_OUTPUT,
          'PROVIDER_INVALID_OUTPUT',
          'provider_responded_in_full_with_a_non_conforming_output'
        );
      case 'PROVIDER_CONFIGURATION_FAILURE':
        return await this.failTerminally(
          reasoningRunId,
          REASONING_PROVIDER_CONFIGURATION_INVALID,
          'PROVIDER_CONFIGURATION_FAILURE',
          'provider_deterministically_rejected_the_frozen_plan'
        );
      case 'PROVIDER_TRANSPORT_FAILURE':
        failEvidenceUnitsStage('PROVIDER_TRANSPORT_FAILURE', {
          invariant: 'no_usable_semantic_response_was_obtained',
          reasoningRunId
        });
      default:
        failEvidenceUnitsStage('INTERNAL_AI_SERVICE_FAILURE', {
          invariant: 'ai_service_failed_for_a_reason_that_is_not_a_run_outcome',
          reasoningRunId
        });
    }
  }

  private readEnvelope(
    reasoningRunId: string,
    envelope: unknown
  ): {
    artifact: unknown;
    verification: EffectiveModelVerification | null;
    providerCalled: boolean;
  } {
    if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) {
      failEvidenceUnitsStage('INTERNAL_AI_SERVICE_FAILURE', {
        invariant: 'evidence_units_response_must_be_an_object',
        reasoningRunId
      });
    }

    const body = envelope as Record<string, unknown>;
    if (body.schemaVersion !== EVIDENCE_UNITS_RESPONSE_SCHEMA_VERSION) {
      failEvidenceUnitsStage('INTERNAL_AI_SERVICE_FAILURE', {
        invariant: 'evidence_units_response_schema_version_unsupported',
        reasoningRunId
      });
    }

    const execution =
      typeof body.execution === 'object' && body.execution !== null
        ? (body.execution as Record<string, unknown>)
        : {};
    const reported = execution.effectiveModelVerification;

    return {
      artifact: body.artifact,
      verification:
        reported === 'MATCH' || reported === 'UNAVAILABLE' ? reported : null,
      providerCalled: execution.providerCalled === true
    };
  }

  /**
   * Persiste con el CAS endurecido, después de la verificación source-addressable.
   *
   * El orden importa: primero se comprueba que cada coordenada sea reproducible
   * contra el artifact de extracción que ESTE proceso verificó, y recién después
   * se escribe. NestJS no confía en que Python haya anclado bien — un `200` dice
   * que el servicio respondió, no que el grounding sea correcto.
   */
  private async persistArtifact(
    reasoningRunId: string,
    candidate: unknown,
    grounded: readonly GroundedSource[],
    claim: ReasoningRunExecutionClaim | undefined
  ): Promise<VerifiedEvidenceUnits> {
    const extractions: VerifiedExtractionsByRunLocalSourceId = new Map(
      grounded.map((item) => [item.runLocalSourceId, item.artifact])
    );

    try {
      return await this.slots.fillEvidenceUnitsArtifact(
        reasoningRunId,
        candidate,
        (verified) => verifyEvidenceUnitsAgainstSourceExtractions(verified, extractions),
        claim
      );
    } catch (error: unknown) {
      if (error instanceof ReasoningRunArtifactError) {
        return await this.failTerminally(
          reasoningRunId,
          REASONING_EVIDENCE_UNITS_INVALID_OUTPUT,
          'PROVIDER_INVALID_OUTPUT',
          'provider_output_does_not_verify_against_the_frozen_sources'
        );
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Transición terminal — condicional y específica de esta etapa
  // -------------------------------------------------------------------------

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
    failEvidenceUnitsStage(stageCode, { invariant, reasoningRunId });
  }

  /**
   * CONDICIONAL sobre el mismo estado elegible que el CAS del artifact, para que
   * el éxito y el fallo terminal compitan en vez de escribir columnas distintas
   * sin verse. Si no aplica, no se pisa nada: la fila ya dijo otra cosa.
   */
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
        evidenceUnitsArtifact: { equals: Prisma.DbNull }
      },
      data: {
        status: ReasoningRunStatus.failed,
        failureCode,
        failedAt: new Date()
      }
    });
  }
}
/**
 * Ejecución productiva del razonamiento contextual — slice F3.5.
 *
 * UNA LLAMADA POR REQUIREMENT, en el orden del snapshot del Objective, cortando
 * en el primero que falla.
 *
 *     req_01 → llamada 1 ─┐
 *     req_02 → llamada 2  ├─ éxito ⇒ agregado transitorio para F3.6
 *     req_N  → llamada N ─┘
 *
 *     falla req_K ⇒ CERO llamadas para K+1..N
 *
 * Por qué fail-fast y no completar las N: cuando un Requirement no puede producir
 * una salida aceptable, el agregado que F3.6 necesita ya no se puede construir.
 * Seguir llamando no rescata el run, gasta observaciones y produce salidas que
 * nadie va a consumir.
 *
 * NADA SE PERSISTE.
 *
 *     CONTEXTUAL_REASONING_SUCCESS_CHECKPOINT: NONE
 *
 * Los resultados válidos de 1..K-1 viven en memoria del proceso y se descartan al
 * terminar la invocación. F3.5 no escribe `resultArtifact` —eso es de F3.6, que
 * es dueño de la mitad determinista del mismo artifact— y no completa el run.
 *
 * ESTA ETAPA NO ES IDEMPOTENTE.
 *
 *     PROVIDER_EXECUTION_IDEMPOTENT: NO
 *
 * Llamarla dos veces compra dos observaciones por Requirement. Un reintento
 * empieza otra vez por el PRIMER Requirement, porque "cuáles ya salieron bien" no
 * es un hecho que exista en ningún lado. Por eso no hay consumidor público
 * todavía: F3.6 es el consumidor previsto.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Prisma, ReasoningRunStatus } from '@prisma/client';

import { AiServiceClient } from '../ai/ai-service.client';
import {
  ObjectiveAnalysisTransportError,
  type AnalyzeContextualReasoningSource,
  type AnalyzeObjectiveExecutionPlan
} from '../ai/ai-service.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  eligibleRunStatusFor,
  type ReasoningRunExecutionClaim
} from './reasoning-run-execution-claim.service';
import { verifyObjectiveDefinitionArtifact } from '../objectives/objective-definition.validator';
import {
  CONTEXTUAL_REASONING_CONTRACT_VERSION,
  type ContextualReasoningV1,
  type ContextualRequirementResult
} from './contextual-reasoning.contract';
import { verifyContextualRequirementResult } from './contextual-reasoning.validator';
import { verifyContextualResultReferences } from './contextual-reasoning-references.verifier';
import { ReasoningRunArtifactSlotService } from './reasoning-run-artifact-slot.service';
import { ReasoningRunArtifactError } from './reasoning-run-artifact.errors';
import {
  REASONING_EXECUTION_METADATA_SCHEMA_VERSION,
  type ObjectiveAnalysisRequirement,
  type StageExecutionPlan,
  type VerifiedEvidenceUnits,
  type VerifiedObjectiveAnalysis,
  type VerifiedReasoningExecutionMetadata
} from './reasoning-run-artifact.types';
import {
  GroundingUnusableError,
  ReasoningRunGroundingLoader
} from './reasoning-run-grounding.loader';
import { verifyEvidenceUnitsAgainstSourceExtractions } from './evidence-units-source-addressable.verifier';
import {
  verifyEvidenceUnitsAgainstRunInventory,
  verifyObjectiveAnalysisAgainstObjectiveSnapshot,
  type FrozenInventoryItem
} from './reasoning-run-cross-artifact.verifier';
import {
  CONTEXTUAL_REASONING_REQUEST_SCHEMA_VERSION,
  CONTEXTUAL_REASONING_RESPONSE_SCHEMA_VERSION,
  CONTEXTUAL_REASONING_STAGE_IDENTITY,
  EVIDENCE_UNITS_STAGE_IDENTITY,
  OBJECTIVE_ANALYSIS_STAGE_IDENTITY,
  PRODUCT_DETERMINISTIC_POLICY_VERSION,
  PRODUCT_EXECUTION_PROVIDER,
  PRODUCT_REASONER_CONTRACT_VERSION,
  PRODUCT_REASONING_EFFORT,
  configuredExecutionModel
} from './product-stage-identity';
import {
  REASONING_CONTEXTUAL_AUTHORITY_UNUSABLE,
  REASONING_CONTEXTUAL_REASONING_INVALID_OUTPUT,
  failContextualStage
} from './reasoning-run-contextual-reasoning.errors';
import {
  REASONING_EXECUTION_PLAN_MISMATCH,
  REASONING_PROVIDER_CONFIGURATION_INVALID
} from './reasoning-run-objective-analysis.errors';
import { UNKNOWN_INVALID_OUTPUT_SUBCODE } from '../ai/ai-service-invalid-output-diagnostics';
import { logReasoningAiServiceFailure } from './reasoning-run-diagnostics';

const RUN_SELECT = {
  id: true,
  status: true,
  failureCode: true,
  objectiveDefinitionSnapshot: true,
  objectiveAnalysisArtifact: true,
  evidenceUnitsArtifact: true,
  resultArtifact: true,
  executionMetadata: true
} as const;

interface RunRow {
  id: string;
  status: ReasoningRunStatus;
  failureCode: string | null;
  objectiveDefinitionSnapshot: unknown;
  objectiveAnalysisArtifact: unknown;
  evidenceUnitsArtifact: unknown;
  resultArtifact: unknown;
  executionMetadata: unknown;
}

export type EffectiveModelVerification = 'MATCH' | 'UNAVAILABLE';

export interface ContextualReasoningOutcome {
  readonly reasoningRunId: string;
  /** El agregado TRANSITORIO. No está persistido y no lo estará en este slice. */
  readonly contextualReasoning: ContextualReasoningV1;
  /** Exactamente la cantidad de Requirements confirmados, en un intento exitoso. */
  readonly providerCallsMade: number;
  readonly effectiveModelVerification: EffectiveModelVerification | null;
}

@Injectable()
export class ReasoningRunContextualReasoningService {
  private readonly logger = new Logger(ReasoningRunContextualReasoningService.name);

  public constructor(
    private readonly prisma: PrismaService,
    private readonly slots: ReasoningRunArtifactSlotService,
    private readonly grounding: ReasoningRunGroundingLoader,
    private readonly ai: AiServiceClient
  ) {}

  /**
   * Produce el razonamiento contextual de TODOS los Requirements del run.
   *
   * Recibe SÓLO el id: el Objective, su análisis, el catálogo y la configuración
   * se cargan de persistencia. Si el llamante pudiera pasar Requirements, podría
   * pasar OTROS, y el snapshot congelado dejaría de ser la autoridad del run.
   */
  public async generateContextualReasoningForRun(
    reasoningRunId: string,
    /**
     * F3.6. Presente SOLO cuando esta etapa corre dentro de una ejecucion que ya
     * gano la claim exclusiva del run. Sin ella, la etapa conserva exactamente su
     * semantica anterior de entrypoint directo.
     */
    claim?: ReasoningRunExecutionClaim
  ): Promise<ContextualReasoningOutcome> {
    const run = await this.loadRun(reasoningRunId);
    this.assertEligible(run, claim);

    const { definition, analysis, evidenceUnits } = await this.loadVerifiedAuthorities(run);

    const metadata = await this.ensureExecutionPlan(run);
    const plan = await this.requireMatchingContextualPlan(
      reasoningRunId,
      metadata.contextualReasoning
    );

    const analysisByRequirementId = new Map(
      analysis.requirements.map((item) => [item.requirementId, item])
    );
    const sources = this.toTransportSources(evidenceUnits);
    const transportUnits = this.toTransportEvidenceUnits(evidenceUnits);
    const preparation = this.toTransportPreparation(evidenceUnits);

    const results: ContextualRequirementResult[] = [];
    let verification: EffectiveModelVerification | null = null;
    let callsMade = 0;

    // ORDEN DEL SNAPSHOT. No orden de Prisma, ni de dificultad, ni de relevancia:
    // el orden en que la persona confirmó sus Requirements.
    for (const requirement of definition.requirements) {
      const analysisRequirement = analysisByRequirementId.get(requirement.requirementId);
      if (!analysisRequirement) {
        // El verificador cruzado ya garantiza la cobertura completa; si igual
        // faltara, es corrupción y no un caso a tolerar.
        return await this.failTerminally(
          reasoningRunId,
          REASONING_CONTEXTUAL_AUTHORITY_UNUSABLE,
          'PERSISTED_AUTHORITY_UNUSABLE',
          'every_confirmed_requirement_must_be_analysed',
          requirement.requirementId,
          callsMade
        );
      }

      let envelope: unknown;
      try {
        callsMade += 1;
        envelope = await this.ai.analyzeContextualReasoning({
          schemaVersion: CONTEXTUAL_REASONING_REQUEST_SCHEMA_VERSION,
          executionPlan: plan,
          objectiveContext: definition.objectiveContext,
          requirement: {
            requirementId: analysisRequirement.requirementId,
            requirementText: requirement.requirementText,
            epistemicTarget: analysisRequirement.epistemicTarget,
            atomicity: analysisRequirement.atomicity,
            evaluability: analysisRequirement.evaluability,
            qualifiers: analysisRequirement.qualifiers,
            normalizedRequirement: analysisRequirement.normalizedRequirement
          },
          // CATÁLOGO COMPLETO en cada llamada. Sin recuperación, sin top-k:
          // omitir una unidad cambiaría el universo observado.
          evidenceUnits: transportUnits,
          sources,
          preparation,
          correlationId: reasoningRunId
        });
      } catch (error: unknown) {
        return await this.handleTransportFailure(
          reasoningRunId,
          error,
          requirement.requirementId,
          callsMade
        );
      }

      const { result, modelVerification } = await this.readAndVerifyEnvelope(
        reasoningRunId,
        envelope,
        analysisRequirement,
        requirement.requirementText,
        evidenceUnits,
        callsMade
      );
      verification = modelVerification;
      results.push(result);
    }

    return {
      reasoningRunId,
      contextualReasoning: this.buildAggregate(
        reasoningRunId,
        results,
        definition.requirements.map((item) => item.requirementId),
        callsMade
      ),
      providerCallsMade: callsMade,
      effectiveModelVerification: verification
    };
  }

  // -------------------------------------------------------------------------
  // Estado y autoridades
  // -------------------------------------------------------------------------

  private async loadRun(reasoningRunId: string): Promise<RunRow> {
    const run = await this.prisma.reasoningRun.findUnique({
      where: { id: reasoningRunId },
      select: RUN_SELECT
    });
    if (!run) {
      failContextualStage('REASONING_RUN_NOT_FOUND', {
        invariant: 'reasoning_run_does_not_exist',
        reasoningRunId
      });
    }
    return run as RunRow;
  }

  private assertEligible(
    run: RunRow,
    claim: ReasoningRunExecutionClaim | undefined
  ): void {
    if (claim !== undefined && claim.reasoningRunId !== run.id) {
      // Una claim de OTRO run no autoriza nada acá: la capability nombra la
      // fila que reclamó, no "alguna fila".
      failContextualStage('RUN_NOT_ELIGIBLE', {
        invariant: 'execution_claim_must_name_this_reasoning_run',
        reasoningRunId: run.id
      });
    }
    if (run.status !== eligibleRunStatusFor(claim) || run.failureCode !== null) {
      failContextualStage('RUN_NOT_ELIGIBLE', {
        invariant: 'contextual_reasoning_requires_an_eligible_run_without_failure',
        reasoningRunId: run.id
      });
    }
    if (run.resultArtifact !== null) {
      failContextualStage('RUN_NOT_ELIGIBLE', {
        invariant: 'the_run_already_has_a_final_result',
        reasoningRunId: run.id
      });
    }
  }

  /**
   * Carga y REVERIFICA todo lo persistido, antes de cualquier llamada.
   *
   * Que F3.3 y F3.4 lo hayan verificado al escribirlo no dice nada sobre el
   * estado de la fila ahora. Se vuelve a verificar:
   *
   *     el snapshot del Objective contra el verificador de F2
   *     el análisis contra el snapshot, anclas de qualifier incluidas
   *     el catálogo contra el inventario congelado
   *     el catálogo contra los `source_extraction_v1` verificados
   */
  private async loadVerifiedAuthorities(run: RunRow): Promise<{
    definition: ReturnType<typeof verifyObjectiveDefinitionArtifact>;
    analysis: VerifiedObjectiveAnalysis;
    evidenceUnits: VerifiedEvidenceUnits;
  }> {
    if (run.objectiveAnalysisArtifact === null || run.evidenceUnitsArtifact === null) {
      // F3.5 es la primera etapa que necesita las DOS. Que se puedan producir por
      // separado no significa que se pueda razonar sin alguna.
      failContextualStage('PREVIOUS_STAGE_ARTIFACT_MISSING', {
        invariant: 'contextual_reasoning_requires_objective_analysis_and_evidence_units',
        reasoningRunId: run.id
      });
    }

    let definition;
    let artifacts;
    try {
      definition = verifyObjectiveDefinitionArtifact(run.objectiveDefinitionSnapshot);
      // Relee por el servicio de slots: valida forma Y coherencia cruzada contra
      // el snapshot y el inventario cargados de la base.
      artifacts = await this.slots.readReasoningRunArtifacts(run.id);
    } catch {
      return await this.failAuthority(run.id, 'persisted_authorities_must_verify');
    }

    const analysis = artifacts.objectiveAnalysis;
    const evidenceUnits = artifacts.evidenceUnits;
    if (analysis === null || evidenceUnits === null) {
      return await this.failAuthority(run.id, 'persisted_stage_artifacts_must_verify');
    }

    // Las verificaciones CRUZADAS, otra vez y explícitas. `readReasoningRunArtifacts`
    // valida la forma de cada artifact, no su coherencia con las autoridades del
    // run: eso hay que pedirlo. Acá se comprueba que el análisis siga cubriendo
    // exactamente los Requirements confirmados con sus anclas de qualifier
    // literales, y que el catálogo siga perteneciendo al inventario congelado.
    try {
      verifyObjectiveAnalysisAgainstObjectiveSnapshot(analysis, {
        objectiveContext: definition.objectiveContext,
        requirements: definition.requirements.map((item) => ({
          requirementId: item.requirementId,
          requirementText: item.requirementText
        }))
      });
      verifyEvidenceUnitsAgainstRunInventory(
        evidenceUnits,
        await this.loadInventory(run.id)
      );
    } catch (error: unknown) {
      if (error instanceof ReasoningRunArtifactError) {
        return await this.failAuthority(
          run.id,
          'persisted_stage_artifacts_no_longer_match_their_authorities'
        );
      }
      throw error;
    }

    // El grounding congelado, otra vez, y el catálogo contra él: un excerpt
    // manipulado después de F3.4 no puede entrar al razonamiento.
    try {
      const grounded = await this.grounding.loadVerifiedGroundingSet(run.id);
      verifyEvidenceUnitsAgainstSourceExtractions(
        evidenceUnits,
        new Map(grounded.map((item) => [item.runLocalSourceId, item.artifact]))
      );
    } catch (error: unknown) {
      if (error instanceof GroundingUnusableError || error instanceof ReasoningRunArtifactError) {
        return await this.failAuthority(
          run.id,
          error instanceof GroundingUnusableError
            ? error.invariant
            : 'evidence_units_no_longer_match_the_frozen_sources'
        );
      }
      throw error;
    }

    return { definition, analysis, evidenceUnits };
  }

  /** El inventario congelado, tal como lo necesita el verificador cruzado. */
  private async loadInventory(
    reasoningRunId: string
  ): Promise<readonly FrozenInventoryItem[]> {
    const items = await this.prisma.reasoningRunInventoryItem.findMany({
      where: { reasoningRunId },
      select: { disposition: true, runLocalSourceId: true, sourceSha256: true }
    });
    return items.map((item) => ({
      disposition: String(item.disposition),
      runLocalSourceId: item.runLocalSourceId,
      sourceSha256: item.sourceSha256
    }));
  }

  private async failAuthority(reasoningRunId: string, invariant: string): Promise<never> {
    await this.markTerminalFailure(
      reasoningRunId,
      REASONING_CONTEXTUAL_AUTHORITY_UNUSABLE
    );
    failContextualStage('PERSISTED_AUTHORITY_UNUSABLE', { invariant, reasoningRunId });
  }

  // -------------------------------------------------------------------------
  // Proyección al transporte
  // -------------------------------------------------------------------------

  /**
   * Proyecta la provenance por fuente.
   *
   * El producto la guarda UNA vez en `evidence_units_v1.sources[]`; el reasoner
   * congelado la esperaba junto al material. Se proyecta acá determinísticamente,
   * y el proveedor no la elige ni la puede fortalecer: nunca aumenta soporte.
   */
  private toTransportSources(
    evidenceUnits: VerifiedEvidenceUnits
  ): readonly AnalyzeContextualReasoningSource[] {
    const coverageBySource = new Map(
      evidenceUnits.preparation.sourceObservabilityFacts.map((fact) => [
        fact.sourceId,
        fact.coverageStatus
      ])
    );
    return evidenceUnits.sources.map((source) => ({
      sourceId: source.sourceId,
      sourceProvenance: source.sourceProvenance,
      coverageStatus: coverageBySource.get(source.sourceId) ?? 'UNRESOLVED'
    }));
  }

  /**
   * El catálogo, sin material crudo de fuente.
   *
   * Viaja la cita exacta y su contexto —el reasoner los necesita— pero NO el
   * texto canónico completo, ni el artifact de extracción, ni identidad de base
   * de datos. La direccionabilidad sigue disponible por la traza; el modelo no
   * necesita el documento.
   */
  private toTransportEvidenceUnits(evidenceUnits: VerifiedEvidenceUnits) {
    return evidenceUnits.evidenceUnits.map((unit) => ({
      evidenceUnitId: unit.evidenceUnitId,
      sourceId: unit.sourceTrace.sourceId,
      normalizedProposition: unit.normalizedProposition,
      claimType: unit.claimType,
      semanticQualifiers: unit.semanticQualifiers.map((qualifier) => ({
        kind: qualifier.kind,
        value: qualifier.value
      })),
      exactQuote: unit.exactQuote,
      contextBefore: unit.contextBefore,
      contextAfter: unit.contextAfter,
      sectionLabel: unit.sectionLabel,
      interpretationProvenance: unit.interpretationProvenance,
      extractionQuality: unit.extractionQuality
    }));
  }

  /** La capa determinista de F3.4: hechos, no juicios. */
  private toTransportPreparation(evidenceUnits: VerifiedEvidenceUnits) {
    const preparation = evidenceUnits.preparation;
    return {
      mode: preparation.mode,
      evidenceUnitIds: [...preparation.evidenceUnitIds],
      exactRedundancyGroups: preparation.exactRedundancyGroups.map((group) => [...group]),
      sourceObservabilityFacts: preparation.sourceObservabilityFacts.map((fact) => ({
        sourceId: fact.sourceId,
        coverageStatus: fact.coverageStatus,
        observedEvidenceUnitIds: [...fact.observedEvidenceUnitIds],
        extractionDiagnostics: [...fact.extractionDiagnostics]
      })),
      discardedEvidenceProposalCount: preparation.discardedEvidenceProposalCount
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
      failContextualStage('EXECUTION_CONFIGURATION_MISSING', {
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

  /**
   * `CONFIG_DRIFT_POLICY: FAIL_CLOSED`.
   *
   * Aunque haya N llamadas, todas pertenecen a la MISMA etapa y comparten el
   * mismo plan: la granularidad no necesita una entrada de `executionMetadata`
   * por Requirement.
   */
  private async requireMatchingContextualPlan(
    reasoningRunId: string,
    plan: StageExecutionPlan
  ): Promise<AnalyzeObjectiveExecutionPlan> {
    const model = configuredExecutionModel();
    const matches =
      plan.artifactSchemaVersion ===
        CONTEXTUAL_REASONING_STAGE_IDENTITY.artifactSchemaVersion &&
      plan.promptVersion === CONTEXTUAL_REASONING_STAGE_IDENTITY.promptVersion &&
      plan.adapterVersion === CONTEXTUAL_REASONING_STAGE_IDENTITY.adapterVersion &&
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
        'frozen_plan_must_match_the_deployed_configuration',
        undefined,
        0
      );
    }

    return {
      artifactSchemaVersion: plan.artifactSchemaVersion,
      promptVersion: CONTEXTUAL_REASONING_STAGE_IDENTITY.promptVersion,
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
    error: unknown,
    requirementId: string,
    callsMade: number
  ): Promise<never> {
    if (!(error instanceof ObjectiveAnalysisTransportError)) throw error;

    switch (error.code) {
      case 'EXECUTION_PLAN_MISMATCH':
        return await this.failTerminally(
          reasoningRunId,
          REASONING_EXECUTION_PLAN_MISMATCH,
          'EXECUTION_PLAN_MISMATCH',
          'ai_service_rejected_the_frozen_plan',
          requirementId,
          callsMade
        );
      case 'PROVIDER_INVALID_OUTPUT':
        // Diagnostico interno. NO cambia la clasificacion ni el desenlace:
        // el `failTerminally` de abajo es exactamente el que ya estaba.
        logReasoningAiServiceFailure(this.logger, {
          stage: 'contextual_reasoning',
          operationalCode: REASONING_CONTEXTUAL_REASONING_INVALID_OUTPUT,
          upstreamCode: 'PROVIDER_INVALID_OUTPUT',
          upstreamSubcode: error.invalidOutputSubcode ?? UNKNOWN_INVALID_OUTPUT_SUBCODE,
          reasoningRunReference: reasoningRunId,
          requirementReference: requirementId,
        });
        return await this.failTerminally(
          reasoningRunId,
          REASONING_CONTEXTUAL_REASONING_INVALID_OUTPUT,
          'PROVIDER_INVALID_OUTPUT',
          'provider_responded_in_full_with_a_non_conforming_output',
          requirementId,
          callsMade
        );
      case 'PROVIDER_CONFIGURATION_FAILURE':
        return await this.failTerminally(
          reasoningRunId,
          REASONING_PROVIDER_CONFIGURATION_INVALID,
          'PROVIDER_CONFIGURATION_FAILURE',
          'provider_deterministically_rejected_the_frozen_plan',
          requirementId,
          callsMade
        );
      case 'PROVIDER_TRANSPORT_FAILURE':
        // El run queda INTACTO. El reintento vuelve a empezar por el primer
        // Requirement: no hay checkpoint que permita retomar.
        failContextualStage('PROVIDER_TRANSPORT_FAILURE', {
          invariant: 'no_usable_semantic_response_was_obtained',
          reasoningRunId,
          requirementId,
          providerCallsMade: callsMade
        });
      default:
        failContextualStage('INTERNAL_AI_SERVICE_FAILURE', {
          invariant: 'ai_service_failed_for_a_reason_that_is_not_a_run_outcome',
          reasoningRunId,
          requirementId,
          providerCallsMade: callsMade
        });
    }
  }

  /**
   * Lee el envelope y verifica el resultado ANTES de aceptarlo.
   *
   * NestJS no confía en que Python haya validado bien: un `200` dice que el
   * servicio respondió. La validación estructural y la de referencias corren acá
   * otra vez, contra las autoridades que ESTE proceso cargó.
   */
  private async readAndVerifyEnvelope(
    reasoningRunId: string,
    envelope: unknown,
    analysisRequirement: ObjectiveAnalysisRequirement,
    requirementText: string,
    evidenceUnits: VerifiedEvidenceUnits,
    callsMade: number
  ): Promise<{
    result: ContextualRequirementResult;
    modelVerification: EffectiveModelVerification | null;
  }> {
    if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) {
      failContextualStage('INTERNAL_AI_SERVICE_FAILURE', {
        invariant: 'contextual_reasoning_response_must_be_an_object',
        reasoningRunId,
        requirementId: analysisRequirement.requirementId,
        providerCallsMade: callsMade
      });
    }

    const body = envelope as Record<string, unknown>;
    if (body.schemaVersion !== CONTEXTUAL_REASONING_RESPONSE_SCHEMA_VERSION) {
      failContextualStage('INTERNAL_AI_SERVICE_FAILURE', {
        invariant: 'contextual_reasoning_response_schema_version_unsupported',
        reasoningRunId,
        requirementId: analysisRequirement.requirementId,
        providerCallsMade: callsMade
      });
    }

    const execution =
      typeof body.execution === 'object' && body.execution !== null
        ? (body.execution as Record<string, unknown>)
        : {};
    const reported = execution.effectiveModelVerification;
    const modelVerification =
      reported === 'MATCH' || reported === 'UNAVAILABLE' ? reported : null;

    try {
      const result = verifyContextualRequirementResult(body.contextualResult);
      verifyContextualResultReferences(result, {
        analysisRequirement,
        requirementText,
        evidenceUnits
      });
      return { result, modelVerification };
    } catch (error: unknown) {
      if (error instanceof ReasoningRunArtifactError) {
        return await this.failTerminally(
          reasoningRunId,
          REASONING_CONTEXTUAL_REASONING_INVALID_OUTPUT,
          'PROVIDER_INVALID_OUTPUT',
          'contextual_output_does_not_verify_against_the_frozen_authorities',
          analysisRequirement.requirementId,
          callsMade
        );
      }
      throw error;
    }
  }

  /**
   * Arma el agregado y verifica su COMPLETITUD.
   *
   * Exactamente un resultado por Requirement confirmado, en el mismo orden, sin
   * faltantes, duplicados ni sobrantes. El agregado lo construye este código: el
   * proveedor nunca produjo este array y ninguna de sus llamadas vio a las otras.
   */
  private buildAggregate(
    reasoningRunId: string,
    results: readonly ContextualRequirementResult[],
    confirmedRequirementIds: readonly string[],
    callsMade: number
  ): ContextualReasoningV1 {
    const produced = results.map((item) => item.requirementId);
    const complete =
      produced.length === confirmedRequirementIds.length &&
      produced.every((id, index) => id === confirmedRequirementIds[index]);

    if (!complete) {
      failContextualStage('PERSISTED_AUTHORITY_UNUSABLE', {
        invariant: 'contextual_aggregate_must_cover_every_confirmed_requirement_in_order',
        reasoningRunId,
        providerCallsMade: callsMade
      });
    }

    return {
      schemaVersion: CONTEXTUAL_REASONING_CONTRACT_VERSION,
      requirementResults: results
    };
  }

  // -------------------------------------------------------------------------
  // Transición terminal
  // -------------------------------------------------------------------------

  private async failTerminally(
    reasoningRunId: string,
    failureCode: string,
    stageCode:
      | 'EXECUTION_PLAN_MISMATCH'
      | 'PROVIDER_INVALID_OUTPUT'
      | 'PROVIDER_CONFIGURATION_FAILURE'
      | 'PERSISTED_AUTHORITY_UNUSABLE',
    invariant: string,
    requirementId?: string,
    providerCallsMade?: number
  ): Promise<never> {
    await this.markTerminalFailure(reasoningRunId, failureCode);
    failContextualStage(stageCode, {
      invariant,
      reasoningRunId,
      requirementId,
      providerCallsMade
    });
  }

  /**
   * Transición terminal CONDICIONAL.
   *
   * No hay éxito de F3.5 que proteger —no se persiste ninguno— así que la guarda
   * no protege a esta etapa de sí misma. Lo que protege es lo que viene después:
   * un éxito final YA PERSISTIDO por F3.6 no puede ser pisado por un intento de
   * F3.5 que llegó tarde. Por eso se exige también `resultArtifact` ausente.
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

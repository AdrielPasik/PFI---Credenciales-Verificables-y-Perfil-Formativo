/**
 * Proyeccion PUBLICA del resultado de un VerificationRun.
 *
 * UN CONTRATO NUEVO, no el del holder recortado. El DTO del holder lleva citas,
 * contexto, pagina y cobertura; el tercero no ve nada de eso. Se reusa la MISMA
 * cadena verificada del holder -- `projectReasoningRunEvidence` y
 * `mapReasoningRunDetail` con su sintesis -- para no reimplementar ningun
 * invariante, y despues se COPIA campo por campo a un DTO que no tiene donde
 * poner lo que no debe salir.
 *
 * NUNCA SALE (no existe campo para esto):
 *
 *   explanation            contiene las citas renderizadas
 *   excerpt / contextBefore / contextAfter / sectionLabel / pageNumber / coverage
 *   requirementId          `req_NN` interno del snapshot; se identifica por `order`
 *   reasoningRunReference / objectiveReference   ids de base
 *   src_NN / eu_NN / SHAs / storage / AnalysisRunSource / metadata de proveedor
 *   policyTrace y todo juicio intermedio del razonador
 *   score, porcentaje, ranking o veredicto global
 *
 * ROLES DE EVIDENCIA EXPLICITOS. `supportingEvidenceUnitIds` del holder toma el
 * techo conjunto y el claim debil con independencia del estado final. Publicamente
 * solo existe el rol `supporting`, y SOLO para `SUPPORTED` y
 * `PARTIALLY_SUPPORTED`. Para `INSUFFICIENT_EVIDENCE`, `ABSTAIN` y
 * `NOT_ASSESSABLE` la lista es VACIA: mostrar ahi una credencial le diria al
 * tercero que respalda algo que el run concluyo que no se sostiene.
 *
 * HISTORICO VS ACTUAL. `finalState` es lo que el run concluyo al completarse.
 * `currentStatus` de cada credencial es su estado HOY: una credencial revocada
 * despues aparece como tal, sin reescribir la conclusion historica.
 *
 * `credentialReference` es la MISMA referencia que el perfil publico de este
 * enlace ya expone en sus tarjetas. Sirve para correlacionar con esa tarjeta; no
 * da autoridad sobre nada.
 */

import { type ObjectiveType } from '@prisma/client';

import { type VerifiedObjectiveDefinition } from '../objectives/objective-definition.types';
import { type EvidenceUnitsV1, type VerifiedReasoningRunResult } from '../reasoning-run/reasoning-run-artifact.types';
import {
  type FrozenInventorySourceView,
  type ProjectedSourceKind,
  projectReasoningRunEvidence
} from '../reasoning-run/reasoning-run-evidence.projection';
import { mapReasoningRunDetail } from '../reasoning-run/reasoning-run.mapper';

export type PublicFinalState =
  | 'SUPPORTED'
  | 'PARTIALLY_SUPPORTED'
  | 'INSUFFICIENT_EVIDENCE'
  | 'ABSTAIN'
  | 'NOT_ASSESSABLE';

export type PublicVerificationState =
  | 'AWAITING_REQUIREMENTS'
  | 'READY_TO_EXECUTE'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED';

export type PublicFailureCategory =
  /** Fallo transitorio; quedan intentos. Reintentable con el mismo token. */
  | 'TEMPORARILY_UNAVAILABLE'
  /** El holder revoco el enlace o deshabilito el analisis durante la ejecucion. */
  | 'AUTHORIZATION_WITHDRAWN'
  /** Se agotaron los 3 intentos por fallos transitorios. */
  | 'RETRY_BUDGET_EXHAUSTED'
  /** El proceso que ejecutaba murio; el run no puede reanudarse. */
  | 'EXECUTION_INTERRUPTED'
  | 'EXECUTION_FAILED';

export interface PublicObjectiveDto {
  readonly objectiveType: ObjectiveType;
  readonly title: string | null;
  readonly objectiveContext: string;
  readonly requirements: ReadonlyArray<{ readonly order: number; readonly requirementText: string }>;
}

export interface PublicSupportingCredentialDto {
  readonly credentialReference: string;
  readonly title: string;
  readonly credentialType: string;
  readonly issuerName: string;
  /** Estado de HOY. No es una instantanea del momento del run. */
  readonly currentStatus: string;
  readonly sourceKinds: readonly ProjectedSourceKind[];
  /** Cuantas unidades de evidencia de esta credencial respaldan el requisito. */
  readonly supportingUnitCount: number;
}

export interface PublicRequirementResultDto {
  readonly order: number;
  readonly requirementText: string;
  /** Conclusion HISTORICA del run. */
  readonly finalState: PublicFinalState;
  /** Solo en `PARTIALLY_SUPPORTED`: lo que si se sostiene. */
  readonly supportedWeakerClaim: string | null;
  readonly evidence: { readonly supporting: readonly PublicSupportingCredentialDto[] };
}

export interface PublicSynthesisDto {
  readonly stateSummary: {
    readonly supportedCount: number;
    readonly partiallySupportedCount: number;
    readonly insufficientEvidenceCount: number;
    readonly abstainCount: number;
    readonly notAssessableCount: number;
  };
  readonly positiveConclusions: ReadonlyArray<{
    readonly order: number;
    readonly requirementText: string;
    readonly finalState: 'SUPPORTED' | 'PARTIALLY_SUPPORTED';
    readonly supportedWeakerClaim: string | null;
    readonly supportingCredentialReferences: readonly string[];
  }>;
  readonly credentialsSupportingPositiveConclusions: ReadonlyArray<{
    readonly credentialReference: string;
    readonly title: string;
    readonly credentialType: string;
    readonly issuerName: string;
    readonly currentStatus: string;
    readonly supportedRequirementOrders: readonly number[];
    readonly partiallySupportedRequirementOrders: readonly number[];
  }>;
}

export interface PublicVerificationResultDto {
  readonly state: PublicVerificationState;
  readonly objective: PublicObjectiveDto | null;
  readonly completedAt: string | null;
  readonly failure: { readonly category: PublicFailureCategory; readonly retryable: boolean } | null;
  readonly result: {
    readonly requirements: readonly PublicRequirementResultDto[];
    readonly synthesis: PublicSynthesisDto;
    /** Recordatorio explicito de la semantica temporal de los campos. */
    readonly temporalNotice: 'FINAL_STATE_IS_HISTORICAL_CREDENTIAL_STATUS_IS_CURRENT';
  } | null;
}

export function projectPublicObjective(
  definition: VerifiedObjectiveDefinition,
  title: string | null
): PublicObjectiveDto {
  return {
    objectiveType: definition.objectiveType as ObjectiveType,
    title,
    objectiveContext: definition.objectiveContext,
    requirements: definition.requirements.map((requirement) => ({
      order: requirement.order,
      requirementText: requirement.requirementText
    }))
  };
}

const POSITIVE: ReadonlySet<string> = new Set(['SUPPORTED', 'PARTIALLY_SUPPORTED']);

/** Placeholder INTERNO para reusar el mapper del holder; nunca se copia afuera. */
const INTERNAL_ONLY = '__public_projection_internal__';

export interface CompletedRunInput {
  readonly definition: VerifiedObjectiveDefinition;
  readonly title: string | null;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date;
  readonly result: VerifiedReasoningRunResult;
  readonly evidenceUnits: EvidenceUnitsV1;
  readonly inventory: readonly FrozenInventorySourceView[];
}

export function projectCompletedVerification(input: CompletedRunInput): PublicVerificationResultDto {
  const evidence = projectReasoningRunEvidence(
    input.result.requirementResults,
    input.evidenceUnits,
    input.inventory
  );
  const detail = mapReasoningRunDetail({
    id: INTERNAL_ONLY,
    objectiveId: INTERNAL_ONLY,
    objectiveTitleSnapshot: input.title ?? '',
    status: 'completed',
    failureCode: null,
    createdAt: input.createdAt,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    failedAt: null,
    definition: input.definition,
    result: input.result,
    evidence
  });
  if (detail.result === null || detail.synthesis === null) {
    throw new Error('public_verification_completed_run_without_result');
  }

  const orderById = new Map(input.definition.requirements.map((item) => [item.requirementId, item.order]));
  const orderOf = (internalId: string): number => {
    const order = orderById.get(internalId);
    if (order === undefined) throw new Error('public_verification_requirement_not_in_snapshot');
    return order;
  };

  const requirements = detail.result.requirementResults.map((item): PublicRequirementResultDto => {
    const positive = POSITIVE.has(item.finalState);
    return {
      order: orderOf(item.requirementId),
      requirementText: item.requirementText,
      finalState: item.finalState as PublicFinalState,
      supportedWeakerClaim: item.finalState === 'PARTIALLY_SUPPORTED' ? item.supportedWeakerClaim : null,
      evidence: { supporting: positive ? aggregateByCredential(item.evidence) : [] }
    };
  });

  const synthesis = detail.synthesis;
  return {
    state: 'COMPLETED',
    objective: projectPublicObjective(input.definition, input.title),
    completedAt: input.completedAt.toISOString(),
    failure: null,
    result: {
      requirements,
      synthesis: {
        stateSummary: { ...synthesis.stateSummary },
        positiveConclusions: synthesis.positiveConclusions.map((item) => ({
          order: orderOf(item.requirementId),
          requirementText: item.requirementText,
          finalState: item.finalState,
          supportedWeakerClaim: item.finalState === 'PARTIALLY_SUPPORTED' ? item.supportedWeakerClaim : null,
          supportingCredentialReferences: [...item.supportingCredentialReferences]
        })),
        credentialsSupportingPositiveConclusions: synthesis.credentialsSupportingPositiveConclusions.map(
          (item) => ({
            credentialReference: item.credentialReference,
            title: item.credentialDisplay.title,
            credentialType: item.credentialDisplay.credentialType,
            issuerName: item.credentialDisplay.issuerName,
            currentStatus: item.credentialDisplay.currentStatus,
            supportedRequirementOrders: item.supportedRequirementIds.map(orderOf),
            partiallySupportedRequirementOrders: item.partiallySupportedRequirementIds.map(orderOf)
          })
        )
      },
      temporalNotice: 'FINAL_STATE_IS_HISTORICAL_CREDENTIAL_STATUS_IS_CURRENT'
    }
  };
}

type HolderEvidence = NonNullable<
  ReturnType<typeof mapReasoningRunDetail>['result']
>['requirementResults'][number]['evidence'];

/**
 * Una entrada por credencial, en orden de primera aparicion. De cada evidencia
 * se lee SOLO la credencial y el tipo de fuente: la cita nunca se toca.
 */
function aggregateByCredential(evidence: HolderEvidence): PublicSupportingCredentialDto[] {
  const byReference = new Map<
    string,
    { credential: NonNullable<HolderEvidence[number]['credential']>; kinds: Set<ProjectedSourceKind>; count: number }
  >();
  for (const item of evidence) {
    // Sin credencial no hay nada publicable que nombrar.
    if (item.credential === null) continue;
    const entry = byReference.get(item.credential.credentialReference) ?? {
      credential: item.credential,
      kinds: new Set<ProjectedSourceKind>(),
      count: 0
    };
    entry.kinds.add(item.sourceKind as ProjectedSourceKind);
    entry.count += 1;
    byReference.set(item.credential.credentialReference, entry);
  }
  return [...byReference.values()].map(({ credential, kinds, count }) => ({
    credentialReference: credential.credentialReference,
    title: credential.title,
    credentialType: credential.credentialType,
    issuerName: credential.issuerName,
    currentStatus: credential.currentStatus,
    sourceKinds: [...kinds].sort(),
    supportingUnitCount: count
  }));
}

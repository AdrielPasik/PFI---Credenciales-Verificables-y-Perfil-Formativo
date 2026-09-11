/**
 * Validador estructural de `reasoning_run_result_v1` — slice F3.1.
 *
 * Es la unica autoridad persistida de los outputs de reasoning contextual, de la
 * policy determinista y del render historico. NO recopia el Objective Analysis ni
 * el catalogo de EvidenceUnits: los referencia por id, y esas referencias las
 * resuelve `verifyReasoningResultReferences` contra los otros dos slots.
 *
 * NO RE-EJECUTA LA POLICY. `policyTrace` se valida como forma, no recomputando
 * `finalState` a partir de sus entradas: un artifact historico debe poder leerse
 * aunque la policy cambie de version despues, y recomputar convertiria al
 * validador en un segundo motor epistemologico.
 */

import {
  assertExactKeys,
  assertUnique,
  deepFreeze,
  expectArray,
  expectBoolean,
  expectEnum,
  expectIdentifier,
  expectIdentifierArray,
  expectNonBlankString,
  expectObject,
  expectString,
  expectStringArray
} from './reasoning-run-artifact.primitives';
import { failArtifact } from './reasoning-run-artifact.errors';
import { verifyStageValidations } from './objective-analysis-artifact.validator';
import {
  COMPOSITION_MODES,
  CONTINUITY_TRANSFORMATION_TOKENS,
  EPISTEMIC_TARGETS,
  EVIDENCE_UNIT_ID_PATTERN,
  FACET_COVERAGE_TOKENS,
  FINAL_STATE_TOKENS,
  FULL_CLAIM_STATUS_TOKENS,
  INDEPENDENT_OBSERVABLE_SUPPORT_TOKENS,
  MATERIAL_USEFULNESS_TOKENS,
  MISSING_MATERIAL_RELEVANCE_TOKENS,
  OBSERVABILITY_STATUS_TOKENS,
  REASONING_RUN_RESULT_SCHEMA_VERSION,
  RELATION_TOKENS,
  REQUIREMENT_ID_PATTERN,
  RUN_LOCAL_SOURCE_ID_PATTERN,
  SHIFT_REASON_TOKENS,
  WEAKER_SEARCH_STATUS_TOKENS,
  YES_NO_UNRESOLVED_TOKENS,
  type CompositionAssessment,
  type ContinuityAssessment,
  type EvaluatedEvidence,
  type FullClaimAssessment,
  type IncompleteSourceAssessment,
  type JointClaimCeiling,
  type ObservabilityAssessment,
  type PolicyTrace,
  type RequirementFacet,
  type RequirementResult,
  type VerifiedReasoningRunResult,
  type WeakerClaimCandidate,
  type WeakerClaimSearch
} from './reasoning-run-artifact.types';

const ROOT_KEYS = new Set([
  'schemaVersion',
  'requirementResults',
  'validations'
]);
const RESULT_KEYS = new Set([
  'requirementId',
  'finalState',
  'evaluatedEvidence',
  'facets',
  'compositionAssessment',
  'fullClaimAssessment',
  'jointClaimCeiling',
  'observabilityAssessment',
  'weakerClaimSearch',
  'semanticUnresolved',
  'unresolvedReason',
  'policyTrace',
  'explanation'
]);
const EVALUATED_KEYS = new Set([
  'evidenceUnitId',
  'relation',
  'supportedQualifierIds',
  'missingQualifierIds',
  'evidenceContribution',
  'rationale'
]);
const FACET_KEYS = new Set([
  'localFacetKey',
  'facetText',
  'requirementBasisPhrases',
  'whyNecessary',
  'essential',
  'coverage',
  'evidenceUnitIds',
  'rationale'
]);
const COMPOSITION_KEYS = new Set([
  'mode',
  'nonRedundantEvidenceUnitIds',
  'jointlySupportsFullRequirement',
  'integrationRequired',
  'integrationDemonstrated',
  'integrationEvidenceIds',
  'missingFacetLocalKeys',
  'unresolved',
  'rationale'
]);
const FULL_CLAIM_KEYS = new Set([
  'status',
  'supportedQualifierIds',
  'missingQualifierIds',
  'coveredFacetLocalKeys',
  'missingFacetLocalKeys',
  'rationale'
]);
const CEILING_KEYS = new Set(['text', 'supportingEvidenceUnitIds']);
const INCOMPLETE_KEYS = new Set([
  'sourceId',
  'affectedRequirementElements',
  'missingMaterialRelevance',
  'rationale'
]);
const OBSERVABILITY_KEYS = new Set([
  'incompleteSourceAssessments',
  'independentObservableSupport',
  'observabilityStatus',
  'rationale'
]);
const CONTINUITY_KEYS = new Set([
  'status',
  'transformation',
  'requirementBasisPhrases',
  'constitutiveProjection',
  'explicitlyRelaxed',
  'externalTargetIntroduced',
  'shiftReason',
  'rationale'
]);
const CANDIDATE_KEYS = new Set([
  'text',
  'supportingEvidenceUnitIds',
  'derivedFromJointClaimCeiling',
  'droppedQualifierIds',
  'droppedFacetLocalKeys',
  'continuityAssessment',
  'materialUsefulness',
  'usefulnessRationale'
]);
const SEARCH_KEYS = new Set(['status', 'rationale', 'candidate']);
const POLICY_TRACE_KEYS = new Set([
  'preGuardState',
  'hardFactualFailure',
  'formativeEvidenceCapable',
  'epistemicTarget',
  'unresolved',
  'reachesFullRequirement',
  'weakerSearchStatus',
  'continuityStatus',
  'materialUsefulness',
  'hasMateriallyUsefulWeakerClaim',
  'weakerClaimStillBelongsToRequirement',
  'observabilityStatus'
]);

function verifyEvaluatedEvidence(
  raw: unknown,
  path: string
): EvaluatedEvidence {
  const value = expectObject(raw, path);
  assertExactKeys(value, EVALUATED_KEYS, path);
  return Object.freeze({
    evidenceUnitId: expectIdentifier(
      value.evidenceUnitId,
      EVIDENCE_UNIT_ID_PATTERN,
      `${path}.evidenceUnitId`
    ),
    relation: expectEnum(value.relation, RELATION_TOKENS, `${path}.relation`),
    supportedQualifierIds: expectStringArray(
      value.supportedQualifierIds,
      `${path}.supportedQualifierIds`
    ),
    missingQualifierIds: expectStringArray(
      value.missingQualifierIds,
      `${path}.missingQualifierIds`
    ),
    evidenceContribution: expectNonBlankString(
      value.evidenceContribution,
      `${path}.evidenceContribution`
    ),
    rationale: expectNonBlankString(value.rationale, `${path}.rationale`)
  });
}

function verifyFacet(raw: unknown, path: string): RequirementFacet {
  const value = expectObject(raw, path);
  assertExactKeys(value, FACET_KEYS, path);
  return Object.freeze({
    localFacetKey: expectNonBlankString(
      value.localFacetKey,
      `${path}.localFacetKey`
    ),
    facetText: expectNonBlankString(value.facetText, `${path}.facetText`),
    requirementBasisPhrases: expectStringArray(
      value.requirementBasisPhrases,
      `${path}.requirementBasisPhrases`
    ),
    whyNecessary: expectNonBlankString(
      value.whyNecessary,
      `${path}.whyNecessary`
    ),
    essential: expectBoolean(value.essential, `${path}.essential`),
    coverage: expectEnum(
      value.coverage,
      FACET_COVERAGE_TOKENS,
      `${path}.coverage`
    ),
    evidenceUnitIds: expectIdentifierArray(
      value.evidenceUnitIds,
      EVIDENCE_UNIT_ID_PATTERN,
      `${path}.evidenceUnitIds`
    ),
    rationale: expectNonBlankString(value.rationale, `${path}.rationale`)
  });
}

function verifyComposition(raw: unknown, path: string): CompositionAssessment {
  const value = expectObject(raw, path);
  assertExactKeys(value, COMPOSITION_KEYS, path);
  return Object.freeze({
    mode: expectEnum(value.mode, COMPOSITION_MODES, `${path}.mode`),
    nonRedundantEvidenceUnitIds: expectIdentifierArray(
      value.nonRedundantEvidenceUnitIds,
      EVIDENCE_UNIT_ID_PATTERN,
      `${path}.nonRedundantEvidenceUnitIds`
    ),
    jointlySupportsFullRequirement: expectBoolean(
      value.jointlySupportsFullRequirement,
      `${path}.jointlySupportsFullRequirement`
    ),
    integrationRequired: expectBoolean(
      value.integrationRequired,
      `${path}.integrationRequired`
    ),
    integrationDemonstrated: expectBoolean(
      value.integrationDemonstrated,
      `${path}.integrationDemonstrated`
    ),
    integrationEvidenceIds: expectIdentifierArray(
      value.integrationEvidenceIds,
      EVIDENCE_UNIT_ID_PATTERN,
      `${path}.integrationEvidenceIds`
    ),
    missingFacetLocalKeys: expectStringArray(
      value.missingFacetLocalKeys,
      `${path}.missingFacetLocalKeys`
    ),
    unresolved: expectBoolean(value.unresolved, `${path}.unresolved`),
    rationale: expectNonBlankString(value.rationale, `${path}.rationale`)
  });
}

function verifyFullClaim(raw: unknown, path: string): FullClaimAssessment {
  const value = expectObject(raw, path);
  assertExactKeys(value, FULL_CLAIM_KEYS, path);
  return Object.freeze({
    status: expectEnum(
      value.status,
      FULL_CLAIM_STATUS_TOKENS,
      `${path}.status`
    ),
    supportedQualifierIds: expectStringArray(
      value.supportedQualifierIds,
      `${path}.supportedQualifierIds`
    ),
    missingQualifierIds: expectStringArray(
      value.missingQualifierIds,
      `${path}.missingQualifierIds`
    ),
    coveredFacetLocalKeys: expectStringArray(
      value.coveredFacetLocalKeys,
      `${path}.coveredFacetLocalKeys`
    ),
    missingFacetLocalKeys: expectStringArray(
      value.missingFacetLocalKeys,
      `${path}.missingFacetLocalKeys`
    ),
    rationale: expectNonBlankString(value.rationale, `${path}.rationale`)
  });
}

function verifyCeiling(raw: unknown, path: string): JointClaimCeiling {
  const value = expectObject(raw, path);
  assertExactKeys(value, CEILING_KEYS, path);
  return Object.freeze({
    // Puede ser vacio: "no hay ningun claim conjunto sostenible" es una respuesta.
    text: expectString(value.text, `${path}.text`),
    supportingEvidenceUnitIds: expectIdentifierArray(
      value.supportingEvidenceUnitIds,
      EVIDENCE_UNIT_ID_PATTERN,
      `${path}.supportingEvidenceUnitIds`
    )
  });
}

function verifyIncompleteSource(
  raw: unknown,
  path: string
): IncompleteSourceAssessment {
  const value = expectObject(raw, path);
  assertExactKeys(value, INCOMPLETE_KEYS, path);
  return Object.freeze({
    sourceId: expectIdentifier(
      value.sourceId,
      RUN_LOCAL_SOURCE_ID_PATTERN,
      `${path}.sourceId`
    ),
    affectedRequirementElements: expectStringArray(
      value.affectedRequirementElements,
      `${path}.affectedRequirementElements`
    ),
    missingMaterialRelevance: expectEnum(
      value.missingMaterialRelevance,
      MISSING_MATERIAL_RELEVANCE_TOKENS,
      `${path}.missingMaterialRelevance`
    ),
    rationale: expectNonBlankString(value.rationale, `${path}.rationale`)
  });
}

function verifyObservability(
  raw: unknown,
  path: string
): ObservabilityAssessment {
  const value = expectObject(raw, path);
  assertExactKeys(value, OBSERVABILITY_KEYS, path);
  return Object.freeze({
    incompleteSourceAssessments: Object.freeze(
      expectArray(
        value.incompleteSourceAssessments,
        `${path}.incompleteSourceAssessments`
      ).map((item, index) =>
        verifyIncompleteSource(
          item,
          `${path}.incompleteSourceAssessments[${index}]`
        )
      )
    ),
    independentObservableSupport: expectEnum(
      value.independentObservableSupport,
      INDEPENDENT_OBSERVABLE_SUPPORT_TOKENS,
      `${path}.independentObservableSupport`
    ),
    observabilityStatus: expectEnum(
      value.observabilityStatus,
      OBSERVABILITY_STATUS_TOKENS,
      `${path}.observabilityStatus`
    ),
    rationale: expectNonBlankString(value.rationale, `${path}.rationale`)
  });
}

function verifyContinuity(raw: unknown, path: string): ContinuityAssessment {
  const value = expectObject(raw, path);
  assertExactKeys(value, CONTINUITY_KEYS, path);
  return Object.freeze({
    status: expectEnum(value.status, YES_NO_UNRESOLVED_TOKENS, `${path}.status`),
    transformation: expectEnum(
      value.transformation,
      CONTINUITY_TRANSFORMATION_TOKENS,
      `${path}.transformation`
    ),
    requirementBasisPhrases: expectStringArray(
      value.requirementBasisPhrases,
      `${path}.requirementBasisPhrases`
    ),
    constitutiveProjection: expectString(
      value.constitutiveProjection,
      `${path}.constitutiveProjection`
    ),
    explicitlyRelaxed: expectStringArray(
      value.explicitlyRelaxed,
      `${path}.explicitlyRelaxed`
    ),
    externalTargetIntroduced: expectEnum(
      value.externalTargetIntroduced,
      YES_NO_UNRESOLVED_TOKENS,
      `${path}.externalTargetIntroduced`
    ),
    // `null` es un valor legitimo del contrato congelado: no hubo desplazamiento
    // que explicar.
    shiftReason:
      value.shiftReason === null
        ? null
        : expectEnum(
            value.shiftReason,
            SHIFT_REASON_TOKENS,
            `${path}.shiftReason`
          ),
    rationale: expectNonBlankString(value.rationale, `${path}.rationale`)
  });
}

function verifyCandidate(raw: unknown, path: string): WeakerClaimCandidate {
  const value = expectObject(raw, path);
  assertExactKeys(value, CANDIDATE_KEYS, path);
  return Object.freeze({
    text: expectNonBlankString(value.text, `${path}.text`),
    supportingEvidenceUnitIds: expectIdentifierArray(
      value.supportingEvidenceUnitIds,
      EVIDENCE_UNIT_ID_PATTERN,
      `${path}.supportingEvidenceUnitIds`
    ),
    derivedFromJointClaimCeiling: expectEnum(
      value.derivedFromJointClaimCeiling,
      YES_NO_UNRESOLVED_TOKENS,
      `${path}.derivedFromJointClaimCeiling`
    ),
    droppedQualifierIds: expectStringArray(
      value.droppedQualifierIds,
      `${path}.droppedQualifierIds`
    ),
    droppedFacetLocalKeys: expectStringArray(
      value.droppedFacetLocalKeys,
      `${path}.droppedFacetLocalKeys`
    ),
    continuityAssessment: verifyContinuity(
      value.continuityAssessment,
      `${path}.continuityAssessment`
    ),
    materialUsefulness: expectEnum(
      value.materialUsefulness,
      MATERIAL_USEFULNESS_TOKENS,
      `${path}.materialUsefulness`
    ),
    usefulnessRationale: expectNonBlankString(
      value.usefulnessRationale,
      `${path}.usefulnessRationale`
    )
  });
}

/**
 * DELTA_A: `status: FOUND` obliga a que haya candidato, y cualquier otro estado
 * obliga a que no lo haya. Es justamente lo que la delta introdujo — que "busque
 * y no encontre" deje de confundirse con "nunca busque"— y sin esta comprobacion
 * el artifact podria persistir las dos cosas a la vez.
 */
function verifySearch(raw: unknown, path: string): WeakerClaimSearch {
  const value = expectObject(raw, path);
  assertExactKeys(value, SEARCH_KEYS, path);

  const status = expectEnum(
    value.status,
    WEAKER_SEARCH_STATUS_TOKENS,
    `${path}.status`
  );
  const hasCandidate = value.candidate !== null;

  if (status === 'FOUND' && !hasCandidate) {
    failArtifact('SCHEMA_INVALID', {
      invariant: 'a_found_weaker_claim_search_must_carry_its_candidate',
      path: `${path}.candidate`,
      observed: status
    });
  }
  if (status !== 'FOUND' && hasCandidate) {
    failArtifact('SCHEMA_INVALID', {
      invariant: 'only_a_found_weaker_claim_search_carries_a_candidate',
      path: `${path}.candidate`,
      observed: status
    });
  }

  return Object.freeze({
    status,
    rationale: expectNonBlankString(value.rationale, `${path}.rationale`),
    candidate: hasCandidate
      ? verifyCandidate(value.candidate, `${path}.candidate`)
      : null
  });
}

function verifyPolicyTrace(raw: unknown, path: string): PolicyTrace {
  const value = expectObject(raw, path);
  assertExactKeys(value, POLICY_TRACE_KEYS, path);
  return Object.freeze({
    preGuardState: expectEnum(
      value.preGuardState,
      FINAL_STATE_TOKENS,
      `${path}.preGuardState`
    ),
    hardFactualFailure: expectBoolean(
      value.hardFactualFailure,
      `${path}.hardFactualFailure`
    ),
    formativeEvidenceCapable: expectBoolean(
      value.formativeEvidenceCapable,
      `${path}.formativeEvidenceCapable`
    ),
    epistemicTarget: expectEnum(
      value.epistemicTarget,
      EPISTEMIC_TARGETS,
      `${path}.epistemicTarget`
    ),
    unresolved: expectBoolean(value.unresolved, `${path}.unresolved`),
    reachesFullRequirement: expectBoolean(
      value.reachesFullRequirement,
      `${path}.reachesFullRequirement`
    ),
    weakerSearchStatus: expectEnum(
      value.weakerSearchStatus,
      WEAKER_SEARCH_STATUS_TOKENS,
      `${path}.weakerSearchStatus`
    ),
    // `null` cuando no hubo candidato: no hay continuidad que evaluar.
    continuityStatus:
      value.continuityStatus === null
        ? null
        : expectEnum(
            value.continuityStatus,
            YES_NO_UNRESOLVED_TOKENS,
            `${path}.continuityStatus`
          ),
    materialUsefulness:
      value.materialUsefulness === null
        ? null
        : expectEnum(
            value.materialUsefulness,
            MATERIAL_USEFULNESS_TOKENS,
            `${path}.materialUsefulness`
          ),
    hasMateriallyUsefulWeakerClaim: expectBoolean(
      value.hasMateriallyUsefulWeakerClaim,
      `${path}.hasMateriallyUsefulWeakerClaim`
    ),
    weakerClaimStillBelongsToRequirement: expectBoolean(
      value.weakerClaimStillBelongsToRequirement,
      `${path}.weakerClaimStillBelongsToRequirement`
    ),
    observabilityStatus: expectEnum(
      value.observabilityStatus,
      OBSERVABILITY_STATUS_TOKENS,
      `${path}.observabilityStatus`
    )
  });
}

function verifyRequirementResult(
  raw: unknown,
  path: string
): RequirementResult {
  const value = expectObject(raw, path);
  assertExactKeys(value, RESULT_KEYS, path);

  const facets = expectArray(value.facets, `${path}.facets`).map(
    (item, index) => verifyFacet(item, `${path}.facets[${index}]`)
  );

  // `localFacetKey` es local al Requirement, y ahi dentro tiene que ser unico:
  // `missingFacetLocalKeys` y `coveredFacetLocalKeys` lo usan como referencia.
  assertUnique(
    facets.map((facet) => facet.localFacetKey),
    'FACET_KEY_DUPLICATED',
    'local_facet_keys_are_unique_within_a_requirement',
    `${path}.facets`
  );

  const evaluated = expectArray(
    value.evaluatedEvidence,
    `${path}.evaluatedEvidence`
  ).map((item, index) =>
    verifyEvaluatedEvidence(item, `${path}.evaluatedEvidence[${index}]`)
  );

  assertUnique(
    evaluated.map((item) => item.evidenceUnitId),
    'IDENTIFIER_DUPLICATED',
    'each_evidence_unit_is_evaluated_at_most_once_per_requirement',
    `${path}.evaluatedEvidence`
  );

  return Object.freeze({
    requirementId: expectIdentifier(
      value.requirementId,
      REQUIREMENT_ID_PATTERN,
      `${path}.requirementId`
    ),
    finalState: expectEnum(
      value.finalState,
      FINAL_STATE_TOKENS,
      `${path}.finalState`
    ),
    evaluatedEvidence: Object.freeze(evaluated),
    facets: Object.freeze(facets),
    compositionAssessment: verifyComposition(
      value.compositionAssessment,
      `${path}.compositionAssessment`
    ),
    fullClaimAssessment: verifyFullClaim(
      value.fullClaimAssessment,
      `${path}.fullClaimAssessment`
    ),
    jointClaimCeiling: verifyCeiling(
      value.jointClaimCeiling,
      `${path}.jointClaimCeiling`
    ),
    observabilityAssessment: verifyObservability(
      value.observabilityAssessment,
      `${path}.observabilityAssessment`
    ),
    weakerClaimSearch: verifySearch(
      value.weakerClaimSearch,
      `${path}.weakerClaimSearch`
    ),
    semanticUnresolved: expectBoolean(
      value.semanticUnresolved,
      `${path}.semanticUnresolved`
    ),
    unresolvedReason: expectString(
      value.unresolvedReason,
      `${path}.unresolvedReason`
    ),
    policyTrace: verifyPolicyTrace(value.policyTrace, `${path}.policyTrace`),
    explanation: expectNonBlankString(value.explanation, `${path}.explanation`)
  });
}

export function verifyReasoningRunResultArtifact(
  input: unknown
): VerifiedReasoningRunResult {
  const root = expectObject(input, 'result');
  assertExactKeys(root, ROOT_KEYS, 'result');

  if (root.schemaVersion !== REASONING_RUN_RESULT_SCHEMA_VERSION) {
    failArtifact('SCHEMA_VERSION_UNSUPPORTED', {
      invariant: 'schema_version_must_be_the_single_supported_one',
      path: 'result.schemaVersion',
      observed: typeof root.schemaVersion === 'string'
        ? root.schemaVersion.slice(0, 64)
        : typeof root.schemaVersion
    });
  }

  const results = expectArray(
    root.requirementResults,
    'result.requirementResults'
  ).map((item, index) =>
    verifyRequirementResult(item, `result.requirementResults[${index}]`)
  );

  assertUnique(
    results.map((item) => item.requirementId),
    'IDENTIFIER_DUPLICATED',
    'exactly_one_final_result_per_requirement',
    'result.requirementResults'
  );

  return deepFreeze({
    schemaVersion: REASONING_RUN_RESULT_SCHEMA_VERSION,
    requirementResults: Object.freeze(results),
    validations: verifyStageValidations(root.validations, 'result.validations')
  } as VerifiedReasoningRunResult);
}

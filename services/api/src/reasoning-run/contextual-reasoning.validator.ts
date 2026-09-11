/**
 * Validador estructural del contrato transitorio — slice F3.5.
 *
 * Verifica FORMA y VOCABULARIOS CERRADOS. No juzga si una relation es
 * semánticamente acertada, si un ceiling es suficientemente fuerte ni si la
 * continuidad es verdadera: reimplementar el razonador en TypeScript crearía un
 * segundo motor semántico, y dos motores semánticos que discrepan no tienen
 * forma de resolverse.
 *
 * Lo que sí decide acá, porque es determinista:
 *
 *     el proveedor NO trae `finalState`, `policyTrace` ni `explanation`
 *     `candidate` existe si y sólo si el status es `FOUND`
 *     `transformation` acompaña estructuralmente al `status` de continuidad
 *     `materialUsefulness` es `NOT_EVALUATED` salvo continuidad `YES`
 *     `shiftReason` está presente cuando la continuidad es `NO`
 *
 * Los cuatro últimos son contradicciones estructurales, no opiniones.
 */

import {
  CONTEXTUAL_RESULT_KEYS,
  FORBIDDEN_OUTPUT_KEYS,
  POLICY_OWNED_KEYS,
  type ContextualRequirementResult
} from './contextual-reasoning.contract';
import { failArtifact } from './reasoning-run-artifact.errors';
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
  expectPossiblyEmptyString,
  expectString,
  expectStringArray
} from './reasoning-run-artifact.primitives';
import {
  COMPOSITION_MODES,
  CONTINUITY_TRANSFORMATION_TOKENS,
  EVIDENCE_UNIT_ID_PATTERN,
  FACET_COVERAGE_TOKENS,
  FULL_CLAIM_STATUS_TOKENS,
  INDEPENDENT_OBSERVABLE_SUPPORT_TOKENS,
  MATERIAL_USEFULNESS_TOKENS,
  MISSING_MATERIAL_RELEVANCE_TOKENS,
  OBSERVABILITY_STATUS_TOKENS,
  RELATION_TOKENS,
  REQUIREMENT_ID_PATTERN,
  RUN_LOCAL_SOURCE_ID_PATTERN,
  SHIFT_REASON_TOKENS,
  WEAKER_SEARCH_STATUS_TOKENS,
  YES_NO_UNRESOLVED_TOKENS
} from './reasoning-run-artifact.types';

/**
 * Correspondencia estructural congelada. Decir `YES` y `SEMANTIC_SHIFT` a la vez
 * es una contradicción, no un juicio semántico discutible.
 */
const TRANSFORMATION_BY_STATUS: Record<string, string> = {
  YES: 'CONSTITUTIVE_REDUCTION',
  NO: 'SEMANTIC_SHIFT',
  UNRESOLVED: 'UNRESOLVED'
};

function assertNoPolicyAuthority(value: Record<string, unknown>, path: string): void {
  for (const key of POLICY_OWNED_KEYS) {
    if (key in value) {
      failArtifact('EXPERIMENTAL_FIELD_NOT_ALLOWED', {
        invariant: 'contextual_stage_has_no_final_policy_authority',
        path: `${path}.${key}`,
        observed: key
      });
    }
  }
  for (const key of FORBIDDEN_OUTPUT_KEYS) {
    if (key in value) {
      failArtifact('EXPERIMENTAL_FIELD_NOT_ALLOWED', {
        invariant: 'field_does_not_exist_in_the_frozen_contract',
        path: `${path}.${key}`,
        observed: key
      });
    }
  }
}

function verifyEvaluatedEvidence(raw: unknown, path: string): unknown {
  const value = expectObject(raw, path);
  assertExactKeys(
    value,
    new Set([
      'evidenceUnitId',
      'relation',
      'supportedQualifierIds',
      'missingQualifierIds',
      'evidenceContribution',
      'rationale'
    ]),
    path
  );
  return {
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
    evidenceContribution: expectString(
      value.evidenceContribution,
      `${path}.evidenceContribution`
    ),
    rationale: expectString(value.rationale, `${path}.rationale`)
  };
}

function verifyFacet(raw: unknown, path: string): unknown {
  const value = expectObject(raw, path);
  assertExactKeys(
    value,
    new Set([
      'localFacetKey',
      'facetText',
      'requirementBasisPhrases',
      'whyNecessary',
      'essential',
      'coverage',
      'evidenceUnitIds',
      'rationale'
    ]),
    path
  );
  return {
    // LOCAL al Requirement: la identidad real es (requirementId, localFacetKey).
    localFacetKey: expectNonBlankString(value.localFacetKey, `${path}.localFacetKey`),
    facetText: expectNonBlankString(value.facetText, `${path}.facetText`),
    requirementBasisPhrases: expectStringArray(
      value.requirementBasisPhrases,
      `${path}.requirementBasisPhrases`
    ),
    whyNecessary: expectString(value.whyNecessary, `${path}.whyNecessary`),
    essential: expectBoolean(value.essential, `${path}.essential`),
    coverage: expectEnum(value.coverage, FACET_COVERAGE_TOKENS, `${path}.coverage`),
    evidenceUnitIds: expectIdentifierArray(
      value.evidenceUnitIds,
      EVIDENCE_UNIT_ID_PATTERN,
      `${path}.evidenceUnitIds`
    ),
    rationale: expectString(value.rationale, `${path}.rationale`)
  };
}

function verifyComposition(raw: unknown, path: string): unknown {
  const value = expectObject(raw, path);
  assertExactKeys(
    value,
    new Set([
      'mode',
      'nonRedundantEvidenceUnitIds',
      'jointlySupportsFullRequirement',
      'integrationRequired',
      'integrationDemonstrated',
      'integrationEvidenceIds',
      'missingFacetLocalKeys',
      'unresolved',
      'rationale'
    ]),
    path
  );
  return {
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
    rationale: expectString(value.rationale, `${path}.rationale`)
  };
}

function verifyFullClaim(raw: unknown, path: string): unknown {
  const value = expectObject(raw, path);
  assertExactKeys(
    value,
    new Set([
      'status',
      'supportedQualifierIds',
      'missingQualifierIds',
      'coveredFacetLocalKeys',
      'missingFacetLocalKeys',
      'rationale'
    ]),
    path
  );
  return {
    status: expectEnum(value.status, FULL_CLAIM_STATUS_TOKENS, `${path}.status`),
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
    rationale: expectString(value.rationale, `${path}.rationale`)
  };
}

function verifyObservability(raw: unknown, path: string): unknown {
  const value = expectObject(raw, path);
  assertExactKeys(
    value,
    new Set([
      'incompleteSourceAssessments',
      'independentObservableSupport',
      'observabilityStatus',
      'rationale'
    ]),
    path
  );
  const assessments = expectArray(
    value.incompleteSourceAssessments,
    `${path}.incompleteSourceAssessments`
  ).map((item, index) => {
    const where = `${path}.incompleteSourceAssessments[${index}]`;
    const assessment = expectObject(item, where);
    assertExactKeys(
      assessment,
      new Set([
        'sourceId',
        'affectedRequirementElements',
        'missingMaterialRelevance',
        'rationale'
      ]),
      where
    );
    return {
      sourceId: expectIdentifier(
        assessment.sourceId,
        RUN_LOCAL_SOURCE_ID_PATTERN,
        `${where}.sourceId`
      ),
      affectedRequirementElements: expectStringArray(
        assessment.affectedRequirementElements,
        `${where}.affectedRequirementElements`
      ),
      missingMaterialRelevance: expectEnum(
        assessment.missingMaterialRelevance,
        MISSING_MATERIAL_RELEVANCE_TOKENS,
        `${where}.missingMaterialRelevance`
      ),
      rationale: expectString(assessment.rationale, `${where}.rationale`)
    };
  });

  return {
    incompleteSourceAssessments: assessments,
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
    rationale: expectString(value.rationale, `${path}.rationale`)
  };
}

function verifyContinuity(raw: unknown, path: string): Record<string, unknown> {
  const value = expectObject(raw, path);
  assertExactKeys(
    value,
    new Set([
      'status',
      'transformation',
      'requirementBasisPhrases',
      'constitutiveProjection',
      'explicitlyRelaxed',
      'externalTargetIntroduced',
      'shiftReason',
      'rationale'
    ]),
    path
  );

  const status = expectEnum(value.status, YES_NO_UNRESOLVED_TOKENS, `${path}.status`);
  const transformation = expectEnum(
    value.transformation,
    CONTINUITY_TRANSFORMATION_TOKENS,
    `${path}.transformation`
  );
  if (transformation !== TRANSFORMATION_BY_STATUS[status]) {
    failArtifact('SCHEMA_INVALID', {
      invariant: 'continuity_transformation_must_match_its_status',
      path: `${path}.transformation`,
      observed: `${status}/${transformation}`
    });
  }

  const shiftReason =
    value.shiftReason === null
      ? null
      : expectEnum(value.shiftReason, SHIFT_REASON_TOKENS, `${path}.shiftReason`);
  if (status === 'NO' && shiftReason === null) {
    // Un desplazamiento semántico sin decir hacia dónde no es auditable.
    failArtifact('SCHEMA_INVALID', {
      invariant: 'semantic_shift_requires_a_shift_reason',
      path: `${path}.shiftReason`,
      observed: status
    });
  }

  return {
    status,
    transformation,
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
    shiftReason,
    rationale: expectString(value.rationale, `${path}.rationale`)
  };
}

function verifyWeakerSearch(raw: unknown, path: string): unknown {
  const value = expectObject(raw, path);
  assertExactKeys(value, new Set(['status', 'rationale', 'candidate']), path);

  const status = expectEnum(
    value.status,
    WEAKER_SEARCH_STATUS_TOKENS,
    `${path}.status`
  );
  const hasCandidate = value.candidate !== null && value.candidate !== undefined;

  // DELTA_A: `NONE` significa "se buscó y no existe", no "nunca se buscó". Que el
  // candidate exista si y sólo si el status es FOUND es lo que hace observable esa
  // diferencia.
  if ((status === 'FOUND') !== hasCandidate) {
    failArtifact('SCHEMA_INVALID', {
      invariant: 'weaker_claim_candidate_exists_iff_status_is_found',
      path: `${path}.candidate`,
      observed: `${status}/${hasCandidate ? 'present' : 'absent'}`
    });
  }

  if (!hasCandidate) {
    return {
      status,
      rationale: expectString(value.rationale, `${path}.rationale`),
      candidate: null
    };
  }

  const where = `${path}.candidate`;
  const candidate = expectObject(value.candidate, where);
  assertExactKeys(
    candidate,
    new Set([
      'text',
      'supportingEvidenceUnitIds',
      'derivedFromJointClaimCeiling',
      'droppedQualifierIds',
      'droppedFacetLocalKeys',
      'continuityAssessment',
      'materialUsefulness',
      'usefulnessRationale'
    ]),
    where
  );

  const continuity = verifyContinuity(
    candidate.continuityAssessment,
    `${where}.continuityAssessment`
  );
  const materialUsefulness = expectEnum(
    candidate.materialUsefulness,
    MATERIAL_USEFULNESS_TOKENS,
    `${where}.materialUsefulness`
  );

  // La puerta de B2.4.1: la utilidad nunca rescata un desplazamiento semántico.
  if (continuity.status !== 'YES' && materialUsefulness !== 'NOT_EVALUATED') {
    failArtifact('SCHEMA_INVALID', {
      invariant: 'material_usefulness_is_evaluated_only_when_continuity_is_yes',
      path: `${where}.materialUsefulness`,
      observed: `${String(continuity.status)}/${materialUsefulness}`
    });
  }

  return {
    status,
    rationale: expectString(value.rationale, `${path}.rationale`),
    candidate: {
      text: expectNonBlankString(candidate.text, `${where}.text`),
      supportingEvidenceUnitIds: expectIdentifierArray(
        candidate.supportingEvidenceUnitIds,
        EVIDENCE_UNIT_ID_PATTERN,
        `${where}.supportingEvidenceUnitIds`
      ),
      derivedFromJointClaimCeiling: expectEnum(
        candidate.derivedFromJointClaimCeiling,
        YES_NO_UNRESOLVED_TOKENS,
        `${where}.derivedFromJointClaimCeiling`
      ),
      droppedQualifierIds: expectStringArray(
        candidate.droppedQualifierIds,
        `${where}.droppedQualifierIds`
      ),
      droppedFacetLocalKeys: expectStringArray(
        candidate.droppedFacetLocalKeys,
        `${where}.droppedFacetLocalKeys`
      ),
      continuityAssessment: continuity,
      materialUsefulness,
      usefulnessRationale: expectString(
        candidate.usefulnessRationale,
        `${where}.usefulnessRationale`
      )
    }
  };
}

/** Valida el resultado contextual de UN Requirement. */
export function verifyContextualRequirementResult(
  input: unknown,
  path = 'contextualResult'
): ContextualRequirementResult {
  const value = expectObject(input, path);
  assertNoPolicyAuthority(value, path);
  assertExactKeys(value, CONTEXTUAL_RESULT_KEYS, path);

  const facets = expectArray(value.facets, `${path}.facets`).map((item, index) =>
    verifyFacet(item, `${path}.facets[${index}]`)
  );
  assertUnique(
    facets.map((item) => (item as { localFacetKey: string }).localFacetKey),
    'IDENTIFIER_DUPLICATED',
    'facet_local_keys_must_be_unique_within_the_requirement',
    `${path}.facets`
  );

  const evaluated = expectArray(
    value.evaluatedEvidence,
    `${path}.evaluatedEvidence`
  ).map((item, index) =>
    verifyEvaluatedEvidence(item, `${path}.evaluatedEvidence[${index}]`)
  );
  assertUnique(
    evaluated.map((item) => (item as { evidenceUnitId: string }).evidenceUnitId),
    'IDENTIFIER_DUPLICATED',
    'each_evidence_unit_is_evaluated_at_most_once',
    `${path}.evaluatedEvidence`
  );

  return deepFreeze({
    requirementId: expectIdentifier(
      value.requirementId,
      REQUIREMENT_ID_PATTERN,
      `${path}.requirementId`
    ),
    evaluatedEvidence: evaluated,
    facets,
    compositionAssessment: verifyComposition(
      value.compositionAssessment,
      `${path}.compositionAssessment`
    ),
    fullClaimAssessment: verifyFullClaim(
      value.fullClaimAssessment,
      `${path}.fullClaimAssessment`
    ),
    jointClaimCeiling: verifyJointCeiling(
      value.jointClaimCeiling,
      `${path}.jointClaimCeiling`
    ),
    observabilityAssessment: verifyObservability(
      value.observabilityAssessment,
      `${path}.observabilityAssessment`
    ),
    weakerClaimSearch: verifyWeakerSearch(
      value.weakerClaimSearch,
      `${path}.weakerClaimSearch`
    ),
    semanticUnresolved: expectBoolean(
      value.semanticUnresolved,
      `${path}.semanticUnresolved`
    ),
    unresolvedReason: expectPossiblyEmptyString(
      value.unresolvedReason,
      `${path}.unresolvedReason`
    )
  } as ContextualRequirementResult);
}

function verifyJointCeiling(raw: unknown, path: string): unknown {
  const value = expectObject(raw, path);
  assertExactKeys(value, new Set(['text', 'supportingEvidenceUnitIds']), path);
  return {
    text: expectString(value.text, `${path}.text`),
    supportingEvidenceUnitIds: expectIdentifierArray(
      value.supportingEvidenceUnitIds,
      EVIDENCE_UNIT_ID_PATTERN,
      `${path}.supportingEvidenceUnitIds`
    )
  };
}
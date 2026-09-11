/**
 * Verificación de REFERENCIAS del razonamiento contextual — slice F3.5.
 *
 * El validador estructural ya comprobó forma y vocabularios. Acá se comprueba la
 * otra mitad: que todo lo que el resultado NOMBRA exista realmente en el universo
 * congelado de este run.
 *
 * SE ENUMERAN TODAS LAS SUPERFICIES, no una representativa. Cada lugar donde el
 * contrato puede nombrar algo:
 *
 *     requirementId                              el Requirement de la llamada
 *     evaluatedEvidence[].evidenceUnitId         catálogo
 *     evaluatedEvidence[].supportedQualifierIds  qualifiers MATERIALES del Requirement
 *     evaluatedEvidence[].missingQualifierIds    idem
 *     facets[].evidenceUnitIds                   catálogo
 *     composition.nonRedundantEvidenceUnitIds    catálogo
 *     composition.integrationEvidenceIds         catálogo
 *     composition.missingFacetLocalKeys          facets declaradas acá
 *     fullClaim.supportedQualifierIds            qualifiers materiales
 *     fullClaim.missingQualifierIds              idem
 *     fullClaim.coveredFacetLocalKeys            facets declaradas acá
 *     fullClaim.missingFacetLocalKeys            idem
 *     jointClaimCeiling.supportingEvidenceUnitIds catálogo
 *     observability.incompleteSourceAssessments[].sourceId  fuentes INCLUDED
 *     weakerClaim.candidate.supportingEvidenceUnitIds       catálogo
 *     weakerClaim.candidate.droppedQualifierIds             qualifiers materiales
 *     weakerClaim.candidate.droppedFacetLocalKeys           facets declaradas acá
 *     continuity.requirementBasisPhrases         citas literales del Requirement
 *
 * LA IDENTIDAD DE UN QUALIFIER ES `(requirementId, qualifierId)`.
 *
 * `req_01/q_01` y `req_02/q_01` son qualifiers DISTINTOS. El experimento congelado
 * numeraba global y podía resolverlos con un solo mapa; el producto no. Acá se
 * resuelve SIEMPRE contra los qualifiers del Requirement en curso, y nunca contra
 * un mapa global. Que la granularidad sea por Requirement ya lo hace difícil de
 * violar, pero no se confía en eso como única defensa: la verificación es
 * explícita.
 *
 * SÓLO LOS MATERIALES SON REFERENCIABLES. Un `CONTEXTUAL` o un
 * `STRUCTURAL_WRAPPER` describe el entorno o el envoltorio del Requirement.
 * Dejarlo entrar como condición de soporte faltante inventaría una exigencia que
 * el Requirement no hace.
 *
 * Función PURA: recibe lo ya verificado y no toca la base.
 *
 * PRIVACIDAD: `observed` lleva ids y tokens. Nunca `requirementText`, ni citas,
 * ni el texto de un ceiling.
 */

import { type ContextualRequirementResult } from './contextual-reasoning.contract';
import { failArtifact } from './reasoning-run-artifact.errors';
import {
  type ObjectiveAnalysisRequirement,
  type VerifiedEvidenceUnits
} from './reasoning-run-artifact.types';

const MATERIAL_QUALIFIER = 'MATERIAL_QUALIFIER';

/** El universo congelado contra el que se resuelve un resultado contextual. */
export interface ContextualReferenceUniverse {
  /** El análisis del Requirement en curso: define sus qualifiers materiales. */
  readonly analysisRequirement: ObjectiveAnalysisRequirement;
  /** El texto autoritativo del Requirement, del snapshot congelado. */
  readonly requirementText: string;
  readonly evidenceUnits: VerifiedEvidenceUnits;
}

/**
 * Los `qualifierId` referenciables de ESTE Requirement.
 *
 * Se recalcula por Requirement a propósito. Un `Map<qualifierId, Qualifier>`
 * global haría pasar `req_02/q_01` como si fuera `req_01/q_01`, y ese es
 * exactamente el error que el contrato productivo prohíbe.
 */
function materialQualifierIds(
  requirement: ObjectiveAnalysisRequirement
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const qualifier of requirement.qualifiers) {
    if (qualifier.role === MATERIAL_QUALIFIER && qualifier.qualifierId !== null) {
      ids.add(qualifier.qualifierId);
    }
  }
  return ids;
}

function assertKnownEvidence(
  ids: readonly string[],
  known: ReadonlySet<string>,
  path: string
): void {
  for (const [index, id] of ids.entries()) {
    if (!known.has(id)) {
      failArtifact('EVIDENCE_UNIT_REFERENCE_UNKNOWN', {
        invariant: 'contextual_reasoning_may_only_reference_catalogued_evidence',
        path: `${path}[${index}]`,
        observed: id
      });
    }
  }
}

function assertKnownQualifiers(
  ids: readonly string[],
  known: ReadonlySet<string>,
  requirementId: string,
  path: string
): void {
  for (const [index, id] of ids.entries()) {
    if (!known.has(id)) {
      failArtifact('REQUIREMENT_REFERENCE_UNKNOWN', {
        invariant: 'qualifier_must_be_a_material_qualifier_of_this_requirement',
        path: `${path}[${index}]`,
        // El id solo no dice nada: lo que importa es el par.
        observed: `${requirementId}/${id}`
      });
    }
  }
}

function assertKnownFacets(
  keys: readonly string[],
  known: ReadonlySet<string>,
  path: string
): void {
  for (const [index, key] of keys.entries()) {
    if (!known.has(key)) {
      failArtifact('FACET_KEY_DUPLICATED', {
        invariant: 'facet_reference_must_name_a_facet_declared_in_this_requirement',
        path: `${path}[${index}]`,
        observed: key.slice(0, 64)
      });
    }
  }
}

export function verifyContextualResultReferences(
  result: ContextualRequirementResult,
  universe: ContextualReferenceUniverse
): void {
  const requirementId = universe.analysisRequirement.requirementId;
  const path = `contextualResult[${requirementId}]`;

  if (result.requirementId !== requirementId) {
    failArtifact('REQUIREMENT_REFERENCE_UNKNOWN', {
      invariant: 'contextual_result_must_answer_the_requirement_it_was_asked_about',
      path: `${path}.requirementId`,
      observed: `${result.requirementId}!=${requirementId}`
    });
  }

  const evidenceIds = new Set(
    universe.evidenceUnits.evidenceUnits.map((unit) => unit.evidenceUnitId)
  );
  const qualifierIds = materialQualifierIds(universe.analysisRequirement);
  const facetKeys = new Set(result.facets.map((facet) => facet.localFacetKey));
  const sourceIds = new Set(
    universe.evidenceUnits.sources.map((source) => source.sourceId)
  );

  // --- relations -----------------------------------------------------------
  for (const [index, item] of result.evaluatedEvidence.entries()) {
    const where = `${path}.evaluatedEvidence[${index}]`;
    assertKnownEvidence([item.evidenceUnitId], evidenceIds, `${where}.evidenceUnitId`);
    assertKnownQualifiers(
      item.supportedQualifierIds,
      qualifierIds,
      requirementId,
      `${where}.supportedQualifierIds`
    );
    assertKnownQualifiers(
      item.missingQualifierIds,
      qualifierIds,
      requirementId,
      `${where}.missingQualifierIds`
    );
  }

  // --- facets --------------------------------------------------------------
  for (const [index, facet] of result.facets.entries()) {
    const where = `${path}.facets[${index}]`;
    assertKnownEvidence(facet.evidenceUnitIds, evidenceIds, `${where}.evidenceUnitIds`);
    if (facet.requirementBasisPhrases.length === 0) {
      failArtifact('TEXT_EMPTY', {
        invariant: 'a_facet_must_cite_the_requirement_it_derives_from',
        path: `${where}.requirementBasisPhrases`,
        observed: '0'
      });
    }
    // Citas LITERALES, sin normalizar: una paráfrasis donde va una cita rompe la
    // trazabilidad de por qué la facet existe.
    for (const [position, phrase] of facet.requirementBasisPhrases.entries()) {
      if (!universe.requirementText.includes(phrase)) {
        failArtifact('QUALIFIER_ANCHOR_NOT_LITERAL', {
          invariant: 'facet_basis_must_be_a_literal_requirement_quote',
          path: `${where}.requirementBasisPhrases[${position}]`,
          observed: `len=${phrase.length}`
        });
      }
    }
  }

  // --- composición ---------------------------------------------------------
  const composition = result.compositionAssessment;
  assertKnownEvidence(
    composition.nonRedundantEvidenceUnitIds,
    evidenceIds,
    `${path}.compositionAssessment.nonRedundantEvidenceUnitIds`
  );
  assertKnownEvidence(
    composition.integrationEvidenceIds,
    evidenceIds,
    `${path}.compositionAssessment.integrationEvidenceIds`
  );
  assertKnownFacets(
    composition.missingFacetLocalKeys,
    facetKeys,
    `${path}.compositionAssessment.missingFacetLocalKeys`
  );

  // --- claim completo ------------------------------------------------------
  const full = result.fullClaimAssessment;
  assertKnownQualifiers(
    full.supportedQualifierIds,
    qualifierIds,
    requirementId,
    `${path}.fullClaimAssessment.supportedQualifierIds`
  );
  assertKnownQualifiers(
    full.missingQualifierIds,
    qualifierIds,
    requirementId,
    `${path}.fullClaimAssessment.missingQualifierIds`
  );
  assertKnownFacets(
    full.coveredFacetLocalKeys,
    facetKeys,
    `${path}.fullClaimAssessment.coveredFacetLocalKeys`
  );
  assertKnownFacets(
    full.missingFacetLocalKeys,
    facetKeys,
    `${path}.fullClaimAssessment.missingFacetLocalKeys`
  );

  // --- ceiling -------------------------------------------------------------
  assertKnownEvidence(
    result.jointClaimCeiling.supportingEvidenceUnitIds,
    evidenceIds,
    `${path}.jointClaimCeiling.supportingEvidenceUnitIds`
  );

  // --- observabilidad ------------------------------------------------------
  for (const [index, assessment] of result.observabilityAssessment.incompleteSourceAssessments.entries()) {
    if (!sourceIds.has(assessment.sourceId)) {
      failArtifact('SOURCE_REFERENCE_NOT_GROUNDED', {
        invariant: 'observability_may_only_reference_sources_of_this_run',
        path: `${path}.observabilityAssessment.incompleteSourceAssessments[${index}].sourceId`,
        observed: assessment.sourceId
      });
    }
  }

  // --- weaker claim y continuidad ------------------------------------------
  const candidate = result.weakerClaimSearch.candidate;
  if (candidate === null) return;

  const where = `${path}.weakerClaimSearch.candidate`;
  assertKnownEvidence(
    candidate.supportingEvidenceUnitIds,
    evidenceIds,
    `${where}.supportingEvidenceUnitIds`
  );
  assertKnownQualifiers(
    candidate.droppedQualifierIds,
    qualifierIds,
    requirementId,
    `${where}.droppedQualifierIds`
  );
  assertKnownFacets(
    candidate.droppedFacetLocalKeys,
    facetKeys,
    `${where}.droppedFacetLocalKeys`
  );

  // La continuidad también se ancla en el MISMO Requirement: un `q_01` ajeno no
  // puede justificar que el claim más débil siga perteneciendo a éste.
  for (const [index, phrase] of candidate.continuityAssessment.requirementBasisPhrases.entries()) {
    if (!universe.requirementText.includes(phrase)) {
      failArtifact('QUALIFIER_ANCHOR_NOT_LITERAL', {
        invariant: 'continuity_basis_must_be_a_literal_requirement_quote',
        path: `${where}.continuityAssessment.requirementBasisPhrases[${index}]`,
        observed: `len=${phrase.length}`
      });
    }
  }
}

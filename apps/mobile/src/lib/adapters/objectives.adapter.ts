import {
  array,
  booleanValue,
  enumValueOf,
  invalid,
  isoDateLabel,
  nonNegativeIntegerValue,
  nullableVerbatimString,
  optionalRecordOf,
  record,
  verbatimString
} from '@/lib/adapters/verbatim';
import {
  OBJECTIVE_TYPE_LABELS,
  OBJECTIVE_TYPES,
  type ObjectiveDetailVM,
  type ObjectiveGrounding,
  type ObjectiveProposalCandidateVM,
  type ObjectiveProposalVM,
  type ObjectiveRequirementVM,
  type ObjectiveSourceRangeVM,
  type ObjectiveSummaryVM,
  type ObjectiveTypeToken,
  type RequirementProvenanceKind
} from '@/types/objectives';

/**
 * Adapters de Objetivos.
 *
 * ATENCIÓN AL WHITESPACE: `exactExcerpt` y `sourceOriginalText` son material
 * anclado. El backend exige que `sourceQuote` sea subcadena LITERAL del texto
 * original, así que este módulo usa las primitivas VERBATIM y nunca normaliza.
 */

const GROUNDINGS = ['UNIQUE', 'AMBIGUOUS', 'NOT_FOUND'] as const;
const PROVENANCE_KINDS = [
  'DERIVED_FROM_SOURCE_TEXT',
  'DIRECT_STRUCTURED_INPUT'
] as const;

function objectiveType(value: unknown, path: string): ObjectiveTypeToken {
  return enumValueOf<ObjectiveTypeToken>(value, OBJECTIVE_TYPES, path);
}

// ---------------------------------------------------------------------------
// Propuesta (transitoria)
// ---------------------------------------------------------------------------

function sourceRange(
  value: unknown,
  path: string
): ObjectiveSourceRangeVM | null {
  const reference = optionalRecordOf(value, path);
  if (reference === null) return null;

  return {
    start: nonNegativeIntegerValue(reference.charStart, `${path}.charStart`),
    end: nonNegativeIntegerValue(reference.charEnd, `${path}.charEnd`)
  };
}

function candidate(
  value: unknown,
  path: string
): ObjectiveProposalCandidateVM {
  const raw = record(value, path);
  const reference = optionalRecordOf(
    raw.primarySourceReference,
    `${path}.primarySourceReference`
  );

  return {
    candidateId: verbatimString(raw.candidateId, `${path}.candidateId`),
    proposedRequirementText: verbatimString(
      raw.proposedRequirementText,
      `${path}.proposedRequirementText`
    ),
    primaryExcerpt:
      reference === null
        ? null
        : verbatimString(
            reference.exactExcerpt,
            `${path}.primarySourceReference.exactExcerpt`
          ),
    excerptRange: sourceRange(
      raw.primarySourceReference,
      `${path}.primarySourceReference`
    ),
    grounding: enumValueOf<ObjectiveGrounding>(
      raw.primarySourceGrounding,
      GROUNDINGS,
      `${path}.primarySourceGrounding`
    ),
    confirmableAsSourceDerived: booleanValue(
      raw.confirmableAsSourceDerived,
      `${path}.confirmableAsSourceDerived`
    ),
    sourceSectionLabel: nullableVerbatimString(
      raw.sourceSectionLabel,
      `${path}.sourceSectionLabel`
    ),
    isExactDuplicate: booleanValue(
      raw.exactDuplicateOfEarlier,
      `${path}.exactDuplicateOfEarlier`
    )
  };
}

export function adaptObjectiveProposal(payload: unknown): ObjectiveProposalVM {
  const raw = record(payload, 'proposal');

  // El contrato promete estas dos banderas. Si no llegan, algo cambió de forma
  // incompatible y es mejor fallar que asumir autoridad.
  if (raw.authority !== 'PROPOSAL_ONLY') {
    invalid('proposal.authority', "'PROPOSAL_ONLY'", raw.authority);
  }
  if (raw.humanConfirmationRequired !== true) {
    invalid(
      'proposal.humanConfirmationRequired',
      'true',
      raw.humanConfirmationRequired
    );
  }

  return {
    candidates: array(raw.candidates, 'proposal.candidates').map(
      (value, index) => candidate(value, `proposal.candidates[${index}]`)
    ),
    unresolvedPassageCount: array(
      raw.unresolvedPassages,
      'proposal.unresolvedPassages'
    ).length
  };
}

// ---------------------------------------------------------------------------
// Objective persistido
// ---------------------------------------------------------------------------

export function adaptObjectiveSummaries(
  payload: unknown
): ObjectiveSummaryVM[] {
  return array(payload, 'objectives').map((value, index) => {
    const path = `objectives[${index}]`;
    const raw = record(value, path);
    const type = objectiveType(raw.objectiveType, `${path}.objectiveType`);

    return {
      objectiveReference: verbatimString(
        raw.objectiveReference,
        `${path}.objectiveReference`
      ),
      objectiveType: type,
      objectiveTypeLabel: OBJECTIVE_TYPE_LABELS[type],
      title: verbatimString(raw.title, `${path}.title`),
      createdAtLabel: isoDateLabel(raw.createdAt, `${path}.createdAt`)
    };
  });
}

function requirement(value: unknown, path: string): ObjectiveRequirementVM {
  const raw = record(value, path);
  const kind = enumValueOf<RequirementProvenanceKind>(
    raw.provenanceKind,
    PROVENANCE_KINDS,
    `${path}.provenanceKind`
  );

  return {
    requirementId: verbatimString(raw.requirementId, `${path}.requirementId`),
    requirementText: verbatimString(
      raw.requirementText,
      `${path}.requirementText`
    ),
    provenanceKind: kind,
    originLabel:
      kind === 'DERIVED_FROM_SOURCE_TEXT' ? 'Del objetivo' : 'Agregado por vos',
    sourceQuote: nullableVerbatimString(raw.sourceQuote, `${path}.sourceQuote`)
  };
}

/**
 * Adapta la respuesta de detalle.
 *
 * ASIMETRÍA DELIBERADA DEL CONTRATO, y hay que respetarla:
 *
 *   PETICIÓN de creación     source: { inputType, originalText }   ANIDADO
 *   RESPUESTA de lectura     sourceInputType, sourceOriginalText   PLANO
 *
 * `POST /me/objectives` y `GET /me/objectives/:id` usan el MISMO mapper del
 * backend, así que esta función cubre los dos caminos.
 */
export function adaptObjectiveDetail(payload: unknown): ObjectiveDetailVM {
  const raw = record(payload, 'objective');
  const definition = record(raw.definition, 'objective.definition');
  const type = objectiveType(raw.objectiveType, 'objective.objectiveType');

  return {
    objectiveReference: verbatimString(
      raw.objectiveReference,
      'objective.objectiveReference'
    ),
    objectiveType: type,
    objectiveTypeLabel: OBJECTIVE_TYPE_LABELS[type],
    title: verbatimString(raw.title, 'objective.title'),
    createdAtLabel: isoDateLabel(raw.createdAt, 'objective.createdAt'),
    requirements: array(
      definition.requirements,
      'objective.definition.requirements'
    ).map((value, index) =>
      requirement(value, `objective.definition.requirements[${index}]`)
    ),
    sourceInputType: verbatimString(
      definition.sourceInputType,
      'objective.definition.sourceInputType'
    ),
    sourceOriginalText: nullableVerbatimString(
      definition.sourceOriginalText,
      'objective.definition.sourceOriginalText'
    )
  };
}

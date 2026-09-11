/**
 * Adapters de Objetivos — P2.3.
 *
 * ATENCION AL WHITESPACE. El resto de los adapters del repo normalizan con
 * `trim().replace(/\s+/g, ' ')`, y para etiquetas de perfil esta bien. Aca NO se
 * puede: `exactExcerpt` y `originalText` son material anclado. El backend exige
 * que `sourceQuote` sea subcadena LITERAL del texto original, asi que colapsar
 * un espacio aqui convertiria una cita valida en una que el servidor rechaza.
 *
 * Por eso este modulo tiene su propio `verbatimString`, que valida el tipo y no
 * toca el contenido.
 */

import { IncompatiblePayloadError } from '@/lib/errors/api-error';
import {
  OBJECTIVE_TYPES,
  type ObjectiveDetailVM,
  type ObjectiveGrounding,
  type ObjectiveProposalCandidateVM,
  type ObjectiveProposalVM,
  type ObjectiveRequirementVM,
  type ObjectiveSourceRangeVM,
  type ObjectiveSummaryVM,
  type ObjectiveTypeToken,
  type RequirementProvenanceKind,
  OBJECTIVE_TYPE_LABELS
} from '@/models/objectives';

const GROUNDINGS = ['UNIQUE', 'AMBIGUOUS', 'NOT_FOUND'] as const;
const PROVENANCE_KINDS = [
  'DERIVED_FROM_SOURCE_TEXT',
  'DIRECT_STRUCTURED_INPUT'
] as const;

function invalid(path: string, expected: string, value: unknown): never {
  throw new IncompatiblePayloadError('La respuesta del servicio no es compatible.', {
    path,
    expected,
    actualCategory: categoryOf(value)
  });
}

function categoryOf(value: unknown) {
  if (value === undefined) return 'missing' as const;
  if (value === null) return 'null' as const;
  if (Array.isArray(value)) return 'array' as const;
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return type;
  return 'object' as const;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(path, 'object', value);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(path, 'array', value);
  return value;
}

/** String tal cual viene. Sin trim, sin colapsar espacios, sin normalizar. */
function verbatimString(value: unknown, path: string): string {
  if (typeof value !== 'string') invalid(path, 'string', value);
  return value;
}

function nullableVerbatimString(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  return verbatimString(value, path);
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path, 'boolean', value);
  return value;
}

function integer(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    invalid(path, 'non-negative integer', value);
  }
  return value;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string
): T {
  const text = verbatimString(value, path);
  if (!(allowed as readonly string[]).includes(text)) {
    invalid(path, `one of ${allowed.join(', ')}`, value);
  }
  return text as T;
}

function isoDateLabel(value: unknown, path: string): string {
  const text = verbatimString(value, path);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) invalid(path, 'ISO date string', value);
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(parsed);
}

// ---------------------------------------------------------------------------
// Propuesta
// ---------------------------------------------------------------------------

function sourceRange(value: unknown, path: string): ObjectiveSourceRangeVM | null {
  if (value === null || value === undefined) return null;
  const reference = record(value, path);
  return {
    start: integer(reference.charStart, `${path}.charStart`),
    end: integer(reference.charEnd, `${path}.charEnd`)
  };
}

function candidate(value: unknown, path: string): ObjectiveProposalCandidateVM {
  const raw = record(value, path);
  const reference =
    raw.primarySourceReference === null || raw.primarySourceReference === undefined
      ? null
      : record(raw.primarySourceReference, `${path}.primarySourceReference`);

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
    grounding: enumValue<ObjectiveGrounding>(
      raw.primarySourceGrounding,
      GROUNDINGS,
      `${path}.primarySourceGrounding`
    ),
    confirmableAsSourceDerived: boolean(
      raw.confirmableAsSourceDerived,
      `${path}.confirmableAsSourceDerived`
    ),
    sourceSectionLabel: nullableVerbatimString(
      raw.sourceSectionLabel,
      `${path}.sourceSectionLabel`
    ),
    isExactDuplicate: boolean(
      raw.exactDuplicateOfEarlier,
      `${path}.exactDuplicateOfEarlier`
    )
  };
}

export function adaptObjectiveProposal(payload: unknown): ObjectiveProposalVM {
  const raw = record(payload, 'proposal');

  // El contrato promete estas dos banderas. Si no llegan, algo cambio de forma
  // incompatible y es mejor fallar que asumir autoridad.
  if (raw.authority !== 'PROPOSAL_ONLY') {
    invalid('proposal.authority', "'PROPOSAL_ONLY'", raw.authority);
  }
  if (raw.humanConfirmationRequired !== true) {
    invalid('proposal.humanConfirmationRequired', 'true', raw.humanConfirmationRequired);
  }

  return {
    candidates: array(raw.candidates, 'proposal.candidates').map((value, index) =>
      candidate(value, `proposal.candidates[${index}]`)
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

function objectiveType(value: unknown, path: string): ObjectiveTypeToken {
  return enumValue<ObjectiveTypeToken>(value, OBJECTIVE_TYPES, path);
}

export function adaptObjectiveSummaries(payload: unknown): ObjectiveSummaryVM[] {
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
  const kind = enumValue<RequirementProvenanceKind>(
    raw.provenanceKind,
    PROVENANCE_KINDS,
    `${path}.provenanceKind`
  );
  return {
    requirementId: verbatimString(raw.requirementId, `${path}.requirementId`),
    requirementText: verbatimString(raw.requirementText, `${path}.requirementText`),
    provenanceKind: kind,
    originLabel:
      kind === 'DERIVED_FROM_SOURCE_TEXT' ? 'Del objetivo' : 'Agregado por vos',
    sourceQuote: nullableVerbatimString(raw.sourceQuote, `${path}.sourceQuote`)
  };
}

/**
 * Adapta la respuesta de detalle.
 *
 * ASIMETRIA DELIBERADA DEL CONTRATO, y hay que respetarla:
 *
 *   PETICION de creacion     source: { inputType, originalText }   ANIDADO
 *   RESPUESTA de lectura     sourceInputType, sourceOriginalText   PLANO
 *
 * El backend aplana a proposito —`objective.mapper.ts` lo documenta: el cliente
 * no gana nada con un nivel extra y la allowlist queda como una sola lista
 * plana—. Asumir simetria fue exactamente el defecto que rompio el round-trip de
 * detalle en el primer smoke de P2.3.
 *
 * `POST /me/objectives`, `GET /me/objectives/:id` y las revisiones usan el MISMO
 * `mapObjectiveDetail` del backend, asi que esta funcion cubre los tres caminos.
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

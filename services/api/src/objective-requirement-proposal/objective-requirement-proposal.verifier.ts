/**
 * Verificación INDEPENDIENTE del artefacto de propuesta — slice P2.2.
 *
 * QUE EL AI SERVICE PRODUZCA UN ARTEFACTO VÁLIDO NO ALCANZA. El artefacto llega
 * por la red interna y eso no lo vuelve confiable: un despliegue mal apuntado, una
 * versión distinta del servicio o un bug del builder producen JSON bien formado y
 * estructuralmente falso. Este módulo lo comprueba TODO otra vez contra el texto
 * que ESTE proceso envió.
 *
 *     FastAPI propone y construye
 *         v
 *     NestJS verifica integridad estructural y de fuente
 *         v
 *     el browser recibe una vista segura de revisión
 *
 * LO QUE SÍ VERIFICA:
 *
 *     versión de schema del artefacto e identidad de etapa
 *     ids de candidato, formato, unicidad y orden estrictamente consecutivo
 *     que cada excerpt sea IGUAL al fragmento del texto crudo en sus offsets
 *     que los offsets sean enteros en code points y estén dentro del texto
 *     coherencia entre el estado de anclaje y la presencia de referencia primaria
 *     que no aparezca NINGÚN campo prohibido, en ningún nivel
 *
 * LO QUE NO PUEDE VERIFICAR, y por eso no lo afirma: fidelidad semántica del
 * claim, granularidad correcta, completitud, ni interpretación de
 * required/preferred. P2.1 midió eso con adjudicación humana; acá no se re-afirma.
 */

import {
  MAX_OBJECTIVE_CHARACTERS,
  OBJECTIVE_REQUIREMENT_PROPOSAL_ARTIFACT_SCHEMA_VERSION,
  OBJECTIVE_REQUIREMENT_PROPOSAL_RESPONSE_SCHEMA_VERSION,
  OBJECTIVE_UNDERSTANDING_PROVIDER,
  OBJECTIVE_UNDERSTANDING_REASONING_EFFORT,
  OBJECTIVE_UNDERSTANDING_STAGE_IDENTITY,
  OFFSET_UNIT_UNICODE_CODE_POINT,
  PROVIDER_FORBIDDEN_ARTIFACT_FIELDS,
  SOURCE_GROUNDING_STATUSES,
  SOURCE_NORMALIZATION_NONE,
  type SourceGroundingStatus
} from './objective-requirement-proposal.contract';
import { ObjectiveProposalArtifactInvariantError } from './objective-requirement-proposal.errors';

export interface VerifiedSourceReference {
  readonly exactExcerpt: string;
  readonly charStart: number;
  readonly charEnd: number;
  readonly offsetUnit: typeof OFFSET_UNIT_UNICODE_CODE_POINT;
}

export interface VerifiedAmbiguousReference {
  readonly exactExcerpt: string;
  readonly occurrences: number;
}

export interface VerifiedProposalCandidate {
  readonly candidateId: string;
  readonly order: number;
  readonly proposedRequirementText: string;
  readonly primarySourceReference: VerifiedSourceReference | null;
  readonly primarySourceGrounding: SourceGroundingStatus;
  readonly auxiliarySourceReferences: readonly VerifiedSourceReference[];
  readonly ambiguousReferences: readonly VerifiedAmbiguousReference[];
  readonly unmatchedReferences: readonly string[];
  readonly sourceSectionLabel: string;
  readonly exactDuplicateOfEarlier: boolean;
  readonly confirmableAsSourceDerived: boolean;
}

export interface VerifiedUnresolvedPassage {
  readonly exactExcerpt: string;
  readonly reason: string;
  readonly grounding: SourceGroundingStatus;
  readonly charStart: number | null;
  readonly charEnd: number | null;
}

export interface VerifiedProposalArtifact {
  readonly candidates: readonly VerifiedProposalCandidate[];
  readonly unresolvedPassages: readonly VerifiedUnresolvedPassage[];
}

const CANDIDATE_ID_PATTERN = /^cand_\d{2,}$/u;

function fail(detail: string): never {
  throw new ObjectiveProposalArtifactInvariantError(detail);
}

function asRecord(value: unknown, detail: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(detail);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, detail: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(detail);
  }
  return value;
}

function asString(value: unknown, detail: string): string {
  if (typeof value !== 'string') {
    fail(detail);
  }
  return value;
}

function asInteger(value: unknown, detail: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fail(detail);
  }
  return value;
}

function asBoolean(value: unknown, detail: string): boolean {
  if (typeof value !== 'boolean') {
    fail(detail);
  }
  return value;
}

/**
 * Busca campos prohibidos en CUALQUIER nivel del artefacto.
 *
 * Recursivo a propósito: un campo prohibido escondido tres niveles abajo sigue
 * siendo autoridad que el proveedor no tiene.
 */
function assertNoForbiddenFields(node: unknown, path: string): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => assertNoForbiddenFields(item, `${path}[${index}]`));
    return;
  }
  if (typeof node !== 'object' || node === null) {
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if ((PROVIDER_FORBIDDEN_ARTIFACT_FIELDS as readonly string[]).includes(key)) {
      fail(`forbidden_field:${path}.${key}`);
    }
    assertNoForbiddenFields(value, `${path}.${key}`);
  }
}

/**
 * Verifica una referencia contra el texto crudo que ESTE proceso envió.
 *
 * La igualdad se comprueba con los offsets declarados, no buscando el excerpt: si
 * lo buscáramos, un offset equivocado pasaría inadvertido mientras el texto
 * existiera en otro lado. El punto del offset es decir DÓNDE.
 *
 * `slice` de JavaScript opera en unidades UTF-16, así que el rango se recorta con
 * el array de code points para que la comparación sea en la unidad congelada.
 */
function verifyReference(
  value: unknown,
  sourceCodePoints: readonly string[],
  detail: string
): VerifiedSourceReference {
  const record = asRecord(value, `${detail}_not_an_object`);
  const exactExcerpt = asString(record.exactExcerpt, `${detail}_excerpt_not_a_string`);
  const charStart = asInteger(record.charStart, `${detail}_char_start_not_an_integer`);
  const charEnd = asInteger(record.charEnd, `${detail}_char_end_not_an_integer`);
  const offsetUnit = asString(record.offsetUnit, `${detail}_offset_unit_not_a_string`);

  if (offsetUnit !== OFFSET_UNIT_UNICODE_CODE_POINT) {
    fail(`${detail}_offset_unit_unsupported`);
  }
  if (charStart < 0 || charEnd < charStart) {
    fail(`${detail}_offset_range_invalid`);
  }
  if (charEnd > sourceCodePoints.length) {
    fail(`${detail}_offset_out_of_bounds`);
  }
  if (sourceCodePoints.slice(charStart, charEnd).join('') !== exactExcerpt) {
    // El fallo más importante del verificador: el excerpt NO es lo que hay en el
    // texto en esos offsets. Un resaltado construido con esto apuntaría al lugar
    // equivocado sin que nadie se entere.
    fail(`${detail}_excerpt_does_not_match_source`);
  }
  return { exactExcerpt, charStart, charEnd, offsetUnit: OFFSET_UNIT_UNICODE_CODE_POINT };
}

function verifyGrounding(value: unknown, detail: string): SourceGroundingStatus {
  const status = asString(value, `${detail}_not_a_string`);
  if (!(SOURCE_GROUNDING_STATUSES as readonly string[]).includes(status)) {
    fail(`${detail}_unsupported`);
  }
  return status as SourceGroundingStatus;
}

/** Verifica el envelope completo del AI service y devuelve el artefacto limpio. */
export function verifyObjectiveProposalResponse(
  response: unknown,
  submittedRawObjectiveText: string
): VerifiedProposalArtifact {
  const envelope = asRecord(response, 'response_not_an_object');

  if (
    asString(envelope.schemaVersion, 'response_schema_version_not_a_string') !==
    OBJECTIVE_REQUIREMENT_PROPOSAL_RESPONSE_SCHEMA_VERSION
  ) {
    fail('response_schema_version_unsupported');
  }

  const execution = asRecord(envelope.execution, 'execution_not_an_object');
  if (
    execution.artifactSchemaVersion !==
      OBJECTIVE_UNDERSTANDING_STAGE_IDENTITY.artifactSchemaVersion ||
    execution.promptVersion !== OBJECTIVE_UNDERSTANDING_STAGE_IDENTITY.promptVersion ||
    execution.adapterVersion !== OBJECTIVE_UNDERSTANDING_STAGE_IDENTITY.adapterVersion ||
    execution.providerProposalSchemaVersion !==
      OBJECTIVE_UNDERSTANDING_STAGE_IDENTITY.providerProposalSchemaVersion
  ) {
    // La identidad que el AI service afirma haber ejecutado no es la que este
    // despliegue espera. Falla cerrado en vez de mapear una propuesta producida
    // por una etapa distinta de la que NestJS cree.
    fail('stage_identity_mismatch');
  }
  if (execution.provider !== OBJECTIVE_UNDERSTANDING_PROVIDER) {
    fail('provider_mismatch');
  }
  if (execution.reasoningEffort !== OBJECTIVE_UNDERSTANDING_REASONING_EFFORT) {
    fail('reasoning_effort_mismatch');
  }

  const artifact = asRecord(envelope.artifact, 'artifact_not_an_object');
  if (
    asString(artifact.schemaVersion, 'artifact_schema_version_not_a_string') !==
    OBJECTIVE_REQUIREMENT_PROPOSAL_ARTIFACT_SCHEMA_VERSION
  ) {
    fail('artifact_schema_version_unsupported');
  }
  if (artifact.sourceNormalization !== SOURCE_NORMALIZATION_NONE) {
    fail('source_normalization_unsupported');
  }
  if (artifact.offsetUnit !== OFFSET_UNIT_UNICODE_CODE_POINT) {
    fail('artifact_offset_unit_unsupported');
  }

  assertNoForbiddenFields(artifact, 'artifact');

  const sourceCodePoints = Array.from(submittedRawObjectiveText);
  if (sourceCodePoints.length > MAX_OBJECTIVE_CHARACTERS) {
    fail('submitted_objective_too_large');
  }
  if (
    asInteger(artifact.sourceCharacterCount, 'source_character_count_not_an_integer') !==
    sourceCodePoints.length
  ) {
    // El artefacto se construyó sobre un texto distinto del que enviamos. Todos
    // los offsets de abajo serían de otro documento.
    fail('source_character_count_mismatch');
  }

  const rawCandidates = asArray(artifact.candidates, 'candidates_not_a_list');
  const seenIds = new Set<string>();
  const candidates: VerifiedProposalCandidate[] = rawCandidates.map((value, index) => {
    const record = asRecord(value, 'candidate_not_an_object');
    const candidateId = asString(record.candidateId, 'candidate_id_not_a_string');
    if (!CANDIDATE_ID_PATTERN.test(candidateId)) {
      fail('candidate_id_format_invalid');
    }
    if (seenIds.has(candidateId)) {
      fail('candidate_id_duplicated');
    }
    seenIds.add(candidateId);

    const order = asInteger(record.order, 'candidate_order_not_an_integer');
    if (order !== index + 1) {
      // Orden estrictamente consecutivo desde 1. Un hueco significaría que el
      // artefacto perdió un candidato en el camino.
      fail('candidate_order_not_consecutive');
    }

    const proposedRequirementText = asString(
      record.proposedRequirementText,
      'candidate_text_not_a_string'
    );
    if (proposedRequirementText.trim().length === 0) {
      fail('candidate_text_empty');
    }

    const grounding = verifyGrounding(record.primarySourceGrounding, 'candidate_grounding');
    const primarySourceReference =
      record.primarySourceReference === null
        ? null
        : verifyReference(record.primarySourceReference, sourceCodePoints, 'primary_reference');

    if (grounding === 'UNIQUE' && primarySourceReference === null) {
      fail('primary_reference_missing_for_unique_grounding');
    }
    if (grounding !== 'UNIQUE' && primarySourceReference !== null) {
      // Una cita ambigua o no encontrada NUNCA puede presentarse como referencia
      // primaria con offsets: sería anclaje inventado (P2.0 §15).
      fail('primary_reference_present_without_unique_grounding');
    }

    const confirmableAsSourceDerived = asBoolean(
      record.confirmableAsSourceDerived,
      'candidate_confirmable_not_a_boolean'
    );
    if (confirmableAsSourceDerived !== (grounding === 'UNIQUE')) {
      fail('confirmable_flag_inconsistent_with_grounding');
    }

    const auxiliarySourceReferences = asArray(
      record.auxiliarySourceReferences,
      'auxiliary_references_not_a_list'
    ).map((item) => verifyReference(item, sourceCodePoints, 'auxiliary_reference'));

    const ambiguousReferences = asArray(
      record.ambiguousReferences,
      'ambiguous_references_not_a_list'
    ).map((item) => {
      const entry = asRecord(item, 'ambiguous_reference_not_an_object');
      const occurrences = asInteger(entry.occurrences, 'ambiguous_occurrences_not_an_integer');
      if (occurrences < 2) {
        fail('ambiguous_reference_occurrences_invalid');
      }
      return {
        exactExcerpt: asString(entry.exactExcerpt, 'ambiguous_excerpt_not_a_string'),
        occurrences
      };
    });

    const unmatchedReferences = asArray(
      record.unmatchedReferences,
      'unmatched_references_not_a_list'
    ).map((item) => asString(item, 'unmatched_reference_not_a_string'));

    return {
      candidateId,
      order,
      proposedRequirementText,
      primarySourceReference,
      primarySourceGrounding: grounding,
      auxiliarySourceReferences,
      ambiguousReferences,
      unmatchedReferences,
      sourceSectionLabel: asString(record.sourceSectionLabel, 'section_label_not_a_string'),
      exactDuplicateOfEarlier: asBoolean(
        record.exactDuplicateOfEarlier,
        'exact_duplicate_flag_not_a_boolean'
      ),
      confirmableAsSourceDerived
    };
  });

  const unresolvedPassages: VerifiedUnresolvedPassage[] = asArray(
    artifact.unresolvedPassages,
    'unresolved_passages_not_a_list'
  ).map((value) => {
    const record = asRecord(value, 'unresolved_passage_not_an_object');
    const grounding = verifyGrounding(record.grounding, 'unresolved_grounding');
    const exactExcerpt = asString(record.exactExcerpt, 'unresolved_excerpt_not_a_string');
    let charStart: number | null = null;
    let charEnd: number | null = null;
    if (grounding === 'UNIQUE') {
      const reference = verifyReference(
        {
          exactExcerpt,
          charStart: record.charStart,
          charEnd: record.charEnd,
          offsetUnit: record.offsetUnit
        },
        sourceCodePoints,
        'unresolved_reference'
      );
      charStart = reference.charStart;
      charEnd = reference.charEnd;
    }
    return {
      exactExcerpt,
      reason: asString(record.reason, 'unresolved_reason_not_a_string'),
      grounding,
      charStart,
      charEnd
    };
  });

  return { candidates, unresolvedPassages };
}

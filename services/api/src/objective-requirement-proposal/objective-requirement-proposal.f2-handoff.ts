/**
 * Handoff de la propuesta a F2 — slice P2.2.
 *
 * ESTO NO CREA NADA. Es una función pura que traduce una decisión ya tomada por
 * una persona a la forma que `POST /me/objectives` ya acepta. No llama a
 * `ObjectivesService`, no toca Prisma y no se invoca desde el endpoint de
 * propuesta: vive acá para que la regla de procedencia esté escrita y probada en
 * un solo lugar, y no reinventada en el frontend.
 *
 * LA REGLA CONGELADA POR P2.0 §19, sin excepciones:
 *
 *     candidato SIN editar y con anclaje único  -> DERIVED_FROM_SOURCE_TEXT
 *     candidato con CUALQUIER edición textual   -> DIRECT_STRUCTURED_INPUT
 *     Requirement agregado a mano               -> DIRECT_STRUCTURED_INPUT
 *
 * POR QUÉ LA REGLA ES TAN GRUESA. Determinar si una edición preserva la relación
 * con la fuente es un juicio SEMÁNTICO, y el código no puede hacerlo. Lo único
 * comprobable —que la cita siga siendo subcadena— es justamente el invariante
 * insuficiente: la cita puede seguir existiendo mientras el texto editado dice
 * otra cosa. Conservar `DERIVED_FROM_SOURCE_TEXT` tras una edición sería afirmar
 * un respaldo que nadie verificó.
 *
 * COSTO ACEPTADO: un Requirement editado pierde su traza de procedencia. Se
 * mitiga en la UI, donde las referencias siguen visibles durante la revisión.
 *
 * SIN ENUM NUEVO. `REQUIREMENT_PROVENANCE_KINDS` de F2 no cambia, y por eso
 *
 *     F2_SCHEMA_CHANGES = 0
 *
 * LAS REFERENCIAS AUXILIARES NO ENTRAN A F2 en V1: son sólo para revisión. Y NO se
 * concatenan excerpts para fabricar una cita más "completa" — el resultado no
 * sería subcadena literal del texto y rompería la verificación de F2.
 */

import {
  type RequirementProvenance
} from '../objectives/objective-definition.types';
import {
  type ObjectiveProposalCandidateDto
} from './dto/objective-requirement-proposal.dto';

/** Lo que la persona hizo con un candidato antes de confirmar. */
export type ReviewDecision =
  | { readonly kind: 'UNCHANGED'; readonly candidateId: string }
  | { readonly kind: 'EDITED'; readonly candidateId: string; readonly editedText: string }
  | { readonly kind: 'MANUALLY_ADDED'; readonly text: string };

export interface RequirementHandoff {
  readonly requirementText: string;
  readonly provenance: RequirementProvenance;
}

/**
 * Traduce una decisión de revisión a la forma de F2.
 *
 * `candidatesById` es la propuesta que la persona revisó. Un candidato ausente es
 * un error del llamante, no un caso a tolerar en silencio.
 */
export function mapReviewDecisionToRequirement(
  decision: ReviewDecision,
  candidatesById: ReadonlyMap<string, ObjectiveProposalCandidateDto>
): RequirementHandoff {
  if (decision.kind === 'MANUALLY_ADDED') {
    return {
      requirementText: decision.text,
      provenance: { kind: 'DIRECT_STRUCTURED_INPUT', sourceQuote: null }
    };
  }

  const candidate = candidatesById.get(decision.candidateId);
  if (candidate === undefined) {
    throw new Error(`unknown_candidate:${decision.candidateId}`);
  }

  if (decision.kind === 'EDITED') {
    // No se compara el texto editado con el propuesto para "detectar" si la
    // edición fue cosmética: cualquier edición cae del mismo lado. Una regla que
    // dependa de cuánto cambió el texto sería un juicio semántico disfrazado.
    return {
      requirementText: decision.editedText,
      provenance: { kind: 'DIRECT_STRUCTURED_INPUT', sourceQuote: null }
    };
  }

  // UNCHANGED. Sólo conserva la procedencia derivada si el anclaje fue único: sin
  // cita verificada no hay nada que afirmar sobre la fuente.
  if (!candidate.confirmableAsSourceDerived || candidate.primarySourceReference === null) {
    return {
      requirementText: candidate.proposedRequirementText,
      provenance: { kind: 'DIRECT_STRUCTURED_INPUT', sourceQuote: null }
    };
  }

  return {
    requirementText: candidate.proposedRequirementText,
    provenance: {
      kind: 'DERIVED_FROM_SOURCE_TEXT',
      sourceQuote: candidate.primarySourceReference.exactExcerpt
    }
  };
}

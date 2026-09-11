/**
 * DTO privado de la propuesta — slice P2.2.
 *
 * ALLOWLIST, NO DENYLIST. El browser recibe exactamente lo que una persona
 * necesita para revisar: el claim propuesto, dónde está en su texto y si ese
 * anclaje es confiable. Nada más.
 *
 * LO QUE NUNCA SALE, y no por omisión sino porque no hay campo donde ponerlo:
 *
 *     respuesta cruda del proveedor   prompt          versión de prompt
 *     modelo                          reasoning effort headers del proveedor
 *     metadata de ejecución           detalle interno de errores
 *     razonamiento intermedio         finalState       policyTrace
 *     cualquier dato del holder
 *
 * TAMPOCO SE DEVUELVE `rawObjectiveText`. El frontend acaba de enviarlo; los
 * excerpts y offsets alcanzan para resaltar sobre el texto que ya tiene, y
 * repetirlo duplicaría el payload sin agregar información.
 *
 * SIN SCORE, SIN PORCENTAJE, SIN RANKING. Una propuesta no tiene calidad medible
 * por candidato: proponer un número invitaría a confiar en él.
 */

export interface ObjectiveProposalSourceReferenceDto {
  readonly exactExcerpt: string;
  readonly charStart: number;
  readonly charEnd: number;
  readonly offsetUnit: 'UNICODE_CODE_POINT';
}

export interface ObjectiveProposalAmbiguousReferenceDto {
  readonly exactExcerpt: string;
  /** Cuántas veces aparece. Se informa para que la persona entienda por qué no ancla. */
  readonly occurrences: number;
}

export interface ObjectiveProposalCandidateDto {
  /** Identidad estable DENTRO de esta propuesta. No es un `req_NN` de F2. */
  readonly candidateId: string;
  readonly order: number;
  readonly proposedRequirementText: string;
  /** `null` cuando la cita no ancla de forma única. El candidato se muestra igual. */
  readonly primarySourceReference: ObjectiveProposalSourceReferenceDto | null;
  readonly primarySourceGrounding: 'UNIQUE' | 'AMBIGUOUS' | 'NOT_FOUND';
  /** Sólo para revisión: no entran a F2 en V1. */
  readonly auxiliarySourceReferences: readonly ObjectiveProposalSourceReferenceDto[];
  readonly ambiguousReferences: readonly ObjectiveProposalAmbiguousReferenceDto[];
  readonly unmatchedReferences: readonly string[];
  /** Encabezado literal de la sección. Transitorio: no llega a F2. */
  readonly sourceSectionLabel: string;
  /**
   * Duplicado EXACTO de un candidato anterior, detectado por código confiable.
   *
   * Los duplicados SEMÁNTICOS no se detectan y no se eliminan: P2.1 los midió
   * como carga de revisión aceptada y deduplicarlos con heurística sería inventar
   * un juicio que nadie evaluó. La persona puede borrar el que sobre.
   */
  readonly exactDuplicateOfEarlier: boolean;
  /**
   * Si al confirmar puede conservar `DERIVED_FROM_SOURCE_TEXT`.
   *
   * `false` cuando la cita primaria no ancló de forma única: ese candidato sólo
   * puede confirmarse como `DIRECT_STRUCTURED_INPUT`.
   */
  readonly confirmableAsSourceDerived: boolean;
}

export interface ObjectiveProposalUnresolvedPassageDto {
  readonly exactExcerpt: string;
  readonly reason: string;
  readonly grounding: 'UNIQUE' | 'AMBIGUOUS' | 'NOT_FOUND';
  readonly charStart: number | null;
  readonly charEnd: number | null;
}

export interface ObjectiveRequirementProposalResponseDto {
  /** Versión del artefacto transitorio. No hay id: nada se persistió. */
  readonly schemaVersion: 'objective_requirement_proposal_v1';
  /**
   * `PROPOSAL_ONLY`. Viaja explícito para que ningún cliente pueda asumir que
   * esto ya es un Objective.
   */
  readonly authority: 'PROPOSAL_ONLY';
  /** Siempre `true`: la confirmación humana es obligatoria y no es negociable. */
  readonly humanConfirmationRequired: true;
  readonly candidates: readonly ObjectiveProposalCandidateDto[];
  readonly unresolvedPassages: readonly ObjectiveProposalUnresolvedPassageDto[];
}

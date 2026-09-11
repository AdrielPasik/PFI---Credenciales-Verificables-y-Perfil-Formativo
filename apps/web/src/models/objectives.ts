/**
 * Modelos de Objetivos — P2.3.
 *
 * Tres capas separadas a proposito:
 *
 *   1. VM de PROPUESTA      lo que devuelve el backend, ya adaptado
 *   2. BORRADOR DE REVISION estado local de la persona mientras revisa
 *   3. VM de OBJETIVO       lo persistido, solo lectura
 *
 * La propuesta es TRANSITORIA: no existe en el servidor y no se puede recuperar.
 * El borrador de revision tampoco. Solo la tercera capa tiene identidad estable.
 */

export const OBJECTIVE_TYPES = [
  'EMPLOYMENT',
  'SCHOLARSHIP',
  'ADMISSION',
  'EQUIVALENCE',
  'OTHER'
] as const;

export type ObjectiveTypeToken = (typeof OBJECTIVE_TYPES)[number];

/** Etiquetas de producto. Los tokens del enum NUNCA se muestran. */
export const OBJECTIVE_TYPE_LABELS: Record<ObjectiveTypeToken, string> = {
  EMPLOYMENT: 'Busqueda laboral',
  SCHOLARSHIP: 'Beca',
  ADMISSION: 'Admision a un programa',
  EQUIVALENCE: 'Equivalencia o convalidacion',
  OTHER: 'Otro'
};

export type ObjectiveGrounding = 'UNIQUE' | 'AMBIGUOUS' | 'NOT_FOUND';

export type RequirementProvenanceKind =
  | 'DERIVED_FROM_SOURCE_TEXT'
  | 'DIRECT_STRUCTURED_INPUT';

// ---------------------------------------------------------------------------
// 1. Propuesta
// ---------------------------------------------------------------------------

/**
 * Rango en CODE POINTS Unicode, no en unidades UTF-16.
 *
 * Es la unidad congelada por P2.2 y la unica con la que se puede recortar el
 * texto sin desplazar el resaltado cuando hay caracteres fuera del BMP.
 */
export interface ObjectiveSourceRangeVM {
  start: number;
  end: number;
}

export interface ObjectiveProposalCandidateVM {
  /** Identidad DENTRO de la propuesta. Estado de cliente: nunca se muestra. */
  candidateId: string;
  proposedRequirementText: string;
  /** `null` cuando la cita no ancla de forma unica. */
  primaryExcerpt: string | null;
  excerptRange: ObjectiveSourceRangeVM | null;
  grounding: ObjectiveGrounding;
  confirmableAsSourceDerived: boolean;
  sourceSectionLabel: string | null;
  isExactDuplicate: boolean;
}

export interface ObjectiveProposalVM {
  candidates: ObjectiveProposalCandidateVM[];
  unresolvedPassageCount: number;
}

// ---------------------------------------------------------------------------
// 2. Borrador de revision
// ---------------------------------------------------------------------------

/**
 * El texto EXACTO que produjo la propuesta.
 *
 * Es la unica autoridad textual a partir de aca: al confirmar, `originalText`
 * sale de este snapshot y no del textarea. Las citas se verificaron contra esta
 * string exacta, y el backend exige que `sourceQuote` sea subcadena literal de
 * lo que se persista. Releerlo del DOM o normalizarlo romperia esa cadena.
 */
export interface AnalyzedObjectiveSnapshot {
  objectiveType: ObjectiveTypeToken;
  title: string;
  rawObjectiveText: string;
}

export type ReviewItemOrigin = 'PROPOSED' | 'MANUAL';

export interface ReviewItem {
  /** Identidad local estable. Clave de React y del reordenamiento. */
  localKey: string;
  /** Solo trazabilidad local. NUNCA se muestra ni se envia. */
  candidateId: string | null;
  text: string;
  originalProposedText: string | null;
  origin: ReviewItemOrigin;
  /**
   * MONOTONICA. Una vez `true`, no vuelve a `false` ni aunque el texto final
   * coincida otra vez con el propuesto.
   *
   * P2.0 congela que cualquier edicion produce `DIRECT_STRUCTURED_INPUT`. Lo
   * que importa es que una persona intervino ese texto, no como quedo: la cita
   * respaldaba lo que dijo el proveedor, y tras una intervencion nadie verifico
   * que siga respaldando lo que ahora dice.
   */
  wasEverEdited: boolean;
  primaryExcerpt: string | null;
  excerptRange: ObjectiveSourceRangeVM | null;
  grounding: ObjectiveGrounding | null;
  confirmableAsSourceDerived: boolean;
  sourceSectionLabel: string | null;
  isExactDuplicate: boolean;
}

export interface ObjectiveReviewDraft {
  snapshot: AnalyzedObjectiveSnapshot;
  /** El ORDEN del array es el orden final. El servidor deriva `order` de el. */
  items: ReviewItem[];
  unresolvedPassageCount: number;
}

// ---------------------------------------------------------------------------
// 3. Objective persistido
// ---------------------------------------------------------------------------

export interface ObjectiveSummaryVM {
  objectiveReference: string;
  objectiveType: ObjectiveTypeToken;
  objectiveTypeLabel: string;
  title: string;
  createdAtLabel: string;
}

export interface ObjectiveRequirementVM {
  requirementId: string;
  requirementText: string;
  provenanceKind: RequirementProvenanceKind;
  /** Etiqueta de producto: "Del objetivo" / "Agregado por vos". */
  originLabel: string;
  sourceQuote: string | null;
}

export interface ObjectiveDetailVM {
  objectiveReference: string;
  objectiveType: ObjectiveTypeToken;
  objectiveTypeLabel: string;
  title: string;
  createdAtLabel: string;
  requirements: ObjectiveRequirementVM[];
  /**
   * Como entro la oportunidad. La RESPUESTA lo trae plano
   * (`sourceInputType` / `sourceOriginalText`), a diferencia de la PETICION de
   * creacion, que lo anida bajo `source`. La asimetria es del contrato.
   */
  sourceInputType: string;
  sourceOriginalText: string | null;
}

// ---------------------------------------------------------------------------
// Peticiones
// ---------------------------------------------------------------------------

export interface ObjectiveProposalRequestBody {
  objectiveType: ObjectiveTypeToken;
  title: string;
  rawObjectiveText: string;
}

export interface CreateObjectiveRequirementBody {
  requirementText: string;
  provenanceKind: RequirementProvenanceKind;
  sourceQuote: string | null;
}

export interface CreateObjectiveRequestBody {
  objectiveType: ObjectiveTypeToken;
  title: string;
  objectiveContext: string;
  source: {
    inputType: 'PASTED_TEXT';
    originalText: string;
  };
  requirements: CreateObjectiveRequirementBody[];
}

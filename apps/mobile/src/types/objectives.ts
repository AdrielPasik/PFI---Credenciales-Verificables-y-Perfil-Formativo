/**
 * Modelos de Objetivos.
 *
 * Tres capas separadas a propósito:
 *
 *   1. VM de PROPUESTA      lo que devuelve el backend, ya adaptado
 *   2. BORRADOR DE REVISIÓN estado local mientras la persona revisa
 *   3. VM de OBJETIVO       lo persistido, sólo lectura
 *
 * La propuesta es TRANSITORIA: no existe en el servidor y no se puede
 * recuperar. El borrador tampoco. Sólo la tercera capa tiene identidad estable.
 *
 * Es código propio de la app móvil: no se importa nada de `apps/web`. Replica
 * el mismo contrato porque el backend es el mismo.
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
  EMPLOYMENT: 'Búsqueda laboral',
  SCHOLARSHIP: 'Beca',
  ADMISSION: 'Admisión a un programa',
  EQUIVALENCE: 'Equivalencia o convalidación',
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
 * Es la unidad que congeló el backend y la única con la que se puede recortar
 * el texto sin desplazar el resaltado cuando hay caracteres fuera del BMP.
 */
export interface ObjectiveSourceRangeVM {
  start: number;
  end: number;
}

export interface ObjectiveProposalCandidateVM {
  /** Identidad DENTRO de la propuesta. Estado de cliente: nunca se muestra. */
  candidateId: string;
  proposedRequirementText: string;
  /** `null` cuando la cita no ancla de forma única. */
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
// 2. Borrador de revisión
// ---------------------------------------------------------------------------

/**
 * El texto EXACTO que produjo la propuesta.
 *
 * Es la única autoridad textual a partir de acá: al confirmar, `originalText`
 * sale de este snapshot y no del campo de entrada. Las citas se verificaron
 * contra esta string exacta, y el backend exige que `sourceQuote` sea subcadena
 * literal de lo que se persista. Releerlo del input o normalizarlo rompería esa
 * cadena.
 */
export interface AnalyzedObjectiveSnapshot {
  objectiveType: ObjectiveTypeToken;
  title: string;
  rawObjectiveText: string;
}

export type ReviewItemOrigin = 'PROPOSED' | 'MANUAL';

export interface ReviewItem {
  /** Identidad local estable. Clave de lista y del reordenamiento. */
  localKey: string;
  /** Sólo trazabilidad local. NUNCA se muestra ni se envía. */
  candidateId: string | null;
  text: string;
  originalProposedText: string | null;
  origin: ReviewItemOrigin;
  /**
   * MONOTÓNICA. Una vez `true`, no vuelve a `false` ni aunque el texto final
   * coincida otra vez con el propuesto.
   *
   * Cualquier edición produce `DIRECT_STRUCTURED_INPUT`. Lo que importa es que
   * una persona intervino ese texto, no cómo quedó: la cita respaldaba lo que
   * dijo el proveedor, y tras una intervención nadie verificó que siga
   * respaldando lo que ahora dice.
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
  /** El ORDEN del array es el orden final. El servidor deriva `order` de él. */
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
   * Cómo entró la oportunidad. La RESPUESTA lo trae plano
   * (`sourceInputType` / `sourceOriginalText`), a diferencia de la PETICIÓN de
   * creación, que lo anida bajo `source`. La asimetría es del contrato.
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

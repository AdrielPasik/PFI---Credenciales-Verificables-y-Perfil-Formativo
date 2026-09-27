/**
 * Modelos de Análisis de trayectoria (ReasoningRun).
 *
 * EL CONTRATO NO TRAE `explanation`, y no es un olvido del backend: el render
 * determinista del razonador lleva adentro los `src_NN` locales del run y
 * tokens de enum, así que se sacó del transporte. La app NO lo espera, NO lo
 * pide y, si algún día reapareciera, el adapter lo ignora.
 *
 * El lenguaje que ve la persona se compone acá, de forma determinista, desde
 * tres campos estructurados con autoridad propia: `finalState`,
 * `supportedWeakerClaim` y `evidence[]`. Nada se parsea, nada se infiere.
 */

// ---------------------------------------------------------------------------
// Vocabularios cerrados
// ---------------------------------------------------------------------------

/** Lifecycle OPERACIONAL del run. No es el resultado epistémico. */
export const REASONING_RUN_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed'
] as const;

export type ReasoningRunStatus = (typeof REASONING_RUN_STATUSES)[number];

/**
 * Los CINCO estados finales por Requirement. No hay un sexto.
 *
 * Se preservan exactos: no se colapsan a aprobado/reprobado, no se convierten
 * en porcentaje y no se ordenan por "mejor resultado".
 */
export const REQUIREMENT_FINAL_STATES = [
  'SUPPORTED',
  'PARTIALLY_SUPPORTED',
  'INSUFFICIENT_EVIDENCE',
  'NOT_ASSESSABLE',
  'ABSTAIN'
] as const;

export type RequirementFinalState = (typeof REQUIREMENT_FINAL_STATES)[number];

/**
 * Etiquetas es-AR.
 *
 * Todas son afirmaciones sobre LA EVIDENCIA DISPONIBLE, nunca sobre la persona.
 * "Evidencia insuficiente" describe lo que Scope pudo observar en las
 * credenciales; no dice que alguien no sepa algo.
 */
export const FINAL_STATE_LABELS: Record<RequirementFinalState, string> = {
  SUPPORTED: 'Respaldado por tu evidencia',
  PARTIALLY_SUPPORTED: 'Respaldado parcialmente',
  INSUFFICIENT_EVIDENCE: 'Evidencia insuficiente',
  NOT_ASSESSABLE: 'No evaluable con evidencia formativa',
  ABSTAIN: 'No se pudo determinar con suficiente confiabilidad'
};

/**
 * Copy explicativo por estado. Determinista y fijo. No se genera, no se resume
 * y no describe "lo que falta" salvo que el backend lo entregue estructurado
 * —que hoy sólo pasa con `supportedWeakerClaim`—.
 */
export const FINAL_STATE_DESCRIPTIONS: Record<RequirementFinalState, string> = {
  SUPPORTED:
    'Scope encontró evidencia en tus credenciales que permite respaldar este requisito.',
  PARTIALLY_SUPPORTED:
    'La evidencia disponible respalda una parte de lo que pide este requisito, pero no todo su alcance.',
  INSUFFICIENT_EVIDENCE:
    'No encontramos evidencia suficiente en las credenciales disponibles para justificar este requisito.',
  NOT_ASSESSABLE:
    'Este requisito no puede evaluarse de forma confiable a partir de credenciales formativas.',
  ABSTAIN:
    'Con la evidencia disponible no fue posible llegar a una conclusión confiable sobre este requisito.'
};

/** Calidad de la EXTRACCIÓN de la fuente. Nunca una afirmación sobre la persona. */
export const EVIDENCE_COVERAGES = ['FULL', 'PARTIAL', 'FAILED'] as const;
export type EvidenceCoverage = (typeof EVIDENCE_COVERAGES)[number];

export const EVIDENCE_SOURCE_KINDS = ['DOCUMENT', 'TEXT'] as const;
export type EvidenceSourceKind = (typeof EVIDENCE_SOURCE_KINDS)[number];

export const SOURCE_KIND_LABELS: Record<EvidenceSourceKind, string> = {
  DOCUMENT: 'Documento respaldatorio',
  TEXT: 'Contenido declarado'
};

/** Aviso sobre la extracción, no sobre la persona. `null` cuando fue completa. */
export const COVERAGE_NOTICES: Record<EvidenceCoverage, string | null> = {
  FULL: null,
  PARTIAL: 'La fuente se pudo leer sólo de forma parcial.',
  FAILED: 'La fuente no se pudo leer por completo.'
};

/**
 * Estado ACTUAL de la credencial. Se muestra como presente, jamás como pasado:
 * el backend no tiene instantánea del estado al momento del run, así que decir
 * "se revocó después del análisis" sería inventar historia.
 */
export const CREDENTIAL_CURRENT_STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  issued: 'Emitida',
  revoked: 'Revocada'
};

/** Categoría de fallo del run. Cerrada del lado del backend. */
export const RUN_FAILURE_CATEGORIES = [
  'EVIDENCE_PREPARATION_BLOCKED',
  'EXECUTION_FAILED'
] as const;

export type RunFailureCategory = (typeof RUN_FAILURE_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// View models
// ---------------------------------------------------------------------------

export interface ReasoningEvidenceCredentialVM {
  credentialReference: string;
  title: string;
  credentialType: string;
  issuerName: string;
  /** SIEMPRE presente. SIEMPRE actual. Ver la nota de arriba. */
  currentStatus: string;
  currentStatusLabel: string;
}

export interface ReasoningEvidenceVM {
  /** La cita exacta, VERBATIM. Nunca se recorta ni se normaliza antes de mostrar. */
  excerpt: string;
  contextBefore: string | null;
  contextAfter: string | null;
  sectionLabel: string | null;
  /** `null` legítimo: siempre en fuentes de texto, y en PDF sin página identificada. */
  pageNumber: number | null;
  coverage: EvidenceCoverage;
  sourceKind: EvidenceSourceKind;
  credential: ReasoningEvidenceCredentialVM | null;
}

export interface RequirementResultVM {
  requirementId: string;
  requirementText: string;
  finalState: RequirementFinalState;
  /** Texto persistido del claim más débil defendible. Copiado exacto. */
  supportedWeakerClaim: string | null;
  evidence: ReasoningEvidenceVM[];
}

/** Agregación determinista ya resuelta por el backend. */
export interface ObjectiveSynthesisStateSummaryVM {
  supportedCount: number;
  partiallySupportedCount: number;
  insufficientEvidenceCount: number;
  abstainCount: number;
  notAssessableCount: number;
}

export interface ObjectiveSynthesisRequirementVM {
  requirementId: string;
  order: number;
  requirementText: string;
  finalState: RequirementFinalState;
}

export interface ObjectiveSynthesisPositiveConclusionVM {
  requirementId: string;
  requirementText: string;
  finalState: Extract<
    RequirementFinalState,
    'SUPPORTED' | 'PARTIALLY_SUPPORTED'
  >;
  supportedWeakerClaim: string | null;
  supportingCredentialReferences: string[];
}

export interface ObjectiveSynthesisSupportingCredentialVM {
  credentialReference: string;
  credentialDisplay: {
    title: string;
    credentialType: string;
    issuerName: string;
    /** Estado actual de presentación; no reescribe el resultado histórico. */
    currentStatus: string;
  };
  supportedRequirementIds: string[];
  partiallySupportedRequirementIds: string[];
}

/**
 * Read model aditivo del backend. NO se reconstruye en el cliente: conserva
 * exactamente la forma y el orden que entrega el servidor.
 */
export interface ObjectiveSynthesisVM {
  schemaVersion: 'objective_synthesis_v1';
  reasoningRunReference: string;
  objectiveReference: string;
  stateSummary: ObjectiveSynthesisStateSummaryVM;
  requirements: ObjectiveSynthesisRequirementVM[];
  positiveConclusions: ObjectiveSynthesisPositiveConclusionVM[];
  credentialsSupportingPositiveConclusions: ObjectiveSynthesisSupportingCredentialVM[];
}

/**
 * Evidencias AGRUPADAS por credencial para presentarlas.
 *
 * Se agrupa por `credentialReference`, que es identidad autoritativa del
 * backend. NUNCA por título, emisor ni parecido semántico. Las evidencias sin
 * credencial quedan sueltas, sin inventarles una asociación.
 */
export interface EvidenceCredentialGroupVM {
  credential: ReasoningEvidenceCredentialVM | null;
  items: ReasoningEvidenceVM[];
}

export interface ReasoningRunSummaryVM {
  reasoningRunReference: string;
  objectiveReference: string;
  objectiveTitle: string;
  status: ReasoningRunStatus;
  requirementCount: number;
  failureCategory: RunFailureCategory | null;
  createdAt: string;
  createdAtLabel: string;
}

export interface ReasoningRunDetailVM {
  reasoningRunReference: string;
  status: ReasoningRunStatus;
  objectiveReference: string;
  objectiveTitle: string;
  failureCategory: RunFailureCategory | null;
  /**
   * ISO crudo, el MISMO que trae el resumen.
   *
   * No se muestra: existe para reconciliar el historial cuando una operación
   * autoritativa devuelve el detalle de un run que la lista todavía no conocía.
   * La alternativa era fabricar una fecha en el cliente.
   */
  createdAt: string;
  createdAtLabel: string;
  completedAtLabel: string | null;
  /** Presente SÓLO cuando el run completó. */
  requirementResults: RequirementResultVM[] | null;
  /**
   * Ausente en APIs previas compatibles y `null` en runs no completados. Ambos
   * casos se representan como `null`; nunca se reconstruye desde `result`.
   */
  synthesis: ObjectiveSynthesisVM | null;
}

// ---------------------------------------------------------------------------
// Derivaciones de presentación
// ---------------------------------------------------------------------------

/**
 * Recuento DESCRIPTIVO por estado, en el orden congelado de los cinco.
 *
 * Es un recuento, no un puntaje. No se divide por el total, no se convierte en
 * porcentaje y no se compara entre objetivos: "5 respaldados" describe la
 * evidencia; "78% de compatibilidad" sería una afirmación sobre la persona que
 * el sistema no puede sostener.
 */
export function countByFinalState(
  results: readonly RequirementResultVM[]
): { state: RequirementFinalState; label: string; count: number }[] {
  return REQUIREMENT_FINAL_STATES.map((state) => ({
    state,
    label: FINAL_STATE_LABELS[state],
    count: results.filter((result) => result.finalState === state).length
  })).filter((entry) => entry.count > 0);
}

/** Agrupa preservando el orden de aparición, tanto de grupos como de items. */
export function groupEvidenceByCredential(
  evidence: readonly ReasoningEvidenceVM[]
): EvidenceCredentialGroupVM[] {
  const groups: EvidenceCredentialGroupVM[] = [];
  const byReference = new Map<string, EvidenceCredentialGroupVM>();

  for (const item of evidence) {
    if (item.credential === null) {
      // Sin credencial no hay identidad por la que agrupar. Cada una va sola:
      // juntarlas sugeriría que comparten origen, y no lo sabemos.
      groups.push({ credential: null, items: [item] });
      continue;
    }

    const key = item.credential.credentialReference;
    const existing = byReference.get(key);

    if (existing) {
      existing.items.push(item);
      continue;
    }

    const group: EvidenceCredentialGroupVM = {
      credential: item.credential,
      items: [item]
    };
    byReference.set(key, group);
    groups.push(group);
  }

  return groups;
}

/**
 * Modelos de Analisis de trayectoria (ReasoningRun) — P2.4B.
 *
 * EL CONTRATO NO TRAE `explanation`, y no es un olvido del backend: P2.4A.1 lo
 * saco del transporte a proposito porque el render determinista de F3.6 lleva
 * adentro los `src_NN` locales del run y tokens de enum. La web NO lo espera,
 * NO lo pide y, si algun dia reapareciera, el adapter lo ignora.
 *
 * El lenguaje que ve la persona se compone aca, de forma determinista, desde
 * tres campos estructurados con autoridad propia: `finalState`,
 * `supportedWeakerClaim` y `evidence[]`. Nada se parsea, nada se infiere.
 */

// ---------------------------------------------------------------------------
// Vocabularios cerrados
// ---------------------------------------------------------------------------

/** Lifecycle OPERACIONAL del run. No es el resultado epistemico. */
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
 * Se preservan exactos: no se colapsan a aprobado/reprobado, no se convierten en
 * porcentaje y no se ordenan por "mejor resultado".
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
 * Copy explicativo por estado.
 *
 * Determinista y fijo. No se genera, no se resume y no describe "lo que falta"
 * salvo que el backend lo entregue estructurado —que hoy solo pasa con
 * `supportedWeakerClaim`—.
 */
export const FINAL_STATE_DESCRIPTIONS: Record<RequirementFinalState, string> = {
  SUPPORTED:
    'Scope encontro evidencia en tus credenciales que permite respaldar este requisito.',
  PARTIALLY_SUPPORTED:
    'La evidencia disponible respalda una parte de lo que pide este requisito, pero no todo su alcance.',
  INSUFFICIENT_EVIDENCE:
    'No encontramos evidencia suficiente en las credenciales disponibles para justificar este requisito.',
  NOT_ASSESSABLE:
    'Este requisito no puede evaluarse de forma confiable a partir de credenciales formativas.',
  ABSTAIN:
    'Con la evidencia disponible no fue posible llegar a una conclusion confiable sobre este requisito.'
};

/** Calidad de la EXTRACCION de la fuente. Nunca una afirmacion sobre la persona. */
export const EVIDENCE_COVERAGES = ['FULL', 'PARTIAL', 'FAILED'] as const;
export type EvidenceCoverage = (typeof EVIDENCE_COVERAGES)[number];

export const EVIDENCE_SOURCE_KINDS = ['DOCUMENT', 'TEXT'] as const;
export type EvidenceSourceKind = (typeof EVIDENCE_SOURCE_KINDS)[number];

export const SOURCE_KIND_LABELS: Record<EvidenceSourceKind, string> = {
  DOCUMENT: 'Documento respaldatorio',
  TEXT: 'Contenido declarado'
};

/**
 * Estado ACTUAL de la credencial. Se muestra como presente, jamas como pasado:
 * el backend no tiene instantanea del estado al momento del run, asi que decir
 * "se revoco despues del analisis" seria inventar historia.
 */
export const CREDENTIAL_CURRENT_STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  issued: 'Emitida',
  revoked: 'Revocada'
};

/** Categoria de fallo del run. Cerrada del lado del backend. */
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
  /** `null` legitimo: siempre en fuentes de texto, y en PDF sin pagina identificada. */
  pageNumber: number | null;
  coverage: EvidenceCoverage;
  sourceKind: EvidenceSourceKind;
  credential: ReasoningEvidenceCredentialVM | null;
}

export interface RequirementResultVM {
  requirementId: string;
  requirementText: string;
  finalState: RequirementFinalState;
  /** Texto persistido del claim mas debil defendible. Copiado exacto. */
  supportedWeakerClaim: string | null;
  evidence: ReasoningEvidenceVM[];
}

/**
 * Evidencias AGRUPADAS por credencial para presentarlas.
 *
 * Se agrupa por `credentialReference`, que es identidad autoritativa del
 * backend. NUNCA por titulo, emisor ni parecido semantico. Las evidencias sin
 * credencial quedan sueltas, sin inventarles una asociacion.
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
   * No se muestra: existe para reconciliar el historial cuando una operacion
   * autoritativa devuelve el detalle de un run que la lista todavia no conocia.
   * La alternativa era fabricar una fecha en el cliente.
   */
  createdAt: string;
  createdAtLabel: string;
  completedAtLabel: string | null;
  /** Presente SOLO cuando el run completo. */
  requirementResults: RequirementResultVM[] | null;
}

// ---------------------------------------------------------------------------
// Derivaciones de presentacion
// ---------------------------------------------------------------------------

/**
 * Recuento DESCRIPTIVO por estado, en el orden congelado de los cinco.
 *
 * Es un recuento, no un puntaje. No se divide por el total, no se convierte en
 * porcentaje y no se compara entre objetivos: "5 respaldados" describe la
 * evidencia; "78% de compatibilidad" seria una afirmacion sobre la persona que
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

/** Agrupa preservando el orden de aparicion, tanto de grupos como de items. */
export function groupEvidenceByCredential(
  evidence: readonly ReasoningEvidenceVM[]
): EvidenceCredentialGroupVM[] {
  const groups: EvidenceCredentialGroupVM[] = [];
  const byReference = new Map<string, EvidenceCredentialGroupVM>();

  for (const item of evidence) {
    if (item.credential === null) {
      // Sin credencial no hay identidad por la que agrupar. Cada una va sola:
      // juntarlas sugeriria que comparten origen, y no lo sabemos.
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

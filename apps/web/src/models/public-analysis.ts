/**
 * Modelos del analisis contextual publico — vista del verificador.
 *
 * TRES capas, como en el holder, y ninguna se mezcla:
 *
 *   1. SESION    lo que el backend sabe de la solicitud (autoridad de reanudacion)
 *   2. BORRADOR  la revision local de requisitos (reusa el nucleo del holder)
 *   3. RESULTADO la proyeccion publica ya decidida por el backend
 *
 * NADA de la capa 3 se deriva en el cliente. Los estados epistemicos, la
 * sintesis, el claim mas debil y las credenciales de respaldo vienen del
 * servidor o no existen.
 */

import type { ObjectiveProposalVM, ObjectiveTypeToken } from '@/models/objectives';

// ---------------------------------------------------------------------------
// 1. Sesion
// ---------------------------------------------------------------------------

export const VERIFICATION_REQUEST_STATUSES = [
  'draft',
  'requirements_proposed',
  'requirements_confirmed',
  'consumed'
] as const;

export type VerificationRequestStatusToken = (typeof VERIFICATION_REQUEST_STATUSES)[number];

export interface PublicVerificationSessionVM {
  status: VerificationRequestStatusToken;
  objectiveType: ObjectiveTypeToken;
  objectiveTypeLabel: string;
  /** El texto propio del verificador, verbatim. */
  rawObjectiveText: string;
  objectiveTitle: string | null;
  /** `objective_requirement_proposal_v1` ya adaptado. PROPOSAL_ONLY. */
  proposal: ObjectiveProposalVM | null;
  /** Hay trabajo en curso para esta sesion. */
  proposalInProgress: boolean;
  /** Los requisitos confirmados, en orden. Solo lectura. */
  confirmedRequirements: string[];
  expiresAtLabel: string | null;
}

export interface CreatedPublicVerificationSessionVM {
  /**
   * Valor crudo, entregado UNA sola vez. Nunca se renderiza, nunca va a la URL
   * y nunca se escribe en un log.
   */
  requestToken: string;
  session: PublicVerificationSessionVM;
}

// ---------------------------------------------------------------------------
// 3. Resultado publico
// ---------------------------------------------------------------------------

export const PUBLIC_ANALYSIS_STATES = [
  'AWAITING_REQUIREMENTS',
  'READY_TO_EXECUTE',
  'PROCESSING',
  'COMPLETED',
  'FAILED'
] as const;

export type PublicAnalysisStateToken = (typeof PUBLIC_ANALYSIS_STATES)[number];

export const PUBLIC_FAILURE_CATEGORIES = [
  'TEMPORARILY_UNAVAILABLE',
  'AUTHORIZATION_WITHDRAWN',
  'RETRY_BUDGET_EXHAUSTED',
  'EXECUTION_INTERRUPTED',
  'EXECUTION_FAILED'
] as const;

export type PublicFailureCategoryToken = (typeof PUBLIC_FAILURE_CATEGORIES)[number];

export const PUBLIC_FINAL_STATES = [
  'SUPPORTED',
  'PARTIALLY_SUPPORTED',
  'INSUFFICIENT_EVIDENCE',
  'ABSTAIN',
  'NOT_ASSESSABLE'
] as const;

export type PublicFinalStateToken = (typeof PUBLIC_FINAL_STATES)[number];

/**
 * Copy de producto de cada estado.
 *
 * Deliberadamente descriptiva: describe QUE respalda la evidencia compartida, no
 * si una persona "cumple", "califica" o "es apta".
 */
export const PUBLIC_FINAL_STATE_LABELS: Record<PublicFinalStateToken, string> = {
  SUPPORTED: 'Respaldado por la evidencia compartida',
  PARTIALLY_SUPPORTED: 'Respaldado parcialmente',
  INSUFFICIENT_EVIDENCE: 'Evidencia insuficiente',
  NOT_ASSESSABLE: 'No evaluable con esta evidencia',
  ABSTAIN: 'No se pudo determinar con suficiente confiabilidad'
};

/**
 * Que significa cada estado, en una frase, para quien lee el resultado.
 *
 * TRES ESTADOS NO POSITIVOS Y TRES SIGNIFICADOS DISTINTOS. Colapsarlos en
 * "la evidencia no alcanza" le miente al lector en dos de los tres casos:
 *
 *   INSUFFICIENT_EVIDENCE  el requisito SI es evaluable desde evidencia
 *                          formativa; lo que falta es evidencia.
 *   NOT_ASSESSABLE         el requisito no se evalua adecuadamente SOLO con
 *                          evidencia formativa. Mas credenciales del mismo tipo
 *                          no cambiarian nada: no es un problema de cantidad.
 *   ABSTAIN                el tipo de afirmacion si se podia evaluar, pero no se
 *                          llego a una conclusion suficientemente fundada.
 *
 * Es COPY: no decide estados, no los deriva y no los reinterpreta. La policy
 * determinista del backend ya decidio; aca solo se dice bien.
 */
export const PUBLIC_FINAL_STATE_EXPLANATIONS: Record<PublicFinalStateToken, string | null> = {
  // Los positivos se explican con su propia evidencia, no con una frase generica.
  SUPPORTED: null,
  PARTIALLY_SUPPORTED: null,
  INSUFFICIENT_EVIDENCE: 'La evidencia compartida no alcanza para justificar este requisito.',
  NOT_ASSESSABLE:
    'Este requisito no puede evaluarse adecuadamente únicamente a partir de la evidencia formativa compartida.',
  ABSTAIN:
    'Scope pudo evaluar este tipo de requisito, pero no llegó a una conclusión suficientemente fundada con la evidencia compartida.'
};

export const PUBLIC_SOURCE_KINDS = ['DOCUMENT', 'TEXT'] as const;
export type PublicSourceKindToken = (typeof PUBLIC_SOURCE_KINDS)[number];

export const PUBLIC_SOURCE_KIND_LABELS: Record<PublicSourceKindToken, string> = {
  DOCUMENT: 'Documento',
  TEXT: 'Texto declarado'
};

export interface PublicSupportingCredentialVM {
  credentialReference: string;
  title: string;
  credentialTypeLabel: string;
  issuerName: string;
  /** Estado ACTUAL de la credencial, no el que tenia al ejecutarse el analisis. */
  currentStatus: 'issued' | 'revoked';
  currentStatusLabel: string;
  sourceKindLabels: string[];
  supportingUnitCount: number;
}

export interface PublicRequirementResultVM {
  order: number;
  requirementText: string;
  /** Conclusion HISTORICA del analisis. */
  finalState: PublicFinalStateToken;
  finalStateLabel: string;
  /** Solo en `PARTIALLY_SUPPORTED`: el enunciado mas acotado que si se sostiene. */
  supportedWeakerClaim: string | null;
  supportingCredentials: PublicSupportingCredentialVM[];
}

export interface PublicAnalysisObjectiveVM {
  objectiveType: ObjectiveTypeToken;
  objectiveTypeLabel: string;
  title: string | null;
  objectiveContext: string;
  requirements: Array<{ order: number; requirementText: string }>;
}

export interface PublicAnalysisSynthesisVM {
  stateSummary: Array<{ state: PublicFinalStateToken; label: string; count: number }>;
  totalRequirements: number;
  positiveConclusions: Array<{
    order: number;
    requirementText: string;
    finalState: Extract<PublicFinalStateToken, 'SUPPORTED' | 'PARTIALLY_SUPPORTED'>;
    finalStateLabel: string;
    supportedWeakerClaim: string | null;
    supportingCredentialReferences: string[];
  }>;
  supportingCredentials: Array<{
    credentialReference: string;
    title: string;
    credentialTypeLabel: string;
    issuerName: string;
    currentStatus: 'issued' | 'revoked';
    currentStatusLabel: string;
    supportedRequirementOrders: number[];
    partiallySupportedRequirementOrders: number[];
  }>;
}

export interface PublicAnalysisResultVM {
  state: PublicAnalysisStateToken;
  objective: PublicAnalysisObjectiveVM | null;
  completedAtLabel: string | null;
  failure: { category: PublicFailureCategoryToken; retryable: boolean } | null;
  result: {
    requirements: PublicRequirementResultVM[];
    synthesis: PublicAnalysisSynthesisVM;
    /** Copy humana; el token del backend nunca se muestra. */
    temporalNotice: string;
  } | null;
}

/**
 * Modelos de dominio del titular, en su proyección de presentación.
 *
 * Es el MISMO dominio que Holder Web: una credencial es la misma credencial,
 * un perfil es el mismo perfil. Mobile adapta la presentación, nunca la
 * verdad del dominio (sección 102 del encargo).
 */

export type HolderCredentialStatus = 'issued' | 'revoked';

export type HolderCredentialType =
  | 'academic_subject'
  | 'course'
  | 'certification'
  | 'degree';

export type HolderSemanticAnalysisStatus = 'completed' | 'partial';

export interface HolderCredentialListItemVM {
  credentialReference: string;
  title: string;
  type: HolderCredentialType;
  typeLabel: string;
  status: HolderCredentialStatus;
  statusLabel: string;
  issuerName: string;
  issuedAtLabel: string | null;
  hasIntegrityEvidence: boolean;
  hasAnalysis: boolean;
}

export interface HolderCredentialIntegrityRecordVM {
  networkLabel: string;
  chainId: number;
  txHash: string;
  txHashShort: string;
  statusLabel: string;
  registeredAtLabel: string;
}

export interface HolderCredentialIntegrityVM {
  canonicalHash: string | null;
  canonicalHashShort: string | null;
  canonicalizationVersion: string | null;
  records: HolderCredentialIntegrityRecordVM[];
}

export interface HolderCredentialSubjectVM {
  achievementName: string | null;
  institutionName: string | null;
  completionDate: string | null;
  academicPeriod: string | null;
  programName: string | null;
  grade: string | null;
  providerName: string | null;
  platformName: string | null;
  modality: string | null;
  level: string | null;
  externalUrl: string | null;
  skills: string[];
  competencies: string[];
  learningOutcomes: string[];
}

export interface HolderCredentialAnalysisVM {
  status: HolderSemanticAnalysisStatus;
  statusLabel: string;
  confidenceLabel: string | null;
  areas: string[];
  skills: string[];
  concepts: string[];
  qualityFlags: string[];
  analyzedAtLabel: string;
}

export interface HolderCredentialDetailVM extends HolderCredentialListItemVM {
  description: string | null;
  hoursLabel: string | null;
  issuerDid: string | null;
  holderLabel: string | null;
  holderEmail: string | null;
  holderDid: string | null;
  revokedAtLabel: string | null;
  revocationReason: string | null;
  subject: HolderCredentialSubjectVM;
  documentEvidence: {
    originalFileName: string;
    mimeType: string;
    sizeLabel: string;
    sha256Short: string;
    uploadedAtLabel: string;
  } | null;
  textEvidence: {
    label: string | null;
    preview: string;
    characterCount: number;
    sha256Short: string;
    submittedAtLabel: string;
  } | null;
  integrity: HolderCredentialIntegrityVM;
  analysis: HolderCredentialAnalysisVM | null;
}

/**
 * Procedencia agregada de un área o habilidad, en lenguaje de producto.
 * Nunca ids internos ni enums técnicos. `null` cuando el backend no tiene
 * información: en ese caso no se renderiza nada, nunca un "sin datos".
 */
export interface HolderProfileProvenanceVM {
  issuerReviewedLabel: string | null;
  aiInferredLabel: string | null;
}

export interface HolderProfileAreaVM {
  label: string;
  estimatedHoursLabel: string | null;
  provenance: HolderProfileProvenanceVM | null;
}

export interface HolderProfileSkillVM {
  label: string;
  confidenceLabel: string | null;
  provenance: HolderProfileProvenanceVM | null;
}

export interface HolderProfileVM {
  profileVersion: string;
  credentialsCount: number;
  /** Suma de horas declaradas por las credenciales, nunca una estimación. */
  totalOfficialHoursLabel: string | null;
  hoursCoverageNoticeLabel: string | null;
  semanticCoverageNoticeLabel: string | null;
  reviewedInterpretationNoticeLabel: string | null;
  /** Síntesis prudente y determinística del perfil, no una certificación. */
  narrative: string | null;
  areas: HolderProfileAreaVM[];
  /** Inferidas por análisis. Ver `emittedSkills` para lo declarado. */
  skills: HolderProfileSkillVM[];
  concepts: string[];
  /** Declarado por la institución emisora. Nunca una inferencia de IA. */
  emittedSkills: string[];
  emittedCompetencies: string[];
  emittedLearningOutcomes: string[];
  confidenceLabel: string | null;
  qualityFlags: string[];
  generatedAtLabel: string;
}

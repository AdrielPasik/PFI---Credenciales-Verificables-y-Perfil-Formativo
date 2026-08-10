export type HolderCredentialStatus = 'issued' | 'revoked';
export type HolderCredentialType =
  | 'academic_subject'
  | 'course'
  | 'certification'
  | 'degree';
export type HolderSemanticAnalysisStatus = 'completed' | 'partial';

export interface HolderCredentialIntegrityVM {
  canonicalHash: string | null;
  canonicalHashShort: string | null;
  canonicalizationVersion: string | null;
  records: Array<{
    networkLabel: string;
    chainId: number;
    txHashShort: string;
    statusLabel: string;
    registeredAtLabel: string;
  }>;
}

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

export interface HolderCredentialDetailVM
  extends HolderCredentialListItemVM {
  description: string | null;
  hoursLabel: string | null;
  issuerDid: string | null;
  holderLabel: string | null;
  holderEmail: string | null;
  holderDid: string | null;
  revokedAtLabel: string | null;
  revocationReason: string | null;
  subject: {
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
  };
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
  analysis: {
    status: HolderSemanticAnalysisStatus;
    statusLabel: string;
    confidenceLabel: string | null;
    areas: string[];
    skills: string[];
    concepts: string[];
    qualityFlags: string[];
    analyzedAtLabel: string;
  } | null;
}

export interface HolderProfileVM {
  profileVersion: string;
  credentialsCount: number;
  totalHoursLabel: string | null;
  areas: Array<{ label: string; estimatedHoursLabel: string | null }>;
  /** Inferido/agregado por análisis de IA. Ver emittedSkills para lo declarado por el emisor. */
  skills: Array<{ label: string; confidenceLabel: string | null }>;
  concepts: string[];
  /** Declarado por la institución emisora en la credencial. Nunca es una inferencia de IA. */
  emittedSkills: string[];
  emittedCompetencies: string[];
  emittedLearningOutcomes: string[];
  confidenceLabel: string | null;
  qualityFlags: string[];
  generatedAtLabel: string;
}

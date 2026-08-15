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

/**
 * C5b.2: proyeccion de producto (no tecnica) de provenance agregada por
 * area/skill -- nunca ids internos, nunca enums (issuer_reviewed/
 * ai_inferred), nunca "sources". Cada label es null cuando ese aporte no
 * existe (nunca "0 aportes"). `provenance` en si es null cuando el backend
 * no tiene informacion (perfil legacy o malformado) -- el componente no
 * debe renderizar nada en ese caso, nunca un "sin datos" ruidoso.
 */
export interface HolderProfileProvenanceVM {
  issuerReviewedLabel: string | null;
  aiInferredLabel: string | null;
}

export interface HolderProfileVM {
  profileVersion: string;
  credentialsCount: number;
  // C2c: horas oficiales/declaradas (suma de Credential.hours), nunca una
  // distribucion por area. Renombrado desde totalHoursLabel para que el
  // nombre nunca se preste a confundirse con una estimacion de IA.
  totalOfficialHoursLabel: string | null;
  /** "N credenciales no informan horas." Null cuando no hay ninguna (o el
   * contador no esta disponible en un perfil generado antes de C2c). */
  hoursCoverageNoticeLabel: string | null;
  /** "N credenciales todavía no tienen análisis semántico." Null cuando no
   * hay ninguna (o el contador no esta disponible en un perfil pre-C2c). */
  semanticCoverageNoticeLabel: string | null;
  /** "N credenciales cuentan con una interpretación revisada por el emisor."
   * Null cuando no hay ninguna o el contador no esta disponible (perfil
   * pre-C5b.1). C5b.2. */
  reviewedInterpretationNoticeLabel: string | null;
  /** Síntesis prudente y determinística del perfil, no una certificación. */
  narrative: string | null;
  areas: Array<{
    label: string;
    estimatedHoursLabel: string | null;
    /** Opcional: los VM de fixtures/tests preexistentes no necesitan
     * declararlo explicitamente -- ausente se trata igual que null. */
    provenance?: HolderProfileProvenanceVM | null;
  }>;
  /** Inferido/agregado por análisis de IA. Ver emittedSkills para lo declarado por el emisor. */
  skills: Array<{
    label: string;
    confidenceLabel: string | null;
    provenance?: HolderProfileProvenanceVM | null;
  }>;
  concepts: string[];
  /** Declarado por la institución emisora en la credencial. Nunca es una inferencia de IA. */
  emittedSkills: string[];
  emittedCompetencies: string[];
  emittedLearningOutcomes: string[];
  confidenceLabel: string | null;
  qualityFlags: string[];
  generatedAtLabel: string;
}

export interface MeCredentialDetailResponseDto {
  id: string;
  type: string;
  title: string;
  description: string | null;
  hours: number | null;
  status: string;
  issuer: {
    name: string;
    did: string | null;
  };
  subject: {
    did: string | null;
    email: string | null;
    displayName: string | null;
  };
  issuedAt: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  canonicalHash: string | null;
  canonicalizationVersion: string | null;
  credentialSubject: {
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
    sizeBytes: number;
    sha256: string;
    uploadedAt: string;
  } | null;
  textEvidence: {
    label: string | null;
    preview: string;
    characterCount: number;
    sha256: string;
    submittedAt: string;
  } | null;
  blockchainRecords: Array<{
    network: string;
    chainId: number;
    txHash: string;
    status: string;
    registeredAt: string;
    revokedAt: string | null;
  }>;
  latestSemanticAnalysis: {
    status: string;
    confidence: number | null;
    areas: string[];
    skills: string[];
    concepts: string[];
    qualityFlags: string[];
    analyzedAt: string;
  } | null;
}

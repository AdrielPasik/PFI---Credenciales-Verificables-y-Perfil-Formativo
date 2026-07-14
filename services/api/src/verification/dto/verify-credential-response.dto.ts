export type CredentialVerificationStatus =
  | 'valid'
  | 'revoked'
  | 'draft'
  | 'incomplete';

export interface VerificationCredentialDto {
  id: string;
  title: string;
  status: string;
  issuedAt: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  canonicalHash: string | null;
  canonicalizationVersion: string | null;
}

export interface VerificationBlockchainRecordDto {
  id: string;
  network: string;
  chainId: number;
  transactionHash: string;
  recordedAt: string;
  status: string;
}

export interface VerificationLatestSemanticAnalysisDto {
  id: string;
  schemaVersion: string;
  status: string;
  pipelineVersion: string;
  taxonomyVersion: string;
  confidence: number | null;
  areas: unknown[];
  skills: unknown[];
  concepts: unknown[];
  qualityFlags: string[];
  analyzedAt: string;
}

export interface VerifyCredentialResponseDto {
  credentialId: string;
  verificationStatus: CredentialVerificationStatus;
  credential: VerificationCredentialDto;
  blockchain: {
    records: VerificationBlockchainRecordDto[];
  };
  semanticAnalysis: {
    latest: VerificationLatestSemanticAnalysisDto | null;
  };
}

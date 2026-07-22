export interface MeCredentialDetailResponseDto {
  id: string;
  schemaVersion: string;
  type: string;
  title: string;
  description: string | null;
  status: string;
  issuer: {
    id: string;
    name: string;
    did: string | null;
  };
  subject: {
    id: string;
    did: string | null;
    email: string | null;
    displayName: string | null;
  };
  issuedAt: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  canonicalHash: string | null;
  canonicalizationVersion: string | null;
  credentialSubject: unknown;
  metadata: unknown | null;
  blockchainRecords: Array<{
    id: string;
    network: string;
    chainId: number;
    contractAddress: string;
    txHash: string;
    issuerAddress: string;
    status: string;
    registeredAt: string;
    revokedAt: string | null;
  }>;
  latestSemanticAnalysis: {
    id: string;
    schemaVersion: string;
    status: string;
    pipelineVersion: string;
    taxonomyVersion: string;
    confidence: number | null;
    areas: unknown;
    skills: unknown;
    concepts: unknown;
    qualityFlags: unknown;
    analyzedAt: string;
  } | null;
}

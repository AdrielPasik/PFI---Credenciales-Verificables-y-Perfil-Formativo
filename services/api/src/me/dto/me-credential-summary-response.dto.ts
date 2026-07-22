export interface MeCredentialSummaryResponseDto {
  id: string;
  title: string;
  type: string;
  status: string;
  issuer: {
    id: string;
    name: string;
    did: string | null;
  };
  issuedAt: string | null;
  revokedAt: string | null;
  canonicalHash: string | null;
  canonicalizationVersion: string | null;
  latestBlockchainRecord: {
    id: string;
    network: string;
    chainId: number;
    txHash: string;
    status: string;
    registeredAt: string;
  } | null;
  latestSemanticAnalysis: {
    id: string;
    status: string;
    confidence: number | null;
    analyzedAt: string;
  } | null;
}

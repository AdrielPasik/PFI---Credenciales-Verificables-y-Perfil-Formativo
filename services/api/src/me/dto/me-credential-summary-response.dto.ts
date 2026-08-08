export interface MeCredentialSummaryResponseDto {
  id: string;
  title: string;
  type: string;
  status: string;
  issuerName: string;
  issuedAt: string | null;
  hasIntegrityEvidence: boolean;
  hasAnalysis: boolean;
}

import type { CredentialType } from '@/models/credentials';

export type PublicVerificationStatus = 'issued' | 'revoked';
export type PublicVerificationResult =
  | 'valid_issued'
  | 'revoked'
  | 'not_verifiable';

export interface PublicCredentialVerificationVM {
  credentialReference: string;
  status: PublicVerificationStatus;
  statusLabel: string;
  title: string;
  type: CredentialType;
  typeLabel: string;
  issuerName: string;
  issuerDid: string | null;
  holderLabel: string | null;
  holderDid: string | null;
  issuedAtLabel: string | null;
  revokedAtLabel: string | null;
  revocationReason: string | null;
  canonicalHashShort: string | null;
  canonicalizationVersion: string | null;
  integrity: {
    canonicalHashPresent: boolean;
    blockchainRecordsCount: number;
    latestBlockchainRecord: {
      networkLabel: string;
      chainId: number;
      txHashShort: string | null;
      statusLabel: string;
      registeredAtLabel: string | null;
    } | null;
  };
  verification: {
    result: PublicVerificationResult;
    summary: string;
    checkedAtLabel: string;
  };
}

export interface PublicVerificationFeedback {
  code: 'invalid_input' | 'not_found' | 'service_unavailable' | 'network' | 'incompatible_response';
  message: string;
}

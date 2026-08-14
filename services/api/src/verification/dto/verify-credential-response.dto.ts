import { BlockchainNetwork, BlockchainRecordStatus, CredentialType } from '@prisma/client';

export type PublicCredentialVerificationResult =
  | 'valid_issued'
  | 'revoked'
  | 'not_verifiable';

export interface PublicVerificationIssuerDto {
  displayName: string;
  did: string | null;
}

export interface PublicVerificationHolderDto {
  displayLabel: string | null;
  did: string | null;
}

export interface PublicVerificationBlockchainRecordDto {
  network: BlockchainNetwork;
  networkLabel: string;
  chainId: number;
  txHash: string | null;
  txHashShort: string | null;
  status: BlockchainRecordStatus;
  statusLabel: string;
  registeredAt: string | null;
}

export interface VerifyCredentialResponseDto {
  credentialReference: string;
  exists: true;
  status: 'issued' | 'revoked';
  statusLabel: string;
  title: string;
  type: CredentialType;
  typeLabel: string;
  issuer: PublicVerificationIssuerDto;
  holder: PublicVerificationHolderDto;
  issuedAt: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  canonicalHash: string | null;
  canonicalHashShort: string | null;
  canonicalizationVersion: string | null;
  integrity: {
    canonicalHashPresent: boolean;
    blockchainRecordsCount: number;
    latestBlockchainRecord: PublicVerificationBlockchainRecordDto | null;
  };
  verification: {
    result: PublicCredentialVerificationResult;
    summary: string;
    checkedAt: string;
  };
}

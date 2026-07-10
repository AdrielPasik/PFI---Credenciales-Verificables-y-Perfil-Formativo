export class CredentialStatusResponseDto {
  id!: string;
  status!: string;
  issuedAt?: string;
  revokedAt?: string;
  canonicalHash?: string;
  canonicalizationVersion?: string;
  hasBlockchainRecord!: boolean;
  blockchainRecordId?: string;
  blockchainStatus?: string;
  network?: string;
  registeredAt?: string;
}

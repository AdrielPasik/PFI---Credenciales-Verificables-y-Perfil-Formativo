export class IssuerCredentialRevocationResponseDto {
  credentialReference!: string;
  status!: 'revoked';
  revokedAt!: string;
  profileReconciliation!: 'rebuilt';
}

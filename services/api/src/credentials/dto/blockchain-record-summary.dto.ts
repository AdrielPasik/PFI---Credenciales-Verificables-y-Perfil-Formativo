export class BlockchainRecordSummaryDto {
  id!: string;
  network!: string;
  chainId!: number;
  status!: string;
  credentialHash!: string;
  hashAlgorithm!: string;
  canonicalizationVersion!: string;
  contractAddress!: string;
  txHash!: string;
  issuerAddress!: string;
  registeredAt!: string;
}

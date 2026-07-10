import { BlockchainRecordSummaryDto } from './blockchain-record-summary.dto';

export class CredentialSummaryResponseDto {
  id!: string;
  schemaVersion!: string;
  issuerId!: string;
  subjectUserId!: string;
  type!: string;
  title!: string;
  description?: string;
  sourceType!: string;
  status!: string;
  hours?: string;
  academicCourseId?: string;
  externalCourseId?: string;
  credentialSubject!: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
  createdAt!: string;
  updatedAt!: string;
  issuedAt?: string;
  canonicalHash?: string;
  canonicalizationVersion?: string;
  latestBlockchainRecord?: BlockchainRecordSummaryDto;
}

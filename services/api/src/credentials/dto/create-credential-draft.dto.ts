import { CredentialSourceType, CredentialType } from '@prisma/client';

export class CreateCredentialDraftDto {
  issuerId!: string;
  subjectUserId!: string;
  type!: CredentialType;
  title?: string;
  description?: string;
  sourceType!: CredentialSourceType;
  hours?: number | string;
  academicCourseReference?: string;
  curriculumReference?: string;
  externalCourseId?: string;
  credentialSubject?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  rawData?: Record<string, unknown>;
}

import { CredentialType } from '@prisma/client';

export class UpdateIssuerCredentialDraftDto {
  expectedUpdatedAt!: string;
  achievementName?: string;
  description?: string | null;
  hours?: string | null;
  type?: CredentialType;
  completionDate?: string | null;
  academicPeriod?: string | null;
  programName?: string | null;
  grade?: string | null;
  providerName?: string | null;
  platformName?: string | null;
  modality?: string | null;
  level?: string | null;
  certificationCode?: string | null;
  expirationDate?: string | null;
  externalUrl?: string | null;
  skills?: string[] | null;
  competencies?: string[] | null;
  learningOutcomes?: string[] | null;
}

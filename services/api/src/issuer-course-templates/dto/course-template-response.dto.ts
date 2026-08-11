import { CourseTemplateStatus } from '@prisma/client';

import type { ReusableCredentialType } from '../issuer-course-templates.validator';

export class CourseTemplateResponseDto {
  id!: string;
  // C3a.2: course o certification. academic_subject/degree nunca aparecen.
  credentialType!: ReusableCredentialType;
  title!: string;
  description!: string | null;
  // Decimal serializado como string (mismo patron que Credential.hours en
  // issuer-credential-read.mapper.ts) -- nunca un objeto Decimal crudo.
  hours!: string | null;
  modality!: string | null;
  platformName!: string | null;
  externalUrl!: string | null;
  // Solo aplican cuando credentialType === 'certification'.
  certificationCode!: string | null;
  expirationDate!: string | null;
  providerName!: string | null;
  level!: string | null;
  skills!: string[];
  competencies!: string[];
  learningOutcomes!: string[];
  status!: CourseTemplateStatus;
  createdFromCredentialId!: string | null;
  lastSemanticAnalysisId!: string | null;
  createdAt!: string;
  updatedAt!: string;
}

import { CourseTemplateStatus } from '@prisma/client';

export class CourseTemplateResponseDto {
  id!: string;
  title!: string;
  description!: string | null;
  // Decimal serializado como string (mismo patron que Credential.hours en
  // issuer-credential-read.mapper.ts) -- nunca un objeto Decimal crudo.
  hours!: string | null;
  modality!: string | null;
  platformName!: string | null;
  externalUrl!: string | null;
  competencies!: string[];
  learningOutcomes!: string[];
  status!: CourseTemplateStatus;
  createdFromCredentialId!: string | null;
  lastSemanticAnalysisId!: string | null;
  createdAt!: string;
  updatedAt!: string;
}

import { CourseTemplateStatus } from '@prisma/client';

export class PatchCourseTemplateDto {
  // credentialType es inmutable despues de creado -- no forma parte del patch.
  title?: string;
  description?: string | null;
  hours?: number | null;
  modality?: string | null;
  platformName?: string | null;
  externalUrl?: string | null;
  certificationCode?: string | null;
  expirationDate?: string | null;
  providerName?: string | null;
  level?: string | null;
  skills?: string[];
  competencies?: string[];
  learningOutcomes?: string[];
  status?: CourseTemplateStatus;
}

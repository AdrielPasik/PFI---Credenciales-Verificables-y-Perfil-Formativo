import type { ReusableCredentialType } from '../issuer-course-templates.validator';

export class CreateCourseTemplateDto {
  // Opcional; default 'course' si se omite (compatibilidad con C3a).
  credentialType?: ReusableCredentialType;
  title!: string;
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
}

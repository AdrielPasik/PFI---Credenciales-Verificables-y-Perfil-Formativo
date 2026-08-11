import { CourseTemplateStatus } from '@prisma/client';

export class PatchCourseTemplateDto {
  title?: string;
  description?: string | null;
  hours?: number | null;
  modality?: string | null;
  platformName?: string | null;
  externalUrl?: string | null;
  competencies?: string[];
  learningOutcomes?: string[];
  status?: CourseTemplateStatus;
}

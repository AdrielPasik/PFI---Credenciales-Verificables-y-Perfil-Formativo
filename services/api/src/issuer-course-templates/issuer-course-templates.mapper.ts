import { CourseTemplateStatus } from '@prisma/client';

import { CourseTemplateResponseDto } from './dto/course-template-response.dto';

export interface CourseTemplateRecord {
  id: string;
  title: string;
  description: string | null;
  hours: {
    toFixed: (fractionDigits?: number) => string;
  } | null;
  modality: string | null;
  platformName: string | null;
  externalUrl: string | null;
  competencies: string[];
  learningOutcomes: string[];
  status: CourseTemplateStatus;
  createdFromCredentialId: string | null;
  lastSemanticAnalysisId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// issuerId y createdByUserId nunca se exponen -- no aportan valor al issuer
// que ya sabe cual es su propio catalogo, y evitan filtrar ids internos de
// usuario innecesariamente.
export function mapCourseTemplateResponse(
  template: CourseTemplateRecord
): CourseTemplateResponseDto {
  return {
    id: template.id,
    title: template.title,
    description: template.description,
    hours: template.hours?.toFixed(2) ?? null,
    modality: template.modality,
    platformName: template.platformName,
    externalUrl: template.externalUrl,
    competencies: template.competencies,
    learningOutcomes: template.learningOutcomes,
    status: template.status,
    createdFromCredentialId: template.createdFromCredentialId,
    lastSemanticAnalysisId: template.lastSemanticAnalysisId,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString()
  };
}

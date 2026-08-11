import { CourseTemplateStatus, Prisma } from '@prisma/client';

import { CourseTemplateResponseDto } from './dto/course-template-response.dto';
import { buildApprovedSemanticSnapshotSummary } from './issuer-course-templates.helpers';
import type { ReusableCredentialType } from './issuer-course-templates.validator';

export interface CourseTemplateRecord {
  id: string;
  credentialType: ReusableCredentialType;
  title: string;
  description: string | null;
  hours: {
    toFixed: (fractionDigits?: number) => string;
  } | null;
  modality: string | null;
  platformName: string | null;
  externalUrl: string | null;
  certificationCode: string | null;
  expirationDate: string | null;
  providerName: string | null;
  level: string | null;
  skills: string[];
  competencies: string[];
  learningOutcomes: string[];
  status: CourseTemplateStatus;
  createdFromCredentialId: string | null;
  lastSemanticAnalysisId: string | null;
  approvedSemanticAnalysisId: string | null;
  approvedSemanticSnapshot: Prisma.JsonValue | null;
  approvedSemanticApprovedAt: Date | null;
  approvedSemanticPipelineVersion: string | null;
  approvedSemanticTaxonomyVersion: string | null;
  approvedSemanticSourceCredentialId: string | null;
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
    credentialType: template.credentialType,
    title: template.title,
    description: template.description,
    hours: template.hours?.toFixed(2) ?? null,
    modality: template.modality,
    platformName: template.platformName,
    externalUrl: template.externalUrl,
    certificationCode: template.certificationCode,
    expirationDate: template.expirationDate,
    providerName: template.providerName,
    level: template.level,
    skills: template.skills,
    competencies: template.competencies,
    learningOutcomes: template.learningOutcomes,
    status: template.status,
    createdFromCredentialId: template.createdFromCredentialId,
    lastSemanticAnalysisId: template.lastSemanticAnalysisId,
    approvedSemanticAnalysisId: template.approvedSemanticAnalysisId,
    approvedSemanticApprovedAt:
      template.approvedSemanticApprovedAt?.toISOString() ?? null,
    approvedSemanticPipelineVersion: template.approvedSemanticPipelineVersion,
    approvedSemanticTaxonomyVersion: template.approvedSemanticTaxonomyVersion,
    approvedSemanticSourceCredentialId:
      template.approvedSemanticSourceCredentialId,
    approvedSemanticSnapshotSummary: buildApprovedSemanticSnapshotSummary(
      template.approvedSemanticSnapshot
    ),
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString()
  };
}

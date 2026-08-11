import { CourseTemplateStatus } from '@prisma/client';

import type { ApprovedSemanticSnapshotSummary } from '../issuer-course-templates.helpers';
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
  // C4a.1: aprobacion explicita del emisor de una interpretacion semantica
  // como snapshot reutilizable. approvedSemanticSnapshot NUNCA se expone
  // completo aca -- solo un resumen seguro (approvedSemanticSnapshotSummary).
  // Ver docs/architecture/domain-rules-v0.md.
  approvedSemanticAnalysisId!: string | null;
  approvedSemanticApprovedAt!: string | null;
  approvedSemanticPipelineVersion!: string | null;
  approvedSemanticTaxonomyVersion!: string | null;
  approvedSemanticSourceCredentialId!: string | null;
  approvedSemanticSnapshotSummary!: ApprovedSemanticSnapshotSummary | null;
  createdAt!: string;
  updatedAt!: string;
}

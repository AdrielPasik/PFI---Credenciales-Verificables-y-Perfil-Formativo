import { SemanticAnalysisStatus } from '@prisma/client';

// C4a.2: resumen seguro de una SemanticAnalysis candidata a ser aprobada
// para un IssuerCourseTemplate, ANTES de aprobarla. Misma allowlist que
// approvedSemanticSnapshotSummary (ver issuer-course-templates.helpers.ts)
// -- nunca expone analysisJson, sourceRefs, evidenceMap, textForEmbedding
// ni ningun identificador de evidencia/almacenamiento.
export class TemplateSemanticApprovalCandidateSummaryDto {
  schema!: string;
  status!: SemanticAnalysisStatus;
  areaCount!: number;
  skillCount!: number;
  conceptCount!: number;
  hasHoursDistribution!: boolean;
  warningCount!: number;
  qualityFlagCount!: number;
}

export class TemplateSemanticApprovalCandidateResponseDto {
  semanticAnalysisId!: string;
  status!: SemanticAnalysisStatus;
  pipelineVersion!: string;
  taxonomyVersion!: string;
  sourceCredentialId!: string;
  summary!: TemplateSemanticApprovalCandidateSummaryDto;
}

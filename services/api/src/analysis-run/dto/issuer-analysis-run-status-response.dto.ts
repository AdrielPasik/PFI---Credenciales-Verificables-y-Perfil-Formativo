import {
  AnalysisRunInputMode,
  AnalysisRunSourceType,
  AnalysisRunStatus,
  AnalysisRunTrigger,
  SemanticAnalysisStatus
} from '@prisma/client';

export class IssuerAnalysisRunSemanticSummaryDto {
  semanticAnalysisId!: string;
  status!: SemanticAnalysisStatus;
  pipelineVersion!: string;
  taxonomyVersion!: string;
  confidence!: number | null;
  areasCount!: number;
  skillsCount!: number;
  conceptsCount!: number;
  qualityFlags!: string[];
  analyzedAt!: string;
}

export class IssuerAnalysisRunStatusResponseDto {
  analysisRunId!: string;
  credentialId!: string;
  status!: AnalysisRunStatus;
  inputMode!: AnalysisRunInputMode;
  trigger!: AnalysisRunTrigger;
  requestedPipelineVersion!: string;
  requestedTaxonomyVersion!: string;
  sourceCount!: number;
  sourceTypes!: AnalysisRunSourceType[];
  createdAt!: string;
  startedAt!: string | null;
  completedAt!: string | null;
  failedAt!: string | null;
  errorCode!: string | null;
  errorMessage!: string | null;
  semanticAnalysis!: IssuerAnalysisRunSemanticSummaryDto | null;
}

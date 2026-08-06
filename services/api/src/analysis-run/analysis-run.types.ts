import {
  AnalysisRunInputMode,
  AnalysisRunSourceType,
  AnalysisRunStatus,
  AnalysisRunTrigger,
  SemanticAnalysisStatus
} from '@prisma/client';

export interface CreateAnalysisRunInput {
  credentialId: string;
  requestedByUserId?: string | null;
  inputMode: AnalysisRunInputMode;
  trigger: AnalysisRunTrigger;
  requestedPipelineVersion: string;
  requestedTaxonomyVersion: string;
}

export interface AnalysisRunSummary {
  runReference: string;
  credentialReference: string;
  status: AnalysisRunStatus;
  inputMode: AnalysisRunInputMode;
  trigger: AnalysisRunTrigger;
  requestedPipelineVersion: string;
  requestedTaxonomyVersion: string;
  sourceTypes: AnalysisRunSourceType[];
  sourceCount: number;
  createdAt: string;
}

export interface AnalysisRunExecutionSummary {
  runReference: string;
  credentialReference: string;
  status: AnalysisRunStatus;
  semanticAnalysisReference: string;
  artifactStatus: SemanticAnalysisStatus;
  sourceCount: number;
  completedAt: string;
}

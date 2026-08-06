export type AnalysisRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled';

export type AnalysisRunInputMode = 'document' | 'text' | 'combined';

export type AnalysisRunTrigger = 'manual' | 'system';

export type AnalysisRunSourceType =
  | 'document_evidence'
  | 'text_evidence';

export type SemanticAnalysisStatus = 'completed' | 'partial';

export interface AnalysisRunSemanticSummaryVM {
  semanticAnalysisReference: string;
  status: SemanticAnalysisStatus;
  pipelineVersion: string;
  taxonomyVersion: string;
  confidence: number | null;
  confidenceLabel: string;
  areasCount: number;
  skillsCount: number;
  conceptsCount: number;
  qualityFlags: string[];
  qualityFlagLabels: string[];
  analyzedAt: string;
  analyzedAtLabel: string;
}

export interface IssuerAnalysisRunVM {
  analysisRunReference: string;
  credentialReference: string;
  status: AnalysisRunStatus;
  statusLabel: string;
  inputMode: AnalysisRunInputMode;
  inputModeLabel: string;
  trigger: AnalysisRunTrigger;
  requestedPipelineVersion: string;
  requestedTaxonomyVersion: string;
  sourceCount: number;
  sourceTypes: AnalysisRunSourceType[];
  sourceLabels: string[];
  createdAt: string;
  createdAtLabel: string;
  startedAt: string | null;
  startedAtLabel: string | null;
  completedAt: string | null;
  completedAtLabel: string | null;
  failedAt: string | null;
  failedAtLabel: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  semanticAnalysis: AnalysisRunSemanticSummaryVM | null;
}

export interface DocumentAnalysisTriggerResultVM {
  analysisRunReference: string;
  credentialReference: string;
  status: 'completed';
  semanticAnalysisReference: string;
  artifactStatus: SemanticAnalysisStatus;
  sourceCount: number;
  completedAt: string;
}

export type AnalysisOperation =
  | 'analysis-run-latest'
  | 'analysis-run-by-id'
  | 'document-analysis-trigger';


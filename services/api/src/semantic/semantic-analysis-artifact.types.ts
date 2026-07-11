export const SEMANTIC_ANALYSIS_SCHEMA_VERSION = 'semantic_analysis_v1';

export const SEMANTIC_ANALYSIS_STATUSES = ['completed', 'partial'] as const;
export const SEMANTIC_ANALYSIS_SOURCE_TYPES = [
  'academic_pdf',
  'online_course_catalog'
] as const;
export const SEMANTIC_ANALYSIS_CONFIDENCE_METHODS = [
  'measured',
  'derived',
  'heuristic',
  'unavailable'
] as const;

export type SemanticAnalysisArtifactStatus =
  typeof SEMANTIC_ANALYSIS_STATUSES[number];
export type SemanticAnalysisArtifactSourceType =
  typeof SEMANTIC_ANALYSIS_SOURCE_TYPES[number];
export type SemanticAnalysisConfidenceMethod =
  typeof SEMANTIC_ANALYSIS_CONFIDENCE_METHODS[number];

export interface SemanticAnalysisArtifactSourceRefs {
  [key: string]: unknown;
}

export interface SemanticAnalysisArtifactConfidence {
  global: number | null;
  globalMethod?: SemanticAnalysisConfidenceMethod;
  coverage?: number | null;
  coverageMethod?: SemanticAnalysisConfidenceMethod;
  [key: string]: unknown;
}

export interface SemanticAnalysisArtifactDescriptor {
  id: string;
  label: string;
  confidence: number | null;
  confidenceMethod?: SemanticAnalysisConfidenceMethod;
  source?: string;
  [key: string]: unknown;
}

export interface SemanticAnalysisArtifactHoursDistributionEntry {
  areaId: string;
  hours: number;
}

export interface SemanticAnalysisArtifact {
  schemaVersion: typeof SEMANTIC_ANALYSIS_SCHEMA_VERSION;
  pipelineVersion: string;
  taxonomyVersion: string;
  status: SemanticAnalysisArtifactStatus;
  sourceType: SemanticAnalysisArtifactSourceType;
  sourceRefs: SemanticAnalysisArtifactSourceRefs;
  areas: SemanticAnalysisArtifactDescriptor[];
  skills: SemanticAnalysisArtifactDescriptor[];
  concepts: SemanticAnalysisArtifactDescriptor[];
  hoursDistribution: SemanticAnalysisArtifactHoursDistributionEntry[];
  evidenceMap: Record<string, unknown>;
  confidence: SemanticAnalysisArtifactConfidence;
  qualityFlags: string[];
  textForEmbedding: string;
  warnings: string[];
  partialReasons: string[];
}

export interface SemanticAnalysisArtifactMetadata {
  schemaVersion: typeof SEMANTIC_ANALYSIS_SCHEMA_VERSION;
  pipelineVersion: string;
  taxonomyVersion: string;
  sourceType: SemanticAnalysisArtifactSourceType;
  sourceRefs: SemanticAnalysisArtifactSourceRefs;
  hoursDistribution: SemanticAnalysisArtifactHoursDistributionEntry[];
}

export interface SemanticAnalysisArtifactMappingResult {
  status: SemanticAnalysisArtifactStatus;
  schemaVersion: typeof SEMANTIC_ANALYSIS_SCHEMA_VERSION;
  pipelineVersion: string;
  taxonomyVersion: string;
  areas: SemanticAnalysisArtifactDescriptor[];
  skills: SemanticAnalysisArtifactDescriptor[];
  concepts: SemanticAnalysisArtifactDescriptor[];
  evidenceMap: Record<string, unknown>;
  confidence: SemanticAnalysisArtifactConfidence;
  qualityFlags: string[];
  textForEmbedding: string;
  warnings: string[];
  partialReasons: string[];
  metadata: SemanticAnalysisArtifactMetadata;
}

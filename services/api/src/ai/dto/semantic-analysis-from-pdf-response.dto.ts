import {
  type SemanticAnalysisArtifactSourceType,
  type SemanticAnalysisArtifactStatus
} from '../../semantic/semantic-analysis-artifact.types';

export interface SemanticAnalysisFromPdfResponseDto {
  credentialId: string;
  semanticAnalysisId: string;
  analyzedAt: string;
  schemaVersion: 'semantic_analysis_v1';
  status: SemanticAnalysisArtifactStatus;
  sourceType: SemanticAnalysisArtifactSourceType;
  areasCount: number;
  skillsCount: number;
  conceptsCount: number;
  confidence: number | null;
  warnings: string[];
  qualityFlags: string[];
}

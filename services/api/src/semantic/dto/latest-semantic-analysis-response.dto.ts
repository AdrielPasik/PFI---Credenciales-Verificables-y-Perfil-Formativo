export interface SemanticAnalysisLatestItemDto {
  id: string;
  schemaVersion: string;
  status: string;
  pipelineVersion: string;
  taxonomyVersion: string;
  confidence: number | null;
  areas: unknown[];
  skills: unknown[];
  concepts: unknown[];
  qualityFlags: string[];
  evidenceMap: Record<string, unknown>;
  textForEmbedding: string;
  analysisJson: Record<string, unknown> | null;
  analyzedAt: string;
}

export interface CredentialLatestSemanticAnalysisResponseDto {
  credentialId: string;
  latestSemanticAnalysis: SemanticAnalysisLatestItemDto | null;
}

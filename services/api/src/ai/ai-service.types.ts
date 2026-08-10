export interface AiServiceHealthResponse {
  status: string;
  service: string;
}

export interface AnalyzePdfWithAiInput {
  filePath?: string;
  fileBytes?: Uint8Array;
  documentId?: string;
  correlationId?: string;
  fileName?: string;
  pipelineVersion?: string;
  taxonomyVersion?: string;
}

export interface BuildFormativeProfileWithAiInput {
  artifacts: unknown[];
}

// C2b.2: metadata declarada por el emisor, separada de `content` a
// proposito -- nunca se concatena con el texto analizable (ver
// AiServiceClient.analyzeText). `languageHint` existe en el contrato para
// uso futuro; el backend todavia no lo infiere ni lo completa.
export interface AnalyzeTextWithAiMetadata {
  platformName?: string;
  hours?: number;
  modality?: string;
  credentialType?: string;
  languageHint?: string;
}

export interface AnalyzeTextWithAiSourceRefs {
  textEvidenceId?: string;
  credentialId?: string;
}

export interface AnalyzeTextWithAiInput {
  content: string;
  metadata?: AnalyzeTextWithAiMetadata;
  sourceRefs?: AnalyzeTextWithAiSourceRefs;
  correlationId?: string;
  pipelineVersion?: string;
  taxonomyVersion?: string;
}

export type AiServiceErrorCode =
  | 'configuration'
  | 'file'
  | 'unavailable'
  | 'timeout'
  | 'http'
  | 'invalid_response';

export class AiServiceClientError extends Error {
  constructor(
    message: string,
    readonly code: AiServiceErrorCode,
    readonly status: number | null = null,
    readonly detail: unknown = null,
    readonly causeCode: string | null = null
  ) {
    super(message);
    this.name = 'AiServiceClientError';
  }
}

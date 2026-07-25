export interface AiServiceHealthResponse {
  status: string;
  service: string;
}

export interface AnalyzePdfWithAiInput {
  filePath: string;
  documentId?: string;
  fileName?: string;
  pipelineVersion?: string;
  taxonomyVersion?: string;
}

export interface BuildFormativeProfileWithAiInput {
  artifacts: unknown[];
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
    readonly detail: unknown = null
  ) {
    super(message);
    this.name = 'AiServiceClientError';
  }
}

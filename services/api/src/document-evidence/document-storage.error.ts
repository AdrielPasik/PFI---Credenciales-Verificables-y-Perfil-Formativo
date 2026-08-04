export type DocumentStorageErrorCode =
  | 'configuration'
  | 'invalid_key'
  | 'not_found'
  | 'invalid_body'
  | 'too_large'
  | 'upstream';

export class DocumentStorageError extends Error {
  constructor(
    readonly code: DocumentStorageErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'DocumentStorageError';
  }
}


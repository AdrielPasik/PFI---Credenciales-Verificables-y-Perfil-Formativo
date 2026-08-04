export type DetectedDocumentExtension = '.pdf' | '.png' | '.jpg';
export type DetectedDocumentMimeType =
  | 'application/pdf'
  | 'image/png'
  | 'image/jpeg';

export interface SaveDocumentInput {
  buffer: Buffer;
  detectedExtension: DetectedDocumentExtension;
  detectedMimeType: DetectedDocumentMimeType;
  sha256: string;
}

export interface SavedDocument {
  storageProvider: string;
  storageKey: string;
}

export interface DocumentStoragePort {
  saveDocument(input: SaveDocumentInput): Promise<SavedDocument>;
  readDocument(storageKey: string): Promise<Buffer>;
  deleteDocument(storageKey: string): Promise<void>;
}

export const DOCUMENT_STORAGE_PORT = Symbol('DOCUMENT_STORAGE_PORT');

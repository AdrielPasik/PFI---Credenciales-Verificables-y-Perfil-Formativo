import {
  DocumentEvidenceKind,
  DocumentEvidenceStatus
} from '@prisma/client';

import { DocumentEvidenceResponseDto } from './dto/document-evidence-response.dto';

export const documentEvidenceResponseSelect = {
  id: true,
  kind: true,
  status: true,
  originalFileName: true,
  mimeType: true,
  sizeBytes: true,
  sha256: true,
  uploadedAt: true
} as const;

export interface DocumentEvidenceResponseRecord {
  id: string;
  kind: DocumentEvidenceKind;
  status: DocumentEvidenceStatus;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedAt: Date;
}

export function mapDocumentEvidenceResponse(
  evidence: DocumentEvidenceResponseRecord
): DocumentEvidenceResponseDto {
  return {
    evidenceReference: evidence.id,
    kind: evidence.kind,
    status: evidence.status,
    originalFileName: evidence.originalFileName,
    mimeType: evidence.mimeType,
    sizeBytes: evidence.sizeBytes,
    sha256: evidence.sha256.toLowerCase(),
    uploadedAt: evidence.uploadedAt.toISOString()
  };
}

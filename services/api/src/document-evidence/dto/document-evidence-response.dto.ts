import {
  DocumentEvidenceKind,
  DocumentEvidenceStatus
} from '@prisma/client';

export class DocumentEvidenceResponseDto {
  evidenceReference!: string;
  kind!: DocumentEvidenceKind;
  status!: DocumentEvidenceStatus;
  originalFileName!: string;
  mimeType!: string;
  sizeBytes!: number;
  sha256!: string;
  uploadedAt!: string;
}

export class CredentialDocumentEvidenceResponseDto {
  currentDocument!: DocumentEvidenceResponseDto | null;
}

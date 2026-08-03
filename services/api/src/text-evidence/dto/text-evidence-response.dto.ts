import { TextEvidenceStatus } from '@prisma/client';

export class TextEvidenceResponseDto {
  textEvidenceReference!: string;
  status!: TextEvidenceStatus;
  label!: string | null;
  content!: string;
  characterCount!: number;
  sha256!: string;
  submittedAt!: string;
}

export class CredentialTextEvidenceResponseDto {
  currentText!: TextEvidenceResponseDto | null;
}

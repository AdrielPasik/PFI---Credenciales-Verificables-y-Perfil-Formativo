import { TextEvidenceStatus } from '@prisma/client';

import { TextEvidenceResponseDto } from './dto/text-evidence-response.dto';

export const textEvidenceResponseSelect = {
  id: true,
  status: true,
  label: true,
  content: true,
  sha256: true,
  submittedAt: true
} as const;

export interface TextEvidenceResponseRecord {
  id: string;
  status: TextEvidenceStatus;
  label: string | null;
  content: string;
  sha256: string;
  submittedAt: Date;
}

export function mapTextEvidenceResponse(
  evidence: TextEvidenceResponseRecord
): TextEvidenceResponseDto {
  return {
    textEvidenceReference: evidence.id,
    status: evidence.status,
    label: evidence.label,
    content: evidence.content,
    characterCount: Array.from(evidence.content).length,
    sha256: evidence.sha256.toLowerCase(),
    submittedAt: evidence.submittedAt.toISOString()
  };
}

import type { DocumentEvidenceMimeType } from '@/models/credentials';

export const MAX_DOCUMENT_EVIDENCE_SIZE_BYTES = 20 * 1024 * 1024;
export const DOCUMENT_EVIDENCE_ACCEPT =
  '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg';

const extensionMimeTypes = new Map<string, DocumentEvidenceMimeType>([
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg']
]);

export interface DocumentEvidenceFileValidation {
  valid: boolean;
  error: string | null;
}

export function validateDocumentEvidenceFile(
  file: File | null | undefined
): DocumentEvidenceFileValidation {
  if (!file) {
    return invalid('Seleccioná un archivo para continuar.');
  }

  if (file.size <= 0) {
    return invalid('El archivo está vacío. Seleccioná otro documento.');
  }

  if (file.size > MAX_DOCUMENT_EVIDENCE_SIZE_BYTES) {
    return invalid('El archivo supera el máximo permitido de 20 MB.');
  }

  const extension = fileExtension(file.name);
  const expectedMimeType = extensionMimeTypes.get(extension);

  if (!expectedMimeType) {
    return invalid('El formato no es compatible. Usá PDF, PNG o JPEG.');
  }

  if (file.type && file.type.toLowerCase() !== expectedMimeType) {
    return invalid(
      'El tipo del archivo no coincide con su extensión. Revisalo e intentá nuevamente.'
    );
  }

  return { valid: true, error: null };
}

function fileExtension(fileName: string) {
  const lastDot = fileName.lastIndexOf('.');

  return lastDot < 0 ? '' : fileName.slice(lastDot).toLowerCase();
}

function invalid(error: string): DocumentEvidenceFileValidation {
  return { valid: false, error };
}

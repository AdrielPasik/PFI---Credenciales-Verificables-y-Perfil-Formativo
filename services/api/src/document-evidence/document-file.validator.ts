import { createHash } from 'node:crypto';
import { extname } from 'node:path';

import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException
} from '@nestjs/common';
import { DocumentEvidenceKind } from '@prisma/client';

import { type UploadedDocumentFile } from './document-evidence.types';
import {
  type DetectedDocumentExtension,
  type DetectedDocumentMimeType
} from './document-storage.port';

export const MAX_DOCUMENT_SIZE_BYTES = 20 * 1024 * 1024;
export const MAX_ORIGINAL_FILE_NAME_LENGTH = 180;

const PDF_SIGNATURE = Buffer.from('%PDF-', 'ascii');
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

interface DetectedDocumentFormat {
  kind: DocumentEvidenceKind;
  mimeType: DetectedDocumentMimeType;
  extension: DetectedDocumentExtension;
  compatibleExtensions: readonly string[];
}

export interface ValidatedDocumentFile {
  buffer: Buffer;
  kind: DocumentEvidenceKind;
  detectedMimeType: DetectedDocumentMimeType;
  detectedExtension: DetectedDocumentExtension;
  originalFileName: string;
  sizeBytes: number;
  sha256: string;
}

export function validateDocumentFile(
  file: UploadedDocumentFile | undefined
): ValidatedDocumentFile {
  if (!file) {
    throw new BadRequestException('Se requiere exactamente un archivo.');
  }

  if (!Buffer.isBuffer(file.buffer) || file.buffer.byteLength === 0) {
    throw new BadRequestException('El archivo no puede estar vacio.');
  }

  if (
    file.buffer.byteLength > MAX_DOCUMENT_SIZE_BYTES ||
    file.size > MAX_DOCUMENT_SIZE_BYTES
  ) {
    throw new PayloadTooLargeException('El archivo supera el limite de 20 MB.');
  }

  if (file.size !== file.buffer.byteLength) {
    throw new BadRequestException('El tamano informado del archivo no es valido.');
  }

  const format = detectDocumentFormat(file.buffer);
  const originalFileName = sanitizeOriginalFileName(
    file.originalname,
    format,
    file.mimetype
  );

  return {
    buffer: file.buffer,
    kind: format.kind,
    detectedMimeType: format.mimeType,
    detectedExtension: format.extension,
    originalFileName,
    sizeBytes: file.buffer.byteLength,
    sha256: createHash('sha256').update(file.buffer).digest('hex')
  };
}

function detectDocumentFormat(buffer: Buffer): DetectedDocumentFormat {
  if (buffer.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE)) {
    return {
      kind: DocumentEvidenceKind.pdf,
      mimeType: 'application/pdf',
      extension: '.pdf',
      compatibleExtensions: ['.pdf']
    };
  }

  if (buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return {
      kind: DocumentEvidenceKind.image,
      mimeType: 'image/png',
      extension: '.png',
      compatibleExtensions: ['.png']
    };
  }

  if (buffer.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) {
    return {
      kind: DocumentEvidenceKind.image,
      mimeType: 'image/jpeg',
      extension: '.jpg',
      compatibleExtensions: ['.jpg', '.jpeg']
    };
  }

  throw new UnsupportedMediaTypeException(
    'El formato del archivo no esta admitido.'
  );
}

function sanitizeOriginalFileName(
  originalName: string,
  format: DetectedDocumentFormat,
  informedMimeType: string
) {
  const mimeType = informedMimeType.trim().toLowerCase();
  const isOctetStream = mimeType === 'application/octet-stream';

  if (mimeType !== format.mimeType && !isOctetStream) {
    throw new UnsupportedMediaTypeException(
      'El MIME informado no coincide con el formato detectado.'
    );
  }

  if (
    originalName.includes('/') ||
    originalName.includes('\\') ||
    originalName.trim() === '..'
  ) {
    throw new BadRequestException('El nombre del archivo no es valido.');
  }

  if (CONTROL_CHARACTERS.test(originalName)) {
    throw new BadRequestException('El nombre del archivo contiene controles.');
  }

  const normalized = originalName.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (normalized.length > MAX_ORIGINAL_FILE_NAME_LENGTH) {
    throw new BadRequestException('El nombre del archivo es demasiado largo.');
  }

  const originalExtension = extname(normalized).toLowerCase();
  if (
    originalExtension &&
    !format.compatibleExtensions.includes(originalExtension)
  ) {
    throw new UnsupportedMediaTypeException(
      'La extension no coincide con el formato detectado.'
    );
  }

  if (isOctetStream && !originalExtension) {
    throw new UnsupportedMediaTypeException(
      'application/octet-stream requiere una extension compatible.'
    );
  }

  if (!normalized) {
    return `documento${format.extension}`;
  }

  return originalExtension ? normalized : `${normalized}${format.extension}`;
}

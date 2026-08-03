import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException
} from '@nestjs/common';
import { DocumentEvidenceKind } from '@prisma/client';

import { type UploadedDocumentFile } from './document-evidence.types';
import {
  MAX_DOCUMENT_SIZE_BYTES,
  validateDocumentFile
} from './document-file.validator';

const PDF = Buffer.from('%PDF-1.4\nminimal');
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00
]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);

function file(
  buffer: Buffer,
  originalname: string,
  mimetype: string
): UploadedDocumentFile {
  return {
    buffer,
    originalname,
    mimetype,
    size: buffer.byteLength
  };
}

test('validator requires one non-empty file and enforces 20 MB', () => {
  assert.throws(() => validateDocumentFile(undefined), BadRequestException);
  assert.throws(
    () => validateDocumentFile(file(Buffer.alloc(0), 'empty.pdf', 'application/pdf')),
    BadRequestException
  );
  assert.throws(
    () =>
      validateDocumentFile(
        file(
          Buffer.concat([PDF, Buffer.alloc(MAX_DOCUMENT_SIZE_BYTES)]),
          'large.pdf',
          'application/pdf'
        )
      ),
    PayloadTooLargeException
  );
});

test('validator detects PDF, PNG and JPEG bytes and returns known SHA-256 values', () => {
  const pdf = validateDocumentFile(file(PDF, 'programa.pdf', 'application/pdf'));
  const png = validateDocumentFile(file(PNG, 'constancia.png', 'image/png'));
  const jpeg = validateDocumentFile(file(JPEG, 'acta.jpeg', 'image/jpeg'));

  assert.deepEqual(
    {
      kind: pdf.kind,
      mime: pdf.detectedMimeType,
      extension: pdf.detectedExtension,
      sha256: pdf.sha256
    },
    {
      kind: DocumentEvidenceKind.pdf,
      mime: 'application/pdf',
      extension: '.pdf',
      sha256: '36105003a740a7bd80afc20d505e4fe59ee43f1f85f691a3ec528737a52f5158'
    }
  );
  assert.equal(
    png.sha256,
    '843ac23b1736b4487ec81cf7c07ddd9bb46ae5b7818c2c3843d99d62fa75f3c9'
  );
  assert.equal(png.kind, DocumentEvidenceKind.image);
  assert.equal(png.detectedMimeType, 'image/png');
  assert.equal(
    jpeg.sha256,
    'f55517e918c9f1ac538778a7d787f93b66102886b93464e5bf61b48527913dfd'
  );
  assert.equal(jpeg.originalFileName, 'acta.jpeg');
  assert.equal(jpeg.detectedExtension, '.jpg');
});

test('validator rejects unknown signatures, SVG and mismatched MIME or extension', () => {
  const unknown = Buffer.from('plain text');

  for (const candidate of [
    file(unknown, 'notes.txt', 'text/plain'),
    file(unknown, 'vector.svg', 'image/svg+xml'),
    file(JPEG, 'fake.pdf', 'application/pdf'),
    file(PDF, 'fake.jpg', 'image/jpeg'),
    file(PDF, 'fake.txt', 'application/pdf'),
    file(PNG, 'fake.png', 'image/jpeg')
  ]) {
    assert.throws(
      () => validateDocumentFile(candidate),
      UnsupportedMediaTypeException
    );
  }
});

test('octet-stream is accepted only with an extension matching detected bytes', () => {
  const accepted = validateDocumentFile(
    file(PNG, 'scan.png', 'application/octet-stream')
  );
  assert.equal(accepted.detectedMimeType, 'image/png');

  assert.throws(
    () => validateDocumentFile(file(PNG, 'scan', 'application/octet-stream')),
    UnsupportedMediaTypeException
  );
  assert.throws(
    () => validateDocumentFile(file(PNG, 'scan.pdf', 'application/octet-stream')),
    UnsupportedMediaTypeException
  );
});

test('validator sanitizes visible names without accepting traversal, controls or excessive length', () => {
  assert.equal(
    validateDocumentFile(file(PDF, '  programa   final  ', 'application/pdf'))
      .originalFileName,
    'programa final.pdf'
  );
  assert.equal(
    validateDocumentFile(file(PDF, '   ', 'application/pdf')).originalFileName,
    'documento.pdf'
  );

  for (const originalname of [
    '../secret.pdf',
    '..\\secret.pdf',
    'bad\u0000name.pdf',
    `${'a'.repeat(181)}.pdf`
  ]) {
    assert.throws(
      () => validateDocumentFile(file(PDF, originalname, 'application/pdf')),
      BadRequestException
    );
  }
});

test('validator rejects inconsistent size metadata', () => {
  assert.throws(
    () => validateDocumentFile({ ...file(PDF, 'programa.pdf', 'application/pdf'), size: 1 }),
    BadRequestException
  );
});

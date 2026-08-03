import { describe, expect, it } from 'vitest';

import {
  MAX_DOCUMENT_EVIDENCE_SIZE_BYTES,
  validateDocumentEvidenceFile
} from '@/features/credentials/document-evidence-file';

function file(name: string, type: string, content = 'content') {
  return new File([content], name, { type });
}

describe('validateDocumentEvidenceFile', () => {
  it('requires a non-empty file no larger than 20 MB', () => {
    expect(validateDocumentEvidenceFile(null)).toMatchObject({
      valid: false
    });
    expect(
      validateDocumentEvidenceFile(
        new File([], 'vacio.pdf', { type: 'application/pdf' })
      )
    ).toMatchObject({ valid: false });
    expect(
      validateDocumentEvidenceFile(
        new File(
          [new Uint8Array(MAX_DOCUMENT_EVIDENCE_SIZE_BYTES + 1)],
          'grande.pdf',
          { type: 'application/pdf' }
        )
      )
    ).toEqual({
      valid: false,
      error: 'El archivo supera el máximo permitido de 20 MB.'
    });
  });

  it.each([
    ['programa.pdf', 'application/pdf'],
    ['captura.png', 'image/png'],
    ['constancia.jpg', 'image/jpeg'],
    ['constancia.jpeg', 'image/jpeg'],
    ['SIN-MIME.PDF', '']
  ])('accepts %s with a compatible MIME', (name, type) => {
    expect(validateDocumentEvidenceFile(file(name, type))).toEqual({
      valid: true,
      error: null
    });
  });

  it('rejects a MIME that contradicts the extension', () => {
    expect(
      validateDocumentEvidenceFile(file('programa.pdf', 'image/png'))
    ).toMatchObject({ valid: false });
  });

  it.each([
    ['notas.txt', 'text/plain'],
    ['imagen.svg', 'image/svg+xml'],
    ['sin-extension', 'application/pdf']
  ])('rejects unsupported file %s', (name, type) => {
    expect(validateDocumentEvidenceFile(file(name, type))).toMatchObject({
      valid: false
    });
  });
});

import { describe, expect, it } from 'vitest';

import {
  buildTextEvidencePreview,
  countTextEvidenceCharacters,
  normalizeTextEvidenceContentForSubmission,
  normalizeTextEvidenceLabelForSubmission,
  validateTextEvidenceDraft
} from '@/features/credentials/text-evidence';

describe('text evidence normalization and validation', () => {
  it('normalizes NFC and line endings only for submission', () => {
    expect(
      normalizeTextEvidenceContentForSubmission(
        '  Cafe\u0301\r\nLínea dos\rLínea tres  '
      )
    ).toBe('Café\nLínea dos\nLínea tres');
  });

  it('preserves internal spaces, tabs and line feeds', () => {
    const validation = validateTextEvidenceDraft(
      '  Línea  con  espacios\n\tDetalle  ',
      null
    );

    expect(validation.valid).toBe(true);
    expect(validation.normalizedSubmission.content).toBe(
      'Línea  con  espacios\n\tDetalle'
    );
  });

  it.each(['', '   ', '\r\n\t '])('rejects empty content %#', (content) => {
    expect(validateTextEvidenceDraft(content, null).valid).toBe(false);
  });

  it.each([
    '\u0000',
    '\u0001',
    '\u0008',
    '\u000B',
    '\u000C',
    '\u000E',
    '\u001F'
  ])('rejects invalid content control %s', (control) => {
    expect(validateTextEvidenceDraft(`Texto${control}`, null).valid).toBe(
      false
    );
  });

  it('accepts exactly 50,000 code points and rejects one more', () => {
    expect(validateTextEvidenceDraft('a'.repeat(50_000), null).valid).toBe(
      true
    );
    expect(validateTextEvidenceDraft('a'.repeat(50_001), null).valid).toBe(
      false
    );
  });

  it('counts an emoji as one Unicode code point', () => {
    expect(countTextEvidenceCharacters('A😀B')).toBe(3);
    expect(validateTextEvidenceDraft('😀', null).characterCount).toBe(1);
  });

  it('normalizes labels deterministically and maps empty labels to null', () => {
    expect(normalizeTextEvidenceLabelForSubmission(undefined)).toBeNull();
    expect(normalizeTextEvidenceLabelForSubmission('   ')).toBeNull();
    expect(
      normalizeTextEvidenceLabelForSubmission(
        '  Temario\u00A0\u2003institucional  '
      )
    ).toBe('Temario institucional');
  });

  it.each(['Etiqueta\nsegunda', 'Etiqueta\rsegunda', 'Etiqueta\tsegunda']) (
    'rejects multiline labels %#',
    (label) => {
      expect(validateTextEvidenceDraft('Texto', label).valid).toBe(false);
    }
  );

  it.each(['\u0001', '\u007F', '\u0085', '\u2028', '\u2029'])(
    'rejects invalid label control %s',
    (control) => {
      expect(
        validateTextEvidenceDraft('Texto', `Fuente${control}`).valid
      ).toBe(false);
    }
  );

  it('accepts a 120-code-point label and rejects 121', () => {
    expect(validateTextEvidenceDraft('Texto', 'x'.repeat(120)).valid).toBe(
      true
    );
    expect(validateTextEvidenceDraft('Texto', 'x'.repeat(121)).valid).toBe(
      false
    );
  });

  it('builds a line-safe and code-point-safe preview without changing source', () => {
    const longByLines = Array.from({ length: 14 }, (_, index) =>
      `Línea ${index + 1}`
    ).join('\n');
    const linePreview = buildTextEvidencePreview(longByLines);
    const codePointPreview = buildTextEvidencePreview('😀'.repeat(1_001));

    expect(linePreview.collapsed).toBe(true);
    expect(linePreview.text.split('\n')).toHaveLength(12);
    expect(codePointPreview.collapsed).toBe(true);
    expect(Array.from(codePointPreview.text)).toHaveLength(1_000);
    expect(longByLines.split('\n')).toHaveLength(14);
  });
});

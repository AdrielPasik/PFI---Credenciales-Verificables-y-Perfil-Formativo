import { describe, expect, it } from 'vitest';

import {
  abbreviateDocumentHash,
  formatDocumentSize,
  formatDocumentUploadedAt
} from '@/lib/formatters/document-evidence';

describe('document evidence formatters', () => {
  it('formats bytes, KB and MB with the es-AR locale', () => {
    expect(formatDocumentSize(512)).toBe('512 bytes');
    expect(formatDocumentSize(1536)).toBe('1,5 KB');
    expect(formatDocumentSize(2 * 1024 * 1024)).toBe('2 MB');
  });

  it('formats upload timestamps in the Buenos Aires timezone', () => {
    const label = formatDocumentUploadedAt('2026-08-03T12:00:00.000Z');

    expect(label).toContain('3 ago 2026');
    expect(label).toContain('9:00');
  });

  it('keeps a meaningful prefix and suffix in an abbreviated hash', () => {
    const hash = 'a1b2c3d4e5f6'.padEnd(56, '0') + '9a8b7c6d';

    expect(abbreviateDocumentHash(hash)).toBe(
      'a1b2c3d4e5f6…9a8b7c6d'
    );
  });
});

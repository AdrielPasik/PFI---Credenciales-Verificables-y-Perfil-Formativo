import { describe, expect, it } from 'vitest';

import {
  abbreviateTextEvidenceHash,
  formatTextEvidenceCharacterCount,
  formatTextEvidenceSubmittedAt
} from '@/lib/formatters/text-evidence';

describe('text evidence formatters', () => {
  it('formats singular and plural counts using es-AR', () => {
    expect(formatTextEvidenceCharacterCount(1)).toBe('1 carácter');
    expect(formatTextEvidenceCharacterCount(358)).toBe('358 caracteres');
    expect(formatTextEvidenceCharacterCount(1250)).toBe('1.250 caracteres');
  });

  it('abbreviates SHA-256 without losing its meaningful ends', () => {
    const hash = 'a1b2c3d4e5f6'.padEnd(56, '0') + '9a8b7c6d';

    expect(abbreviateTextEvidenceHash(hash)).toBe(
      'a1b2c3d4e5f6…9a8b7c6d'
    );
  });

  it('formats the timestamp in the Buenos Aires timezone', () => {
    const label = formatTextEvidenceSubmittedAt(
      '2026-08-03T12:00:00.000Z'
    );

    expect(label).toContain('3 ago 2026');
    expect(label).toContain('9:00');
  });
});

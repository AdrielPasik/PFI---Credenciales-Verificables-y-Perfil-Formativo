import { describe, expect, it } from 'vitest';

import type { PublicVerificationHeadline } from '@/models/public-verification';
import { effectiveHeadline, presentVerdict } from './verdict-presentation';

const HEADLINES: PublicVerificationHeadline[] = [
  'VERIFIED',
  'VERIFIED_WITH_LIMITED_EVIDENCE',
  'INVALID',
  'REVOKED',
  'INDETERMINATE'
];

describe('presentVerdict', () => {
  it('maps every server headline to a distinct title and tone', () => {
    const presented = HEADLINES.map((headline) => presentVerdict(headline, 'issued'));

    expect(new Set(presented.map((item) => item.title)).size).toBe(5);
    expect(new Set(presented.map((item) => item.tone)).size).toBe(5);
  });

  it('only VERIFIED can produce the positive tone', () => {
    for (const headline of HEADLINES) {
      const tone = presentVerdict(headline, 'issued').tone;
      expect(tone === 'verified').toBe(headline === 'VERIFIED');
    }
  });

  it('never softens INVALID, even for a revoked status', () => {
    expect(effectiveHeadline('INVALID', 'revoked')).toBe('INVALID');
    expect(presentVerdict('INVALID', 'revoked').tone).toBe('invalid');
  });

  it('a revoked status dominates any non-invalid headline', () => {
    for (const headline of ['VERIFIED', 'VERIFIED_WITH_LIMITED_EVIDENCE', 'INDETERMINATE', 'REVOKED'] as const) {
      expect(presentVerdict(headline, 'revoked').headline).toBe('REVOKED');
    }
  });
});

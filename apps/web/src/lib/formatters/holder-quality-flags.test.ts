import { expect, it } from 'vitest';

import { formatHolderQualityFlag } from '@/lib/formatters/holder-quality-flags';

it('humanizes known and future holder quality flags without rendering raw objects', () => {
  expect(formatHolderQualityFlag('partial_evidence')).toBe('Información parcial');
  expect(formatHolderQualityFlag('low_coverage')).toBe('Cobertura limitada');
  expect(formatHolderQualityFlag('future_safe_flag')).toBe('Future safe flag');
});

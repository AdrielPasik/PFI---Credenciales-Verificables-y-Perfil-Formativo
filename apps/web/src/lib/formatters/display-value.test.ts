import { describe, expect, it } from 'vitest';

import { formatDisplayValue } from './display-value';

describe('formatDisplayValue', () => {
  it('uses an honest fallback for absent or empty values', () => {
    expect(formatDisplayValue(null)).toBe('No disponible');
    expect(formatDisplayValue(undefined)).toBe('No disponible');
    expect(formatDisplayValue('   ')).toBe('No disponible');
  });

  it('normalizes valid text', () => {
    expect(formatDisplayValue('  Demo   University  ')).toBe(
      'Demo University'
    );
  });

  it('formats finite numbers with es-AR locale', () => {
    expect(formatDisplayValue(1234.5)).toBe('1.234,5');
    expect(formatDisplayValue(Number.NaN)).toBe('No disponible');
  });
});

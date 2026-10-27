import { describe, expect, it } from 'vitest';

import {
  EMAIL_PATTERN,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  PASSWORD_LENGTH_MESSAGE
} from './credential-rules';

describe('credential rules', () => {
  it('keeps the password policy aligned with the backend (8 to 128)', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
    expect(MAX_PASSWORD_LENGTH).toBe(128);
    expect(PASSWORD_LENGTH_MESSAGE).toContain('8');
    expect(PASSWORD_LENGTH_MESSAGE).toContain('128');
  });

  it('normalizes the email with trim and lower case, like login and register', () => {
    expect(normalizeEmail('  Ana.Perez@Example.COM \n')).toBe(
      'ana.perez@example.com'
    );
  });

  it('accepts plausible emails and rejects obviously malformed ones', () => {
    expect(EMAIL_PATTERN.test('ana@example.com')).toBe(true);
    expect(EMAIL_PATTERN.test('ana@example')).toBe(false);
    expect(EMAIL_PATTERN.test('ana example@x.com')).toBe(false);
    expect(EMAIL_PATTERN.test('@example.com')).toBe(false);
    expect(EMAIL_PATTERN.test('')).toBe(false);
  });
});

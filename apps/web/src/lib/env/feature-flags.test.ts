import { afterEach, describe, expect, it, vi } from 'vitest';

import { isPasswordRecoveryEnabled } from '@/lib/env/feature-flags';

describe('isPasswordRecoveryEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is off by default', () => {
    vi.stubEnv('NEXT_PUBLIC_PASSWORD_RECOVERY_ENABLED', '');
    expect(isPasswordRecoveryEnabled()).toBe(false);
    expect(isPasswordRecoveryEnabled(undefined)).toBe(false);
  });

  it('is on only for the exact value "true"', () => {
    expect(isPasswordRecoveryEnabled('true')).toBe(true);
    expect(isPasswordRecoveryEnabled(' true ')).toBe(true);
    for (const value of ['TRUE', 'True', '1', 'yes', 'on', 'false', '', 'truee']) {
      expect(isPasswordRecoveryEnabled(value), value).toBe(false);
    }
  });

  it('reads NEXT_PUBLIC_PASSWORD_RECOVERY_ENABLED when no value is given', () => {
    vi.stubEnv('NEXT_PUBLIC_PASSWORD_RECOVERY_ENABLED', 'true');
    expect(isPasswordRecoveryEnabled()).toBe(true);
    vi.stubEnv('NEXT_PUBLIC_PASSWORD_RECOVERY_ENABLED', 'false');
    expect(isPasswordRecoveryEnabled()).toBe(false);
  });
});

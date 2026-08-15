import { describe, expect, it } from 'vitest';

import {
  ApiError,
  IncompatiblePayloadError
} from '@/lib/errors/api-error';
import { mapAuthError } from '@/lib/errors/auth-error-mapper';

describe('mapAuthError', () => {
  it.each([
    [400, 'login' as const, 'invalid_input'],
    [401, 'login' as const, 'invalid_credentials'],
    [401, 'session' as const, 'session_expired'],
    [403, 'session' as const, 'forbidden'],
    [500, 'session' as const, 'service_unavailable'],
    [503, 'login' as const, 'service_unavailable'],
    // A1
    [400, 'register' as const, 'invalid_input'],
    [409, 'register' as const, 'email_taken'],
    [500, 'register' as const, 'service_unavailable']
  ])('maps HTTP %s during %s to %s', (status, operation, code) => {
    expect(
      mapAuthError(new ApiError('upstream detail', 'http', status), operation)
        .code
    ).toBe(code);
  });

  it('maps network failures without exposing their raw detail', () => {
    const result = mapAuthError(
      new ApiError('sensitive network detail', 'network'),
      'login'
    );

    expect(result.code).toBe('network');
    expect(result.message).not.toContain('sensitive');
  });

  it('A1: maps a duplicate-email 409 during register to product copy without technical codes', () => {
    const result = mapAuthError(
      new ApiError('P2002 unique constraint failed', 'http', 409),
      'register'
    );

    expect(result).toMatchObject({
      code: 'email_taken',
      message: 'Ya existe una cuenta con ese correo.',
      recoverable: true
    });
    expect(result.message).not.toMatch(/P2002|prisma|constraint/i);
  });

  it('maps incompatible payloads to controlled feedback', () => {
    expect(
      mapAuthError(new IncompatiblePayloadError('raw detail'), 'session')
    ).toMatchObject({
      code: 'incompatible_response',
      recoverable: true
    });
  });
});

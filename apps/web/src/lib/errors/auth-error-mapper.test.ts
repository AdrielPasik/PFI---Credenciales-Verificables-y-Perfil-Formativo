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
    [503, 'login' as const, 'service_unavailable']
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

  it('maps incompatible payloads to controlled feedback', () => {
    expect(
      mapAuthError(new IncompatiblePayloadError('raw detail'), 'session')
    ).toMatchObject({
      code: 'incompatible_response',
      recoverable: true
    });
  });
});

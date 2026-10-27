import { describe, expect, it } from 'vitest';

import { ApiError, IncompatiblePayloadError } from '@/lib/errors/api-error';

import { mapPasswordResetError } from './password-reset-error-mapper';

const http = (status: number, code: string | null = null) =>
  new ApiError('El servicio rechazó la operación.', 'http', status, code);

describe('mapPasswordResetError', () => {
  it('maps the public backend codes', () => {
    expect(
      mapPasswordResetError(http(400, 'PASSWORD_RESET_TOKEN_INVALID'), 'verify')
        .problem
    ).toBe('token_invalid');
    expect(
      mapPasswordResetError(http(400, 'PASSWORD_RESET_TOKEN_INVALID'), 'confirm')
        .problem
    ).toBe('token_invalid');
    expect(
      mapPasswordResetError(http(400, 'PASSWORD_POLICY_VIOLATION'), 'confirm')
        .problem
    ).toBe('password_policy');
    expect(
      mapPasswordResetError(http(400, 'INVALID_EMAIL'), 'request').problem
    ).toBe('invalid_email');
    expect(
      mapPasswordResetError(http(400, 'INVALID_REQUEST_INPUT'), 'confirm')
        .problem
    ).toBe('invalid_input');
    expect(
      mapPasswordResetError(http(503, 'PASSWORD_RECOVERY_UNAVAILABLE'), 'request')
        .problem
    ).toBe('unavailable');
  });

  it('maps throttling by code or by status', () => {
    expect(
      mapPasswordResetError(http(429, 'TOO_MANY_REQUESTS'), 'request').problem
    ).toBe('rate_limited');
    expect(mapPasswordResetError(http(429), 'verify').problem).toBe(
      'rate_limited'
    );
  });

  it.each(['request', 'verify'] as const)(
    'reports network, 5xx and bad bodies as plain failures on %s',
    (operation) => {
      expect(
        mapPasswordResetError(new ApiError('x', 'network'), operation).problem
      ).toBe('network');
      expect(mapPasswordResetError(http(500), operation).problem).toBe(
        'service_error'
      );
      expect(
        mapPasswordResetError(
          new ApiError('x', 'invalid-response', 200),
          operation
        ).problem
      ).toBe('incompatible_response');
      expect(
        mapPasswordResetError(new IncompatiblePayloadError(), operation).problem
      ).toBe('incompatible_response');
    }
  );

  it('never claims a definitive failure when confirm outcome is unknown', () => {
    for (const error of [
      new ApiError('x', 'network'),
      http(500),
      http(502),
      new ApiError('x', 'invalid-response', 200),
      new IncompatiblePayloadError()
    ]) {
      expect(mapPasswordResetError(error, 'confirm').problem).toBe(
        'outcome_unknown'
      );
    }
  });

  it('does not copy backend messages or unknown codes into the UI text', () => {
    const feedback = mapPasswordResetError(
      new ApiError('detalle interno SECRETO', 'http', 418, 'SOME_CODE'),
      'verify'
    );

    expect(feedback.problem).toBe('unexpected');
    expect(feedback.message).not.toContain('SECRETO');
    expect(feedback.message).not.toContain('SOME_CODE');
    expect(mapPasswordResetError(new Error('boom'), 'verify').problem).toBe(
      'unexpected'
    );
  });
});

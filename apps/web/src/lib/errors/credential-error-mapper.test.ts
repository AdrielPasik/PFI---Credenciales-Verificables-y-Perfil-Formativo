import { describe, expect, it } from 'vitest';

import { ApiError, IncompatiblePayloadError } from '@/lib/errors/api-error';
import { mapCredentialError } from '@/lib/errors/credential-error-mapper';

describe('mapCredentialError', () => {
  it('uses a uniform safe holder not-found message', () => {
    const result = mapCredentialError(
      new ApiError('upstream contained PII', 'http', 404),
      'holder-resolution'
    );

    expect(result).toEqual({
      code: 'not_found',
      message:
        'No encontramos un titular disponible con ese correo. Verificá el email o consultá con la institución.'
    });
    expect(result.message).not.toContain('upstream');
  });

  it.each([
    [400, 'invalid_input'],
    [401, 'session_expired'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [500, 'service_unavailable'],
    [503, 'service_unavailable']
  ])('maps HTTP %i to %s', (status, code) => {
    expect(
      mapCredentialError(
        new ApiError('upstream detail', 'http', status),
        'draft-create'
      ).code
    ).toBe(code);
  });

  it('maps network and incompatible payloads without exposing details', () => {
    expect(
      mapCredentialError(
        new ApiError('private transport detail', 'network'),
        'detail'
      ).code
    ).toBe('network');
    expect(
      mapCredentialError(
        new IncompatiblePayloadError('private payload detail'),
        'detail'
      ).code
    ).toBe('incompatible_response');
  });

  it('maps draft update conflicts without exposing the upstream detail', () => {
    const result = mapCredentialError(
      new ApiError('private concurrency detail', 'http', 409),
      'draft-update'
    );

    expect(result).toEqual({
      code: 'conflict',
      message: 'Este borrador fue actualizado desde otra sesión.'
    });
    expect(result.message).not.toContain('private');
  });
});

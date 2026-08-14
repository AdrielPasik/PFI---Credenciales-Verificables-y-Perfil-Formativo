import { describe, expect, it } from 'vitest';

import { ApiError, IncompatiblePayloadError } from '@/lib/errors/api-error';
import { mapPublicVerificationError } from './public-verification-error-mapper';

describe('mapPublicVerificationError', () => {
  it('maps public errors without exposing backend internals', () => {
    expect(mapPublicVerificationError(new ApiError('raw', 'http', 404)).message).toBe('No encontramos una credencial verificable con esa referencia.');
    expect(mapPublicVerificationError(new ApiError('raw', 'http', 400)).message).toBe('Revisá el código o enlace ingresado.');
    expect(mapPublicVerificationError(new IncompatiblePayloadError('raw')).message).toBe('No pudimos completar la verificación en este momento. Probá nuevamente.');
  });
});

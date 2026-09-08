import { shouldRetry } from '@/lib/query/query-client';
import { ApiError, IncompatiblePayloadError } from '@/lib/errors/api-error';

describe('política de reintentos', () => {
  it('reintenta un problema de red', () => {
    expect(shouldRetry(0, new ApiError('x', 'network'))).toBe(true);
  });

  it('reintenta un timeout', () => {
    expect(shouldRetry(0, new ApiError('x', 'timeout'))).toBe(true);
  });

  it('reintenta un 5xx', () => {
    expect(shouldRetry(0, new ApiError('x', 'http', 503))).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 422])(
    'NO reintenta un %s: insistir no arregla nada',
    (status) => {
      expect(shouldRetry(0, new ApiError('x', 'http', status))).toBe(false);
    }
  );

  it('NO reintenta un contrato incompatible', () => {
    expect(shouldRetry(0, new IncompatiblePayloadError())).toBe(false);
  });

  it('deja de reintentar después de dos intentos', () => {
    const error = new ApiError('x', 'network');

    expect(shouldRetry(1, error)).toBe(true);
    expect(shouldRetry(2, error)).toBe(false);
    expect(shouldRetry(9, error)).toBe(false);
  });

  it('NO reintenta un error desconocido', () => {
    expect(shouldRetry(0, new Error('vaya a saber'))).toBe(false);
  });
});

import { ApiError, IncompatiblePayloadError } from '@/lib/errors/api-error';
import type { PublicVerificationFeedback } from '@/models/public-verification';

export function mapPublicVerificationError(error: unknown): PublicVerificationFeedback {
  if (error instanceof IncompatiblePayloadError) {
    return {
      code: 'incompatible_response',
      message: 'No pudimos completar la verificación en este momento. Probá nuevamente.'
    };
  }

  if (error instanceof ApiError) {
    if (error.kind === 'network') {
      return {
        code: 'network',
        message: 'No pudimos completar la verificación en este momento. Probá nuevamente.'
      };
    }

    if (error.status === 400) {
      return { code: 'invalid_input', message: 'Revisá el código o enlace ingresado.' };
    }

    if (error.status === 404) {
      return {
        code: 'not_found',
        message: 'No encontramos una credencial verificable con esa referencia.'
      };
    }
  }

  return {
    code: 'service_unavailable',
    message: 'No pudimos completar la verificación en este momento. Probá nuevamente.'
  };
}

import { ApiError, IncompatiblePayloadError } from '@/lib/errors/api-error';
import type { AuthFeedback } from '@/types/auth';

type AuthOperation = 'login' | 'session';

/**
 * Traduce un error técnico a un mensaje de producto.
 *
 * Distingue explícitamente credenciales inválidas, red, servidor y contrato:
 * convertir todo en "no encontrado" o en un genérico impide que la persona
 * sepa qué hacer (secciones 38 y 141 del encargo). Nunca expone detalle
 * interno del servidor.
 */
export function mapAuthError(
  error: unknown,
  operation: AuthOperation
): AuthFeedback {
  if (error instanceof IncompatiblePayloadError) {
    return {
      code: 'incompatible_response',
      message:
        'El servicio respondió con un formato incompatible. Intentá nuevamente.',
      recoverable: true
    };
  }

  if (!(error instanceof ApiError)) {
    return {
      code: 'unexpected',
      message: 'No pudimos completar la operación. Intentá nuevamente.',
      recoverable: true
    };
  }

  if (error.kind === 'network') {
    return {
      code: 'network',
      message:
        'No pudimos conectar con Scope. Revisá tu conexión e intentá nuevamente.',
      recoverable: true
    };
  }

  if (error.kind === 'timeout') {
    return {
      code: 'timeout',
      message:
        'Scope tardó demasiado en responder. Intentá nuevamente en unos instantes.',
      recoverable: true
    };
  }

  if (error.kind === 'invalid-response') {
    return {
      code: 'incompatible_response',
      message:
        'El servicio respondió con un formato incompatible. Intentá nuevamente.',
      recoverable: true
    };
  }

  if (error.status === 400) {
    return {
      code: 'invalid_input',
      message: 'Revisá los datos ingresados e intentá nuevamente.',
      recoverable: true
    };
  }

  if (error.status === 401) {
    return operation === 'login'
      ? {
          code: 'invalid_credentials',
          message: 'El correo o la contraseña son incorrectos.',
          recoverable: true
        }
      : {
          code: 'session_expired',
          message: 'Tu sesión venció. Volvé a iniciar sesión.',
          recoverable: false
        };
  }

  if (error.status === 403) {
    return {
      code: 'forbidden',
      message: 'La cuenta no tiene acceso a esta experiencia.',
      recoverable: false
    };
  }

  if (error.status !== null && error.status >= 500) {
    return {
      code: 'service_unavailable',
      message:
        'Scope no está disponible en este momento. Intentá nuevamente más tarde.',
      recoverable: true
    };
  }

  return {
    code: 'unexpected',
    message: 'No pudimos completar la operación. Intentá nuevamente.',
    recoverable: true
  };
}

export const SESSION_EXPIRED_FEEDBACK: AuthFeedback = {
  code: 'session_expired',
  message: 'Tu sesión venció. Volvé a iniciar sesión.',
  recoverable: false
};

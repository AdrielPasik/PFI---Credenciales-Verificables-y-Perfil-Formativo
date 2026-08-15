import {
  ApiError,
  IncompatiblePayloadError
} from '@/lib/errors/api-error';
import type { AuthFeedback } from '@/models/auth-session';

type AuthOperation = 'login' | 'session' | 'register';

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
        'No pudimos conectar con el servicio. Revisá la conexión e intentá nuevamente.',
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

  if (error.status === 409 && operation === 'register') {
    return {
      code: 'email_taken',
      message: 'Ya existe una cuenta con ese correo.',
      recoverable: true
    };
  }

  if (error.status !== null && error.status >= 500) {
    return {
      code: 'service_unavailable',
      message:
        'El servicio no está disponible temporalmente. Intentá nuevamente más tarde.',
      recoverable: true
    };
  }

  return {
    code: 'unexpected',
    message: 'No pudimos completar la operación. Intentá nuevamente.',
    recoverable: true
  };
}

import {
  ApiError,
  IncompatiblePayloadError
} from '@/lib/errors/api-error';
import type {
  CredentialFeedback,
  CredentialFeedbackCode
} from '@/models/credentials';

type CredentialOperation =
  | 'holder-resolution'
  | 'draft-create'
  | 'detail';

function feedback(
  code: CredentialFeedbackCode,
  message: string
): CredentialFeedback {
  return { code, message };
}

export function mapCredentialError(
  error: unknown,
  operation: CredentialOperation
): CredentialFeedback {
  if (error instanceof IncompatiblePayloadError) {
    return feedback(
      'incompatible_response',
      'El servicio respondió con un formato incompatible. Intentá nuevamente.'
    );
  }

  if (!(error instanceof ApiError)) {
    return feedback(
      'unexpected',
      'No pudimos completar la operación. Intentá nuevamente.'
    );
  }

  if (error.kind === 'network') {
    return feedback(
      'network',
      'No pudimos conectar con el servicio. Revisá la conexión e intentá nuevamente.'
    );
  }

  if (error.kind === 'invalid-response') {
    return feedback(
      'incompatible_response',
      'El servicio respondió con un formato incompatible. Intentá nuevamente.'
    );
  }

  if (error.status === 401) {
    return feedback(
      'session_expired',
      'Tu sesión venció. Volvé a iniciar sesión.'
    );
  }

  if (error.status === 403) {
    return feedback(
      'forbidden',
      'No tenés permisos para operar con esta institución.'
    );
  }

  if (error.status === 404) {
    if (operation === 'holder-resolution') {
      return feedback(
        'not_found',
        'No encontramos un titular disponible con ese correo. Verificá el email o consultá con la institución.'
      );
    }

    return feedback(
      'not_found',
      'No encontramos la credencial solicitada.'
    );
  }

  if (error.status === 400) {
    return feedback(
      'invalid_input',
      operation === 'holder-resolution'
        ? 'Revisá el correo ingresado e intentá nuevamente.'
        : 'Revisá los datos del borrador e intentá nuevamente.'
    );
  }

  if (error.status !== null && error.status >= 500) {
    return feedback(
      'service_unavailable',
      'El servicio no está disponible temporalmente. Intentá nuevamente más tarde.'
    );
  }

  return feedback(
    'unexpected',
    'No pudimos completar la operación. Intentá nuevamente.'
  );
}

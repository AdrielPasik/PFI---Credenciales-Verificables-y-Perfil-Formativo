import {
  ApiError,
  IncompatiblePayloadError
} from '@/lib/errors/api-error';
import { PASSWORD_LENGTH_MESSAGE } from '@/lib/auth/credential-rules';
import type {
  PasswordResetFeedback,
  PasswordResetOperation,
  PasswordResetProblem
} from '@/models/password-reset';

/**
 * Textos de producto. El mensaje que trae el servicio NUNCA se copia: el backend
 * ya decide que codigos son publicables, y la interfaz decide como se dicen.
 */
const MESSAGES: Record<PasswordResetProblem, string> = {
  invalid_email: 'Ingresá un correo electrónico válido.',
  invalid_input:
    'No pudimos procesar la solicitud. Revisá los datos e intentá nuevamente.',
  rate_limited: 'Hiciste demasiados intentos. Esperá unos minutos y volvé a probar.',
  unavailable:
    'La recuperación de cuenta no está disponible en este momento. Probá de nuevo más tarde.',
  service_error:
    'El servicio no está disponible temporalmente. Intentá nuevamente más tarde.',
  network: 'No pudimos conectar con Scope. Revisá tu conexión e intentá de nuevo.',
  incompatible_response:
    'El servicio respondió con un formato inesperado. Intentá nuevamente.',
  token_invalid: 'Este enlace ya no es válido.',
  password_policy: PASSWORD_LENGTH_MESSAGE,
  outcome_unknown:
    'No pudimos confirmar el resultado. Es posible que tu contraseña sí se haya actualizado.',
  unexpected: 'No pudimos completar la operación. Intentá nuevamente.'
};

function feedback(problem: PasswordResetProblem): PasswordResetFeedback {
  return { problem, message: MESSAGES[problem] };
}

/**
 * Traduce un error del API client a un problema de recuperacion.
 *
 * Se decide por el CODIGO publico del backend y, si no hay, por el status. Nada de
 * texto libre.
 *
 * El caso delicado es `confirm`: ahi un corte de red, un 5xx o un cuerpo ilegible
 * significan que NO SE SABE si la contrasena cambio (la solicitud pudo llegar y
 * consumir el token de un solo uso). Se informa como `outcome_unknown`, jamas como
 * un fallo definitivo, y la pantalla no reintenta sola.
 */
export function mapPasswordResetError(
  error: unknown,
  operation: PasswordResetOperation
): PasswordResetFeedback {
  if (error instanceof IncompatiblePayloadError) {
    return feedback(operation === 'confirm' ? 'outcome_unknown' : 'incompatible_response');
  }

  if (!(error instanceof ApiError)) {
    return feedback('unexpected');
  }

  if (error.kind === 'network') {
    return feedback(operation === 'confirm' ? 'outcome_unknown' : 'network');
  }

  if (error.kind === 'invalid-response') {
    // Un 2xx con un cuerpo que no es el contrato: NO se interpreta como exito ni
    // como fallo. En `confirm`, ademas, la contrasena pudo haber cambiado.
    return feedback(operation === 'confirm' ? 'outcome_unknown' : 'incompatible_response');
  }

  if (error.code === 'PASSWORD_RESET_TOKEN_INVALID') return feedback('token_invalid');
  if (error.code === 'PASSWORD_POLICY_VIOLATION') return feedback('password_policy');
  if (error.code === 'INVALID_EMAIL') return feedback('invalid_email');
  if (error.code === 'INVALID_REQUEST_INPUT') return feedback('invalid_input');
  if (error.code === 'TOO_MANY_REQUESTS' || error.status === 429) return feedback('rate_limited');
  if (error.code === 'PASSWORD_RECOVERY_UNAVAILABLE') return feedback('unavailable');

  if (error.status !== null && error.status >= 500) {
    return feedback(operation === 'confirm' ? 'outcome_unknown' : 'service_error');
  }

  return feedback('unexpected');
}

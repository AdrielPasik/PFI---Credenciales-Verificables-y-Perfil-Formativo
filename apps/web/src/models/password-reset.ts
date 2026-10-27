/**
 * Modelo de presentacion de la recuperacion de contrasena.
 *
 * Solo lo que la interfaz necesita. Nunca el token, ni el cuerpo de una
 * respuesta, ni un id, ni el detalle de un error del servicio.
 */

export type PasswordResetProblem =
  | 'invalid_email'
  | 'invalid_input'
  | 'rate_limited'
  | 'unavailable'
  | 'service_error'
  | 'network'
  | 'incompatible_response'
  | 'token_invalid'
  | 'password_policy'
  /**
   * Solo en `confirm`: la solicitud pudo haber llegado y consumido el token sin
   * que la respuesta volviera (corte de red, 5xx, cuerpo ilegible). NO se sabe si
   * la contrasena cambio, y la interfaz no debe afirmar ninguna de las dos cosas.
   */
  | 'outcome_unknown'
  | 'unexpected';

export interface PasswordResetFeedback {
  problem: PasswordResetProblem;
  /** Texto de producto. Nunca copia el mensaje del servicio. */
  message: string;
}

export type PasswordResetOperation = 'request' | 'verify' | 'confirm';

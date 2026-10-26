import { HttpException, HttpStatus } from '@nestjs/common';

import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH
} from '../credential-rules';

/**
 * Codigos publicos estables de la recuperacion de contrasena.
 *
 * Misma forma que `PublicVerificationError`: `{ code, message }` con un codigo
 * SCREAMING_CASE que el cliente web ya sabe leer (`safeErrorCode` en
 * `apps/web/src/lib/api/api-client.ts` acepta `^[A-Z][A-Z0-9_]{2,63}$`).
 *
 * Varios casos se COLAPSAN a proposito en un mismo codigo:
 *
 *   PASSWORD_RESET_TOKEN_INVALID   token mal formado, inexistente, vencido,
 *                                  consumido, invalidado o de una cuenta no
 *                                  elegible.
 *
 * Separarlos convertiria cada endpoint en un oraculo: un tercero podria
 * distinguir "este token existio y ya se uso" de "nunca existio". No hay
 * 401 ni 404 en esta superficie por la misma razon.
 */
export type PasswordResetErrorCode =
  | 'INVALID_EMAIL'
  | 'INVALID_REQUEST_INPUT'
  | 'PASSWORD_POLICY_VIOLATION'
  | 'PASSWORD_RESET_TOKEN_INVALID'
  | 'TOO_MANY_REQUESTS'
  | 'PASSWORD_RECOVERY_UNAVAILABLE';

const SAFE_MESSAGES: Record<PasswordResetErrorCode, string> = {
  INVALID_EMAIL: 'Ingresá un correo electrónico válido.',
  INVALID_REQUEST_INPUT: 'La solicitud no es válida.',
  PASSWORD_POLICY_VIOLATION: `La contraseña debe tener entre ${MIN_PASSWORD_LENGTH} y ${MAX_PASSWORD_LENGTH} caracteres.`,
  PASSWORD_RESET_TOKEN_INVALID: 'Este enlace ya no es válido.',
  TOO_MANY_REQUESTS: 'Hiciste demasiados intentos. Esperá unos minutos.',
  PASSWORD_RECOVERY_UNAVAILABLE:
    'La recuperación de cuenta no está disponible en este momento.'
};

const STATUS_BY_CODE: Record<PasswordResetErrorCode, HttpStatus> = {
  INVALID_EMAIL: HttpStatus.BAD_REQUEST,
  INVALID_REQUEST_INPUT: HttpStatus.BAD_REQUEST,
  PASSWORD_POLICY_VIOLATION: HttpStatus.BAD_REQUEST,
  PASSWORD_RESET_TOKEN_INVALID: HttpStatus.BAD_REQUEST,
  TOO_MANY_REQUESTS: HttpStatus.TOO_MANY_REQUESTS,
  PASSWORD_RECOVERY_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE
};

/** Frontera estable: nunca token, hash, email, ids ni el motivo interno. */
export class PasswordResetError extends HttpException {
  constructor(readonly code: PasswordResetErrorCode) {
    super({ code, message: SAFE_MESSAGES[code] }, STATUS_BY_CODE[code]);
  }
}

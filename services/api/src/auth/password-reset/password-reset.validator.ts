/**
 * Validacion de los bodies de la recuperacion de contrasena.
 *
 * Escrita a mano y sobre `unknown`, como el resto del repo: no hay `ValidationPipe`
 * global ni `class-validator` (ver `objective-request.validator.ts`). El body llega
 * del cliente, asi que ningun tipo de TypeScript se da por cierto.
 *
 * Se lee CAMPO A CAMPO. Cualquier otro campo del body (`userId`, `email` en el
 * confirm, `sessionVersion`, ...) no se mira nunca, asi que no puede influir en
 * la identidad: el usuario se resuelve unicamente a partir del token.
 *
 * Los chequeos de longitud van ANTES de cualquier trabajo costoso: una contrasena
 * de 100 KB se rechaza sin llegar a scrypt.
 */

import {
  EMAIL_PATTERN,
  MAX_EMAIL_LENGTH,
  isPasswordLengthValid
} from '../credential-rules';
import { PasswordResetError } from './password-reset.errors';
import { normalizePasswordResetToken } from './password-reset-token';

/**
 * Techo para la entrada CRUDA del email, antes de normalizar. Evita hacer
 * `trim().toLowerCase()` sobre un string gigante; holgado respecto del maximo
 * real para no rechazar un email valido con espacios alrededor.
 */
const MAX_RAW_EMAIL_LENGTH = 512;

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new PasswordResetError('INVALID_REQUEST_INPUT');
  }

  return body as Record<string, unknown>;
}

export function parseRequestResetBody(body: unknown): { email: string } {
  const email = asObject(body).email;

  if (typeof email !== 'string') {
    throw new PasswordResetError('INVALID_REQUEST_INPUT');
  }

  if (email.length > MAX_RAW_EMAIL_LENGTH) {
    throw new PasswordResetError('INVALID_EMAIL');
  }

  // Misma normalizacion que login y registro (trim + minusculas).
  const normalized = email.trim().toLowerCase();

  if (
    normalized.length === 0 ||
    normalized.length > MAX_EMAIL_LENGTH ||
    !EMAIL_PATTERN.test(normalized)
  ) {
    throw new PasswordResetError('INVALID_EMAIL');
  }

  return { email: normalized };
}

/**
 * Un `token` que no es un string es un body mal armado (400 de entrada). Un string
 * que no tiene la forma de un token es indistinguible de un token inexistente: ese
 * caso colapsa en `PASSWORD_RESET_TOKEN_INVALID`.
 */
function readToken(fields: Record<string, unknown>): string {
  if (typeof fields.token !== 'string') {
    throw new PasswordResetError('INVALID_REQUEST_INPUT');
  }

  const token = normalizePasswordResetToken(fields.token);

  if (token === null) {
    throw new PasswordResetError('PASSWORD_RESET_TOKEN_INVALID');
  }

  return token;
}

export function parseVerifyBody(body: unknown): { token: string } {
  return { token: readToken(asObject(body)) };
}

export function parseConfirmBody(body: unknown): {
  token: string;
  password: string;
} {
  const fields = asObject(body);
  const token = readToken(fields);

  if (typeof fields.password !== 'string') {
    throw new PasswordResetError('INVALID_REQUEST_INPUT');
  }

  // Misma politica que el registro: longitud y nada mas. Ni trim ni normalizacion:
  // la contrasena se hashea tal como llega, igual que en `register`.
  if (!isPasswordLengthValid(fields.password)) {
    throw new PasswordResetError('PASSWORD_POLICY_VIOLATION');
  }

  return { token, password: fields.password };
}

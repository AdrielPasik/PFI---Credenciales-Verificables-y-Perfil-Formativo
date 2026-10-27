/**
 * Reglas de credenciales compartidas por los formularios de acceso (login,
 * registro y recuperacion de contrasena).
 *
 * Son feedback TEMPRANO para la persona: la autoridad real es el backend, que
 * valida de nuevo y puede rechazar lo que aca pasa. Los valores replican la
 * politica del API (`services/api/src/auth/credential-rules.ts`) sin importar de
 * ahi: el frontend nunca depende de codigo del backend. Si la politica cambiara,
 * el backend responderia `PASSWORD_POLICY_VIOLATION` y la pantalla lo mostraria.
 */

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Misma politica minima que el registro: longitud y nada mas (sin reglas de
// complejidad arbitrarias).
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

/** Misma normalizacion que login y registro. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export const PASSWORD_LENGTH_MESSAGE = `La contraseña debe tener entre ${MIN_PASSWORD_LENGTH} y ${MAX_PASSWORD_LENGTH} caracteres.`;

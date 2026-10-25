/**
 * Reglas de credenciales compartidas entre el registro y la recuperacion de
 * contrasena.
 *
 * Viven en UN solo lugar para que las dos superficies no puedan divergir: si la
 * politica de contrasena del registro cambiara y la de recuperacion no, una
 * persona podria quedar con una contrasena que el registro rechazaria.
 *
 * Esto NO cambia el comportamiento del registro: son exactamente los mismos
 * valores que antes vivian como constantes locales de `AuthService`.
 */

// A1: mismo patron de regex ya usado en issuer-holder-resolution.service.ts y
// analysis-run-backfill.service.ts (el repo no centraliza esta constante en otro
// lado).
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A1: politica minima (seccion 10 del diseno) -- sin reglas de complejidad
// inventadas (mayuscula/simbolo/numero). 8 es un piso razonable, 128 evita
// inputs abusivos sin limitar casos de uso reales.
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

// Longitud maxima de una direccion (RFC 5321: 254). El registro historicamente no
// la acota; la recuperacion si, porque es un endpoint publico sin sesion.
export const MAX_EMAIL_LENGTH = 254;

export function isPasswordLengthValid(value: string): boolean {
  return (
    value.length >= MIN_PASSWORD_LENGTH && value.length <= MAX_PASSWORD_LENGTH
  );
}

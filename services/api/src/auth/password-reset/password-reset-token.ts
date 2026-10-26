/**
 * Token de recuperacion de contrasena.
 *
 * EL MISMO patron que `SharingGrant` y `public-verification/opaque-token.ts`:
 * `randomBytes(32)` en base64url (256 bits), persistido SOLO como SHA-256 hex. El
 * valor crudo existe una unica vez, en el enlace que se le envia a la persona;
 * despues no es recuperable desde la base.
 *
 * Se replica en vez de importar `opaque-token.ts` a proposito: ese archivo es del
 * modulo de verificacion publica, y acoplar autenticacion a otro dominio por tres
 * funciones de una linea cuesta mas de lo que ahorra (la misma decision que ya
 * tomo `profile-sharing`).
 *
 * POR QUE SHA-256 Y NO scrypt. scrypt existe para proteger secretos de BAJA
 * entropia (contrasenas humanas) contra ataques de diccionario. Un token de 256
 * bits no tiene diccionario: SHA-256 alcanza para que un volcado de la base no
 * sirva, y ademas es DETERMINISTA, que es lo que permite encontrar la fila por el
 * indice unico de `tokenHash`. Un hash con sal obligaria a recorrer la tabla.
 */

import { createHash, randomBytes } from 'node:crypto';

/** 32 bytes en base64url, sin relleno. */
export const PASSWORD_RESET_TOKEN_LENGTH = 43;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generatePasswordResetToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashPasswordResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * `null` si el valor no tiene EXACTAMENTE la forma de un token. Nunca lanza y nunca
 * convierte: un numero, un array o un objeto no son "casi" un token.
 *
 * La longitud se compara antes que el patron: una entrada enorme se descarta sin
 * recorrerla.
 */
export function normalizePasswordResetToken(value: unknown): string | null {
  return typeof value === 'string' &&
    value.length === PASSWORD_RESET_TOKEN_LENGTH &&
    TOKEN_PATTERN.test(value)
    ? value
    : null;
}

/**
 * Tokens opacos de autoridad publica.
 *
 * EL MISMO patron que `SharingGrant`: `randomBytes(32)` en base64url (256 bits),
 * persistido solo como SHA-256 hex. El valor crudo existe una unica vez, en la
 * respuesta que lo crea; despues no es recuperable desde la base.
 *
 * Un token es una CREDENCIAL DE ACCESO. Por eso nunca se usa un id de base como
 * autoridad publica: los ids no son secretos, no rotan y aparecen en logs.
 */

import { createHash, randomBytes } from 'node:crypto';

/** Formato aceptado. Rechazar antes de hashear evita trabajo con basura. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,200}$/;

export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** `null` si el valor no tiene forma de token. Nunca lanza. */
export function normalizeOpaqueToken(value: unknown): string | null {
  return typeof value === 'string' && TOKEN_PATTERN.test(value) ? value : null;
}

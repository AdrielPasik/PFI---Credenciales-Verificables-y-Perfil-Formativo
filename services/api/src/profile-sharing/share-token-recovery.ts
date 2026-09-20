/**
 * Recuperacion del enlace compartido por su DUENO.
 *
 * EL PROBLEMA QUE RESUELVE. Hasta ahora solo se persistia `sha256(token)`, asi
 * que el token crudo existia una sola vez: en la respuesta de creacion. Si el
 * holder cerraba esa pantalla, su enlace era irrecuperable y la unica salida era
 * crear otro. De ahi salia la acumulacion de enlaces que encontro la QA manual.
 *
 * LO QUE **NO** CAMBIA. La autoridad publica sigue siendo el hash:
 *
 *     token presentado -> sha256 -> busqueda por `tokenHash`
 *
 * Nunca se busca por texto plano, y el texto plano NUNCA se persiste.
 *
 * QUE SE GUARDA. Un sobre de cifrado autenticado con el token adentro:
 *
 *     v1.<nonce base64url>.<ciphertext+tag base64url>
 *
 *   primitiva   AES-256-GCM (node:crypto, sin dependencias nuevas)
 *   nonce       12 bytes aleatorios por sobre
 *   tag         16 bytes, verificado al abrir
 *   AAD         `profile-share-token|<sharingGrantId>|<userId>`
 *   version     el prefijo `v1` permite migrar formato o clave sin adivinar
 *
 * La AAD ata el sobre a SU fila y a SU dueno: un ciphertext movido a otro grant
 * o a otro usuario no abre, aunque la clave sea la correcta.
 *
 * LA CLAVE VIVE EN EL ENTORNO. `PROFILE_SHARE_TOKEN_KEY`, 32 bytes en base64 o
 * hex. Nunca en el repositorio ni en la base. Sin clave configurada no se puede
 * crear un enlace recuperable: se falla cerrado en vez de guardar algo debil.
 *
 * NO SE GUARDA LA URL ABSOLUTA. Solo el token. La URL se arma al recuperar, con
 * el origen publico configurado, para que un cambio de dominio no invalide nada.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const ENVELOPE_VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export const SHARE_TOKEN_KEY_ENV = 'PROFILE_SHARE_TOKEN_KEY';

/** Falla de configuracion o de integridad. Nunca lleva el token ni la clave. */
export class ShareTokenRecoveryError extends Error {
  constructor(readonly code: 'KEY_NOT_CONFIGURED' | 'KEY_INVALID' | 'ENVELOPE_UNUSABLE') {
    super(code);
    this.name = 'ShareTokenRecoveryError';
  }
}

export interface ShareTokenContext {
  readonly sharingGrantId: string;
  readonly userId: string;
}

function associatedData(context: ShareTokenContext): Buffer {
  return Buffer.from(
    `profile-share-token|${context.sharingGrantId}|${context.userId}`,
    'utf8'
  );
}

/**
 * La clave del entorno. Acepta base64 o hex y exige 32 bytes exactos: una clave
 * corta "que igual funciona" es peor que no tener recuperacion.
 */
export function readShareTokenKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const configured = env[SHARE_TOKEN_KEY_ENV]?.trim();
  if (!configured) throw new ShareTokenRecoveryError('KEY_NOT_CONFIGURED');

  const decoded = /^[0-9a-fA-F]{64}$/.test(configured)
    ? Buffer.from(configured, 'hex')
    : Buffer.from(configured, 'base64');

  if (decoded.length !== KEY_BYTES) throw new ShareTokenRecoveryError('KEY_INVALID');
  return decoded;
}

/** `true` si este despliegue puede crear enlaces recuperables. No lee la clave afuera. */
export function shareTokenRecoveryConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    readShareTokenKey(env);
    return true;
  } catch {
    return false;
  }
}

export function sealShareToken(
  rawToken: string,
  context: ShareTokenContext,
  env: NodeJS.ProcessEnv = process.env
): string {
  const key = readShareTokenKey(env);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  cipher.setAAD(associatedData(context));
  const ciphertext = Buffer.concat([cipher.update(rawToken, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENVELOPE_VERSION,
    nonce.toString('base64url'),
    Buffer.concat([ciphertext, tag]).toString('base64url')
  ].join('.');
}

/**
 * Abre el sobre. Cualquier problema —version desconocida, forma rota, tag que no
 * verifica, clave distinta— es `ENVELOPE_UNUSABLE`: no se devuelve nada parcial
 * y NUNCA se cae al `tokenHash` como sustituto.
 */
export function openShareToken(
  envelope: string,
  context: ShareTokenContext,
  env: NodeJS.ProcessEnv = process.env
): string {
  const key = readShareTokenKey(env);
  const parts = envelope.split('.');
  if (parts.length !== 3 || parts[0] !== ENVELOPE_VERSION) {
    throw new ShareTokenRecoveryError('ENVELOPE_UNUSABLE');
  }

  try {
    const nonce = Buffer.from(parts[1], 'base64url');
    const payload = Buffer.from(parts[2], 'base64url');
    if (nonce.length !== NONCE_BYTES || payload.length <= TAG_BYTES) {
      throw new ShareTokenRecoveryError('ENVELOPE_UNUSABLE');
    }

    const ciphertext = payload.subarray(0, payload.length - TAG_BYTES);
    const tag = payload.subarray(payload.length - TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, key, nonce);
    decipher.setAAD(associatedData(context));
    decipher.setAuthTag(tag);
    const opened = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const token = opened.toString('utf8');
    if (token.length === 0) throw new ShareTokenRecoveryError('ENVELOPE_UNUSABLE');
    return token;
  } catch (error: unknown) {
    if (error instanceof ShareTokenRecoveryError) throw error;
    // `final()` lanza cuando el tag no verifica: es exactamente el caso de
    // corrupcion o de sobre movido de fila.
    throw new ShareTokenRecoveryError('ENVELOPE_UNUSABLE');
  }
}

/** Comparacion en tiempo constante. Solo para tests y verificaciones internas. */
export function sameToken(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * La URL publica se ARMA, no se guarda.
 *
 * El origen sale de la configuracion del despliegue; si no hay origen valido se
 * devuelve la ruta relativa, que sigue siendo utilizable desde la propia web.
 */
export function buildSharePath(rawToken: string): string {
  return `/share/profile/${encodeURIComponent(rawToken)}`;
}

/**
 * Arma la URL publica a partir del ORIGEN configurado.
 *
 * Se valida de verdad, porque de aca sale lo que el holder copia y pega:
 *
 *   - protocolo http o https;
 *   - sin path, query ni fragmento: `https://scope.example.com/algo?x=1#y` no se
 *     "limpia" en silencio, se RECHAZA. Aceptarlo produciria enlaces copiados
 *     con material ajeno pegado antes de la ruta del perfil;
 *   - sin credenciales embebidas en la URL.
 *
 * Origen ausente o invalido devuelve `null`, y el llamante entrega la ruta
 * relativa: nunca una URL a medio formar.
 */
export function buildShareUrl(rawToken: string, configuredOrigin: string | undefined): string | null {
  const candidate = configuredOrigin?.trim();
  if (!candidate) return null;
  try {
    const origin = new URL(candidate);
    if (origin.protocol !== 'http:' && origin.protocol !== 'https:') return null;
    if (origin.username || origin.password) return null;
    if (origin.search || origin.hash) return null;
    // Una barra final sola es el unico path aceptable.
    if (origin.pathname !== '/' && origin.pathname !== '') return null;
    return `${origin.origin}${buildSharePath(rawToken)}`;
  } catch {
    return null;
  }
}

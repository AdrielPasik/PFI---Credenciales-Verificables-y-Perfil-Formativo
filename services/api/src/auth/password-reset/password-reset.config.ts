/**
 * Configuracion de la recuperacion de contrasena.
 *
 * `WEB_PUBLIC_BASE_URL` es el ORIGEN desde el que se abre la pagina de
 * restablecimiento. Es la UNICA fuente del host de los enlaces de correo: el
 * backend nunca lo deduce de la request (`Host`, `Origin`, `X-Forwarded-Host`),
 * porque un `Host` manipulado fabricaria enlaces de recuperacion hacia un dominio
 * del atacante.
 *
 * NO es `WEB_ORIGIN`: esa variable es la lista de CORS (que origen puede llamar a
 * la API; vacia, deshabilita CORS) y NO es la URL de la API. Mezclarlas acoplaria
 * un cambio de CORS con la rotura de todos los enlaces ya enviados.
 *
 * Una URL invalida NO tumba el arranque: el login y el registro no pueden caerse
 * porque una funcionalidad opcional esta mal configurada. La recuperacion queda
 * deshabilitada (503) y el motivo se informa con un texto fijo.
 */

import { isProductionEnvironment } from '../../mail/mail.config';

type Env = Record<string, string | undefined>;

export type WebBaseUrlFailure =
  | 'missing'
  | 'not_a_url'
  | 'not_https_in_production'
  | 'insecure_non_local_host'
  | 'unsupported_protocol'
  | 'has_credentials'
  | 'has_query_or_fragment'
  | 'has_path';

export type WebBaseUrlResult =
  | { ok: true; origin: string }
  | { ok: false; reason: WebBaseUrlFailure };

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function isLocalHostname(hostname: string): boolean {
  return LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost');
}

export function resolveWebPublicBaseUrl(env: Env = process.env): WebBaseUrlResult {
  const raw = env.WEB_PUBLIC_BASE_URL?.trim();

  if (!raw) {
    return { ok: false, reason: 'missing' };
  }

  // `new URL('https://a.example/#')` tiene `hash === ''`: el marcador vacio solo
  // se ve en el texto crudo.
  if (/[?#]/.test(raw)) {
    return { ok: false, reason: 'has_query_or_fragment' };
  }

  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'not_a_url' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: 'unsupported_protocol' };
  }

  if (url.username || url.password) {
    return { ok: false, reason: 'has_credentials' };
  }

  if (url.search || url.hash) {
    return { ok: false, reason: 'has_query_or_fragment' };
  }

  // Un origen no tiene path. `new URL('https://a.example')` ya normaliza a '/'.
  if (url.pathname !== '/') {
    return { ok: false, reason: 'has_path' };
  }

  if (url.protocol === 'http:') {
    // HTTP solo para desarrollo local. En produccion, ni siquiera en localhost:
    // un enlace de recuperacion nunca debe apuntar a texto plano.
    if (isProductionEnvironment(env)) {
      return { ok: false, reason: 'not_https_in_production' };
    }

    if (!isLocalHostname(url.hostname)) {
      return { ok: false, reason: 'insecure_non_local_host' };
    }
  }

  return { ok: true, origin: url.origin };
}

/**
 * El token viaja en el FRAGMENTO, no en el path ni en la query. El navegador no
 * envia el fragmento al servidor que entrega la pagina: no queda en los logs de
 * acceso de Vercel, ni en `Referer`, ni se consume por el solo hecho de visitar la
 * pagina. La web lo lee, lo saca de la barra y lo manda por POST.
 *
 * Sin email ni userId en el enlace.
 */
export function buildPasswordResetLink(origin: string, token: string): string {
  return `${origin}/reset-password#token=${token}`;
}

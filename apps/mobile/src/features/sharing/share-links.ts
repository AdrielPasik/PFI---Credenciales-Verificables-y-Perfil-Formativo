/**
 * Construcción de los enlaces públicos que el titular comparte.
 *
 * Reglas:
 *
 *  - el enlace de PERFIL usa la ruta opaca que devuelve el backend
 *    (`POST /me/profile/share` -> `/share/profile/<token>`). Nunca se inventa
 *    ni se deriva un token del lado del cliente;
 *  - el enlace de CREDENCIAL reproduce exactamente la misma semántica que
 *    Holder Web: `/verify?credential=<referencia>`, la vista pública de
 *    verificación. Hoy NO existe un endpoint de "compartir credencial", así
 *    que no hay mutación que llamar: es un enlace a la experiencia pública;
 *  - el host sale de `EXPO_PUBLIC_WEB_BASE_URL`. Nunca se adivina un dominio.
 *
 * Estas URLs abren la web pública en el navegador del sistema. La app NUNCA
 * embebe el verificador en un WebView (secciones 56 y 129 del encargo).
 */

export function buildProfileShareUrl(
  webBaseUrl: string,
  sharePath: string
): string {
  return `${webBaseUrl}${sharePath}`;
}

export function buildCredentialVerificationUrl(
  webBaseUrl: string,
  credentialReference: string
): string {
  return `${webBaseUrl}/verify?credential=${encodeURIComponent(
    credentialReference
  )}`;
}

/**
 * Mensaje del share sheet nativo.
 *
 * Deliberadamente breve y sin datos sensibles: lo que se expone es lo que la
 * vista pública ya expone por contrato, nada más (sección 130 del encargo).
 */
export function buildProfileShareMessage(url: string): string {
  return `Mi perfil formativo en Scope: ${url}`;
}

export function buildCredentialShareMessage(
  title: string,
  url: string
): string {
  return `Credencial "${title}" en Scope: ${url}`;
}

/** Sólo se abren URLs http(s) ya validadas (sección 98 del encargo). */
export function isSafeExternalUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

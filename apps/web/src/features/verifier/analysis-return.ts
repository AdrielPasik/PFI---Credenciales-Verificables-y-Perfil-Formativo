/**
 * Regreso desde la verificacion de una credencial al analisis que la mostro.
 *
 * QUE VIAJA EN LA URL Y QUE NO:
 *
 *   viaja     la RUTA del analisis: `/share/profile/<shareToken>/analysis`.
 *             El token de ENLACE ya esta en esa URL por diseno: es la credencial
 *             de acceso al perfil y el verificador la tiene desde el principio.
 *   NO viaja  el token de SOLICITUD. Sigue viviendo solo en sessionStorage, y al
 *             volver la ruta del analisis lo relee de ahi: el servidor restaura el
 *             resultado ya calculado con lecturas, sin solicitud nueva y sin F3.
 *
 * NO ES UN REDIRECT GENERICO. `returnTo` no acepta "cualquier ruta interna": acepta
 * DOS formas, el perfil compartido y su analisis publico, validadas con
 * expresiones ancladas en ambos extremos. Eso descarta por construccion URLs absolutas,
 * protocol-relative (`//host`), barras invertidas, traversal, query y fragmento.
 * Cualquier otra cosa se ignora y la pagina se comporta como una visita directa.
 */

export const ANALYSIS_RETURN_PARAM = 'returnTo';

/** Alfabeto base64url del token opaco de enlace; largo acotado a proposito. */
const ANALYSIS_RETURN_PATTERN = /^\/share\/profile\/[A-Za-z0-9_-]{16,128}\/analysis$/;
const PROFILE_RETURN_PATTERN = /^\/share\/profile\/[A-Za-z0-9_-]{16,128}$/;

export interface PublicReturn {
  path: string;
  label: string;
}

export function buildAnalysisReturnPath(shareToken: string): string | null {
  const path = `/share/profile/${shareToken}/analysis`;
  return ANALYSIS_RETURN_PATTERN.test(path) ? path : null;
}

/** Devuelve la ruta de regreso SOLO si es exactamente la de un analisis publico. */
export function parseAnalysisReturnPath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  return ANALYSIS_RETURN_PATTERN.test(raw) ? raw : null;
}

export function buildProfileReturnPath(shareToken: string): string | null {
  const path = `/share/profile/${shareToken}`;
  return PROFILE_RETURN_PATTERN.test(path) ? path : null;
}

/**
 * Regreso desde la verificacion publica: SOLO a un perfil compartido o a su
 * analisis, con una etiqueta que dice a cual. Cualquier otra cosa: `null`.
 */
export function parsePublicReturn(raw: string | null | undefined): PublicReturn | null {
  if (typeof raw !== 'string') return null;
  if (ANALYSIS_RETURN_PATTERN.test(raw)) return { path: raw, label: 'Volver al análisis' };
  if (PROFILE_RETURN_PATTERN.test(raw)) return { path: raw, label: 'Volver al perfil compartido' };
  return null;
}

/** Enlace a la verificacion publica de una credencial, con regreso si corresponde. */
export function buildCredentialVerifyHref(
  credentialReference: string,
  returnTo: string | null
): string {
  const params = new URLSearchParams({ credential: credentialReference });
  const safeReturn = parsePublicReturn(returnTo);
  if (safeReturn !== null) params.set(ANALYSIS_RETURN_PARAM, safeReturn.path);
  return `/verify?${params.toString()}`;
}

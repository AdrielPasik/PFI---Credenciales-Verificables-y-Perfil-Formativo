/**
 * Destino al que volver después de iniciar sesión.
 *
 * Un enlace profundo a una pantalla del titular (`scope://credentials/…`)
 * abierto SIN sesión pasa por el login; el destino viaja como parámetro `next`
 * y, al autenticar, se vuelve a él.
 *
 * El parámetro es entrada no confiable: solo se aceptan rutas internas del
 * espacio del titular, por lista blanca anclada. Nada de esquemas, hosts,
 * `//`, rutas de otros roles ni de autenticación (evita redirecciones abiertas
 * y bucles). Cualquier otra cosa cae al Perfil.
 */

const SEGMENT = '[A-Za-z0-9_-]{1,128}';

const ALLOWED_DESTINATIONS: readonly RegExp[] = [
  /^\/credentials$/,
  new RegExp(`^/credentials/${SEGMENT}$`),
  /^\/objectives$/,
  /^\/objectives\/new$/,
  new RegExp(`^/objectives/${SEGMENT}$`),
  /^\/profile-shares$/,
  new RegExp(`^/profile-shares/${SEGMENT}/verification-policy$`)
];

export const HOLDER_HOME = '/(holder)/(tabs)';

export function safeHolderDestination(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.length === 0 || value.length > 300) {
    return null;
  }
  return ALLOWED_DESTINATIONS.some((pattern) => pattern.test(value)) ? value : null;
}

/**
 * Enlaces públicos que el titular puede compartir.
 *
 * El backend devuelve una RUTA (`/share/profile/<token>`), no una URL
 * absoluta: la URL pública se compone con `EXPO_PUBLIC_WEB_BASE_URL`
 * (ver `src/features/sharing/share-links.ts`). Nunca se adivina un dominio.
 */
export interface ProfileShareLinkVM {
  sharePath: string;
  expiresAtLabel: string | null;
}

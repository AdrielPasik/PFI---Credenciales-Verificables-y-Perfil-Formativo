/**
 * Estado efectivo de un SharingGrant, derivado -- nunca persistido.
 *
 * UNA SOLA DEFINICION PARA LOS DOS LADOS. El listado del holder y el lector
 * publico tienen que coincidir exactamente en que significa "activo": si el
 * holder ve ACTIVE y el lector publico responde 404, o al reves, el producto
 * esta mintiendo sobre el permiso. Por eso el calculo vive aca y no duplicado.
 *
 * No hay reactivacion: `revokedAt` es terminal. Un token filtrado de un enlace
 * revocado nunca vuelve a valer.
 */

import { SharingGrantScope } from '@prisma/client';

export type ShareEffectiveStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

/**
 * ALLOWLIST EXPLICITA de alcances que admiten verificacion contextual.
 *
 * UNA sola definicion para los tres puntos que la necesitan: el PUT de politica
 * del holder, el booleano del lector publico y la autoridad del VerificationRun.
 * Si divergieran, el perfil publico podria anunciar un analisis que el
 * congelamiento despues rechaza.
 *
 * Solo `profile`. `credential` es un enlace a UNA credencial y no autoriza
 * razonamiento a nivel perfil; `credential_and_profile` no tiene semantica de
 * computo diseñada. No se confia en que hoy no tengan productor, y un alcance
 * futuro tampoco entra por omision: queda afuera hasta agregarse aca a proposito.
 */
export const CONTEXTUAL_VERIFICATION_SUPPORTED_SCOPES: ReadonlySet<SharingGrantScope> = new Set([
  SharingGrantScope.profile
]);

export function supportsContextualVerification(scope: SharingGrantScope): boolean {
  return CONTEXTUAL_VERIFICATION_SUPPORTED_SCOPES.has(scope);
}

export interface ShareLifecycleView {
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
}

/**
 * Precedencia: revocado gana sobre vencido.
 *
 * Un enlace revocado Y vencido se reporta REVOKED porque describe la decision
 * del holder, no el paso del tiempo. Los dos niegan acceso igual, asi que la
 * precedencia solo afecta al texto que ve el holder.
 */
export function shareEffectiveStatus(
  share: ShareLifecycleView,
  now: Date = new Date()
): ShareEffectiveStatus {
  if (share.revokedAt !== null) return 'REVOKED';
  // `expiresAt = null` es no-vence. Hoy la creacion siempre lo deja en null,
  // pero una fila con vencimiento cargado por otra via se respeta igual.
  if (share.expiresAt !== null && share.expiresAt <= now) return 'EXPIRED';
  return 'ACTIVE';
}

export function isShareActive(share: ShareLifecycleView, now: Date = new Date()): boolean {
  return shareEffectiveStatus(share, now) === 'ACTIVE';
}

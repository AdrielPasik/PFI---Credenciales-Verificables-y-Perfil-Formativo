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

export type ProfileShareStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';
/** Alcance autoritativo del enlace devuelto por la API. */
export type ProfileShareScope = 'profile' | 'credential' | 'credential_and_profile';

/** Resumen seguro para administrar un enlace propio; nunca incluye el token. */
export interface ProfileShareSummaryVM {
  shareId: string;
  scope: ProfileShareScope;
  status: ProfileShareStatus;
  statusLabel: string;
  createdAtLabel: string;
  expiresAtLabel: string | null;
  revokedAtLabel: string | null;
  lastUsedAtLabel: string | null;
  /** Capacidad de presentación derivada del alcance, nunca una autorización local. */
  supportsContextualVerification: boolean;
}

/** Material portador recuperado únicamente bajo acción explícita. */
export interface RecoveredProfileShareLinkVM {
  sharePath: string;
  shareUrl: string | null;
}

/** Respuesta autoritativa del reemplazo de consentimiento contextual. */
export interface ShareVerificationPolicyVM {
  /** `false` significa que nunca se guardó una política, no una selección vacía. */
  configured: boolean;
  enabled: boolean;
  policyVersion: number;
  authorizedCredentialIds: string[];
  effectiveAuthorizedCredentialIds: string[];
  updatedAtLabel: string | null;
}

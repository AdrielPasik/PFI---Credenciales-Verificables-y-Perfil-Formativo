import {
  adaptHolderProfileShares,
  adaptHolderShareLink,
  adaptProfileShareLink,
  adaptPublicProfileShare,
  adaptShareVerificationPolicy
} from '@/lib/adapters/profile-sharing.adapter';
import { createApiClient, type AuthenticatedApiRequest } from '@/lib/api/api-client';

export async function createProfileShareRequest(request: AuthenticatedApiRequest) {
  return adaptProfileShareLink(await request('/me/profile/share', { method: 'POST' }));
}

export async function getPublicProfileShareRequest(token: string) {
  const normalized = token.trim();
  if (!normalized) throw new Error('El enlace compartido no es válido.');
  return adaptPublicProfileShare(
    await createApiClient().request(`/share/profile/${encodeURIComponent(normalized)}`)
  );
}

export async function listMyProfileSharesRequest(request: AuthenticatedApiRequest) {
  return adaptHolderProfileShares(await request('/me/profile/shares'));
}

/**
 * Recupera el enlace utilizable de UN enlace propio.
 *
 * Operacion EXPLICITA: se dispara al copiar o abrir, nunca al listar. El backend
 * responde con `Cache-Control: no-store`.
 */
export async function recoverProfileShareLinkRequest(
  request: AuthenticatedApiRequest,
  shareId: string
) {
  return adaptHolderShareLink(
    await request(`/me/profile/shares/${encodeURIComponent(shareId)}/link`, { method: 'POST' })
  );
}

export async function revokeProfileShareRequest(
  request: AuthenticatedApiRequest,
  shareId: string
) {
  await request(`/me/profile/shares/${encodeURIComponent(shareId)}/revoke`, { method: 'POST' });
}

/**
 * PUT: `credentialIds` es el conjunto COMPLETO de autorizacion, no un delta.
 * Reenviar el mismo estado es idempotente y no mueve `policyVersion`.
 */
export async function replaceShareVerificationPolicyRequest(
  request: AuthenticatedApiRequest,
  shareId: string,
  policy: { enabled: boolean; credentialIds: string[] }
) {
  return adaptShareVerificationPolicy(
    await request(`/me/profile/shares/${encodeURIComponent(shareId)}/verification-policy`, {
      method: 'PUT',
      body: policy
    })
  );
}

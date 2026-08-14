import { adaptProfileShareLink, adaptPublicProfileShare } from '@/lib/adapters/profile-sharing.adapter';
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

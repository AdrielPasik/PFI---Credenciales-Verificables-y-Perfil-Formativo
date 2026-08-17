import {
  adaptMyCredential,
  adaptMyCredentials,
  adaptMyCurrentProfile
} from '@/lib/adapters/holder.adapter';
import type { AuthenticatedApiRequest } from '@/lib/api/api-client';

export async function getMyCredentialsRequest(request: AuthenticatedApiRequest) {
  return adaptMyCredentials(await request('/me/credentials'));
}

export async function getMyCredentialRequest(
  request: AuthenticatedApiRequest,
  credentialReference: string
) {
  const reference = credentialReference.trim();
  if (!reference) throw new Error('La referencia de credencial no es válida.');
  return adaptMyCredential(
    await request(`/me/credentials/${encodeURIComponent(reference)}`)
  );
}

export async function getMyCurrentProfileRequest(request: AuthenticatedApiRequest) {
  return adaptMyCurrentProfile(await request('/me/profile/current'));
}

// P1.1: fallback manual -- reconstruye el perfil formativo del holder a
// partir de sus credenciales emitidas y de la semantica ya disponible
// (nunca ejecuta IA). Mismo shape de respuesta que getMyCurrentProfileRequest
// (`{ currentProfile }`), asi que se reusa el mismo adapter.
export async function rebuildMyProfileRequest(request: AuthenticatedApiRequest) {
  return adaptMyCurrentProfile(
    await request('/me/profile/rebuild', { method: 'POST' })
  );
}

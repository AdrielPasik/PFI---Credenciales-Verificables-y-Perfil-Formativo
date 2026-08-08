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

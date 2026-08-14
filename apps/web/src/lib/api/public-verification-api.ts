import { adaptPublicCredentialVerification } from '@/lib/adapters/public-verification.adapter';
import { createApiClient } from '@/lib/api/api-client';

export async function getPublicCredentialVerificationRequest(
  credentialReference: string
) {
  const reference = credentialReference.trim();
  if (!reference) throw new Error('La referencia de credencial no es válida.');

  return adaptPublicCredentialVerification(
    await createApiClient().request(
      `/verify/credentials/${encodeURIComponent(reference)}`
    )
  );
}

import {
  adaptIssuerNetworkHealth,
  adaptIssuerTechnicalIdentity
} from '@/lib/adapters/issuer-technical-identity.adapter';
import type { AuthenticatedApiRequest } from '@/lib/api/api-client';

/**
 * Superficie COMPLETA de configuracion tecnica (S8c9):
 *
 *   GET   /issuers/:issuerId/technical-identity
 *   POST  /issuers/:issuerId/technical-identity/network-health   (sin body)
 *
 * No hay ninguna ruta de provisioning, rotacion, capacidades ni claves.
 */
function technicalIdentityPath(issuerReference: string): `/${string}` {
  const reference = issuerReference.trim();
  if (!reference) {
    throw new Error('La referencia de institución no es válida.');
  }
  return `/issuers/${encodeURIComponent(reference)}/technical-identity`;
}

export async function getIssuerTechnicalIdentityRequest(
  request: AuthenticatedApiRequest,
  issuerReference: string,
  options: { signal?: AbortSignal } = {}
) {
  return adaptIssuerTechnicalIdentity(
    await request(technicalIdentityPath(issuerReference), { signal: options.signal })
  );
}

export async function checkIssuerNetworkHealthRequest(
  request: AuthenticatedApiRequest,
  issuerReference: string
) {
  return adaptIssuerNetworkHealth(
    await request(`${technicalIdentityPath(issuerReference)}/network-health`, {
      method: 'POST'
    })
  );
}

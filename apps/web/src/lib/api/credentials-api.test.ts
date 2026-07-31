import { describe, expect, it, vi } from 'vitest';

import {
  createCredentialDraftRequest,
  getIssuerCredentialRequest,
  resolveHolderRequest
} from '@/lib/api/credentials-api';

describe('credentials API', () => {
  it('resolves a holder by exact email within the selected issuer path', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({ ok: true });

    await resolveHolderRequest(requestAuthenticated, {
      issuerReference: 'issuer selected',
      email: 'holder@example.com'
    });

    expect(requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer%20selected/holders/resolve',
      {
        method: 'POST',
        body: { email: 'holder@example.com' }
      }
    );
  });

  it('builds the draft command only from internal references and known fields', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({ ok: true });

    await createCredentialDraftRequest(requestAuthenticated, {
      issuerReference: 'issuer-internal-reference',
      holderReference: 'holder-internal-reference',
      achievementName: 'Arquitectura de Software',
      institutionName: 'Universidad Contextual',
      credentialType: 'course'
    });

    expect(requestAuthenticated).toHaveBeenCalledWith(
      '/credentials/draft',
      {
        method: 'POST',
        body: {
          issuerId: 'issuer-internal-reference',
          subjectUserId: 'holder-internal-reference',
          type: 'course',
          title: 'Arquitectura de Software',
          sourceType: 'manual_issuer',
          credentialSubject: {
            achievement_name: 'Arquitectura de Software',
            institution_name: 'Universidad Contextual'
          }
        }
      }
    );
  });

  it('sends certification without replacing it with a hardcoded type', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({ ok: true });

    await createCredentialDraftRequest(requestAuthenticated, {
      issuerReference: 'issuer-internal-reference',
      holderReference: 'holder-internal-reference',
      achievementName: 'Certificación Profesional',
      institutionName: 'Universidad Contextual',
      credentialType: 'certification'
    });

    expect(requestAuthenticated).toHaveBeenCalledWith(
      '/credentials/draft',
      expect.objectContaining({
        body: expect.objectContaining({
          type: 'certification'
        })
      })
    );
  });

  it('loads detail by encoded resource reference using the authenticated boundary', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({ ok: true });

    await getIssuerCredentialRequest(
      requestAuthenticated,
      'issuer selected reference',
      'credential internal reference'
    );

    expect(requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer%20selected%20reference/credentials/credential%20internal%20reference'
    );
    expect(requestAuthenticated).toHaveBeenCalledTimes(1);
  });
});

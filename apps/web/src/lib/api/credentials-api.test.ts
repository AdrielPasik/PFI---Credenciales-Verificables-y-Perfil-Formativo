import { describe, expect, it, vi } from 'vitest';

import {
  createCredentialDraftRequest,
  getIssuerCredentialRequest,
  patchIssuerCredentialDraftRequest,
  resolveHolderRequest
} from '@/lib/api/credentials-api';
import type { UpdateIssuerCredentialDraftCommand } from '@/models/credentials';

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

  it('patches the encoded issuer draft with a top-level allowlisted body', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({ ok: true });
    const command: UpdateIssuerCredentialDraftCommand & {
      credentialSubject: { forbidden: boolean };
    } = {
      issuerReference: 'issuer selected reference',
      credentialReference: 'credential internal reference',
      expectedUpdatedAt: '2026-07-30T12:00:00.000Z',
      achievementName: 'Arquitectura Aplicada',
      providerName: 'Instituto Demo',
      skills: [],
      credentialSubject: { forbidden: true }
    };

    await patchIssuerCredentialDraftRequest(requestAuthenticated, command);

    expect(requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer%20selected%20reference/credentials/credential%20internal%20reference/draft',
      {
        method: 'PATCH',
        body: {
          expectedUpdatedAt: '2026-07-30T12:00:00.000Z',
          achievementName: 'Arquitectura Aplicada',
          providerName: 'Instituto Demo',
          skills: []
        }
      }
    );
    const body = requestAuthenticated.mock.calls[0]?.[1]?.body;
    expect(body).not.toHaveProperty('issuerReference');
    expect(body).not.toHaveProperty('credentialReference');
    expect(body).not.toHaveProperty('issuerId');
    expect(body).not.toHaveProperty('subjectUserId');
    expect(body).not.toHaveProperty('credentialSubject');
  });
});

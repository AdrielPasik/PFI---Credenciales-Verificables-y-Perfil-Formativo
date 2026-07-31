import { describe, expect, it } from 'vitest';

import {
  adaptCreatedCredentialDraft,
  adaptHolderResolution,
  adaptIssuerCredentialDetail
} from '@/lib/adapters/credentials.adapter';
import { IncompatiblePayloadError } from '@/lib/errors/api-error';

function issuerCredentialPayload(
  overrides: Record<string, unknown> = {}
) {
  return {
    id: 'credential-internal-reference',
    title: 'Arquitectura de Software',
    type: 'academic_subject',
    sourceType: 'manual_issuer',
    status: 'draft',
    createdAt: '2026-07-30T12:00:00.000Z',
    updatedAt: '2026-07-30T12:00:00.000Z',
    credentialSubject: {
      achievement_name: 'Arquitectura de Software',
      institution_name: 'Universidad Demo'
    },
    issuer: {
      displayName: 'Universidad Demo',
      did: 'did:example:issuer'
    },
    holder: {
      displayLabel: 'Demo Holder',
      email: 'HOLDER@EXAMPLE.COM',
      did: 'did:example:holder'
    },
    ...overrides
  };
}

describe('credential adapters', () => {
  it('adapts a holder response and discards extra fields', () => {
    expect(
      adaptHolderResolution({
        id: 'holder-internal-reference',
        email: 'HOLDER@EXAMPLE.COM',
        did: 'did:example:holder',
        displayLabel: 'Demo Holder',
        status: 'active',
        passwordHash: 'must-not-leak',
        memberships: [{ issuerId: 'must-not-leak' }]
      })
    ).toEqual({
      holderReference: 'holder-internal-reference',
      email: 'holder@example.com',
      did: 'did:example:holder',
      displayLabel: 'Demo Holder'
    });
  });

  it('preserves a nullable holder DID', () => {
    expect(
      adaptHolderResolution({
        id: 'holder-internal-reference',
        email: 'holder@example.com',
        did: null,
        displayLabel: 'Demo Holder'
      }).did
    ).toBeNull();
  });

  it('rejects an incomplete holder payload', () => {
    expect(() =>
      adaptHolderResolution({
        id: 'holder-internal-reference',
        email: 'holder@example.com',
        did: null
      })
    ).toThrow(IncompatiblePayloadError);
  });

  it('adapts a created draft response for redirect without exposing raw fields', () => {
    expect(
      adaptCreatedCredentialDraft({
        id: 'credential-internal-reference',
        issuerId: 'issuer-internal-reference',
        status: 'draft',
        subjectUserId: 'must-not-leak',
        canonicalHash: 'must-not-leak'
      })
    ).toEqual({
      credentialReference: 'credential-internal-reference',
      issuerReference: 'issuer-internal-reference',
      status: 'draft'
    });
  });

  it('adapts the issuer-scoped detail through a strict allowlist', () => {
    expect(
      adaptIssuerCredentialDetail({
        ...issuerCredentialPayload(),
        metadata: { internal: true },
        canonicalHash: 'must-not-leak',
        latestBlockchainRecord: { txHash: 'must-not-leak' }
      })
    ).toEqual({
      credentialReference: 'credential-internal-reference',
      title: 'Arquitectura de Software',
      draftAchievementName: 'Arquitectura de Software',
      type: 'academic_subject',
      typeLabel: 'Asignatura académica',
      status: 'draft',
      statusLabel: 'Borrador',
      issuer: {
        displayName: 'Universidad Demo',
        did: 'did:example:issuer'
      },
      draftInstitutionName: 'Universidad Demo',
      holder: {
        displayLabel: 'Demo Holder',
        email: 'holder@example.com',
        did: 'did:example:holder'
      },
      createdAt: '2026-07-30T12:00:00.000Z'
    });
  });

  it('preserves nullable draft, issuer and holder values', () => {
    const detail = adaptIssuerCredentialDetail(
      issuerCredentialPayload({
        credentialSubject: {
          achievement_name: null,
          institution_name: null
        },
        issuer: {
          displayName: 'Universidad Demo',
          did: null
        },
        holder: {
          displayLabel: 'Demo Holder',
          email: null,
          did: null
        }
      })
    );

    expect(detail).toMatchObject({
      draftAchievementName: null,
      draftInstitutionName: null,
      issuer: { did: null },
      holder: { email: null, did: null }
    });
  });

  it('maps every supported credential type to its human label', () => {
    for (const [type, typeLabel] of [
      ['academic_subject', 'Asignatura académica'],
      ['course', 'Curso'],
      ['certification', 'Certificación'],
      ['degree', 'Título académico']
    ] as const) {
      expect(
        adaptIssuerCredentialDetail(
          issuerCredentialPayload({
            id: `credential-${type}`,
            type
          })
        )
      ).toMatchObject({ type, typeLabel });
    }
  });

  it('rejects an unknown credential type', () => {
    expect(() =>
      adaptIssuerCredentialDetail(
        issuerCredentialPayload({ type: 'microcredential' })
      )
    ).toThrow(IncompatiblePayloadError);
  });

  it('supports issued and revoked responses as read-only states', () => {
    for (const [status, statusLabel] of [
      ['issued', 'Emitida'],
      ['revoked', 'Revocada']
    ] as const) {
      expect(
        adaptIssuerCredentialDetail(
          issuerCredentialPayload({
            id: `credential-${status}`,
            status
          })
        )
      ).toMatchObject({ status, statusLabel });
    }
  });

  it('rejects unknown credential statuses', () => {
    expect(() =>
      adaptIssuerCredentialDetail(
        issuerCredentialPayload({ status: 'processing' })
      )
    ).toThrow(IncompatiblePayloadError);
  });

  it('rejects an invalid detail creation date', () => {
    expect(() =>
      adaptIssuerCredentialDetail(
        issuerCredentialPayload({ createdAt: 'not-a-date' })
      )
    ).toThrow(IncompatiblePayloadError);
  });
});

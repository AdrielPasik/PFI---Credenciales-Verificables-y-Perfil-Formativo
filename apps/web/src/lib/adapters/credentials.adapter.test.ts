import { describe, expect, it } from 'vitest';

import {
  adaptHolderResolution,
  adaptIssuerCredentialDetail
} from '@/lib/adapters/credentials.adapter';
import { IncompatiblePayloadError } from '@/lib/errors/api-error';

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

  it('adapts a draft/detail response through a strict allowlist', () => {
    expect(
      adaptIssuerCredentialDetail({
        id: 'credential-internal-reference',
        issuerId: 'issuer-internal-reference',
        subjectUserId: 'holder-must-not-reach-view-model',
        title: 'Arquitectura de Software',
        type: 'academic_subject',
        status: 'draft',
        createdAt: '2026-07-30T12:00:00.000Z',
        credentialSubject: {
          achievement_name: 'Arquitectura de Software',
          institution_name: 'Universidad Demo',
          unknown_private_field: 'must-not-leak'
        },
        metadata: { internal: true },
        canonicalHash: 'must-not-leak',
        latestBlockchainRecord: { txHash: 'must-not-leak' }
      })
    ).toEqual({
      credentialReference: 'credential-internal-reference',
      issuerReference: 'issuer-internal-reference',
      title: 'Arquitectura de Software',
      type: 'academic_subject',
      typeLabel: 'Asignatura académica',
      status: 'draft',
      statusLabel: 'Borrador',
      institutionName: 'Universidad Demo',
      createdAt: '2026-07-30T12:00:00.000Z'
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
        adaptIssuerCredentialDetail({
          id: `credential-${type}`,
          issuerId: 'issuer-internal-reference',
          title: 'Logro',
          type,
          status: 'draft',
          createdAt: '2026-07-30T12:00:00.000Z',
          credentialSubject: {}
        })
      ).toMatchObject({ type, typeLabel });
    }
  });

  it('rejects an unknown credential type', () => {
    expect(() =>
      adaptIssuerCredentialDetail({
        id: 'credential-internal-reference',
        issuerId: 'issuer-internal-reference',
        title: 'Logro',
        type: 'microcredential',
        status: 'draft',
        createdAt: '2026-07-30T12:00:00.000Z',
        credentialSubject: {}
      })
    ).toThrow(IncompatiblePayloadError);
  });

  it('supports issued and revoked responses as read-only states', () => {
    for (const [status, statusLabel] of [
      ['issued', 'Emitida'],
      ['revoked', 'Revocada']
    ] as const) {
      expect(
        adaptIssuerCredentialDetail({
          id: `credential-${status}`,
          issuerId: 'issuer-internal-reference',
          title: 'Logro',
          type: 'course',
          status,
          createdAt: '2026-07-30T12:00:00.000Z',
          credentialSubject: {
            institution_name: 'Universidad Demo'
          }
        })
      ).toMatchObject({ status, statusLabel });
    }
  });

  it('rejects unknown credential statuses', () => {
    expect(() =>
      adaptIssuerCredentialDetail({
        id: 'credential-internal-reference',
        issuerId: 'issuer-internal-reference',
        title: 'Logro',
        type: 'course',
        status: 'processing',
        createdAt: '2026-07-30T12:00:00.000Z',
        credentialSubject: {}
      })
    ).toThrow(IncompatiblePayloadError);
  });

  it('rejects an invalid detail creation date', () => {
    expect(() =>
      adaptIssuerCredentialDetail({
        id: 'credential-internal-reference',
        issuerId: 'issuer-internal-reference',
        title: 'Logro',
        type: 'course',
        status: 'draft',
        createdAt: 'not-a-date',
        credentialSubject: {}
      })
    ).toThrow(IncompatiblePayloadError);
  });
});

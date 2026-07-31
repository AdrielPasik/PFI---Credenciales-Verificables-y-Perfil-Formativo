import { describe, expect, it } from 'vitest';

import {
  adaptCreatedCredentialDraft,
  adaptHolderResolution,
  adaptIssuerCredentialDetail
} from '@/lib/adapters/credentials.adapter';
import { IncompatiblePayloadError } from '@/lib/errors/api-error';

function credentialSubjectPayload(
  overrides: Record<string, unknown> = {}
) {
  return {
    achievement_name: 'Arquitectura de Software',
    institution_name: 'Universidad Demo',
    completion_date: '2026-07-25',
    academic_period: '2026-1',
    program_name: 'Ingeniería Informática',
    grade: '9',
    provider_name: null,
    platform_name: null,
    modality: null,
    level: null,
    certification_code: null,
    expiration_date: null,
    external_url: null,
    skills: ['Diseño de software'],
    competencies: ['Arquitectura'],
    learning_outcomes: [],
    ...overrides
  };
}

function issuerCredentialPayload(
  overrides: Record<string, unknown> = {}
) {
  return {
    id: 'credential-internal-reference',
    title: 'Arquitectura de Software',
    description: 'Diseño y evolución de sistemas.',
    hours: '48.00',
    type: 'academic_subject',
    sourceType: 'manual_issuer',
    status: 'draft',
    createdAt: '2026-07-30T12:00:00.000Z',
    updatedAt: '2026-07-30T12:00:00.000Z',
    credentialSubject: credentialSubjectPayload(),
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
      description: 'Diseño y evolución de sistemas.',
      hours: '48.00',
      type: 'academic_subject',
      typeLabel: 'Asignatura académica',
      status: 'draft',
      statusLabel: 'Borrador',
      issuer: {
        displayName: 'Universidad Demo',
        did: 'did:example:issuer'
      },
      credentialSubject: {
        achievementName: 'Arquitectura de Software',
        institutionName: 'Universidad Demo',
        completionDate: '2026-07-25',
        academicPeriod: '2026-1',
        programName: 'Ingeniería Informática',
        grade: '9',
        providerName: null,
        platformName: null,
        modality: null,
        level: null,
        certificationCode: null,
        expirationDate: null,
        externalUrl: null,
        skills: ['Diseño de software'],
        competencies: ['Arquitectura'],
        learningOutcomes: []
      },
      holder: {
        displayLabel: 'Demo Holder',
        email: 'holder@example.com',
        did: 'did:example:holder'
      },
      createdAt: '2026-07-30T12:00:00.000Z',
      updatedAt: '2026-07-30T12:00:00.000Z'
    });
  });

  it('preserves nullable draft, issuer and holder values', () => {
    const detail = adaptIssuerCredentialDetail(
      issuerCredentialPayload({
        description: null,
        hours: null,
        credentialSubject: credentialSubjectPayload({
          achievement_name: null,
          institution_name: null
        }),
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
      description: null,
      hours: null,
      credentialSubject: {
        achievementName: null,
        institutionName: null
      },
      issuer: { did: null },
      holder: { email: null, did: null }
    });
  });

  it('adapts every controlled subject field and keeps arrays as strings', () => {
    const detail = adaptIssuerCredentialDetail(
      issuerCredentialPayload({
        type: 'course',
        credentialSubject: credentialSubjectPayload({
          completion_date: '2026-07-25',
          academic_period: null,
          program_name: null,
          grade: null,
          provider_name: 'Instituto Demo',
          platform_name: 'Campus Virtual',
          modality: 'Híbrida',
          level: 'Intermedio',
          skills: ['Arquitectura', 'Testing'],
          competencies: ['Diseño'],
          learning_outcomes: ['Documentar decisiones']
        })
      })
    );

    expect(detail.credentialSubject).toEqual({
      achievementName: 'Arquitectura de Software',
      institutionName: 'Universidad Demo',
      completionDate: '2026-07-25',
      academicPeriod: null,
      programName: null,
      grade: null,
      providerName: 'Instituto Demo',
      platformName: 'Campus Virtual',
      modality: 'Híbrida',
      level: 'Intermedio',
      certificationCode: null,
      expirationDate: null,
      externalUrl: null,
      skills: ['Arquitectura', 'Testing'],
      competencies: ['Diseño'],
      learningOutcomes: ['Documentar decisiones']
    });
  });

  it('rejects missing or non-string controlled arrays', () => {
    expect(() =>
      adaptIssuerCredentialDetail(
        issuerCredentialPayload({
          credentialSubject: credentialSubjectPayload({
            skills: undefined
          })
        })
      )
    ).toThrow(IncompatiblePayloadError);

    expect(() =>
      adaptIssuerCredentialDetail(
        issuerCredentialPayload({
          credentialSubject: credentialSubjectPayload({
            skills: ['Arquitectura', 7]
          })
        })
      )
    ).toThrow(IncompatiblePayloadError);
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

  it('rejects an invalid detail update date', () => {
    expect(() =>
      adaptIssuerCredentialDetail(
        issuerCredentialPayload({ updatedAt: 'not-a-date' })
      )
    ).toThrow(IncompatiblePayloadError);
  });
});

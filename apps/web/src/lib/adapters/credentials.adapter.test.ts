import { describe, expect, it } from 'vitest';

import {
  adaptAcademicProgramSearch,
  adaptCreatedCredentialDraft,
  adaptCurriculumAcademicSubjectSearch,
  adaptDocumentEvidenceResponse,
  adaptHolderResolution,
  adaptIssuerCredentialDetail,
  adaptTextEvidenceResponse
} from '@/lib/adapters/credentials.adapter';
import { IncompatiblePayloadError } from '@/lib/errors/api-error';

const documentHash = 'a1b2c3d4e5f6'.padEnd(56, '0') + '9a8b7c6d';
const textHash = 'b1c2d3e4f5a6'.padEnd(56, '0') + '8a7b6c5d';

function documentEvidencePayload(
  overrides: Record<string, unknown> = {}
) {
  return {
    evidenceReference: 'evidence-internal-reference',
    kind: 'pdf',
    status: 'current',
    originalFileName: 'programa.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1536,
    sha256: documentHash,
    uploadedAt: '2026-08-03T12:00:00.000Z',
    ...overrides
  };
}

function textEvidencePayload(overrides: Record<string, unknown> = {}) {
  const content = 'Línea uno\nLínea dos';

  return {
    textEvidenceReference: 'text-evidence-internal-reference',
    status: 'current',
    label: 'Temario institucional',
    content,
    characterCount: Array.from(content).length,
    sha256: textHash,
    submittedAt: '2026-08-03T12:00:00.000Z',
    ...overrides
  };
}

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
    issuedAt: null,
    canonicalHash: null,
    canonicalizationVersion: null,
    blockchainEvidence: null,
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
    academicCourse: null,
    documentEvidence: { currentDocument: null },
    textEvidence: { currentText: null },
    ...overrides
  };
}

describe('credential adapters', () => {
  it('adapts program search items through a strict allowlist', () => {
    expect(
      adaptAcademicProgramSearch({
        items: [
          {
            programReference: 'program-reference',
            programCode: '1621',
            programName: 'Ingeniería en Informática',
            curriculumReference: 'curriculum-reference',
            curriculumCode: '2026',
            internalMetadata: 'must-not-leak'
          }
        ]
      })
    ).toEqual([
      {
        programReference: 'program-reference',
        programCode: '1621',
        programName: 'Ingeniería en Informática',
        curriculumReference: 'curriculum-reference',
        curriculumCode: '2026'
      }
    ]);
  });

  it('adapts curriculum-scoped subjects and preserves nullable catalog fields', () => {
    expect(
      adaptCurriculumAcademicSubjectSearch({
        items: [
          {
            academicCourseReference: 'course-reference',
            code: '3.4.213',
            name: 'Ingeniería de Datos II',
            description: null,
            hours: null,
            programReference: 'program-reference',
            programCode: '1621',
            programName: 'Ingeniería en Informática',
            curriculumReference: 'curriculum-reference',
            curriculumCode: '2026',
            issuerId: 'must-not-leak'
          }
        ]
      })
    ).toEqual([
      {
        academicCourseReference: 'course-reference',
        code: '3.4.213',
        name: 'Ingeniería de Datos II',
        description: null,
        hours: null,
        programReference: 'program-reference',
        programCode: '1621',
        programName: 'Ingeniería en Informática',
        curriculumReference: 'curriculum-reference',
        curriculumCode: '2026'
      }
    ]);
  });

  it('rejects incompatible catalog search payloads', () => {
    expect(() => adaptAcademicProgramSearch({ items: {} })).toThrow(
      IncompatiblePayloadError
    );
    expect(() =>
      adaptCurriculumAcademicSubjectSearch({
        items: [{ academicCourseReference: 'incomplete' }]
      })
    ).toThrow(IncompatiblePayloadError);
  });

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
        updatedAt: '2026-08-11T10:00:00.000Z',
        subjectUserId: 'must-not-leak',
        canonicalHash: 'must-not-leak'
      })
    ).toEqual({
      credentialReference: 'credential-internal-reference',
      issuerReference: 'issuer-internal-reference',
      status: 'draft',
      updatedAt: '2026-08-11T10:00:00.000Z'
    });
  });

  it('adapts the issuer-scoped detail through a strict allowlist', () => {
    expect(
      adaptIssuerCredentialDetail({
        ...issuerCredentialPayload(),
        metadata: { internal: true },
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
      issuedAt: null,
      issuedAtLabel: null,
      canonicalHash: null,
      canonicalHashShort: null,
      canonicalizationVersion: null,
      blockchainEvidence: null,
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
      academicCourse: null,
      documentEvidence: { currentDocument: null },
      textEvidence: { currentText: null },
      createdAt: '2026-07-30T12:00:00.000Z',
      updatedAt: '2026-07-30T12:00:00.000Z'
    });
  });

  it('adapts an upload response and discards storage internals', () => {
    expect(
      adaptDocumentEvidenceResponse(
        documentEvidencePayload({
          storageKey: 'must-not-leak',
          storageProvider: 'must-not-leak',
          path: 'must-not-leak',
          uploadedByUserId: 'must-not-leak',
          credentialId: 'must-not-leak'
        })
      )
    ).toEqual({
      evidenceReference: 'evidence-internal-reference',
      kind: 'pdf',
      status: 'current',
      originalFileName: 'programa.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1536,
      sizeLabel: '1,5 KB',
      sha256: documentHash,
      sha256Short: 'a1b2c3d4e5f6…9a8b7c6d',
      uploadedAt: '2026-08-03T12:00:00.000Z',
      uploadedAtLabel: expect.stringContaining('3 ago 2026')
    });
  });

  it('adapts a text evidence response through a strict allowlist', () => {
    expect(
      adaptTextEvidenceResponse(
        textEvidencePayload({
          submittedByUserId: 'must-not-leak',
          credentialId: 'must-not-leak',
          replacedAt: 'must-not-leak',
          history: ['must-not-leak']
        })
      )
    ).toEqual({
      textEvidenceReference: 'text-evidence-internal-reference',
      status: 'current',
      label: 'Temario institucional',
      content: 'Línea uno\nLínea dos',
      characterCount: 19,
      characterCountLabel: '19 caracteres',
      sha256: textHash,
      sha256Short: 'b1c2d3e4f5a6…8a7b6c5d',
      submittedAt: '2026-08-03T12:00:00.000Z',
      submittedAtLabel: expect.stringContaining('3 ago 2026')
    });
  });

  it('adapts currentText from detail and preserves null alongside documents', () => {
    const withText = adaptIssuerCredentialDetail(
      issuerCredentialPayload({
        documentEvidence: {
          currentDocument: documentEvidencePayload()
        },
        textEvidence: {
          currentText: textEvidencePayload(),
          history: ['must-not-leak']
        }
      })
    );
    const withoutText = adaptIssuerCredentialDetail(
      issuerCredentialPayload()
    );

    expect(withText.textEvidence.currentText).toMatchObject({
      status: 'current',
      label: 'Temario institucional'
    });
    expect(withText.documentEvidence.currentDocument).not.toBeNull();
    expect(withoutText.textEvidence).toEqual({ currentText: null });
    expect(withText.textEvidence).not.toHaveProperty('history');
  });

  it.each([
    { status: 'replaced' },
    { sha256: 'ABC' },
    { submittedAt: 'not-a-date' },
    { characterCount: 0 },
    { characterCount: 18 },
    { content: '' }
  ])('rejects incompatible text evidence %#', (overrides) => {
    expect(() =>
      adaptTextEvidenceResponse(textEvidencePayload(overrides))
    ).toThrow(IncompatiblePayloadError);
  });

  it('requires the textEvidence envelope in issuer detail', () => {
    expect(() =>
      adaptIssuerCredentialDetail(
        issuerCredentialPayload({ textEvidence: undefined })
      )
    ).toThrow(IncompatiblePayloadError);
  });

  it('adapts currentDocument from detail and preserves null explicitly', () => {
    const withDocument = adaptIssuerCredentialDetail(
      issuerCredentialPayload({
        documentEvidence: {
          currentDocument: documentEvidencePayload({
            kind: 'image',
            originalFileName: 'constancia.png',
            mimeType: 'image/png'
          }),
          replaced: ['must-not-leak']
        }
      })
    );
    const withoutDocument = adaptIssuerCredentialDetail(
      issuerCredentialPayload()
    );

    expect(withDocument.documentEvidence.currentDocument).toMatchObject({
      kind: 'image',
      mimeType: 'image/png',
      originalFileName: 'constancia.png'
    });
    expect(withoutDocument.documentEvidence).toEqual({
      currentDocument: null
    });
    expect(withDocument.documentEvidence).not.toHaveProperty('replaced');
  });

  it.each([
    { kind: 'pdf', mimeType: 'image/png' },
    { kind: 'image', mimeType: 'application/pdf' },
    { kind: 'archive', mimeType: 'application/pdf' },
    { status: 'replaced' },
    { sha256: 'ABC' },
    { sizeBytes: 0 },
    { sizeBytes: 1.5 },
    { uploadedAt: 'not-a-date' }
  ])('rejects incompatible document evidence %#', (overrides) => {
    expect(() =>
      adaptDocumentEvidenceResponse(
        documentEvidencePayload(overrides)
      )
    ).toThrow(IncompatiblePayloadError);
  });

  it('requires the documentEvidence envelope in issuer detail', () => {
    expect(() =>
      adaptIssuerCredentialDetail(
        issuerCredentialPayload({ documentEvidence: undefined })
      )
    ).toThrow(IncompatiblePayloadError);
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

  it('adapts the persisted academic course with nullable program context', () => {
    const withProgram = adaptIssuerCredentialDetail(
      issuerCredentialPayload({
        academicCourse: {
          academicCourseReference: 'course-reference',
          code: '3.4.213',
          name: 'Ingeniería de Datos II',
          description: null,
          hours: null,
          program: {
            programReference: 'program-reference',
            programCode: '1621',
            programName: 'Ingeniería en Informática',
            curriculumReference: 'curriculum-reference',
            curriculumCode: '2026',
            metadata: 'must-not-leak'
          },
          issuerId: 'must-not-leak'
        }
      })
    );
    const withoutProgram = adaptIssuerCredentialDetail(
      issuerCredentialPayload({
        academicCourse: {
          academicCourseReference: 'flat-course-reference',
          code: '1.1.1',
          name: 'Asignatura histórica',
          description: null,
          hours: null,
          program: null
        }
      })
    );

    expect(withProgram.academicCourse).toEqual({
      academicCourseReference: 'course-reference',
      code: '3.4.213',
      name: 'Ingeniería de Datos II',
      description: null,
      hours: null,
      program: {
        programReference: 'program-reference',
        programCode: '1621',
        programName: 'Ingeniería en Informática',
        curriculumReference: 'curriculum-reference',
        curriculumCode: '2026'
      }
    });
    expect(withoutProgram.academicCourse?.program).toBeNull();
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
      skills: [],
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

  it('adapts issued integrity evidence and discards dangerous extras', () => {
    const canonicalHash = `0x${'a'.repeat(64)}`;
    const txHash = `0x${'b'.repeat(64)}`;
    const result = adaptIssuerCredentialDetail(
      issuerCredentialPayload({
        status: 'issued',
        issuedAt: '2026-08-06T12:00:00.000Z',
        canonicalHash,
        canonicalizationVersion: 'canon_v1',
        blockchainEvidence: {
          network: 'anvil',
          chainId: 31337,
          txHash,
          status: 'registered',
          registeredAt: '2026-08-06T12:00:02.000Z',
          privateKey: 'must-not-leak',
          signer: 'must-not-leak',
          rpcUrl: 'must-not-leak',
          contractAddress: 'must-not-leak',
          issuerAddress: 'must-not-leak',
          storageKey: 'must-not-leak'
        },
        rawData: 'must-not-leak',
        analysisJson: 'must-not-leak',
        textForEmbedding: 'must-not-leak',
        evidenceMap: 'must-not-leak'
      })
    );

    expect(result).toMatchObject({
      status: 'issued',
      issuedAt: '2026-08-06T12:00:00.000Z',
      issuedAtLabel: expect.any(String),
      canonicalHash,
      canonicalHashShort: `${canonicalHash.slice(0, 12)}…${canonicalHash.slice(-8)}`,
      canonicalizationVersion: 'canon_v1',
      blockchainEvidence: {
        network: 'anvil',
        networkLabel: 'Entorno técnico/demo',
        chainId: 31337,
        txHash,
        txHashShort: `${txHash.slice(0, 12)}…${txHash.slice(-8)}`,
        status: 'registered',
        statusLabel: 'Registrada',
        registeredAt: '2026-08-06T12:00:02.000Z',
        registeredAtLabel: expect.any(String)
      }
    });
    expect(JSON.stringify(result)).not.toMatch(
      /privateKey|signer|rpcUrl|contractAddress|issuerAddress|rawData|analysisJson|textForEmbedding|evidenceMap|storageKey/
    );
  });

  it.each([
    ['mock', 'Entorno técnico/demo'],
    ['anvil', 'Entorno técnico/demo'],
    ['base_sepolia', 'Testnet'],
    ['future_network', 'Red técnica']
  ])('maps network %s to a restrained label', (network, networkLabel) => {
    const result = adaptIssuerCredentialDetail(
      issuerCredentialPayload({
        status: 'issued',
        blockchainEvidence: {
          network,
          chainId: 1,
          txHash: `0x${'b'.repeat(64)}`,
          status: 'registered',
          registeredAt: '2026-08-06T12:00:02.000Z'
        }
      })
    );

    expect(result.blockchainEvidence?.networkLabel).toBe(networkLabel);
  });

  it('preserves issued without evidence and revoked historical evidence', () => {
    const issued = adaptIssuerCredentialDetail(
      issuerCredentialPayload({ status: 'issued' })
    );
    const revoked = adaptIssuerCredentialDetail(
      issuerCredentialPayload({
        status: 'revoked',
        blockchainEvidence: {
          network: 'anvil',
          chainId: 31337,
          txHash: `0x${'b'.repeat(64)}`,
          status: 'revoked',
          registeredAt: '2026-08-06T12:00:02.000Z'
        }
      })
    );

    expect(issued.blockchainEvidence).toBeNull();
    expect(revoked.blockchainEvidence?.statusLabel).toBe('Revocada');
  });

  it('rejects an issuer detail missing the P6a integrity contract', () => {
    const payload: Record<string, unknown> = issuerCredentialPayload();
    delete payload.issuedAt;

    expect(() => adaptIssuerCredentialDetail(payload)).toThrow(
      IncompatiblePayloadError
    );
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

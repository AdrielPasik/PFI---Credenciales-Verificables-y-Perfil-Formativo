import { describe, expect, it } from 'vitest';

import {
  adaptMyCredential,
  adaptMyCredentials,
  adaptMyCurrentProfile
} from '@/lib/adapters/holder.adapter';
import { IncompatiblePayloadError } from '@/lib/errors/api-error';

const txHash = `0x${'b'.repeat(64)}`;

function listPayload() {
  return [{
    id: 'credential-internal-reference', title: 'Arquitectura de software', type: 'course', status: 'issued',
    issuerName: 'Institución demo', issuedAt: '2026-08-01T10:00:00.000Z', revokedAt: null,
    hasIntegrityEvidence: true, hasAnalysis: true,
    rawData: { forbidden: true }, storageKey: 'forbidden'
  }];
}

describe('holder adapters', () => {
  it('adapts only holder-safe credential list fields and accepts issued/revoked', () => {
    const result = adaptMyCredentials(listPayload());
    expect(result[0]).toEqual({
      credentialReference: 'credential-internal-reference', title: 'Arquitectura de software', type: 'course', typeLabel: 'Curso',
      status: 'issued', statusLabel: 'Emitida', issuerName: 'Institución demo', issuedAtLabel: expect.any(String),
      hasIntegrityEvidence: true, hasAnalysis: true
    });
    expect(JSON.stringify(result)).not.toContain('rawData');
    expect(adaptMyCredentials([{ ...listPayload()[0], status: 'revoked' }])[0].statusLabel).toBe('Revocada');
  });

  it('C2c: labels declared hours as official hours', () => {
    const result = adaptMyCredential({
      ...listPayload()[0], description: 'Contenido emitido', hours: 64,
      canonicalHash: null, canonicalizationVersion: null,
      issuer: { name: 'Institución demo', did: null },
      subject: { displayName: 'Titular demo', email: 'holder@example.com', did: null },
      credentialSubject: { achievementName: 'Arquitectura de software', institutionName: 'Institución demo', completionDate: null, academicPeriod: '2026', programName: null, grade: '9', skills: ['Diseño'], competencies: [], learningOutcomes: [] },
      documentEvidence: null, textEvidence: null, blockchainRecords: [], latestSemanticAnalysis: null
    });
    expect(result.hoursLabel).toBe('64 horas');
  });

  it('adapts holder detail without raw artifacts, source ids or storage internals', () => {
    const result = adaptMyCredential({
      ...listPayload()[0], description: 'Contenido emitido', hours: 64,
      canonicalHash: null, canonicalizationVersion: null,
      issuer: { name: 'Institución demo', did: null },
      subject: { displayName: 'Titular demo', email: 'holder@example.com', did: null, id: 'forbidden' },
      credentialSubject: { achievementName: 'Arquitectura de software', institutionName: 'Institución demo', completionDate: null, academicPeriod: '2026', programName: null, grade: '9', skills: ['Diseño'], competencies: ['Análisis'], learningOutcomes: ['Modelar'], raw: 'forbidden' },
      documentEvidence: { originalFileName: 'respaldo.pdf', mimeType: 'application/pdf', sizeBytes: 2048, sha256: 'c'.repeat(64), uploadedAt: '2026-08-01T10:15:00.000Z', storageKey: 'forbidden' },
      textEvidence: { label: 'Programa', preview: 'Vista limitada del respaldo institucional.', characterCount: 42, sha256: 'd'.repeat(64), submittedAt: '2026-08-01T10:20:00.000Z', content: 'forbidden' },
      blockchainRecords: [{ network: 'mock', chainId: 1, txHash, status: 'registered', registeredAt: '2026-08-01T10:05:00.000Z', contractAddress: 'forbidden' }],
      latestSemanticAnalysis: { status: 'partial', confidence: null, areas: ['Software'], skills: ['Diseño'], concepts: ['arquitectura'], qualityFlags: [], analyzedAt: '2026-08-01T10:10:00.000Z', analysisJson: 'forbidden', evidenceMap: 'forbidden' }
    });
    expect(result.integrity.records[0].networkLabel).toBe('Entorno técnico/demo');
    expect(result.analysis?.statusLabel).toBe('Análisis parcial');
    expect(JSON.stringify(result)).not.toContain('forbidden');
    expect(JSON.stringify(result)).not.toContain('analysisJson');
  });

  it('accepts declared course fields (providerName/platformName/modality/level/externalUrl)', () => {
    const result = adaptMyCredential({
      ...listPayload()[0], description: null, hours: null,
      canonicalHash: null, canonicalizationVersion: null,
      issuer: { name: 'Plataforma de Cursos Online Demo', did: null },
      subject: { displayName: 'Titular demo', email: 'holder@example.com', did: null },
      credentialSubject: {
        achievementName: 'Curso de Cloud', institutionName: 'Plataforma de Cursos Online Demo',
        completionDate: null, academicPeriod: null, programName: null, grade: null,
        providerName: 'Instituto Demo', platformName: 'Campus Virtual Demo', modality: 'Online asincrónica',
        level: 'Intermedio', externalUrl: 'https://plataforma-demo.example.com/curso/123',
        skills: ['Cloud'], competencies: [], learningOutcomes: []
      },
      documentEvidence: null, textEvidence: null,
      blockchainRecords: [], latestSemanticAnalysis: null
    });

    expect(result.subject.providerName).toBe('Instituto Demo');
    expect(result.subject.platformName).toBe('Campus Virtual Demo');
    expect(result.subject.modality).toBe('Online asincrónica');
    expect(result.subject.level).toBe('Intermedio');
    expect(result.subject.externalUrl).toBe('https://plataforma-demo.example.com/curso/123');
  });

  it('rejects a course externalUrl that is not http or https', () => {
    expect(() => adaptMyCredential({
      ...listPayload()[0], description: null, hours: null,
      canonicalHash: null, canonicalizationVersion: null,
      issuer: { name: 'Plataforma de Cursos Online Demo', did: null },
      subject: { displayName: 'Titular demo', email: 'holder@example.com', did: null },
      credentialSubject: {
        achievementName: 'Curso de Cloud', institutionName: 'Plataforma de Cursos Online Demo',
        completionDate: null, academicPeriod: null, programName: null, grade: null,
        providerName: null, platformName: null, modality: null, level: null,
        externalUrl: 'javascript:alert(1)',
        skills: [], competencies: [], learningOutcomes: []
      },
      documentEvidence: null, textEvidence: null,
      blockchainRecords: [], latestSemanticAnalysis: null
    })).toThrow(IncompatiblePayloadError);
  });

  it('rejects a credentialSubject payload with non-string declared course fields', () => {
    expect(() => adaptMyCredential({
      ...listPayload()[0], description: null, hours: null,
      canonicalHash: null, canonicalizationVersion: null,
      issuer: { name: 'Plataforma de Cursos Online Demo', did: null },
      subject: { displayName: 'Titular demo', email: 'holder@example.com', did: null },
      credentialSubject: {
        achievementName: 'Curso de Cloud', institutionName: 'Plataforma de Cursos Online Demo',
        completionDate: null, academicPeriod: null, programName: null, grade: null,
        providerName: { forbidden: true }, platformName: null, modality: null, level: null, externalUrl: null,
        skills: [], competencies: [], learningOutcomes: []
      },
      documentEvidence: null, textEvidence: null,
      blockchainRecords: [], latestSemanticAnalysis: null
    })).toThrow(IncompatiblePayloadError);
  });

  it('adapts the current profile through an allowlist and handles no profile', () => {
    expect(adaptMyCurrentProfile({ currentProfile: null })).toBeNull();
    const result = adaptMyCurrentProfile({ currentProfile: {
      profileVersion: 'formative_profile_result_v0',
      credentialsCount: 2, totalHours: 80, generatedAt: '2026-08-01T10:00:00.000Z',
      areas: [{ label: 'Software', estimatedHours: 80, sourceRefs: ['forbidden'] }],
      skills: [{ label: 'Diseño', confidence: 0.8, analysisJson: 'forbidden' }],
      concepts: ['arquitectura'], confidence: 0.8, qualityFlags: ['partial_evidence']
    } });
    expect(result).toMatchObject({ credentialsCount: 2, areas: [{ label: 'Software' }], skills: [{ label: 'Diseño' }], concepts: ['arquitectura'] });
    expect(JSON.stringify(result)).not.toContain('forbidden');
  });

  it('C2c: labels official hours and area estimates unambiguously as an AI estimate', () => {
    const result = adaptMyCurrentProfile({ currentProfile: {
      profileVersion: 'backend_formative_profile_snapshot_v0',
      credentialsCount: 2, totalHours: 80, totalOfficialHours: 80, generatedAt: '2026-08-01T10:00:00.000Z',
      areas: [{ label: 'Software', estimatedHours: 80 }],
      skills: [], concepts: [], confidence: null, qualityFlags: []
    } });
    expect(result?.totalOfficialHoursLabel).toBe('80 horas oficiales declaradas');
    expect(result?.areas[0].estimatedHoursLabel).toBe('80 horas estimadas por IA');
  });

  it('C2c: omits estimatedHoursLabel (never "0h") for an area without estimatedHours', () => {
    const result = adaptMyCurrentProfile({ currentProfile: {
      profileVersion: 'backend_formative_profile_snapshot_v0',
      credentialsCount: 1, totalHours: null, totalOfficialHours: null, generatedAt: '2026-08-01T10:00:00.000Z',
      areas: [{ label: 'Software', estimatedHours: null }],
      skills: [], concepts: [], confidence: null, qualityFlags: []
    } });
    expect(result?.areas[0]).toEqual({ label: 'Software', estimatedHoursLabel: null });
  });

  it('C2c: falls back totalOfficialHours to totalHours when the backend has not deployed it yet', () => {
    const result = adaptMyCurrentProfile({ currentProfile: {
      profileVersion: 'backend_formative_profile_snapshot_v0',
      credentialsCount: 1, totalHours: 64, generatedAt: '2026-08-01T10:00:00.000Z',
      // totalOfficialHours omitted on purpose: simulates a pre-C2c backend deploy.
      areas: [], skills: [], concepts: [], confidence: null, qualityFlags: []
    } });
    expect(result?.totalOfficialHoursLabel).toBe('64 horas oficiales declaradas');
  });

  it('C2c: builds soft coverage notices only when the counters are positive', () => {
    const result = adaptMyCurrentProfile({ currentProfile: {
      profileVersion: 'backend_formative_profile_snapshot_v0',
      credentialsCount: 3, totalHours: 40, totalOfficialHours: 40, generatedAt: '2026-08-01T10:00:00.000Z',
      credentialsWithoutHours: 1, credentialsWithoutSemanticCoverage: 2,
      areas: [], skills: [], concepts: [], confidence: null, qualityFlags: []
    } });
    expect(result?.hoursCoverageNoticeLabel).toBe('1 credencial no informa horas.');
    expect(result?.semanticCoverageNoticeLabel).toBe('2 credenciales todavía no tienen análisis semántico.');
  });

  it('C2c: does not build a coverage notice when a counter is zero or absent', () => {
    const zeroCounters = adaptMyCurrentProfile({ currentProfile: {
      profileVersion: 'backend_formative_profile_snapshot_v0',
      credentialsCount: 1, totalHours: 40, totalOfficialHours: 40, generatedAt: '2026-08-01T10:00:00.000Z',
      credentialsWithoutHours: 0, credentialsWithoutSemanticCoverage: 0,
      areas: [], skills: [], concepts: [], confidence: null, qualityFlags: []
    } });
    expect(zeroCounters).toMatchObject({ hoursCoverageNoticeLabel: null, semanticCoverageNoticeLabel: null });

    const absentCounters = adaptMyCurrentProfile({ currentProfile: {
      profileVersion: 'backend_formative_profile_snapshot_v0',
      credentialsCount: 1, totalHours: 40, generatedAt: '2026-08-01T10:00:00.000Z',
      areas: [], skills: [], concepts: [], confidence: null, qualityFlags: []
    } });
    expect(absentCounters).toMatchObject({ hoursCoverageNoticeLabel: null, semanticCoverageNoticeLabel: null });
  });

  it('C2c: rejects an invalid (negative) coverage counter instead of exposing a fabricated value', () => {
    expect(() => adaptMyCurrentProfile({ currentProfile: {
      profileVersion: 'backend_formative_profile_snapshot_v0',
      credentialsCount: 1, totalHours: 40, credentialsWithoutHours: -1, generatedAt: '2026-08-01T10:00:00.000Z',
      areas: [], skills: [], concepts: [], confidence: null, qualityFlags: []
    } })).toThrow(IncompatiblePayloadError);
  });

  it('accepts emittedSkills/emittedCompetencies/emittedLearningOutcomes and drops forbidden nested fields', () => {
    const result = adaptMyCurrentProfile({ currentProfile: {
      profileVersion: 'backend_formative_profile_snapshot_v0',
      credentialsCount: 1, totalHours: null, generatedAt: '2026-08-08T10:00:00.000Z',
      areas: [], skills: [], concepts: [], confidence: null, qualityFlags: [],
      emittedSkills: ['Excel'],
      emittedCompetencies: ['Trabajo en equipo'],
      emittedLearningOutcomes: ['Redactar informes técnicos']
    } });
    expect(result).toMatchObject({
      emittedSkills: ['Excel'],
      emittedCompetencies: ['Trabajo en equipo'],
      emittedLearningOutcomes: ['Redactar informes técnicos']
    });
  });

  it('treats absent emitted arrays as [] for backend/frontend deploy skew (H1.2 compatibility)', () => {
    const result = adaptMyCurrentProfile({ currentProfile: {
      profileVersion: 'backend_formative_profile_snapshot_v0',
      credentialsCount: 1, totalHours: null, generatedAt: '2026-08-08T10:00:00.000Z',
      areas: [], skills: [], concepts: [], confidence: null, qualityFlags: []
      // emittedSkills/emittedCompetencies/emittedLearningOutcomes omitted on purpose:
      // simulates an old Render API deployed before IA-Q1.
    } });
    expect(result).toMatchObject({ emittedSkills: [], emittedCompetencies: [], emittedLearningOutcomes: [] });
  });

  it('rejects unsafe or incompatible holder payloads', () => {
    expect(() => adaptMyCredentials([{ ...listPayload()[0], status: 'draft' }])).toThrow(IncompatiblePayloadError);
    expect(() => adaptMyCredential({ id: 'missing-fields' })).toThrow(IncompatiblePayloadError);
    expect(() => adaptMyCurrentProfile({ currentProfile: {
      profileVersion: 'formative_profile_result_v0', credentialsCount: 1, totalHours: null,
      areas: [], skills: [], concepts: [], confidence: 1.2, qualityFlags: [], generatedAt: '2026-08-01T10:00:00.000Z'
    } })).toThrow(IncompatiblePayloadError);
  });

  it('rejects emitted arrays that are present but not safe string arrays', () => {
    const base = {
      profileVersion: 'backend_formative_profile_snapshot_v0',
      credentialsCount: 1, totalHours: null, generatedAt: '2026-08-08T10:00:00.000Z',
      areas: [], skills: [], concepts: [], confidence: null, qualityFlags: []
    };
    expect(() => adaptMyCurrentProfile({ currentProfile: { ...base, emittedSkills: [{ label: 'Excel', credentialIds: ['forbidden'] }] } }))
      .toThrow(IncompatiblePayloadError);
    expect(() => adaptMyCurrentProfile({ currentProfile: { ...base, emittedCompetencies: [42] } }))
      .toThrow(IncompatiblePayloadError);
    expect(() => adaptMyCurrentProfile({ currentProfile: { ...base, emittedLearningOutcomes: [null] } }))
      .toThrow(IncompatiblePayloadError);
    expect(() => adaptMyCurrentProfile({ currentProfile: { ...base, emittedSkills: 'not-an-array' } }))
      .toThrow(IncompatiblePayloadError);
  });
});

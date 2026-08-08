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
      credentialReference: 'credential-internal-reference', title: 'Arquitectura de software', typeLabel: 'Curso',
      status: 'issued', statusLabel: 'Emitida', issuerName: 'Institución demo', issuedAtLabel: expect.any(String),
      hasIntegrityEvidence: true, hasAnalysis: true
    });
    expect(JSON.stringify(result)).not.toContain('rawData');
    expect(adaptMyCredentials([{ ...listPayload()[0], status: 'revoked' }])[0].statusLabel).toBe('Revocada');
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

  it('rejects unsafe or incompatible holder payloads', () => {
    expect(() => adaptMyCredentials([{ ...listPayload()[0], status: 'draft' }])).toThrow(IncompatiblePayloadError);
    expect(() => adaptMyCredential({ id: 'missing-fields' })).toThrow(IncompatiblePayloadError);
    expect(() => adaptMyCurrentProfile({ currentProfile: {
      profileVersion: 'formative_profile_result_v0', credentialsCount: 1, totalHours: null,
      areas: [], skills: [], concepts: [], confidence: 1.2, qualityFlags: [], generatedAt: '2026-08-01T10:00:00.000Z'
    } })).toThrow(IncompatiblePayloadError);
  });
});

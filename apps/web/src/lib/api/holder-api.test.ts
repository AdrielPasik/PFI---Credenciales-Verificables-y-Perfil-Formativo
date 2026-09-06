import { expect, it, vi } from 'vitest';

import {
  getMyCredentialRequest,
  getMyCredentialsRequest,
  getMyCurrentProfileRequest,
  rebuildMyProfileRequest
} from '@/lib/api/holder-api';
import { ApiError, IncompatiblePayloadError } from '@/lib/errors/api-error';

it('uses only /me scoped holder endpoints', async () => {
  const request = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce({ currentProfile: null });
  await getMyCredentialsRequest(request);
  await getMyCurrentProfileRequest(request);
  expect(request).toHaveBeenNthCalledWith(1, '/me/credentials');
  expect(request).toHaveBeenNthCalledWith(2, '/me/profile/current');
});

// P1.1
it('rebuildMyProfileRequest POSTs to /me/profile/rebuild and adapts the same shape as current profile', async () => {
  const request = vi.fn().mockResolvedValue({ currentProfile: null });
  await rebuildMyProfileRequest(request);
  expect(request).toHaveBeenCalledWith('/me/profile/rebuild', { method: 'POST' });
});

it('adapts an HTTP 200 rebuild response with proven profile domain descriptors', async () => {
  const request = vi.fn().mockResolvedValue({
    currentProfile: {
      profileVersion: 'formative_profile_v1',
      credentialsCount: 2,
      totalHours: 36,
      areasSummary: [{ area: 'Datos', estimatedHours: 20, credentialIds: ['internal'] }],
      skillsSummary: [{ skill: 'Python', confidence: 0.84, semanticAnalysisIds: ['internal'] }],
      profileJson: {
        concepts: [{ concept: 'Normalización', credentialIds: ['internal'] }],
        emittedSkills: [{ label: 'Excel', credentialIds: ['internal'] }],
        emittedCompetencies: [{ label: 'Análisis de información', credentialIds: ['internal'] }],
        emittedLearningOutcomes: [{ label: 'Interpretar resultados', credentialIds: ['internal'] }],
        confidence: { score: 0.8 }
      },
      qualityFlags: [],
      generatedAt: '2026-08-14T10:00:00.000Z'
    }
  });

  const result = await rebuildMyProfileRequest(request);

  expect(request).toHaveBeenCalledWith('/me/profile/rebuild', { method: 'POST' });
  expect(result).toMatchObject({
    areas: [{ label: 'Datos' }],
    skills: [{ label: 'Python' }],
    concepts: ['Normalización'],
    emittedSkills: ['Excel']
  });
  expect(JSON.stringify(result)).not.toContain('internal');
});

it('preserves an API failure from GET current without misclassifying it as a contract error', async () => {
  const apiError = new ApiError('No pudimos completar la consulta.', 'http', 503);
  const request = vi.fn().mockRejectedValue(apiError);

  await expect(getMyCurrentProfileRequest(request)).rejects.toBe(apiError);
});

it('classifies an HTTP 200 malformed current profile as an adapter failure with a safe path', async () => {
  const request = vi.fn().mockResolvedValue({
    currentProfile: {
      profileVersion: 'formative_profile_v1', credentialsCount: 1, totalHours: 12,
      areas: [{ unexpected: 'not-a-label' }], skills: [], concepts: [],
      confidence: null, qualityFlags: [], generatedAt: '2026-08-14T10:00:00.000Z'
    }
  });

  await expect(getMyCurrentProfileRequest(request)).rejects.toMatchObject({
    name: 'IncompatiblePayloadError',
    diagnostic: {
      path: 'profile.currentProfile.areas[0]',
      expected: 'object with one of: area, name, label, area_label, areaLabel',
      actualCategory: 'object'
    }
  } satisfies Partial<IncompatiblePayloadError>);
});

it('loads one holder credential from the /me scoped route', async () => {
  const request = vi.fn().mockResolvedValue({
    id: 'credential-reference', title: 'Curso', type: 'course', status: 'issued', description: null, hours: null,
    issuer: { name: 'Institución', did: null }, subject: { displayName: null, email: null, did: null }, issuedAt: null, revokedAt: null, revocationReason: null,
    canonicalHash: null, canonicalizationVersion: null, credentialSubject: { achievementName: null, institutionName: null, completionDate: null, academicPeriod: null, programName: null, grade: null, skills: [], competencies: [], learningOutcomes: [] }, documentEvidence: null, textEvidence: null, blockchainRecords: [], latestSemanticAnalysis: null
  });
  await getMyCredentialRequest(request, ' credential/reference ');
  expect(request).toHaveBeenCalledWith('/me/credentials/credential%2Freference');
});

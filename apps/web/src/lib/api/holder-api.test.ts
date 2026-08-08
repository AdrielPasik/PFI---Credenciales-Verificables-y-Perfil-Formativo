import { expect, it, vi } from 'vitest';

import { getMyCredentialRequest, getMyCredentialsRequest, getMyCurrentProfileRequest } from '@/lib/api/holder-api';

it('uses only /me scoped holder endpoints', async () => {
  const request = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce({ currentProfile: null });
  await getMyCredentialsRequest(request);
  await getMyCurrentProfileRequest(request);
  expect(request).toHaveBeenNthCalledWith(1, '/me/credentials');
  expect(request).toHaveBeenNthCalledWith(2, '/me/profile/current');
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

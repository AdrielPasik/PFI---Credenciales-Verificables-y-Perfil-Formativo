import assert from 'node:assert/strict';
import test from 'node:test';

import { mapHolderCurrentProfileResponse } from './holder-current-profile.mapper';

test('maps a current profile through a holder-safe allowlist', () => {
  const response = mapHolderCurrentProfileResponse({
    userId: 'must-not-leak',
    currentProfile: {
      id: 'must-not-leak', profileVersion: 'formative_profile_result_v0', isCurrent: true,
      credentialsCount: 2, totalHours: 80, generatedAt: '2026-08-01T10:00:00Z',
      areasSummary: [{ area: 'Software', estimatedHours: 80, sourceRefs: ['must-not-leak'] }],
      skillsSummary: [{ skill: 'Diseño', confidence: 0.8, analysisJson: { mustNotLeak: true } }],
      qualityFlags: ['partial_evidence'],
      profileJson: { concepts: [{ concept: 'arquitectura', sourceRefs: ['must-not-leak'] }], confidence: { score: 0.8 }, evidenceMap: { mustNotLeak: true } }
    }
  });

  assert.deepEqual(response, {
    currentProfile: {
      profileVersion: 'formative_profile_result_v0', credentialsCount: 2, totalHours: 80,
      areas: [{ label: 'Software', estimatedHours: 80 }], skills: [{ label: 'Diseño', confidence: 0.8 }],
      concepts: ['arquitectura'], confidence: 0.8, qualityFlags: ['partial_evidence'], generatedAt: '2026-08-01T10:00:00Z'
    }
  });
  assert.equal(JSON.stringify(response).includes('must-not-leak'), false);
});

test('maps an absent profile to a safe null response', () => {
  assert.deepEqual(mapHolderCurrentProfileResponse({ userId: 'holder', currentProfile: null }), { currentProfile: null });
});

test('normalizes invalid confidence values to null instead of exposing them', () => {
  const response = mapHolderCurrentProfileResponse({
    userId: 'holder',
    currentProfile: {
      id: 'profile-id', profileVersion: 'formative_profile_result_v0', isCurrent: true,
      credentialsCount: 1, totalHours: null,
      generatedAt: '2026-08-01T10:00:00Z', areasSummary: [],
      skillsSummary: [{ skill: 'Diseño', confidence: 1.4 }], qualityFlags: [],
      profileJson: { concepts: [], confidence: { score: -0.1 } }
    }
  });

  assert.equal(response.currentProfile?.confidence, null);
  assert.equal(response.currentProfile?.skills[0]?.confidence, null);
});

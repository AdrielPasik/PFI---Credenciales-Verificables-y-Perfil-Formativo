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
      profileJson: {
        narrative: 'Según las credenciales emitidas y los análisis disponibles, la trayectoria muestra formación en Software.',
        summary: { totalOfficialHours: 80, credentialsWithoutHours: 0, credentialsWithoutSemanticCoverage: 1 },
        concepts: [{ concept: 'arquitectura', sourceRefs: ['must-not-leak'] }], confidence: { score: 0.8 }, evidenceMap: { mustNotLeak: true }
      }
    }
  });

  assert.deepEqual(response, {
    currentProfile: {
      profileVersion: 'formative_profile_result_v0', credentialsCount: 2, totalHours: 80,
      totalOfficialHours: 80, credentialsWithoutHours: 0, credentialsWithoutSemanticCoverage: 1,
      narrative: 'Según las credenciales emitidas y los análisis disponibles, la trayectoria muestra formación en Software.',
      areas: [{ label: 'Software', estimatedHours: 80 }], skills: [{ label: 'Diseño', confidence: 0.8 }],
      concepts: ['arquitectura'], emittedSkills: [], emittedCompetencies: [], emittedLearningOutcomes: [],
      confidence: 0.8, qualityFlags: ['partial_evidence'], generatedAt: '2026-08-01T10:00:00Z'
    }
  });
  assert.equal(JSON.stringify(response).includes('must-not-leak'), false);
});

test('C2c: falls back to totalHours and null counters for profiles persisted before C2c (no profileJson.summary fields)', () => {
  const response = mapHolderCurrentProfileResponse({
    userId: 'holder',
    currentProfile: {
      id: 'profile-id', profileVersion: 'backend_formative_profile_snapshot_v0', isCurrent: true,
      credentialsCount: 1, totalHours: 64, generatedAt: '2026-07-24T12:00:00.000Z',
      areasSummary: [], skillsSummary: [], qualityFlags: [],
      // Perfil pre-C2c: sin summary.totalOfficialHours ni contadores.
      profileJson: { concepts: [], confidence: { score: null } }
    }
  });

  assert.equal(response.currentProfile?.totalOfficialHours, 64);
  assert.equal(response.currentProfile?.credentialsWithoutHours, null);
  assert.equal(response.currentProfile?.credentialsWithoutSemanticCoverage, null);
});

test('C2c: exposes zero-valued coverage counters without collapsing them to null', () => {
  const response = mapHolderCurrentProfileResponse({
    userId: 'holder',
    currentProfile: {
      id: 'profile-id', profileVersion: 'backend_formative_profile_snapshot_v0', isCurrent: true,
      credentialsCount: 2, totalHours: 40, generatedAt: '2026-08-10T12:00:00.000Z',
      areasSummary: [], skillsSummary: [], qualityFlags: [],
      profileJson: {
        summary: { totalOfficialHours: 40, credentialsWithoutHours: 0, credentialsWithoutSemanticCoverage: 0 },
        concepts: [], confidence: { score: null }
      }
    }
  });

  assert.equal(response.currentProfile?.credentialsWithoutHours, 0);
  assert.equal(response.currentProfile?.credentialsWithoutSemanticCoverage, 0);
});

test('C2c: rejects an invalid (negative/non-integer) counter instead of exposing a fabricated value', () => {
  const response = mapHolderCurrentProfileResponse({
    userId: 'holder',
    currentProfile: {
      id: 'profile-id', profileVersion: 'backend_formative_profile_snapshot_v0', isCurrent: true,
      credentialsCount: 1, totalHours: null, generatedAt: '2026-08-10T12:00:00.000Z',
      areasSummary: [], skillsSummary: [], qualityFlags: [],
      profileJson: {
        summary: { credentialsWithoutHours: -1, credentialsWithoutSemanticCoverage: 1.5 },
        concepts: [], confidence: { score: null }
      }
    }
  });

  assert.equal(response.currentProfile?.credentialsWithoutHours, null);
  assert.equal(response.currentProfile?.credentialsWithoutSemanticCoverage, null);
});

test('maps emitted skills/competencies/learning outcomes to holder-safe labels without leaking credentialIds', () => {
  const response = mapHolderCurrentProfileResponse({
    userId: 'must-not-leak',
    currentProfile: {
      id: 'must-not-leak', profileVersion: 'backend_formative_profile_snapshot_v0', isCurrent: true,
      credentialsCount: 1, totalHours: null, generatedAt: '2026-08-08T10:00:00Z',
      areasSummary: [], skillsSummary: [], qualityFlags: ['no_emitted_skills_available'],
      profileJson: {
        concepts: [],
        confidence: { score: null },
        emittedSkills: [{ label: 'Excel', credentialIds: ['must-not-leak'], evidenceCount: 1 }],
        emittedCompetencies: [{ label: 'Trabajo en equipo', credentialIds: ['must-not-leak'], evidenceCount: 1 }],
        emittedLearningOutcomes: [{ label: 'Redactar informes', credentialIds: ['must-not-leak'], evidenceCount: 1 }]
      }
    }
  });

  assert.deepEqual(response.currentProfile?.emittedSkills, ['Excel']);
  assert.deepEqual(response.currentProfile?.emittedCompetencies, ['Trabajo en equipo']);
  assert.deepEqual(response.currentProfile?.emittedLearningOutcomes, ['Redactar informes']);
  assert.equal(JSON.stringify(response).includes('must-not-leak'), false);
});

test('maps a bounded narrative through the holder-safe allowlist', () => {
  const response = mapHolderCurrentProfileResponse({
    userId: 'holder',
    currentProfile: {
      id: 'profile-id', profileVersion: 'backend_formative_profile_snapshot_v0', isCurrent: true,
      credentialsCount: 1, totalHours: null, generatedAt: '2026-08-12T10:00:00.000Z',
      areasSummary: [], skillsSummary: [], qualityFlags: [],
      profileJson: { narrative: '  La trayectoria muestra formación en gestión de proyectos.  ', summary: {}, concepts: [], confidence: { score: null } }
    }
  });

  assert.equal(response.currentProfile?.narrative, 'La trayectoria muestra formación en gestión de proyectos.');
});

test('builds a prudent read-only narrative fallback for a legacy profile without one', () => {
  const response = mapHolderCurrentProfileResponse({
    userId: 'holder',
    currentProfile: {
      id: 'profile-id', profileVersion: 'legacy', isCurrent: true,
      credentialsCount: 1, totalHours: 16, generatedAt: '2026-08-12T10:00:00.000Z',
      areasSummary: [{ area: 'Gestión de proyectos', estimatedHours: 16 }],
      skillsSummary: [{ skill: 'Scrum', confidence: 0.7 }], qualityFlags: [],
      profileJson: { concepts: ['Kanban'], summary: {}, confidence: { score: null } }
    }
  });

  assert.match(response.currentProfile?.narrative ?? '', /trayectoria formativa muestra credenciales/i);
  assert.match(response.currentProfile?.narrative ?? '', /Scrum/);
  assert.doesNotMatch(response.currentProfile?.narrative ?? '', /domina|experto|certifica|garantiza/i);
});

test('does not fabricate a narrative when a legacy profile has no useful information', () => {
  const response = mapHolderCurrentProfileResponse({
    userId: 'holder',
    currentProfile: {
      id: 'profile-id', profileVersion: 'legacy', isCurrent: true,
      credentialsCount: 0, totalHours: null, generatedAt: '2026-08-12T10:00:00.000Z',
      areasSummary: [], skillsSummary: [], qualityFlags: [],
      profileJson: { concepts: [], summary: {}, confidence: { score: null } }
    }
  });

  assert.equal(response.currentProfile?.narrative, null);
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

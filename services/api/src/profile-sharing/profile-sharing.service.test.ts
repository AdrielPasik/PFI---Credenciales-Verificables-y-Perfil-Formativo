import assert from 'node:assert/strict';
import test from 'node:test';

import { ProfileSharingService } from './profile-sharing.service';

const currentProfile = {
  id: 'profile-1',
  profileVersion: 'formative_profile_v1',
  isCurrent: true,
  credentialsCount: 1,
  totalHours: 12,
  areasSummary: [{ label: 'Gestión de proyectos', estimatedHours: 12 }],
  skillsSummary: [{ label: 'Scrum', confidence: 0.8 }],
  qualityFlags: [],
  generatedAt: '2026-08-14T00:00:00Z',
  profileJson: { concepts: ['Kanban'] }
};

test('profile sharing stores only a hash for a newly generated opaque token', async () => {
  let created: Record<string, unknown> = {};
  const service = new ProfileSharingService(
    { sharingGrant: { create: async ({ data }: { data: Record<string, unknown> }) => { created = data; } } } as never,
    { getCurrentForUser: async () => ({ userId: 'holder-1', currentProfile }) } as never
  );

  const response = await service.createForUser('holder-1');
  const token = response.sharePath.split('/').at(-1)!;

  assert.match(response.sharePath, /^\/share\/profile\/[A-Za-z0-9_-]{32,200}$/);
  assert.equal(created.profileId, 'profile-1');
  assert.equal(created.tokenHash === token, false);
  assert.match(created.tokenHash as string, /^[a-f0-9]{64}$/);
  assert.equal(created.scope, 'profile');
});

test('public profile sharing is allowlisted, bounded and excludes email and raw profile artifacts', async () => {
  const token = 'a'.repeat(43);
  const service = new ProfileSharingService(
    {
      sharingGrant: {
        findUnique: async () => ({
          scope: 'profile', expiresAt: null, revokedAt: null, userId: 'holder-1',
          user: { displayName: 'Holder Demo', firstName: null, lastName: null },
          profile: { ...currentProfile, userId: 'holder-1', totalHours: { toString: () => '12' }, generatedAt: new Date(currentProfile.generatedAt) }
        })
      },
      credential: {
        findMany: async () => [{ id: 'credential-1', title: 'Curso ágil', type: 'course', issuedAt: new Date(currentProfile.generatedAt), issuer: { name: 'Institución Demo' } }]
      }
    } as never,
    {} as never
  );

  const response = await service.getPublicProfile(token);
  const serialized = JSON.stringify(response);

  assert.equal(response.holder.displayLabel, 'Holder Demo');
  assert.equal(response.profile.areas.length, 1);
  assert.equal(response.credentials[0]?.credentialReference, 'credential-1');
  assert.equal(serialized.includes('email'), false);
  assert.equal(serialized.includes('profileJson'), false);
  assert.equal(serialized.includes('analysisJson'), false);
  assert.equal(serialized.includes('sourceRefs'), false);
});

// C5b.2: regresion critica (seccion 13/19 del diseno). El perfil interno
// puede traer provenanceSummary/sources por area/skill (C5b.1) -- el
// remapeo publico (allowlist explicita, ver profile-sharing.service.ts)
// nunca debe propagarlos, incluso si el holder mapper los agrega. Corre el
// pipeline REAL (mapHolderCurrentProfileResponse incluido), no un mock del
// mapper, para que este test detecte una regresion futura de verdad.
test('C5b.2: public profile never leaks provenanceSummary, sources or internal interpretation ids', async () => {
  const token = 'b'.repeat(43);
  const profileWithProvenance = {
    ...currentProfile,
    areasSummary: [
      {
        area: 'Gestión de proyectos',
        estimatedHours: 12,
        sources: [
          { credentialId: 'credential-must-not-leak', provenance: 'issuer_reviewed', reusableInterpretationId: 'rsi-must-not-leak' },
          { credentialId: 'credential-2-must-not-leak', provenance: 'ai_inferred', semanticAnalysisId: 'sa-must-not-leak' }
        ],
        provenanceSummary: { issuerReviewedCount: 1, aiInferredCount: 1 }
      }
    ],
    skillsSummary: [
      {
        skill: 'Scrum',
        confidence: 0.8,
        sources: [{ credentialId: 'credential-must-not-leak', provenance: 'issuer_reviewed', reusableInterpretationId: 'rsi-must-not-leak' }],
        provenanceSummary: { issuerReviewedCount: 1, aiInferredCount: 0 }
      }
    ]
  };
  const service = new ProfileSharingService(
    {
      sharingGrant: {
        findUnique: async () => ({
          scope: 'profile', expiresAt: null, revokedAt: null, userId: 'holder-1',
          user: { displayName: 'Holder Demo', firstName: null, lastName: null },
          profile: { ...profileWithProvenance, userId: 'holder-1', totalHours: { toString: () => '12' }, generatedAt: new Date(currentProfile.generatedAt) }
        })
      },
      credential: { findMany: async () => [] }
    } as never,
    {} as never
  );

  const response = await service.getPublicProfile(token);
  const serialized = JSON.stringify(response);

  assert.deepEqual(response.profile.areas, [{ label: 'Gestión de proyectos', estimatedHours: 12 }]);
  assert.deepEqual(response.profile.skills, [{ label: 'Scrum', confidence: 0.8 }]);
  for (const forbidden of [
    'provenanceSummary', 'issuerReviewedCount', 'aiInferredCount', 'sources',
    'reusableInterpretationId', 'semanticAnalysisId', 'credential-must-not-leak',
    'credential-2-must-not-leak', 'rsi-must-not-leak', 'sa-must-not-leak', 'issuer_reviewed', 'ai_inferred'
  ]) {
    assert.equal(serialized.includes(forbidden), false, `public response must not contain "${forbidden}"`);
  }
});

test('revoked, expired or malformed profile share tokens return the same safe not-found error', async () => {
  const service = new ProfileSharingService(
    { sharingGrant: { findUnique: async () => ({ scope: 'profile', expiresAt: null, revokedAt: new Date(), user: null, profile: null }) } } as never,
    {} as never
  );

  await assert.rejects(() => service.getPublicProfile('a'.repeat(43)), /No encontramos un perfil compartido disponible/);
  await assert.rejects(() => service.getPublicProfile('invalid'), /No encontramos un perfil compartido disponible/);
});

test('a grant cannot expose a profile belonging to another holder', async () => {
  const service = new ProfileSharingService(
    {
      sharingGrant: {
        findUnique: async () => ({
          scope: 'profile', expiresAt: null, revokedAt: null, userId: 'holder-1',
          user: { displayName: 'Holder', firstName: null, lastName: null },
          profile: { ...currentProfile, userId: 'holder-2', totalHours: { toString: () => '12' }, generatedAt: new Date(currentProfile.generatedAt) }
        })
      }
    } as never,
    {} as never
  );

  await assert.rejects(() => service.getPublicProfile('a'.repeat(43)), /No encontramos un perfil compartido disponible/);
});

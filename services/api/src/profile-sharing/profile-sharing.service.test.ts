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

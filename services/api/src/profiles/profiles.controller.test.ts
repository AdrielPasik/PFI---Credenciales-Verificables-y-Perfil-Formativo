import assert from 'node:assert/strict';
import test from 'node:test';

import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserStatus } from '@prisma/client';

import { AuthGuard } from '../auth/auth.guard';
import { ProfilesController } from './profiles.controller';

const currentUser = {
  id: 'holder-1',
  email: 'holder.demo@example.com',
  did: 'did:example:holder-demo',
  status: UserStatus.active
};

test('ProfilesController protects profile endpoints with AuthGuard', () => {
  const guards = Reflect.getMetadata(
    GUARDS_METADATA,
    ProfilesController
  ) as unknown[];

  assert.deepEqual(guards, [AuthGuard]);
});

test('ProfilesController reads current profile using current user id', async () => {
  const calls: string[] = [];
  const expectedResponse = {
    userId: 'holder-1',
    currentProfile: null
  };
  const controller = new ProfilesController({
    async getCurrentForUser(userId: string) {
      calls.push(userId);
      return expectedResponse;
    },
    async rebuildForUser() {
      throw new Error('should not be called');
    }
  } as never);

  const response = await controller.getCurrentProfile(currentUser);

  assert.deepEqual(calls, ['holder-1']);
  assert.deepEqual(response, expectedResponse);
});

test('ProfilesController rebuilds profile using current user id', async () => {
  const calls: string[] = [];
  const expectedResponse = {
    userId: 'holder-1',
    currentProfile: {
      id: 'profile-1',
      profileVersion: 'backend_formative_profile_snapshot_v0',
      isCurrent: true,
      credentialsCount: 1,
      totalHours: 64,
      areasSummary: [],
      skillsSummary: [],
      qualityFlags: [],
      generatedAt: '2026-07-24T12:00:00.000Z',
      profileJson: {}
    }
  };
  const controller = new ProfilesController({
    async getCurrentForUser() {
      throw new Error('should not be called');
    },
    async rebuildForUser(userId: string) {
      calls.push(userId);
      return expectedResponse;
    }
  } as never);

  const response = await controller.rebuildProfile(currentUser);

  assert.deepEqual(calls, ['holder-1']);
  assert.deepEqual(response, expectedResponse);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserStatus } from '@prisma/client';

import { AuthGuard } from '../auth/auth.guard';
import {
  MyProfileSharingController,
  PublicProfileSharingController
} from './profile-sharing.controller';

const currentUser = { id: 'holder-1', email: 'holder@example.com', did: null, status: UserStatus.active };

test('profile sharing creation requires auth while public token reading has no auth guard', async () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, MyProfileSharingController), [AuthGuard]);
  assert.equal(Reflect.getMetadata(GUARDS_METADATA, PublicProfileSharingController), undefined);
  const calls: string[] = [];
  const own = new MyProfileSharingController({ createForUser: async (userId: string) => { calls.push(userId); return { sharePath: '/share/profile/token', expiresAt: null }; } } as never);
  const publicController = new PublicProfileSharingController({ getPublicProfile: async (token: string) => ({ token }) } as never);

  assert.deepEqual(await own.createProfileShare(currentUser), { sharePath: '/share/profile/token', expiresAt: null });
  assert.deepEqual(calls, ['holder-1']);
  assert.deepEqual(await publicController.getSharedProfile('opaque-token'), { token: 'opaque-token' });
});

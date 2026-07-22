import assert from 'node:assert/strict';
import test from 'node:test';

import { UserStatus } from '@prisma/client';

import { AuthController } from './auth.controller';

test('AuthController delegates login to the service', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const expectedResponse = {
    accessToken: 'signed-token',
    user: {
      id: 'user-123',
      email: 'issuer.admin@example.com',
      did: 'did:example:issuer-admin-demo',
      status: UserStatus.active
    }
  };

  const controller = new AuthController({
    async login(dto: Record<string, unknown>) {
      calls.push(dto);
      return expectedResponse;
    },
    async getCurrentUserProfile() {
      throw new Error('should not be called');
    }
  } as never);

  const response = await controller.login({
    email: 'issuer.admin@example.com',
    password: 'DemoIssuer123!'
  });

  assert.deepEqual(calls, [
    {
      email: 'issuer.admin@example.com',
      password: 'DemoIssuer123!'
    }
  ]);
  assert.deepEqual(response, expectedResponse);
});

test('AuthController delegates /auth/me lookup using current user id', async () => {
  const calls: string[] = [];
  const expectedResponse = {
    id: 'user-123',
    email: 'issuer.admin@example.com',
    did: 'did:example:issuer-admin-demo',
    status: UserStatus.active,
    issuerMemberships: [
      {
        issuerId: 'issuer-1',
        role: 'admin',
        status: 'active'
      }
    ]
  };

  const controller = new AuthController({
    async login() {
      throw new Error('should not be called');
    },
    async getCurrentUserProfile(userId: string) {
      calls.push(userId);
      return expectedResponse;
    }
  } as never);

  const response = await controller.getCurrentUser({
    id: 'user-123',
    email: 'issuer.admin@example.com',
    did: 'did:example:issuer-admin-demo',
    status: UserStatus.active
  });

  assert.deepEqual(calls, ['user-123']);
  assert.deepEqual(response, expectedResponse);
});

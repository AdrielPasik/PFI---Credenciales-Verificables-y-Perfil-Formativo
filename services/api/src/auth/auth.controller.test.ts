import assert from 'node:assert/strict';
import test from 'node:test';

import { HttpStatus } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { UserStatus } from '@prisma/client';

import { AuthController } from './auth.controller';

test('AuthController login responds with explicit HTTP 200 OK', () => {
  const statusCode = Reflect.getMetadata(
    HTTP_CODE_METADATA,
    AuthController.prototype.login
  );

  assert.equal(statusCode, HttpStatus.OK);
});

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
        issuerName: 'Demo University',
        issuerDid: 'did:example:issuer-demo',
        issuerAuthorizationStatus: 'authorized',
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

test('AuthController register responds with explicit HTTP 201 Created', () => {
  const statusCode = Reflect.getMetadata(
    HTTP_CODE_METADATA,
    AuthController.prototype.register
  );

  assert.equal(statusCode, HttpStatus.CREATED);
});

// A1/seccion 17 del diseno: POST /auth/register debe ser publico -- nunca
// @UseGuards(AuthGuard). login() tampoco lo lleva (sirve de referencia:
// ambos deben quedar sin metadata de guards).
test('AuthController register and login are both public (no AuthGuard metadata)', () => {
  assert.equal(
    Reflect.getMetadata(GUARDS_METADATA, AuthController.prototype.register),
    undefined
  );
  assert.equal(
    Reflect.getMetadata(GUARDS_METADATA, AuthController.prototype.login),
    undefined
  );
});

test('AuthController delegates register to the service', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const expectedResponse = {
    accessToken: 'signed-token',
    user: {
      id: 'holder-1',
      email: 'nueva.persona@example.com',
      did: null,
      status: UserStatus.active,
      displayLabel: 'Ada Lovelace'
    }
  };

  const controller = new AuthController({
    async login() {
      throw new Error('should not be called');
    },
    async getCurrentUserProfile() {
      throw new Error('should not be called');
    },
    async register(dto: Record<string, unknown>) {
      calls.push(dto);
      return expectedResponse;
    }
  } as never);

  const response = await controller.register({
    email: 'nueva.persona@example.com',
    password: 'CorrectHorse123',
    firstName: 'Ada',
    lastName: 'Lovelace'
  });

  assert.deepEqual(calls, [
    {
      email: 'nueva.persona@example.com',
      password: 'CorrectHorse123',
      firstName: 'Ada',
      lastName: 'Lovelace'
    }
  ]);
  assert.deepEqual(response, expectedResponse);
});

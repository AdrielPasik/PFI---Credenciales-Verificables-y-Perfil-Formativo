import assert from 'node:assert/strict';
import test from 'node:test';

import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserStatus } from '@prisma/client';

import { AuthGuard } from '../auth/auth.guard';
import { MeController } from './me.controller';

test('MeController protects /me endpoints with AuthGuard', () => {
  const guards = Reflect.getMetadata(
    GUARDS_METADATA,
    MeController
  ) as unknown[];

  assert.deepEqual(guards, [AuthGuard]);
});

test('MeController delegates listCredentials using current user id', async () => {
  const calls: string[] = [];
  const expectedResponse = [
    {
      id: 'cred-1',
      title: 'Materia demo',
      type: 'academic_subject',
      status: 'issued',
      issuer: {
        id: 'issuer-1',
        name: 'Demo University',
        did: 'did:example:issuer-demo'
      },
      issuedAt: '2026-07-22T19:00:00Z',
      revokedAt: null,
      canonicalHash: '0x' + '1'.repeat(64),
      canonicalizationVersion: 'canon_v1',
      latestBlockchainRecord: null,
      latestSemanticAnalysis: null
    }
  ];

  const controller = new MeController({
    async listCredentialsForUser(userId: string) {
      calls.push(userId);
      return expectedResponse;
    },
    async getCredentialForUser() {
      throw new Error('should not be called');
    }
  } as never);

  const response = await controller.listCredentials({
    id: 'holder-1',
    email: 'holder.demo@example.com',
    did: 'did:example:holder-demo',
    status: UserStatus.active
  });

  assert.deepEqual(calls, ['holder-1']);
  assert.deepEqual(response, expectedResponse);
});

test('MeController delegates getCredential using current user id', async () => {
  const calls: Array<{ userId: string; credentialId: string }> = [];
  const expectedResponse = {
    id: 'cred-1',
    schemaVersion: 'credential_v1',
    type: 'academic_subject',
    title: 'Materia demo',
    description: null,
    status: 'issued',
    issuer: {
      id: 'issuer-1',
      name: 'Demo University',
      did: 'did:example:issuer-demo'
    },
    subject: {
      id: 'holder-1',
      did: 'did:example:holder-demo',
      email: 'holder.demo@example.com',
      displayName: 'Demo Holder'
    },
    issuedAt: '2026-07-22T19:00:00Z',
    revokedAt: null,
    revocationReason: null,
    canonicalHash: '0x' + '1'.repeat(64),
    canonicalizationVersion: 'canon_v1',
    credentialSubject: {},
    metadata: null,
    blockchainRecords: [],
    latestSemanticAnalysis: null
  };

  const controller = new MeController({
    async listCredentialsForUser() {
      throw new Error('should not be called');
    },
    async getCredentialForUser(userId: string, credentialId: string) {
      calls.push({ userId, credentialId });
      return expectedResponse;
    }
  } as never);

  const response = await controller.getCredential(
    {
      id: 'holder-1',
      email: 'holder.demo@example.com',
      did: 'did:example:holder-demo',
      status: UserStatus.active
    },
    'cred-1'
  );

  assert.deepEqual(calls, [{ userId: 'holder-1', credentialId: 'cred-1' }]);
  assert.deepEqual(response, expectedResponse);
});

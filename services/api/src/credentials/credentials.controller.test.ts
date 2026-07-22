import assert from 'node:assert/strict';
import test from 'node:test';

import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserStatus } from '@prisma/client';

import { AuthGuard } from '../auth/auth.guard';
import { CredentialsController } from './credentials.controller';

test('CredentialsController protects issueCredential with AuthGuard', () => {
  const guards = Reflect.getMetadata(
    GUARDS_METADATA,
    CredentialsController.prototype.issueCredential
  ) as unknown[];

  assert.deepEqual(guards, [AuthGuard]);
});

test('CredentialsController delegates issueCredential with current user to the service', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const expectedResponse = {
    id: 'cred-123',
    schemaVersion: 'credential_v1',
    issuerId: 'issuer-1',
    subjectUserId: 'holder-1',
    type: 'academic_subject',
    title: 'Materia demo',
    sourceType: 'manual_issuer',
    status: 'issued'
  };

  const controller = new CredentialsController({
    async createDraft() {
      throw new Error('should not be called');
    },
    async issueCredential(
      credentialId: string,
      dto: Record<string, unknown>,
      currentUser: Record<string, unknown>
    ) {
      calls.push({ credentialId, dto, currentUser });
      return expectedResponse;
    },
    async getCredential() {
      throw new Error('should not be called');
    },
    async getCredentialStatus() {
      throw new Error('should not be called');
    }
  } as never);

  const response = await controller.issueCredential(
    'cred-123',
    {
      issuerId: 'issuer-1',
      issuedAt: '2026-07-22T18:00:00Z'
    },
    {
      id: 'issuer-user-1',
      email: 'issuer.admin@example.com',
      did: 'did:example:issuer-admin-demo',
      status: UserStatus.active
    }
  );

  assert.deepEqual(calls, [
    {
      credentialId: 'cred-123',
      dto: {
        issuerId: 'issuer-1',
        issuedAt: '2026-07-22T18:00:00Z'
      },
      currentUser: {
        id: 'issuer-user-1',
        email: 'issuer.admin@example.com',
        did: 'did:example:issuer-admin-demo',
        status: UserStatus.active
      }
    }
  ]);
  assert.deepEqual(response, expectedResponse);
});

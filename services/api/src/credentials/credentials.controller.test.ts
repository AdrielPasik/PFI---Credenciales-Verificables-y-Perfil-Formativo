import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { UserStatus } from '@prisma/client';

import { AuthGuard } from '../auth/auth.guard';
import { CredentialsController } from './credentials.controller';

test('CredentialsController protects createDraft with AuthGuard', () => {
  const guards = Reflect.getMetadata(
    GUARDS_METADATA,
    CredentialsController.prototype.createDraft
  ) as unknown[];

  assert.deepEqual(guards, [AuthGuard]);
});

test('CredentialsController delegates createDraft with current user to the service', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const dto = {
    issuerId: 'issuer-1',
    subjectUserId: 'holder-1',
    type: 'academic_subject',
    title: 'Materia demo',
    sourceType: 'manual_issuer',
    credentialSubject: {
      achievement_name: 'Materia demo',
      institution_name: 'Demo University'
    }
  };
  const authenticatedUser = {
    id: 'issuer-user-1',
    email: 'issuer.admin@example.com',
    did: 'did:example:issuer-admin-demo',
    status: UserStatus.active
  };
  const expectedResponse = {
    id: 'cred-draft-1',
    schemaVersion: 'credential_v1',
    issuerId: 'issuer-1',
    subjectUserId: 'holder-1',
    type: 'academic_subject',
    title: 'Materia demo',
    sourceType: 'manual_issuer',
    status: 'draft'
  };

  const controller = new CredentialsController({
    async createDraft(
      receivedDto: Record<string, unknown>,
      currentUser: Record<string, unknown>
    ) {
      calls.push({ dto: receivedDto, currentUser });
      return expectedResponse;
    },
    async issueCredential() {
      throw new Error('should not be called');
    },
    async getCredential() {
      throw new Error('should not be called');
    },
    async getCredentialStatus() {
      throw new Error('should not be called');
    }
  } as never);

  const response = await controller.createDraft(dto as never, authenticatedUser);

  assert.deepEqual(calls, [
    {
      dto,
      currentUser: authenticatedUser
    }
  ]);
  assert.deepEqual(response, expectedResponse);
});

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

test('existing GET /credentials/:id remains unguarded and delegates to the generic read', async () => {
  const calls: string[] = [];
  const controller = new CredentialsController({
    async createDraft() {
      throw new Error('should not be called');
    },
    async issueCredential() {
      throw new Error('should not be called');
    },
    async getCredential(credentialId: string) {
      calls.push(credentialId);
      return {
        id: credentialId,
        issuerId: 'issuer-1',
        subjectUserId: 'holder-1',
        status: 'draft'
      };
    },
    async getCredentialStatus() {
      throw new Error('should not be called');
    }
  } as never);

  const methodPath = Reflect.getMetadata(
    PATH_METADATA,
    CredentialsController.prototype.getCredential
  );
  const requestMethod = Reflect.getMetadata(
    METHOD_METADATA,
    CredentialsController.prototype.getCredential
  );
  const guards = Reflect.getMetadata(
    GUARDS_METADATA,
    CredentialsController.prototype.getCredential
  );
  const response = await controller.getCredential('credential-legacy');

  assert.equal(methodPath, ':id');
  assert.equal(requestMethod, RequestMethod.GET);
  assert.equal(guards, undefined);
  assert.deepEqual(calls, ['credential-legacy']);
  assert.deepEqual(response, {
    id: 'credential-legacy',
    issuerId: 'issuer-1',
    subjectUserId: 'holder-1',
    status: 'draft'
  });
});

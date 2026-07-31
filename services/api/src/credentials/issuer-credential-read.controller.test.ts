import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import {
  CredentialSourceType,
  CredentialStatus,
  CredentialType,
  UserStatus
} from '@prisma/client';

import { AuthGuard } from '../auth/auth.guard';
import { IssuerCredentialReadController } from './issuer-credential-read.controller';

test('issuer credential read route is GET /issuers/:issuerId/credentials/:credentialId and requires AuthGuard', () => {
  const controllerPath = Reflect.getMetadata(
    PATH_METADATA,
    IssuerCredentialReadController
  );
  const methodPath = Reflect.getMetadata(
    PATH_METADATA,
    IssuerCredentialReadController.prototype.getCredential
  );
  const requestMethod = Reflect.getMetadata(
    METHOD_METADATA,
    IssuerCredentialReadController.prototype.getCredential
  );
  const guards = Reflect.getMetadata(
    GUARDS_METADATA,
    IssuerCredentialReadController.prototype.getCredential
  ) as unknown[];

  assert.equal(controllerPath, 'issuers/:issuerId/credentials');
  assert.equal(methodPath, ':credentialId');
  assert.equal(requestMethod, RequestMethod.GET);
  assert.deepEqual(guards, [AuthGuard]);
});

test('controller delegates path references and current user and preserves the safe DTO', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const currentUser = {
    id: 'issuer-user-1',
    email: 'issuer.admin@example.com',
    did: 'did:example:issuer-admin-demo',
    status: UserStatus.active
  };
  const expectedResponse = {
    id: 'credential-1',
    status: CredentialStatus.draft,
    type: CredentialType.course,
    title: 'Arquitectura de Software',
    sourceType: CredentialSourceType.manual_issuer,
    credentialSubject: {
      achievement_name: 'Arquitectura de Software',
      institution_name: 'Demo University'
    },
    createdAt: '2026-07-30T12:00:00.000Z',
    updatedAt: '2026-07-30T12:05:00.000Z',
    issuer: {
      displayName: 'Demo University',
      did: 'did:example:issuer-demo'
    },
    holder: {
      displayLabel: 'Demo Holder',
      email: 'holder.demo@example.com',
      did: null
    }
  };
  const controller = new IssuerCredentialReadController({
    async getCredentialForIssuer(
      issuerId: string,
      credentialId: string,
      authenticatedUser: Record<string, unknown>
    ) {
      calls.push({ issuerId, credentialId, currentUser: authenticatedUser });
      return expectedResponse;
    }
  } as never);

  const response = await controller.getCredential(
    'issuer-1',
    'credential-1',
    currentUser
  );

  assert.deepEqual(calls, [
    {
      issuerId: 'issuer-1',
      credentialId: 'credential-1',
      currentUser
    }
  ]);
  assert.deepEqual(response, expectedResponse);
});

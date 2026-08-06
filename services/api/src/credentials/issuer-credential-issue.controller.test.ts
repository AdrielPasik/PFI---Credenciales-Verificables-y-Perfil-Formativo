import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { UserStatus } from '@prisma/client';

import { AuthGuard } from '../auth/auth.guard';
import { IssuerCredentialIssueController } from './issuer-credential-issue.controller';

test('issuer-scoped issuance route is POST and requires AuthGuard', () => {
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, IssuerCredentialIssueController),
    'issuers/:issuerId/credentials'
  );
  assert.equal(
    Reflect.getMetadata(
      PATH_METADATA,
      IssuerCredentialIssueController.prototype.issueCredential
    ),
    ':credentialId/issue'
  );
  assert.equal(
    Reflect.getMetadata(
      METHOD_METADATA,
      IssuerCredentialIssueController.prototype.issueCredential
    ),
    RequestMethod.POST
  );
  assert.deepEqual(
    Reflect.getMetadata(
      GUARDS_METADATA,
      IssuerCredentialIssueController.prototype.issueCredential
    ),
    [AuthGuard]
  );
  assert.equal(
    Reflect.getMetadata(
      HTTP_CODE_METADATA,
      IssuerCredentialIssueController.prototype.issueCredential
    ),
    200
  );
});

test('controller delegates only path params and CurrentUser and ignores an arbitrary body', async () => {
  const calls: unknown[] = [];
  const currentUser = {
    id: 'issuer-user-1',
    email: 'issuer.admin@example.com',
    did: null,
    status: UserStatus.active
  };
  const expected = {
    id: 'credential-1',
    status: 'issued',
    issuedAt: '2026-08-06T12:00:00.000Z'
  };
  const controller = new IssuerCredentialIssueController({
    async issueForIssuer(...args: unknown[]) {
      calls.push(args);
      return expected;
    }
  } as never);
  const maliciousBody = {
    issuerId: 'issuer-other',
    credentialId: 'credential-other',
    requestedByUserId: 'user-other',
    canonicalHash: 'fake',
    canonicalizationVersion: 'fake',
    network: 'fake',
    signer: 'fake',
    privateKey: 'fake'
  };

  const invoke = controller.issueCredential as unknown as (
    issuerId: string,
    credentialId: string,
    user: typeof currentUser,
    body: typeof maliciousBody
  ) => Promise<unknown>;
  const response = await invoke.call(
    controller,
    'issuer-1',
    'credential-1',
    currentUser,
    maliciousBody
  );

  assert.deepEqual(calls, [['issuer-1', 'credential-1', currentUser]]);
  assert.deepEqual(response, expected);
  assert.equal(JSON.stringify(calls).includes('issuer-other'), false);
  assert.equal(JSON.stringify(response).includes('fake'), false);
});

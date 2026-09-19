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
import { IssuerCredentialRevocationController } from './issuer-credential-revocation.controller';

test('issuer-scoped revocation is POST and requires AuthGuard', () => {
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, IssuerCredentialRevocationController),
    'issuers/:issuerId/credentials'
  );
  assert.equal(
    Reflect.getMetadata(
      PATH_METADATA,
      IssuerCredentialRevocationController.prototype.revokeCredential
    ),
    ':credentialId/revoke'
  );
  assert.equal(
    Reflect.getMetadata(
      METHOD_METADATA,
      IssuerCredentialRevocationController.prototype.revokeCredential
    ),
    RequestMethod.POST
  );
  assert.deepEqual(
    Reflect.getMetadata(
      GUARDS_METADATA,
      IssuerCredentialRevocationController.prototype.revokeCredential
    ),
    [AuthGuard]
  );
  assert.equal(
    Reflect.getMetadata(
      HTTP_CODE_METADATA,
      IssuerCredentialRevocationController.prototype.revokeCredential
    ),
    200
  );
});

test('controller delegates path identity, authenticated actor, and only the optional body to the service', async () => {
  const calls: unknown[] = [];
  const currentUser = {
    id: 'issuer-user-1',
    email: 'issuer@example.com',
    did: null,
    status: UserStatus.active
  };
  const controller = new IssuerCredentialRevocationController({
    async revokeForIssuer(...args: unknown[]) {
      calls.push(args);
      return {
        credentialReference: 'credential-1',
        status: 'revoked' as const,
        revokedAt: '2026-09-15T12:00:00.000Z',
        profileReconciliation: 'rebuilt' as const
      };
    }
  } as never);

  const body = { reason: 'Dato institucional corregido' };
  await controller.revokeCredential('issuer-1', 'credential-1', currentUser, body);

  assert.deepEqual(calls, [['issuer-1', 'credential-1', currentUser, body]]);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA
} from '@nestjs/common/constants';
import { HttpStatus, RequestMethod } from '@nestjs/common';
import { UserStatus } from '@prisma/client';

import { AuthGuard } from '../auth/auth.guard';
import { IssuerHolderResolutionController } from './issuer-holder-resolution.controller';

test('holder resolution route is POST /issuers/:issuerId/holders/resolve and requires AuthGuard', () => {
  const controllerPath = Reflect.getMetadata(
    PATH_METADATA,
    IssuerHolderResolutionController
  );
  const methodPath = Reflect.getMetadata(
    PATH_METADATA,
    IssuerHolderResolutionController.prototype.resolveHolder
  );
  const requestMethod = Reflect.getMetadata(
    METHOD_METADATA,
    IssuerHolderResolutionController.prototype.resolveHolder
  );
  const statusCode = Reflect.getMetadata(
    HTTP_CODE_METADATA,
    IssuerHolderResolutionController.prototype.resolveHolder
  );
  const guards = Reflect.getMetadata(
    GUARDS_METADATA,
    IssuerHolderResolutionController.prototype.resolveHolder
  ) as unknown[];

  assert.equal(controllerPath, 'issuers/:issuerId/holders');
  assert.equal(methodPath, 'resolve');
  assert.equal(requestMethod, RequestMethod.POST);
  assert.equal(statusCode, HttpStatus.OK);
  assert.deepEqual(guards, [AuthGuard]);
  assert.equal(`${controllerPath}/${methodPath}`.includes(':email'), false);
});

test('controller delegates path issuerId, DTO email and current user and preserves safe response', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const currentUser = {
    id: 'issuer-user-1',
    email: 'issuer.admin@example.com',
    did: 'did:example:issuer-admin-demo',
    status: UserStatus.active
  };
  const expectedResponse = {
    id: 'holder-1',
    email: 'holder.demo@example.com',
    did: null,
    displayLabel: 'Demo Holder'
  };
  const controller = new IssuerHolderResolutionController({
    async resolveHolder(
      issuerId: string,
      email: unknown,
      authenticatedUser: Record<string, unknown>
    ) {
      calls.push({ issuerId, email, currentUser: authenticatedUser });
      return expectedResponse;
    }
  } as never);

  const response = await controller.resolveHolder(
    'issuer-1',
    {
      email: ' Holder.Demo@Example.com '
    },
    currentUser
  );

  assert.deepEqual(calls, [
    {
      issuerId: 'issuer-1',
      email: ' Holder.Demo@Example.com ',
      currentUser
    }
  ]);
  assert.deepEqual(response, expectedResponse);
  assert.deepEqual(Object.keys(response).sort(), [
    'did',
    'displayLabel',
    'email',
    'id'
  ]);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA
} from '@nestjs/common/constants';

import { AuthGuard } from '../auth/auth.guard';
import { ReusableSemanticInterpretationController } from './reusable-semantic-interpretation.controller';

test('reusable semantic interpretation routes are protected by AuthGuard and issuer/credential-scoped', () => {
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, ReusableSemanticInterpretationController),
    'issuers/:issuerId/credentials/:credentialId/reusable-semantic-interpretation'
  );

  const routes: Array<[keyof ReusableSemanticInterpretationController, string, RequestMethod]> = [
    ['getCandidate', 'candidate', RequestMethod.GET],
    ['apply', 'apply', RequestMethod.POST],
    ['getActive', '/', RequestMethod.GET]
  ];

  for (const [handler, path, method] of routes) {
    const routeHandler = ReusableSemanticInterpretationController.prototype[handler];

    assert.equal(Reflect.getMetadata(PATH_METADATA, routeHandler), path);
    assert.equal(Reflect.getMetadata(METHOD_METADATA, routeHandler), method);
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, routeHandler), [AuthGuard]);
  }
});

test('apply always answers 200, regardless of whether it created/superseded/was idempotent', () => {
  const routeHandler = ReusableSemanticInterpretationController.prototype.apply;
  assert.equal(Reflect.getMetadata(HTTP_CODE_METADATA, routeHandler), 200);
});

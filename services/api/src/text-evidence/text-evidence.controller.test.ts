import assert from 'node:assert/strict';
import test from 'node:test';

import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA
} from '@nestjs/common/constants';
import { TextEvidenceStatus, UserStatus } from '@prisma/client';

import { AuthGuard } from '../auth/auth.guard';
import { TextEvidenceController } from './text-evidence.controller';

test('text evidence route is a protected POST under the issuer credential context', () => {
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, TextEvidenceController),
    'issuers/:issuerId/credentials/:credentialId/evidence/texts'
  );
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, TextEvidenceController), [
    AuthGuard
  ]);
  assert.equal(
    Reflect.getMetadata(
      METHOD_METADATA,
      TextEvidenceController.prototype.submitText
    ),
    RequestMethod.POST
  );
});

test('controller delegates path, user and exact body and preserves the safe response', async () => {
  const calls: unknown[] = [];
  const currentUser = {
    id: 'user-1',
    email: 'issuer@example.com',
    did: null,
    status: UserStatus.active
  };
  const body = {
    label: 'Temario institucional',
    content: 'Contenido formativo'
  };
  const expected = {
    textEvidenceReference: 'text-evidence-1',
    status: TextEvidenceStatus.current,
    label: 'Temario institucional',
    content: 'Contenido formativo',
    characterCount: 19,
    sha256: 'a'.repeat(64),
    submittedAt: '2026-08-03T12:00:00.000Z'
  };
  const controller = new TextEvidenceController({
    async submitCurrentText(...args: unknown[]) {
      calls.push(args);
      return expected;
    }
  } as never);

  const response = await controller.submitText(
    'issuer-1',
    'credential-1',
    body,
    currentUser
  );

  assert.deepEqual(calls, [
    ['issuer-1', 'credential-1', currentUser, body]
  ]);
  assert.deepEqual(response, expected);
  assert.deepEqual(Object.keys(response), [
    'textEvidenceReference',
    'status',
    'label',
    'content',
    'characterCount',
    'sha256',
    'submittedAt'
  ]);
});

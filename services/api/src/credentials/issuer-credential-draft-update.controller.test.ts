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
import { IssuerCredentialDraftUpdateController } from './issuer-credential-draft-update.controller';

test('draft update route is PATCH /issuers/:issuerId/credentials/:credentialId/draft and requires AuthGuard', () => {
  const controllerPath = Reflect.getMetadata(
    PATH_METADATA,
    IssuerCredentialDraftUpdateController
  );
  const methodPath = Reflect.getMetadata(
    PATH_METADATA,
    IssuerCredentialDraftUpdateController.prototype.updateDraft
  );
  const requestMethod = Reflect.getMetadata(
    METHOD_METADATA,
    IssuerCredentialDraftUpdateController.prototype.updateDraft
  );
  const guards = Reflect.getMetadata(
    GUARDS_METADATA,
    IssuerCredentialDraftUpdateController.prototype.updateDraft
  ) as unknown[];

  assert.equal(controllerPath, 'issuers/:issuerId/credentials');
  assert.equal(methodPath, ':credentialId/draft');
  assert.equal(requestMethod, RequestMethod.PATCH);
  assert.deepEqual(guards, [AuthGuard]);
});

test('controller delegates path params, body and current user and returns the safe read model', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const currentUser = {
    id: 'issuer-user-1',
    email: 'issuer.admin@example.com',
    did: null,
    status: UserStatus.active
  };
  const body = {
    expectedUpdatedAt: '2026-07-30T12:05:00.000Z',
    achievementName: 'Arquitectura de Software'
  };
  const expectedResponse = {
    id: 'credential-1',
    status: CredentialStatus.draft,
    type: CredentialType.course,
    title: 'Arquitectura de Software',
    description: null,
    hours: '24.50',
    sourceType: CredentialSourceType.manual_issuer,
    credentialSubject: {
      achievement_name: 'Arquitectura de Software',
      institution_name: 'Demo University',
      completion_date: '2026-07-30',
      academic_period: null,
      program_name: null,
      grade: null,
      provider_name: 'Traza Academy',
      platform_name: 'Campus',
      modality: 'Hibrida',
      level: 'Avanzado',
      certification_code: null,
      expiration_date: null,
      external_url: null,
      skills: ['TypeScript'],
      competencies: ['Diseno de sistemas'],
      learning_outcomes: ['Construir APIs']
    },
    createdAt: '2026-07-30T12:00:00.000Z',
    updatedAt: '2026-07-30T12:06:00.000Z',
    issuer: {
      displayName: 'Demo University',
      did: null
    },
    holder: {
      displayLabel: 'Demo Holder',
      email: null,
      did: null
    }
  };
  const controller = new IssuerCredentialDraftUpdateController({
    async updateDraftForIssuer(
      issuerId: string,
      credentialId: string,
      dto: Record<string, unknown>,
      authenticatedUser: Record<string, unknown>
    ) {
      calls.push({ issuerId, credentialId, dto, currentUser: authenticatedUser });
      return expectedResponse;
    }
  } as never);

  const response = await controller.updateDraft(
    'issuer-1',
    'credential-1',
    body,
    currentUser
  );

  assert.deepEqual(calls, [
    {
      issuerId: 'issuer-1',
      credentialId: 'credential-1',
      dto: body,
      currentUser
    }
  ]);
  assert.deepEqual(response, expectedResponse);
});

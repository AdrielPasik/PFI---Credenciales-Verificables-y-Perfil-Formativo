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
import { IssuerCourseTemplatesController } from './issuer-course-templates.controller';

const currentUser = {
  id: 'issuer-user-1',
  email: 'issuer.admin@example.com',
  did: null,
  status: UserStatus.active
};

test('course template routes are protected by AuthGuard and issuer-scoped', () => {
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, IssuerCourseTemplatesController),
    'issuers/:issuerId/course-templates'
  );

  const routes: Array<[keyof IssuerCourseTemplatesController, string, RequestMethod]> = [
    ['listTemplates', '/', RequestMethod.GET],
    ['createTemplate', '/', RequestMethod.POST],
    ['createTemplateFromCredential', 'from-credential/:credentialId', RequestMethod.POST],
    ['getCredentialSemanticApprovalCandidate', 'approval-candidate/from-credential/:credentialId/semantic-analysis/:semanticAnalysisId', RequestMethod.GET],
    ['approveCredentialSemanticAnalysis', 'from-credential/:credentialId/approved-analysis/from-semantic-analysis/:semanticAnalysisId', RequestMethod.POST],
    ['patchTemplate', ':templateId', RequestMethod.PATCH],
    [
      'approveTemplateSemanticAnalysis',
      ':templateId/approved-analysis/from-semantic-analysis/:semanticAnalysisId',
      RequestMethod.POST
    ],
    [
      'getTemplateSemanticApprovalCandidate',
      ':templateId/approved-analysis/candidate/from-semantic-analysis/:semanticAnalysisId',
      RequestMethod.GET
    ]
  ];

  for (const [handler, path, method] of routes) {
    const routeHandler = IssuerCourseTemplatesController.prototype[handler];

    assert.equal(Reflect.getMetadata(PATH_METADATA, routeHandler), path);
    assert.equal(Reflect.getMetadata(METHOD_METADATA, routeHandler), method);
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, routeHandler), [
      AuthGuard
    ]);
  }
});

test('controller delegates list with issuerId, search, status, credentialType and current user', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const controller = new IssuerCourseTemplatesController({
    async listTemplatesForIssuer(issuerId: string, query: Record<string, unknown>, user: Record<string, unknown>) {
      calls.push({ issuerId, query, user });
      return [];
    }
  } as never);

  await controller.listTemplates('issuer-1', 'python', 'archived', 'course', currentUser);

  assert.deepEqual(calls, [
    {
      issuerId: 'issuer-1',
      query: { search: 'python', status: 'archived', credentialType: 'course' },
      user: currentUser
    }
  ]);
});

test('controller delegates create with issuerId, dto and current user', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const controller = new IssuerCourseTemplatesController({
    async createTemplateForIssuer(issuerId: string, dto: Record<string, unknown>, user: Record<string, unknown>) {
      calls.push({ issuerId, dto, user });
      return {};
    }
  } as never);

  const dto = { title: 'Curso de Python' };
  await controller.createTemplate('issuer-1', dto as never, currentUser);

  assert.deepEqual(calls, [{ issuerId: 'issuer-1', dto, user: currentUser }]);
});

test('controller delegates create-from-credential with issuerId, credentialId and current user', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const controller = new IssuerCourseTemplatesController({
    async createTemplateFromCredentialForIssuer(issuerId: string, credentialId: string, user: Record<string, unknown>) {
      calls.push({ issuerId, credentialId, user });
      return {};
    }
  } as never);

  await controller.createTemplateFromCredential('issuer-1', 'credential-1', currentUser);

  assert.deepEqual(calls, [
    { issuerId: 'issuer-1', credentialId: 'credential-1', user: currentUser }
  ]);
});

test('controller delegates patch with issuerId, templateId, dto and current user', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const controller = new IssuerCourseTemplatesController({
    async patchTemplateForIssuer(
      issuerId: string,
      templateId: string,
      dto: Record<string, unknown>,
      user: Record<string, unknown>
    ) {
      calls.push({ issuerId, templateId, dto, user });
      return {};
    }
  } as never);

  const dto = { status: 'archived' };
  await controller.patchTemplate('issuer-1', 'template-1', dto as never, currentUser);

  assert.deepEqual(calls, [
    { issuerId: 'issuer-1', templateId: 'template-1', dto, user: currentUser }
  ]);
});

test('controller delegates approveTemplateSemanticAnalysis with issuerId, templateId, semanticAnalysisId and current user', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const controller = new IssuerCourseTemplatesController({
    async approveTemplateSemanticAnalysisForIssuer(
      issuerId: string,
      templateId: string,
      semanticAnalysisId: string,
      user: Record<string, unknown>
    ) {
      calls.push({ issuerId, templateId, semanticAnalysisId, user });
      return {};
    }
  } as never);

  await controller.approveTemplateSemanticAnalysis(
    'issuer-1',
    'template-1',
    'analysis-1',
    currentUser
  );

  assert.deepEqual(calls, [
    {
      issuerId: 'issuer-1',
      templateId: 'template-1',
      semanticAnalysisId: 'analysis-1',
      user: currentUser
    }
  ]);
});

test('controller delegates getTemplateSemanticApprovalCandidate with issuerId, templateId, semanticAnalysisId and current user', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const controller = new IssuerCourseTemplatesController({
    async getTemplateSemanticApprovalCandidateForIssuer(
      issuerId: string,
      templateId: string,
      semanticAnalysisId: string,
      user: Record<string, unknown>
    ) {
      calls.push({ issuerId, templateId, semanticAnalysisId, user });
      return {};
    }
  } as never);

  await controller.getTemplateSemanticApprovalCandidate(
    'issuer-1',
    'template-1',
    'analysis-1',
    currentUser
  );

  assert.deepEqual(calls, [
    {
      issuerId: 'issuer-1',
      templateId: 'template-1',
      semanticAnalysisId: 'analysis-1',
      user: currentUser
    }
  ]);
});

test('controller delegates C5 credential semantic review with the scoped references and reviewed labels', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const controller = new IssuerCourseTemplatesController({
    async approveCredentialSemanticAnalysisForIssuer(
      issuerId: string, credentialId: string, semanticAnalysisId: string, user: Record<string, unknown>, dto: Record<string, unknown>
    ) {
      calls.push({ issuerId, credentialId, semanticAnalysisId, user, dto });
      return {};
    }
  } as never);
  const dto = { reviewedSkills: [{ label: 'Scrum' }] };
  await controller.approveCredentialSemanticAnalysis('issuer-1', 'credential-1', 'analysis-1', dto as never, currentUser);
  assert.deepEqual(calls, [{ issuerId: 'issuer-1', credentialId: 'credential-1', semanticAnalysisId: 'analysis-1', user: currentUser, dto }]);
});

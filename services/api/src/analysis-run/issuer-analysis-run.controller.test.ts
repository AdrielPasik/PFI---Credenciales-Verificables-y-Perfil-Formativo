import assert from 'node:assert/strict';
import test from 'node:test';

import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA
} from '@nestjs/common/constants';
import {
  AnalysisRunStatus,
  SemanticAnalysisStatus,
  UserStatus
} from '@prisma/client';

import { AuthGuard } from '../auth/auth.guard';
import { IssuerAnalysisRunController } from './issuer-analysis-run.controller';

test('document analysis route is issuer-scoped POST protected by AuthGuard', () => {
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, IssuerAnalysisRunController),
    'issuers/:issuerId/credentials/:credentialId/analysis-runs'
  );
  assert.equal(
    Reflect.getMetadata(
      PATH_METADATA,
      IssuerAnalysisRunController.prototype.triggerDocumentAnalysis
    ),
    'document'
  );
  assert.equal(
    Reflect.getMetadata(
      METHOD_METADATA,
      IssuerAnalysisRunController.prototype.triggerDocumentAnalysis
    ),
    RequestMethod.POST
  );
  assert.deepEqual(
    Reflect.getMetadata(
      GUARDS_METADATA,
      IssuerAnalysisRunController.prototype.triggerDocumentAnalysis
    ),
    [AuthGuard]
  );
});

test('text analysis route is issuer-scoped POST protected by AuthGuard', () => {
  assert.equal(
    Reflect.getMetadata(
      PATH_METADATA,
      IssuerAnalysisRunController.prototype.triggerTextAnalysis
    ),
    'text'
  );
  assert.equal(
    Reflect.getMetadata(
      METHOD_METADATA,
      IssuerAnalysisRunController.prototype.triggerTextAnalysis
    ),
    RequestMethod.POST
  );
  assert.deepEqual(
    Reflect.getMetadata(
      GUARDS_METADATA,
      IssuerAnalysisRunController.prototype.triggerTextAnalysis
    ),
    [AuthGuard]
  );
});

test('text controller uses params and current user and ignores an untrusted body', async () => {
  const calls: unknown[] = [];
  const expected = {
    analysisRunId: 'run-1',
    credentialId: 'credential-1',
    status: AnalysisRunStatus.completed,
    semanticAnalysisId: 'semantic-1',
    artifactStatus: SemanticAnalysisStatus.partial,
    sourceCount: 1,
    completedAt: '2026-08-10T12:01:00.000Z'
  };
  const controller = new IssuerAnalysisRunController(
    {
      async triggerTextAnalysis(...args: unknown[]) {
        calls.push(args);
        return expected;
      }
    } as never,
    {} as never
  );
  const currentUser = {
    id: 'authenticated-user',
    email: 'operator@example.com',
    did: null,
    status: UserStatus.active
  };
  const maliciousBody = {
    issuerId: 'other-issuer',
    credentialId: 'other-credential',
    requestedByUserId: 'other-user',
    textEvidenceId: 'other-text-evidence',
    content: 'attacker-supplied text',
    inputMode: 'combined',
    trigger: 'system'
  };

  const response = await controller.triggerTextAnalysis(
    'issuer-1',
    'credential-1',
    currentUser,
    maliciousBody
  );

  assert.deepEqual(calls, [
    ['issuer-1', 'credential-1', 'authenticated-user']
  ]);
  assert.deepEqual(response, expected);
  for (const forbidden of [
    'content',
    'artifact',
    'analysisJson',
    'textForEmbedding',
    'evidenceMap',
    'storageKey',
    'path',
    'token',
    'authorization'
  ]) {
    assert.equal(forbidden in response, false);
  }
});

test('controller uses params and current user and ignores an untrusted body', async () => {
  const calls: unknown[] = [];
  const expected = {
    analysisRunId: 'run-1',
    credentialId: 'credential-1',
    status: AnalysisRunStatus.completed,
    semanticAnalysisId: 'semantic-1',
    artifactStatus: SemanticAnalysisStatus.partial,
    sourceCount: 1,
    completedAt: '2026-08-05T12:00:00.000Z'
  };
  const controller = new IssuerAnalysisRunController({
    async triggerDocumentAnalysis(...args: unknown[]) {
      calls.push(args);
      return expected;
    }
  } as never, {} as never);
  const currentUser = {
    id: 'authenticated-user',
    email: 'operator@example.com',
    did: null,
    status: UserStatus.active
  };
  const maliciousBody = {
    issuerId: 'other-issuer',
    credentialId: 'other-credential',
    requestedByUserId: 'other-user',
    sourceId: 'other-source',
    inputMode: 'combined',
    trigger: 'system',
    pipelineVersion: 'attacker-pipeline',
    taxonomyVersion: 'attacker-taxonomy'
  };

  const response = await controller.triggerDocumentAnalysis(
    'issuer-1',
    'credential-1',
    currentUser,
    maliciousBody
  );

  assert.deepEqual(calls, [
    ['issuer-1', 'credential-1', 'authenticated-user']
  ]);
  assert.deepEqual(response, expected);
  for (const forbidden of [
    'artifact',
    'analysisJson',
    'textForEmbedding',
    'storageKey',
    'path',
    'token',
    'authorization'
  ]) {
    assert.equal(forbidden in response, false);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA
} from '@nestjs/common/constants';
import {
  AnalysisRunInputMode,
  AnalysisRunStatus,
  AnalysisRunTrigger,
  SemanticAnalysisStatus,
  UserStatus
} from '@prisma/client';

import { AuthGuard } from '../auth/auth.guard';
import { IssuerAnalysisRunController } from './issuer-analysis-run.controller';

const currentUser = {
  id: 'issuer-user-1',
  email: 'operator@example.com',
  did: null,
  status: UserStatus.active
};

function response() {
  return {
    analysisRunId: 'run-1',
    credentialId: 'credential-1',
    status: AnalysisRunStatus.completed,
    inputMode: AnalysisRunInputMode.document,
    trigger: AnalysisRunTrigger.manual,
    requestedPipelineVersion: 'unversioned_current',
    requestedTaxonomyVersion: 'unversioned_current',
    sourceCount: 1,
    sourceTypes: [],
    createdAt: '2026-08-05T12:00:00.000Z',
    startedAt: '2026-08-05T12:00:01.000Z',
    completedAt: '2026-08-05T12:00:02.000Z',
    failedAt: null,
    errorCode: null,
    errorMessage: null,
    semanticAnalysis: {
      semanticAnalysisId: 'semantic-1',
      status: SemanticAnalysisStatus.completed,
      pipelineVersion: 'unversioned_current',
      taxonomyVersion: 'unversioned_current',
      confidence: 0.8,
      areasCount: 1,
      skillsCount: 2,
      conceptsCount: 3,
      qualityFlags: [],
      analyzedAt: '2026-08-05T12:00:02.000Z'
    }
  };
}

test('latest and by-id routes are distinct GET endpoints protected by AuthGuard', () => {
  const prototype = IssuerAnalysisRunController.prototype;
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, prototype.getLatestAnalysisRun),
    'latest'
  );
  assert.equal(
    Reflect.getMetadata(METHOD_METADATA, prototype.getLatestAnalysisRun),
    RequestMethod.GET
  );
  assert.deepEqual(
    Reflect.getMetadata(GUARDS_METADATA, prototype.getLatestAnalysisRun),
    [AuthGuard]
  );
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, prototype.getAnalysisRunById),
    ':analysisRunId'
  );
  assert.equal(
    Reflect.getMetadata(METHOD_METADATA, prototype.getAnalysisRunById),
    RequestMethod.GET
  );
  assert.deepEqual(
    Reflect.getMetadata(GUARDS_METADATA, prototype.getAnalysisRunById),
    [AuthGuard]
  );
  const methods = Object.getOwnPropertyNames(prototype);
  assert.ok(
    methods.indexOf('getLatestAnalysisRun') <
      methods.indexOf('getAnalysisRunById')
  );
});

test('controller delegates only params and current user to read service', async () => {
  const calls: unknown[] = [];
  const expected = response();
  const controller = new IssuerAnalysisRunController({} as never, {
    async getLatestForCredential(...args: unknown[]) {
      calls.push(['latest', ...args]);
      return expected;
    },
    async getById(...args: unknown[]) {
      calls.push(['by-id', ...args]);
      return expected;
    }
  } as never);

  assert.deepEqual(
    await controller.getLatestAnalysisRun(
      'issuer-1',
      'credential-1',
      currentUser
    ),
    expected
  );
  assert.deepEqual(
    await controller.getAnalysisRunById(
      'issuer-1',
      'credential-1',
      'run-1',
      currentUser
    ),
    expected
  );
  assert.deepEqual(calls, [
    ['latest', 'issuer-1', 'credential-1', 'issuer-user-1'],
    ['by-id', 'issuer-1', 'credential-1', 'run-1', 'issuer-user-1']
  ]);
  const serialized = JSON.stringify(expected);
  for (const forbidden of [
    'analysisJson',
    'textForEmbedding',
    'evidenceMap',
    'storageKey',
    'storageProvider',
    'path',
    'token',
    'authorization'
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  AnalysisRunInputMode,
  AnalysisRunSourceType,
  AnalysisRunStatus,
  AnalysisRunTrigger,
  CredentialStatus
} from '@prisma/client';

import { issuerAnalysisRunReadSelect } from './issuer-analysis-run-read.mapper';
import { IssuerAnalysisRunReadService } from './issuer-analysis-run-read.service';

function record() {
  return {
    id: 'run-1',
    credentialId: 'credential-1',
    status: AnalysisRunStatus.pending,
    inputMode: AnalysisRunInputMode.document,
    trigger: AnalysisRunTrigger.manual,
    requestedPipelineVersion: 'pipeline-v1',
    requestedTaxonomyVersion: 'taxonomy-v1',
    startedAt: null,
    completedAt: null,
    failedAt: null,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date('2026-08-05T12:00:00.000Z'),
    sources: [{ sourceType: AnalysisRunSourceType.document_evidence }],
    semanticAnalyses: []
  };
}

function setup(options: {
  authorizationError?: Error;
  credential?: { id: string; status?: CredentialStatus } | null;
  latestRun?: ReturnType<typeof record> | null;
  runById?: ReturnType<typeof record> | null;
} = {}) {
  const calls = {
    events: [] as string[],
    authorizations: [] as unknown[],
    credentialQueries: [] as unknown[],
    runQueries: [] as any[],
    aiCalls: 0,
    storageReads: 0,
    textReads: 0,
    runWrites: 0,
    credentialWrites: 0,
    blockchainWrites: 0
  };
  const prisma = {
    credential: {
      async findFirst(args: unknown) {
        calls.events.push('credential');
        calls.credentialQueries.push(args);
        if (options.credential === null) return null;
        return options.credential ?? { id: 'credential-1' };
      },
      async update() { calls.credentialWrites += 1; }
    },
    analysisRun: {
      async findFirst(args: any) {
        calls.events.push('run');
        calls.runQueries.push(args);
        if ('id' in args.where) return options.runById === undefined
          ? record()
          : options.runById;
        return options.latestRun === undefined ? record() : options.latestRun;
      },
      async update() { calls.runWrites += 1; },
      async create() { calls.runWrites += 1; }
    },
    textEvidence: {
      async findFirst() { calls.textReads += 1; }
    },
    blockchainRecord: {
      async create() { calls.blockchainWrites += 1; }
    }
  };
  const issuers = {
    async assertUserCanReadCredentialsForIssuer(...args: unknown[]) {
      calls.events.push('authorize');
      calls.authorizations.push(args);
      if (options.authorizationError) throw options.authorizationError;
    }
  };
  return {
    service: new IssuerAnalysisRunReadService(prisma as never, issuers as never),
    calls
  };
}

test('latest authorizes, scopes credential and applies deterministic ordering', async () => {
  const { service, calls } = setup();
  const response = await service.getLatestForCredential(
    'issuer-1',
    'credential-1',
    'issuer-user-1'
  );
  assert.equal(response?.analysisRunId, 'run-1');
  assert.deepEqual(calls.events, ['authorize', 'credential', 'run']);
  assert.deepEqual(calls.authorizations, [['issuer-user-1', 'issuer-1']]);
  assert.deepEqual(calls.credentialQueries, [{
    where: { id: 'credential-1', issuerId: 'issuer-1' },
    select: { id: true }
  }]);
  assert.deepEqual(calls.runQueries, [{
    where: { credentialId: 'credential-1' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: issuerAnalysisRunReadSelect
  }]);
});

test('read scope accepts draft, issued and revoked credentials', async () => {
  for (const status of Object.values(CredentialStatus)) {
    const { service, calls } = setup({
      credential: { id: 'credential-1', status }
    });
    assert.ok(await service.getLatestForCredential(
      'issuer-1',
      'credential-1',
      'issuer-user-1'
    ));
    assert.deepEqual(calls.credentialQueries[0], {
      where: { id: 'credential-1', issuerId: 'issuer-1' },
      select: { id: true }
    });
  }
});

test('latest returns null when scoped credential has no runs', async () => {
  const { service } = setup({ latestRun: null });
  assert.equal(
    await service.getLatestForCredential(
      'issuer-1',
      'credential-1',
      'issuer-user-1'
    ),
    null
  );
});

test('by id scopes run to credential and returns safe 404 when absent', async () => {
  const found = setup();
  assert.equal(
    (await found.service.getById(
      'issuer-1',
      'credential-1',
      'run-1',
      'issuer-user-1'
    )).analysisRunId,
    'run-1'
  );
  assert.deepEqual(found.calls.runQueries[0], {
    where: { id: 'run-1', credentialId: 'credential-1' },
    select: issuerAnalysisRunReadSelect
  });

  const missing = setup({ runById: null });
  await assert.rejects(
    missing.service.getById(
      'issuer-1',
      'credential-1',
      'run-from-another-credential',
      'issuer-user-1'
    ),
    (error: unknown) => {
      assert.ok(error instanceof NotFoundException);
      assert.equal(error.message, 'No se encontro el analisis solicitado.');
      return true;
    }
  );
});

test('missing or cross-issuer credential returns safe 404 before run lookup', async () => {
  const { service, calls } = setup({ credential: null });
  await assert.rejects(
    service.getLatestForCredential(
      'issuer-1',
      'credential-from-another-issuer',
      'issuer-user-1'
    ),
    NotFoundException
  );
  assert.deepEqual(calls.events, ['authorize', 'credential']);
});

test('authorization failure stops before credential and run lookup', async () => {
  const { service, calls } = setup({
    authorizationError: new ForbiddenException('Sin permiso institucional.')
  });
  await assert.rejects(
    service.getLatestForCredential(
      'issuer-arbitrary',
      'credential-1',
      'issuer-user-1'
    ),
    ForbiddenException
  );
  assert.deepEqual(calls.events, ['authorize']);
});

test('reads have no AI, storage, text, credential, run or blockchain writes', async () => {
  const { service, calls } = setup();
  await service.getLatestForCredential(
    'issuer-1',
    'credential-1',
    'issuer-user-1'
  );
  assert.equal(calls.aiCalls, 0);
  assert.equal(calls.storageReads, 0);
  assert.equal(calls.textReads, 0);
  assert.equal(calls.runWrites, 0);
  assert.equal(calls.credentialWrites, 0);
  assert.equal(calls.blockchainWrites, 0);
});

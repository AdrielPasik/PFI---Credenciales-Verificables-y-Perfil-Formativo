import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  AnalysisRunInputMode,
  AnalysisRunSourceType,
  AnalysisRunStatus,
  AnalysisRunTrigger,
  CredentialStatus,
  DocumentEvidenceStatus,
  Prisma,
  TextEvidenceStatus
} from '@prisma/client';

import { AnalysisRunService } from './analysis-run.service';

const HASH_DOCUMENT = 'a'.repeat(64);
const HASH_TEXT = 'b'.repeat(64);
const CREATED_AT = new Date('2026-08-05T12:00:00.000Z');

function setup(options: {
  credential?: boolean;
  credentialStatus?: CredentialStatus;
  document?: boolean;
  text?: boolean;
} = {}) {
  const calls = {
    credentials: [] as unknown[], documents: [] as unknown[], texts: [] as unknown[],
    creates: [] as unknown[], transactions: [] as unknown[], semanticCreates: 0,
    credentialUpdates: 0, blockchainCreates: 0
  };
  const tx = {
    credential: {
      async findUnique(args: unknown) {
        calls.credentials.push(args);
        if (options.credential === false) return null;
        return { id: 'credential-1', status: options.credentialStatus ?? CredentialStatus.draft };
      },
      async update() { calls.credentialUpdates += 1; }
    },
    documentEvidence: {
      async findFirst(args: unknown) {
        calls.documents.push(args);
        return options.document === false ? null : {
          id: 'document-1', credentialId: 'credential-1', sha256: HASH_DOCUMENT,
          status: DocumentEvidenceStatus.current
        };
      }
    },
    textEvidence: {
      async findFirst(args: unknown) {
        calls.texts.push(args);
        return options.text === false ? null : {
          id: 'text-1', credentialId: 'credential-1', sha256: HASH_TEXT,
          status: TextEvidenceStatus.current
        };
      }
    },
    analysisRun: {
      async create(args: any) {
        calls.creates.push(args);
        const sources = args.data.sources.create as Array<{ sourceType: AnalysisRunSourceType }>;
        return {
          id: 'run-1', credentialId: args.data.credentialId, status: args.data.status,
          inputMode: args.data.inputMode, trigger: args.data.trigger,
          requestedPipelineVersion: args.data.requestedPipelineVersion,
          requestedTaxonomyVersion: args.data.requestedTaxonomyVersion,
          createdAt: CREATED_AT, sources: sources.map(({ sourceType }) => ({ sourceType }))
        };
      }
    },
    semanticAnalysis: { async create() { calls.semanticCreates += 1; } },
    blockchainRecord: { async create() { calls.blockchainCreates += 1; } }
  };
  const prisma = {
    async $transaction(callback: (value: typeof tx) => Promise<unknown>, config: unknown) {
      calls.transactions.push(config);
      return callback(tx);
    }
  };
  return { service: new AnalysisRunService(prisma as never), calls };
}

function input(inputMode: AnalysisRunInputMode, overrides: Record<string, unknown> = {}) {
  return {
    credentialId: 'credential-1', requestedByUserId: 'user-1', inputMode,
    trigger: AnalysisRunTrigger.manual, requestedPipelineVersion: 'pipeline-v1',
    requestedTaxonomyVersion: 'taxonomy-v1', ...overrides
  } as never;
}

test('document mode snapshots only safe allowlisted metadata and persisted hash', async () => {
  const { service, calls } = setup();
  const result = await service.createPendingRun(input(AnalysisRunInputMode.document));

  assert.deepEqual(calls.documents, [{
    where: { credentialId: 'credential-1', status: DocumentEvidenceStatus.current },
    select: { id: true, credentialId: true, sha256: true, status: true }
  }]);
  assert.equal(calls.texts.length, 0);
  const create = calls.creates[0] as any;
  assert.deepEqual(create.data.sources.create, [{
    sourceType: AnalysisRunSourceType.document_evidence,
    documentEvidenceId: 'document-1', textEvidenceId: null,
    sourceSha256: HASH_DOCUMENT, sourceLabel: null, sourceStatusAtRun: 'current'
  }]);
  assert.equal(JSON.stringify(create).includes('storageKey'), false);
  assert.equal(JSON.stringify(create).includes('content'), false);
  assert.equal(JSON.stringify(create).includes('bytes'), false);
  assert.deepEqual(result, {
    runReference: 'run-1', credentialReference: 'credential-1',
    status: AnalysisRunStatus.pending, inputMode: AnalysisRunInputMode.document,
    trigger: AnalysisRunTrigger.manual, requestedPipelineVersion: 'pipeline-v1',
    requestedTaxonomyVersion: 'taxonomy-v1',
    sourceTypes: [AnalysisRunSourceType.document_evidence], sourceCount: 1,
    createdAt: CREATED_AT.toISOString()
  });
});

test('text mode selects no content and snapshots the persisted text hash', async () => {
  const { service, calls } = setup();
  await service.createPendingRun(input(AnalysisRunInputMode.text));
  assert.equal(calls.documents.length, 0);
  assert.deepEqual(calls.texts, [{
    where: { credentialId: 'credential-1', status: TextEvidenceStatus.current },
    select: { id: true, credentialId: true, sha256: true, status: true }
  }]);
});

test('combined requires both current sources and never degrades silently', async () => {
  for (const options of [{ document: false }, { text: false }]) {
    const { service, calls } = setup(options);
    await assert.rejects(service.createPendingRun(input(AnalysisRunInputMode.combined)), BadRequestException);
    assert.equal(calls.creates.length, 0);
  }
  const { service, calls } = setup();
  const result = await service.createPendingRun(input(AnalysisRunInputMode.combined));
  assert.equal(result.sourceCount, 2);
  const sources = (calls.creates[0] as any).data.sources.create;
  assert.equal(sources.every((source: any) => Boolean(source.documentEvidenceId) !== Boolean(source.textEvidenceId)), true);
});

test('missing source, credential, non-draft credential and manual requester are rejected', async () => {
  await assert.rejects(setup({ document: false }).service.createPendingRun(input(AnalysisRunInputMode.document)), BadRequestException);
  await assert.rejects(setup({ credential: false }).service.createPendingRun(input(AnalysisRunInputMode.document)), NotFoundException);
  await assert.rejects(setup({ credentialStatus: CredentialStatus.issued }).service.createPendingRun(input(AnalysisRunInputMode.document)), ConflictException);
  await assert.rejects(setup().service.createPendingRun(input(AnalysisRunInputMode.document, { requestedByUserId: null })), BadRequestException);
});

test('system trigger may omit requester and transaction is serializable', async () => {
  const { service, calls } = setup();
  await service.createPendingRun(input(AnalysisRunInputMode.document, {
    trigger: AnalysisRunTrigger.system, requestedByUserId: null
  }));
  assert.deepEqual(calls.transactions, [{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }]);
  assert.equal((calls.creates[0] as any).data.requestedByUserId, null);
});

test('creating a run has no semantic, credential, canonical or blockchain writes', async () => {
  const { service, calls } = setup();
  await service.createPendingRun(input(AnalysisRunInputMode.combined));
  assert.equal(calls.semanticCreates, 0);
  assert.equal(calls.credentialUpdates, 0);
  assert.equal(calls.blockchainCreates, 0);
  const data = (calls.creates[0] as any).data;
  assert.equal('canonicalHash' in data, false);
});

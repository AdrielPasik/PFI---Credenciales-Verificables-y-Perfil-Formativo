import assert from 'node:assert/strict';
import test from 'node:test';

import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import {
  AnalysisRunInputMode,
  AnalysisRunSourceType,
  AnalysisRunStatus,
  CredentialStatus,
  DocumentEvidenceKind,
  SemanticAnalysisStatus
} from '@prisma/client';

import { AiServiceClientError } from '../ai/ai-service.types';
import { DocumentStorageError } from '../document-evidence/document-storage.error';
import { AnalysisRunExecutionService } from './analysis-run-execution.service';

const HASH = 'a'.repeat(64);

function setup(options: {
  mode?: AnalysisRunInputMode;
  runStatus?: AnalysisRunStatus;
  credentialStatus?: CredentialStatus;
  sources?: any[];
  claimCount?: number;
  documentHash?: string;
  storageError?: Error;
  aiError?: Error;
  semanticError?: Error;
  artifactStatus?: SemanticAnalysisStatus;
} = {}) {
  const calls = {
    updates: [] as any[], documents: [] as any[], reads: [] as string[],
    ai: [] as any[], semantic: [] as any[], credentialWrites: 0,
    blockchainWrites: 0, textReads: 0, events: [] as string[]
  };
  const run = {
    id: 'run-1', credentialId: 'credential-1',
    status: options.runStatus ?? AnalysisRunStatus.pending,
    inputMode: options.mode ?? AnalysisRunInputMode.document,
    requestedPipelineVersion: 'pipeline-v1', requestedTaxonomyVersion: 'taxonomy-v1',
    credential: { status: options.credentialStatus ?? CredentialStatus.draft },
    sources: options.sources ?? [{
      sourceType: AnalysisRunSourceType.document_evidence,
      documentEvidenceId: 'document-1', textEvidenceId: null, sourceSha256: HASH
    }]
  };
  let transactionNumber = 0;
  const tx = {
    analysisRun: {
      async findUnique() { return run; },
      async updateMany(args: any) {
        calls.updates.push(args);
        if (args.data.status === AnalysisRunStatus.running) {
          calls.events.push('claim');
          return { count: options.claimCount ?? 1 };
        }
        return { count: 1 };
      }
    },
    credential: { async findUnique() { return { id: 'credential-1' }; }, async update() { calls.credentialWrites += 1; } },
    semanticAnalysis: { async create() { return null; } }
  };
  const prisma = {
    analysisRun: { async updateMany(args: any) { calls.updates.push(args); return { count: 1 }; } },
    documentEvidence: {
      async findUnique(args: any) {
        calls.documents.push(args);
        return { id: 'document-1', credentialId: 'credential-1', kind: DocumentEvidenceKind.pdf,
          originalFileName: 'programa.pdf', sha256: options.documentHash ?? HASH,
          storageKey: 'internal-key' };
      }
    },
    textEvidence: { async findUnique() { calls.textReads += 1; } },
    blockchainRecord: { async create() { calls.blockchainWrites += 1; } },
    async $transaction(callback: (client: typeof tx) => Promise<unknown>) {
      transactionNumber += 1;
      return callback(tx);
    }
  };
  const storage = {
    async saveDocument() {
      throw new Error('saveDocument must not be called');
    },
    async readDocument(key: string) {
      calls.reads.push(key);
      if (options.storageError) throw options.storageError;
      return Buffer.from('%PDF-1.4 synthetic');
    },
    async deleteDocument() {
      throw new Error('deleteDocument must not be called');
    }
  };
  const ai = {
    async analyzePdf(input: any) {
      calls.events.push('ai');
      calls.ai.push(input);
      if (options.aiError) throw options.aiError;
      return { schemaVersion: 'semantic_analysis_v1', status: options.artifactStatus ?? 'completed' };
    }
  };
  const semantic = {
    async persistForCredential(...args: any[]) {
      calls.semantic.push(args);
      if (options.semanticError) throw options.semanticError;
      return { id: 'semantic-1', status: options.artifactStatus ?? SemanticAnalysisStatus.completed };
    }
  };
  return {
    service: new AnalysisRunExecutionService(prisma as never, ai as never, semantic as never, storage),
    calls,
    transactionCount: () => transactionNumber
  };
}

test('claims document run, reads exact source, persists semantic and completes', async () => {
  const { service, calls, transactionCount } = setup();
  const result = await service.executePendingDocumentRun('run-1');

  assert.equal(calls.updates[0].data.status, AnalysisRunStatus.running);
  assert.deepEqual(calls.events.slice(0, 2), ['claim', 'ai']);
  assert.deepEqual(calls.documents[0].where, { id: 'document-1' });
  assert.equal('status' in calls.documents[0].where, false);
  assert.deepEqual(calls.reads, ['internal-key']);
  assert.equal(calls.ai.length, 1);
  assert.deepEqual(calls.ai[0], {
    fileBytes: Buffer.from('%PDF-1.4 synthetic'), documentId: 'run-1',
    fileName: 'programa.pdf', pipelineVersion: 'pipeline-v1', taxonomyVersion: 'taxonomy-v1'
  });
  assert.equal(calls.semantic[0][0], 'credential-1');
  assert.equal(calls.semantic[0][2].analysisRunId, 'run-1');
  assert.equal('authorization' in calls.ai[0], false);
  assert.equal('accessToken' in calls.ai[0], false);
  assert.equal(calls.updates[1].data.status, AnalysisRunStatus.completed);
  assert.equal(transactionCount(), 2);
  assert.deepEqual(result, {
    runReference: 'run-1', credentialReference: 'credential-1',
    status: AnalysisRunStatus.completed, semanticAnalysisReference: 'semantic-1',
    artifactStatus: SemanticAnalysisStatus.completed, sourceCount: 1,
    completedAt: result.completedAt
  });
  assert.equal('analysisJson' in result, false);
  assert.equal('textForEmbedding' in result, false);
  assert.equal('path' in result, false);
  assert.equal(JSON.stringify(result).includes('internal-key'), false);
});

test('partial semantic artifact still completes the operational run', async () => {
  const { service } = setup({ artifactStatus: SemanticAnalysisStatus.partial });
  const result = await service.executePendingDocumentRun('run-1');
  assert.equal(result.status, AnalysisRunStatus.completed);
  assert.equal(result.artifactStatus, SemanticAnalysisStatus.partial);
});

test('text and combined modes are rejected before claim and never call AI', async () => {
  for (const mode of [AnalysisRunInputMode.text, AnalysisRunInputMode.combined]) {
    const { service, calls } = setup({ mode });
    await assert.rejects(service.executePendingDocumentRun('run-1'), ConflictException);
    assert.equal(calls.ai.length, 0);
    assert.equal(calls.reads.length, 0);
  }
});

test('non-pending, non-draft, malformed source and duplicate claim do not execute', async () => {
  const cases = [
    setup({ runStatus: AnalysisRunStatus.running }),
    setup({ credentialStatus: CredentialStatus.issued }),
    setup({ sources: [] }),
    setup({ claimCount: 0 })
  ];
  for (const context of cases) {
    await assert.rejects(context.service.executePendingDocumentRun('run-1'), ConflictException);
    assert.equal(context.calls.ai.length, 0);
  }
});

test('hash mismatch fails run with a sanitized conflict', async () => {
  const { service, calls } = setup({ documentHash: 'b'.repeat(64) });
  await assert.rejects(service.executePendingDocumentRun('run-1'), ConflictException);
  const failure = calls.updates.at(-1).data;
  assert.equal(failure.status, AnalysisRunStatus.failed);
  assert.equal(failure.errorCode, 'document_unavailable');
  assert.equal(JSON.stringify(failure).includes('internal-key'), false);
});

test('invalid source hash is rejected before claim', async () => {
  const { service, calls } = setup({
    sources: [{
      sourceType: AnalysisRunSourceType.document_evidence,
      documentEvidenceId: 'document-1',
      textEvidenceId: null,
      sourceSha256: 'invalid'
    }]
  });
  await assert.rejects(service.executePendingDocumentRun('run-1'), ConflictException);
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.reads.length, 0);
  assert.equal(calls.ai.length, 0);
});

test('storage and AI failures mark failed with safe categories', async () => {
  const cases = [
    [setup({ storageError: new DocumentStorageError('upstream', 'sensitive key') }), 'document_unavailable'],
    [setup({ aiError: new AiServiceClientError('upstream secret', 'timeout') }), 'ai_timeout'],
    [setup({ aiError: new AiServiceClientError('upstream secret', 'http', 401) }), 'ai_authentication_failed']
  ] as const;
  for (const [context, code] of cases) {
    await assert.rejects(context.service.executePendingDocumentRun('run-1'), ServiceUnavailableException);
    const failure = context.calls.updates.at(-1).data;
    assert.equal(failure.errorCode, code);
    assert.equal(JSON.stringify(failure).includes('sensitive'), false);
    assert.equal(JSON.stringify(failure).includes('secret'), false);
  }
});

test('invalid artifact or semantic persistence failure rolls back completion and marks failed', async () => {
  const { service, calls } = setup({ semanticError: new Error('raw artifact') });
  await assert.rejects(service.executePendingDocumentRun('run-1'), ServiceUnavailableException);
  assert.equal(calls.updates.at(-1).data.errorCode, 'semantic_persistence_failed');
  assert.equal(calls.updates.some((entry) => entry.data.status === AnalysisRunStatus.completed), false);
  assert.equal(calls.textReads, 0);
  assert.equal(calls.credentialWrites, 0);
  assert.equal(calls.blockchainWrites, 0);
});

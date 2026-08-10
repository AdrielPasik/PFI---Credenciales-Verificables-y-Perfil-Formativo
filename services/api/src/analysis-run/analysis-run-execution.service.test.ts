import assert from 'node:assert/strict';
import test from 'node:test';

import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import {
  AnalysisRunInputMode,
  AnalysisRunSourceType,
  AnalysisRunStatus,
  AnalysisRunTrigger,
  CredentialStatus,
  DocumentEvidenceKind,
  SemanticAnalysisStatus,
  TextEvidenceStatus
} from '@prisma/client';

import { AiServiceClientError } from '../ai/ai-service.types';
import { DocumentStorageError } from '../document-evidence/document-storage.error';
import { AnalysisRunExecutionService } from './analysis-run-execution.service';

const HASH = 'a'.repeat(64);

function setup(options: {
  mode?: AnalysisRunInputMode;
  runStatus?: AnalysisRunStatus;
  credentialStatus?: CredentialStatus;
  trigger?: AnalysisRunTrigger;
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
    blockchainWrites: 0, textReads: 0, events: [] as string[], logs: [] as string[]
  };
  const run = {
    id: 'run-1', credentialId: 'credential-1',
    status: options.runStatus ?? AnalysisRunStatus.pending,
    inputMode: options.mode ?? AnalysisRunInputMode.document,
    trigger: options.trigger ?? AnalysisRunTrigger.manual,
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
  const service = new AnalysisRunExecutionService(
    prisma as never,
    ai as never,
    semantic as never,
    storage
  );
  Object.defineProperty(service, 'logger', {
    value: { error: (message: string) => calls.logs.push(message) }
  });
  return {
    service,
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
    correlationId: 'run-1',
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

test('issued execution is allowed only for a system-triggered run', async () => {
  const system = setup({
    credentialStatus: CredentialStatus.issued,
    trigger: AnalysisRunTrigger.system
  });
  await system.service.executePendingDocumentRun('run-1');
  assert.equal(system.calls.ai.length, 1);

  const manual = setup({
    credentialStatus: CredentialStatus.issued,
    trigger: AnalysisRunTrigger.manual
  });
  await assert.rejects(
    manual.service.executePendingDocumentRun('run-1'),
    ConflictException
  );
  assert.equal(manual.calls.ai.length, 0);

  const revoked = setup({
    credentialStatus: CredentialStatus.revoked,
    trigger: AnalysisRunTrigger.system
  });
  await assert.rejects(
    revoked.service.executePendingDocumentRun('run-1'),
    ConflictException
  );
  assert.equal(revoked.calls.ai.length, 0);
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
    [setup({ aiError: new AiServiceClientError('upstream secret', 'http', 401) }), 'ai_authentication_failed'],
    [setup({ aiError: new AiServiceClientError('upstream secret', 'http', 403) }), 'ai_authentication_failed']
  ] as const;
  for (const [context, code] of cases) {
    await assert.rejects(context.service.executePendingDocumentRun('run-1'), ServiceUnavailableException);
    const failure = context.calls.updates.at(-1).data;
    assert.equal(failure.errorCode, code);
    assert.equal(JSON.stringify(failure).includes('sensitive'), false);
    assert.equal(JSON.stringify(failure).includes('secret'), false);
  }
});

test('maps AI HTTP, client, and network failures to diagnostic-safe codes', async () => {
  const cases: Array<[AiServiceClientError, string]> = [
    [new AiServiceClientError('raw', 'http', 400), 'ai_input_rejected'],
    [new AiServiceClientError('raw', 'http', 404), 'ai_endpoint_not_found'],
    [new AiServiceClientError('raw', 'http', 405), 'ai_endpoint_not_found'],
    [new AiServiceClientError('raw', 'http', 409), 'ai_version_conflict'],
    [new AiServiceClientError('raw', 'http', 413), 'ai_input_too_large'],
    [new AiServiceClientError('raw', 'http', 422), 'ai_input_rejected'],
    [new AiServiceClientError('raw', 'http', 500), 'ai_unavailable'],
    [new AiServiceClientError('raw', 'http', 503), 'ai_dependency_unavailable'],
    [new AiServiceClientError('raw', 'http', 504), 'ai_timeout'],
    [new AiServiceClientError('raw', 'invalid_response'), 'ai_invalid_response'],
    [new AiServiceClientError('raw', 'configuration'), 'ai_invalid_configuration'],
    [new AiServiceClientError('raw', 'unavailable', null, null, 'ENOTFOUND'), 'ai_network_unreachable']
  ];

  for (const [aiError, code] of cases) {
    const { service, calls } = setup({ aiError });
    await assert.rejects(
      service.executePendingDocumentRun('run-1'),
      ServiceUnavailableException
    );
    assert.equal(calls.updates.at(-1).data.errorCode, code);
  }
});

test('failure logs preserve diagnostic categories without upstream secrets', async () => {
  const { service, calls } = setup({
    aiError: new AiServiceClientError(
      'raw upstream error',
      'unavailable',
      null,
      'https://internal.example/path?token=secret storageKey=private-key %PDF-1.4 raw artifact',
      'ECONNREFUSED'
    )
  });

  await assert.rejects(
    service.executePendingDocumentRun('run-1'),
    ServiceUnavailableException
  );

  assert.equal(calls.logs.length, 1);
  const logged = JSON.parse(calls.logs[0]) as Record<string, unknown>;
  assert.deepEqual(Object.keys(logged).sort(), [
    'aiServiceErrorCode',
    'analysisRunId',
    'causeCode',
    'credentialId',
    'detail',
    'durationMs',
    'errorCode',
    'event',
    'httpStatus',
    'stage'
  ]);
  assert.equal(logged.errorCode, 'ai_network_unreachable');
  assert.equal(logged.causeCode, 'ECONNREFUSED');
  assert.equal(logged.detail, 'upstream_detail_redacted');
  const serialized = JSON.stringify(logged);
  assert.equal(serialized.includes('internal.example'), false);
  assert.equal(serialized.includes('secret'), false);
  assert.equal(serialized.includes('private-key'), false);
  assert.equal(serialized.includes('%PDF-1.4'), false);
  assert.equal(serialized.includes('raw artifact'), false);
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

// ─── C2b.2: executePendingTextRun ───────────────────────────────────────────

const TEXT_HASH = 'b'.repeat(64);

function setupText(options: {
  runStatus?: AnalysisRunStatus;
  credentialStatus?: CredentialStatus;
  trigger?: AnalysisRunTrigger;
  sources?: any[];
  claimCount?: number;
  textHash?: string;
  textStatus?: TextEvidenceStatus;
  textCredentialId?: string;
  credential?: any | null;
  aiError?: Error;
  semanticError?: Error;
  artifactStatus?: SemanticAnalysisStatus;
} = {}) {
  const calls = {
    updates: [] as any[],
    textReads: [] as any[],
    credentialReads: [] as any[],
    documentReads: 0,
    storageReads: 0,
    pdfCalls: 0,
    ai: [] as any[],
    semantic: [] as any[],
    events: [] as string[],
    logs: [] as string[],
    blockchainWrites: 0
  };
  const run = {
    id: 'run-1',
    credentialId: 'credential-1',
    status: options.runStatus ?? AnalysisRunStatus.pending,
    inputMode: AnalysisRunInputMode.text,
    trigger: options.trigger ?? AnalysisRunTrigger.manual,
    requestedPipelineVersion: 'pipeline-v1',
    requestedTaxonomyVersion: 'taxonomy-v1',
    credential: { status: options.credentialStatus ?? CredentialStatus.draft },
    sources: options.sources ?? [
      {
        sourceType: AnalysisRunSourceType.text_evidence,
        documentEvidenceId: null,
        textEvidenceId: 'text-1',
        sourceSha256: TEXT_HASH
      }
    ]
  };
  const tx = {
    analysisRun: {
      async findUnique() {
        return run;
      },
      async updateMany(args: any) {
        calls.updates.push(args);
        if (args.data.status === AnalysisRunStatus.running) {
          calls.events.push('claim');
          return { count: options.claimCount ?? 1 };
        }
        return { count: 1 };
      }
    }
  };
  const prisma = {
    analysisRun: {
      async updateMany(args: any) {
        calls.updates.push(args);
        return { count: 1 };
      }
    },
    documentEvidence: {
      async findUnique() {
        calls.documentReads += 1;
      }
    },
    textEvidence: {
      async findUnique(args: any) {
        calls.textReads.push(args);
        return {
          id: 'text-1',
          credentialId: options.textCredentialId ?? 'credential-1',
          content: 'The Complete Python Bootcamp From Zero to Hero in Python',
          sha256: options.textHash ?? TEXT_HASH,
          status: options.textStatus ?? TextEvidenceStatus.current
        };
      }
    },
    credential: {
      async findUnique(args: any) {
        calls.credentialReads.push(args);
        if (options.credential === null) return null;
        return (
          options.credential ?? {
            type: 'course',
            hours: null,
            credentialSubject: {}
          }
        );
      }
    },
    blockchainRecord: {
      async create() {
        calls.blockchainWrites += 1;
      }
    },
    async $transaction(callback: (client: typeof tx) => Promise<unknown>) {
      return callback(tx);
    }
  };
  const storage = {
    async saveDocument() {
      throw new Error('saveDocument must not be called');
    },
    async readDocument() {
      calls.storageReads += 1;
      throw new Error('readDocument must not be called for text runs');
    },
    async deleteDocument() {
      throw new Error('deleteDocument must not be called');
    }
  };
  const ai = {
    async analyzePdf() {
      calls.pdfCalls += 1;
      throw new Error('analyzePdf must not be called for text runs');
    },
    async analyzeText(input: any) {
      calls.events.push('ai');
      calls.ai.push(input);
      if (options.aiError) throw options.aiError;
      return {
        schemaVersion: 'semantic_analysis_v1',
        sourceType: 'text',
        status: options.artifactStatus ?? 'completed'
      };
    }
  };
  const semantic = {
    async persistForCredential(...args: any[]) {
      calls.semantic.push(args);
      if (options.semanticError) throw options.semanticError;
      return { id: 'semantic-1', status: options.artifactStatus ?? SemanticAnalysisStatus.completed };
    }
  };
  const service = new AnalysisRunExecutionService(
    prisma as never,
    ai as never,
    semantic as never,
    storage
  );
  Object.defineProperty(service, 'logger', {
    value: { error: (message: string) => calls.logs.push(message) }
  });
  return { service, calls };
}

test('executes a pending text run end-to-end and completes', async () => {
  const { service, calls } = setupText();
  const result = await service.executePendingTextRun('run-1');

  assert.deepEqual(calls.events.slice(0, 2), ['claim', 'ai']);
  assert.equal(calls.textReads[0].where.id, 'text-1');
  assert.equal(calls.ai[0].content, 'The Complete Python Bootcamp From Zero to Hero in Python');
  assert.equal(calls.storageReads, 0);
  assert.equal(calls.pdfCalls, 0);
  assert.equal(calls.semantic[0][0], 'credential-1');
  assert.equal(calls.semantic[0][2].analysisRunId, 'run-1');
  assert.equal(calls.updates[1].data.status, AnalysisRunStatus.completed);
  assert.deepEqual(result, {
    runReference: 'run-1',
    credentialReference: 'credential-1',
    status: AnalysisRunStatus.completed,
    semanticAnalysisReference: 'semantic-1',
    artifactStatus: SemanticAnalysisStatus.completed,
    sourceCount: 1,
    completedAt: result.completedAt
  });
  assert.equal(calls.blockchainWrites, 0);
});

test('text run sends declared credential metadata but omits languageHint', async () => {
  const { service, calls } = setupText({
    credential: {
      type: 'course',
      hours: 22.5,
      credentialSubject: {
        platform_name: 'Plataforma de Cursos Demo',
        modality: 'Online',
        external_url: 'https://example.com/course'
      }
    }
  });
  await service.executePendingTextRun('run-1');

  assert.deepEqual(calls.ai[0].metadata, {
    credentialType: 'course',
    platformName: 'Plataforma de Cursos Demo',
    modality: 'Online',
    hours: 22.5
  });
  assert.equal('languageHint' in calls.ai[0].metadata, false);
  assert.equal('externalUrl' in calls.ai[0].metadata, false);
  assert.deepEqual(calls.ai[0].sourceRefs, {
    textEvidenceId: 'text-1',
    credentialId: 'credential-1'
  });
});

test('partial text artifact still completes the operational run', async () => {
  const { service } = setupText({ artifactStatus: SemanticAnalysisStatus.partial });
  const result = await service.executePendingTextRun('run-1');
  assert.equal(result.status, AnalysisRunStatus.completed);
  assert.equal(result.artifactStatus, SemanticAnalysisStatus.partial);
});

test('document-sourced runs are rejected before claiming as a text run', async () => {
  const { service, calls } = setupText({
    sources: [
      {
        sourceType: AnalysisRunSourceType.document_evidence,
        documentEvidenceId: 'document-1',
        textEvidenceId: null,
        sourceSha256: TEXT_HASH
      }
    ]
  });
  await assert.rejects(service.executePendingTextRun('run-1'), ConflictException);
  assert.equal(calls.ai.length, 0);
});

test('combined mode is rejected with an honest not-implemented message, for both entry points', async () => {
  const combinedDocument = setupCombined(AnalysisRunInputMode.combined);
  await assert.rejects(
    combinedDocument.service.executePendingDocumentRun('run-1'),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.equal(
        (error.getResponse() as { message: string }).message,
        'El análisis combinado todavía no está implementado.'
      );
      return true;
    }
  );

  const combinedText = setupCombined(AnalysisRunInputMode.combined);
  await assert.rejects(
    combinedText.service.executePendingTextRun('run-1'),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.equal(
        (error.getResponse() as { message: string }).message,
        'El análisis combinado todavía no está implementado.'
      );
      return true;
    }
  );
});

function setupCombined(mode: AnalysisRunInputMode) {
  const run = {
    id: 'run-1',
    credentialId: 'credential-1',
    status: AnalysisRunStatus.pending,
    inputMode: mode,
    trigger: AnalysisRunTrigger.manual,
    requestedPipelineVersion: 'pipeline-v1',
    requestedTaxonomyVersion: 'taxonomy-v1',
    credential: { status: CredentialStatus.draft },
    sources: []
  };
  const tx = {
    analysisRun: {
      async findUnique() {
        return run;
      },
      async updateMany() {
        return { count: 1 };
      }
    }
  };
  const prisma = {
    analysisRun: { async updateMany() { return { count: 1 }; } },
    documentEvidence: { async findUnique() { return null; } },
    textEvidence: { async findUnique() { return null; } },
    credential: { async findUnique() { return null; } },
    async $transaction(callback: (client: typeof tx) => Promise<unknown>) {
      return callback(tx);
    }
  };
  const service = new AnalysisRunExecutionService(
    prisma as never,
    { async analyzePdf() {}, async analyzeText() {} } as never,
    { async persistForCredential() {} } as never,
    {
      async readDocument() {},
      async saveDocument() {},
      async deleteDocument() {}
    } as never
  );
  return { service };
}

test('rejects text run when TextEvidence belongs to a different credential', async () => {
  const { service, calls } = setupText({ textCredentialId: 'credential-other' });
  await assert.rejects(service.executePendingTextRun('run-1'), ConflictException);
  assert.equal(calls.updates.at(-1).data.errorCode, 'text_unavailable');
});

test('rejects text run when TextEvidence is not current', async () => {
  const { service, calls } = setupText({ textStatus: TextEvidenceStatus.replaced });
  await assert.rejects(service.executePendingTextRun('run-1'), ConflictException);
  assert.equal(calls.updates.at(-1).data.errorCode, 'text_unavailable');
});

test('text run hash mismatch fails with a sanitized text_unavailable code', async () => {
  const { service, calls } = setupText({ textHash: 'c'.repeat(64) });
  await assert.rejects(service.executePendingTextRun('run-1'), ConflictException);
  const failure = calls.updates.at(-1).data;
  assert.equal(failure.errorCode, 'text_unavailable');
  assert.equal(JSON.stringify(failure).includes('The Complete Python'), false);
});

test('text run AI failure marks the run failed with a safe error code', async () => {
  const { service, calls } = setupText({
    aiError: new AiServiceClientError('upstream secret', 'http', 409)
  });
  await assert.rejects(service.executePendingTextRun('run-1'), ServiceUnavailableException);
  assert.equal(calls.updates.at(-1).data.errorCode, 'ai_version_conflict');
});

test('text run semantic persistence failure marks failed without completing', async () => {
  const { service, calls } = setupText({ semanticError: new Error('raw artifact') });
  await assert.rejects(service.executePendingTextRun('run-1'), ServiceUnavailableException);
  assert.equal(calls.updates.at(-1).data.errorCode, 'semantic_persistence_failed');
  assert.equal(
    calls.updates.some((entry) => entry.data.status === AnalysisRunStatus.completed),
    false
  );
});

test('document runs keep working unaffected by the text execution path', async () => {
  const { service, calls } = setup();
  const result = await service.executePendingDocumentRun('run-1');
  assert.equal(result.status, AnalysisRunStatus.completed);
  assert.equal(calls.ai.length, 1);
});

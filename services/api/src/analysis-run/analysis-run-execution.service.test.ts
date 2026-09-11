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

/**
 * Doble del orquestador de F1.4 -- F1.6.
 *
 * F1.4 ya prueba la cadena interna real (source -> FastAPI -> F0.5 -> F1.2) con
 * 55 tests. Aqui se prueba OTRA cosa: la integracion con el lifecycle. Duplicar
 * la cadena dentro de estos tests no aportaria cobertura y ataria el lifecycle a
 * detalles internos que ya tienen su propio dueno.
 */
function fakeOrchestrator(options: {
  extractionError?: Error;
  coverageStatus?: string;
  sourceType?: string;
  derivationTrust?: string;
  perSource?: Record<string, Error | undefined>;
  order?: string[];
} = {}) {
  const calls: string[] = [];
  return {
    calls,
    orchestrator: {
      async ensureExtractionForAnalysisRunSource(analysisRunSourceId: string) {
        calls.push(analysisRunSourceId);
        options.order?.push('extraction');
        const perSource = options.perSource?.[analysisRunSourceId];
        if (perSource) throw perSource;
        if (options.extractionError) throw options.extractionError;
        return {
          analysisRunSourceId,
          artifact: {
            sourceType: options.sourceType ?? 'PDF_DOCUMENT',
            coverageStatus: options.coverageStatus ?? 'FULL',
            documentCanonicalText: 'TEXTO_CANONICO_QUE_NO_DEBE_LOGGEARSE'
          },
          extractionDerivationTrust: options.derivationTrust ?? 'PRODUCER_ASSUMED',
          artifactBlobSha256: 'b'.repeat(64)
        };
      }
    }
  };
}

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
  extractionError?: Error;
  coverageStatus?: string;
  perSourceExtractionError?: Record<string, Error | undefined>;
  documentKind?: DocumentEvidenceKind;
} = {}) {
  const calls = {
    updates: [] as any[], documents: [] as any[], reads: [] as string[],
    ai: [] as any[], semantic: [] as any[], credentialWrites: 0,
    blockchainWrites: 0, textReads: 0, events: [] as string[], logs: [] as string[],
    infoLogs: [] as string[], warnLogs: [] as string[],
    // Orden relativo extraccion/IA. Separado de `events` a proposito: esa lista
    // es la que los tests previos a F1.6 ya afirmaban, y no debe moverse.
    order: [] as string[]
  };
  const run = {
    id: 'run-1', credentialId: 'credential-1',
    status: options.runStatus ?? AnalysisRunStatus.pending,
    inputMode: options.mode ?? AnalysisRunInputMode.document,
    trigger: options.trigger ?? AnalysisRunTrigger.manual,
    requestedPipelineVersion: 'pipeline-v1', requestedTaxonomyVersion: 'taxonomy-v1',
    credential: { status: options.credentialStatus ?? CredentialStatus.draft },
    sources: options.sources ?? [{
      id: 'ars-doc-1',
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
        return { id: 'document-1', credentialId: 'credential-1',
          kind: options.documentKind ?? DocumentEvidenceKind.pdf,
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
      calls.order.push('ai');
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
  const extraction = fakeOrchestrator({
    extractionError: options.extractionError,
    coverageStatus: options.coverageStatus,
    perSource: options.perSourceExtractionError,
    order: calls.order
  });
  const service = new AnalysisRunExecutionService(
    prisma as never,
    ai as never,
    semantic as never,
    storage,
    extraction.orchestrator as never
  );
  Object.defineProperty(service, 'logger', {
    value: {
      error: (message: string) => calls.logs.push(message),
      log: (message: string) => calls.infoLogs.push(message),
      warn: (message: string) => calls.warnLogs.push(message)
    }
  });
  return {
    service,
    calls,
    extractionCalls: extraction.calls,
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
  extractionError?: Error;
  coverageStatus?: string;
} = {}) {
  const calls = {
    updates: [] as any[],
    textReads: [] as any[],
    credentialReads: [] as any[],
    documentReads: 0,
    storageReads: 0,
    pdfCalls: 0,
    infoLogs: [] as string[],
    warnLogs: [] as string[],
    order: [] as string[],
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
        id: 'ars-text-1',
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
      calls.order.push('ai');
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
  const extraction = fakeOrchestrator({
    extractionError: options.extractionError,
    coverageStatus: options.coverageStatus,
    sourceType: 'TEXT',
    derivationTrust: 'AUTHORITATIVE_CONTENT_MATCHED',
    order: calls.order
  });
  const service = new AnalysisRunExecutionService(
    prisma as never,
    ai as never,
    semantic as never,
    storage,
    extraction.orchestrator as never
  );
  Object.defineProperty(service, 'logger', {
    value: {
      error: (message: string) => calls.logs.push(message),
      log: (message: string) => calls.infoLogs.push(message),
      warn: (message: string) => calls.warnLogs.push(message)
    }
  });
  return { service, calls, extractionCalls: extraction.calls };
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
  // El orquestador lanza si llega a invocarse: estos runs se rechazan antes de
  // la fase de extraccion y ninguna llamada debe alcanzarlo.
  const service = new AnalysisRunExecutionService(
    prisma as never,
    { async analyzePdf() {}, async analyzeText() {} } as never,
    { async persistForCredential() {} } as never,
    {
      async readDocument() {},
      async saveDocument() {},
      async deleteDocument() {}
    } as never,
    {
      async ensureExtractionForAnalysisRunSource() {
        throw new Error('la extraccion no debe intentarse en un run rechazado');
      }
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

// ===========================================================================
// F1.6 — Integracion de source extraction en el lifecycle
//
// F1.4 ya prueba la cadena interna real con 55 tests. Lo que se prueba aqui es
// OTRA cosa: integracion, aislamiento de fallos, logging y ausencia de deriva.
// Por eso el orquestador es un doble.
// ===========================================================================

const SENTINEL = 'CENTINELA_FUENTE_7b2d';

function parsedLogs(messages: string[]): Array<Record<string, unknown>> {
  return messages.map((message) => JSON.parse(message) as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// §18 — Cero deriva en un run que hoy completa
// ---------------------------------------------------------------------------

test('F1.6 document: the successful run is unchanged and the slot gets populated', async () => {
  const { service, calls, extractionCalls } = setup();

  const result = await service.executePendingDocumentRun('run-1');

  // Exactamente el mismo resultado semantico que antes de F1.6.
  assert.equal(result.status, AnalysisRunStatus.completed);
  assert.equal(result.semanticAnalysisReference, 'semantic-1');
  assert.equal(calls.semantic.length, 1);
  assert.deepEqual(calls.events.slice(0, 2), ['claim', 'ai']);

  // Y ademas se intento la extraccion, con la fila CONGELADA de este run.
  assert.deepEqual(extractionCalls, ['ars-doc-1']);
  assert.equal(calls.warnLogs.length, 0);
});

test('F1.6 document: extraction runs after source validation and before the AI call', async () => {
  const { service, calls } = setup();
  await service.executePendingDocumentRun('run-1');

  assert.deepEqual(calls.order, ['extraction', 'ai']);
});

test('F1.6 text: the successful text run is unchanged and the slot gets populated', async () => {
  const { service, calls, extractionCalls } = setupText();

  const result = await service.executePendingTextRun('run-1');

  assert.equal(result.status, AnalysisRunStatus.completed);
  assert.deepEqual(calls.events.slice(0, 2), ['claim', 'ai']);
  assert.deepEqual(extractionCalls, ['ars-text-1']);
  assert.deepEqual(calls.order, ['extraction', 'ai']);
});

test('F1.6: only the frozen rows of THIS run are processed', async () => {
  // La fase recibe ids de `AnalysisRunSource` congelados en el claim. No hay
  // ninguna re-seleccion de "evidencia actual" en el borde del run: los ids
  // salen de la fila del run y de ningun otro sitio.
  const { service, extractionCalls } = setup({
    sources: [{
      id: 'ars-congelada',
      sourceType: AnalysisRunSourceType.document_evidence,
      documentEvidenceId: 'document-1', textEvidenceId: null, sourceSha256: HASH
    }]
  });

  await service.executePendingDocumentRun('run-1');
  assert.deepEqual(extractionCalls, ['ars-congelada']);
});

// ---------------------------------------------------------------------------
// §19 — Un fallo de infraestructura de extraccion es best-effort
// ---------------------------------------------------------------------------

test('F1.6: an extraction failure does not block the semantic run', async () => {
  const { service, calls } = setup({
    extractionError: new AiServiceClientError('AI Service is unavailable.', 'unavailable')
  });

  const result = await service.executePendingDocumentRun('run-1');

  // El analisis semantico corrio igual y el run termino como antes de F1.6.
  assert.equal(result.status, AnalysisRunStatus.completed);
  assert.equal(calls.semantic.length, 1);
  // El intento SI ocurrio y despues fallo; la IA corrio a continuacion. Que
  // 'extraction' figure antes que 'ai' es justamente lo que hay que probar.
  assert.deepEqual(calls.order, ['extraction', 'ai']);
});

test('F1.6: an extraction failure never becomes run.errorCode or errorMessage', async () => {
  const { service, calls } = setup({
    extractionError: new Error('storage down')
  });

  await service.executePendingDocumentRun('run-1');

  const completion = calls.updates.at(-1).data;
  assert.equal(completion.status, AnalysisRunStatus.completed);
  assert.equal(completion.errorCode, null);
  assert.equal(completion.errorMessage, null);
  // Los campos de error terminal NO se reutilizan para warnings, y no se
  // agregaron columnas: la señal persistida es que el slot sigue ABSENT.
  assert.equal(calls.logs.length, 0, 'no se emite un error de run');
  assert.equal(calls.warnLogs.length, 1, 'se emite un warning seguro');
});

test('F1.6: the best-effort warning carries only safe identifiers', async () => {
  const failure = Object.assign(
    new Error(`fallo con ${SENTINEL}`),
    { name: 'SourceExtractionTrustError', code: 'SOURCE_SHA_MISMATCH' }
  );
  Object.assign(failure, {
    detail: { invariant: 'artifact_sha_does_not_match_frozen_run_sha' }
  });

  const { service, calls } = setup({ extractionError: failure });
  await service.executePendingDocumentRun('run-1');

  const [event] = parsedLogs(calls.warnLogs);
  assert.equal(event.event, 'source_extraction_failed');
  assert.equal(event.analysisRunId, 'run-1');
  assert.equal(event.analysisRunSourceId, 'ars-doc-1');
  assert.equal(event.errorClass, 'SourceExtractionTrustError');
  assert.equal(event.errorCode, 'SOURCE_SHA_MISMATCH');
  assert.equal(event.invariant, 'artifact_sha_does_not_match_frozen_run_sha');
  // El mensaje NO se loggea: F1.5 dejo documentado que el de
  // AiServiceClientError incorpora el `detail` del upstream.
  assert.ok(!calls.warnLogs[0].includes(SENTINEL));
  assert.deepEqual(Object.keys(event).sort(), [
    'analysisRunId',
    'analysisRunSourceId',
    'errorClass',
    'errorCode',
    'event',
    'invariant'
  ]);
});

test('F1.6: an unbounded error code or class is dropped, not echoed', async () => {
  const { service, calls } = setup({
    extractionError: Object.assign(new Error('x'), {
      name: `Clase con ${SENTINEL} y espacios`,
      code: `codigo ilegal ${SENTINEL}`
    })
  });
  await service.executePendingDocumentRun('run-1');

  const [event] = parsedLogs(calls.warnLogs);
  assert.equal(event.errorClass, 'Error');
  assert.equal(event.errorCode, null);
  assert.ok(!calls.warnLogs[0].includes(SENTINEL));
});

// ---------------------------------------------------------------------------
// §20 — Un fallo preexistente del run sigue fallando
// ---------------------------------------------------------------------------

test('F1.6: an existing source SHA mismatch still fails, and extraction is never attempted', async () => {
  const { service, calls, extractionCalls } = setup({ documentHash: 'c'.repeat(64) });

  await assert.rejects(service.executePendingDocumentRun('run-1'), ConflictException);

  assert.equal(calls.updates.at(-1).data.errorCode, 'document_unavailable');
  // El punto de insercion esta DESPUES de la validacion que este run ya exigia.
  assert.deepEqual(extractionCalls, []);
});

test('F1.6: an existing AI failure still fails the run, even with extraction succeeding', async () => {
  const { service, calls, extractionCalls } = setup({
    aiError: new AiServiceClientError('timeout', 'timeout')
  });

  await assert.rejects(
    service.executePendingDocumentRun('run-1'),
    ServiceUnavailableException
  );

  assert.equal(calls.updates.at(-1).data.status, AnalysisRunStatus.failed);
  assert.equal(calls.updates.at(-1).data.errorCode, 'ai_timeout');
  // Contrato A: run failed + slot PRESENT es un estado VALIDO. Una extraccion
  // valida ya persistida no se revierte porque el analisis falle despues.
  assert.deepEqual(extractionCalls, ['ars-doc-1']);
  assert.equal(calls.infoLogs.length, 1, 'la extraccion se registro como exitosa');
});

test('F1.6: a storage failure of the existing run still fails it', async () => {
  const { service, calls } = setup({
    storageError: new DocumentStorageError('not_found', 'sin objeto')
  });

  await assert.rejects(service.executePendingDocumentRun('run-1'));
  assert.equal(calls.updates.at(-1).data.errorCode, 'document_unavailable');
});

// ---------------------------------------------------------------------------
// Contrato A — status del run y estado del slot son ortogonales
// ---------------------------------------------------------------------------

for (const [label, options, expectedStatus, expectsExtractionOk] of [
  ['completed + PRESENT', {}, AnalysisRunStatus.completed, true],
  [
    'completed + ABSENT',
    { extractionError: new Error('extraction down') },
    AnalysisRunStatus.completed,
    false
  ],
  [
    'failed + PRESENT',
    { aiError: new AiServiceClientError('timeout', 'timeout') },
    AnalysisRunStatus.failed,
    true
  ],
  [
    'failed + ABSENT',
    {
      extractionError: new Error('extraction down'),
      aiError: new AiServiceClientError('timeout', 'timeout')
    },
    AnalysisRunStatus.failed,
    false
  ]
] as const) {
  test(`F1.6 orthogonality: ${label} is a valid state`, async () => {
    const { service, calls } = setup(options as never);

    await service.executePendingDocumentRun('run-1').catch(() => undefined);

    assert.equal(calls.updates.at(-1).data.status, expectedStatus);
    assert.equal(calls.infoLogs.length, expectsExtractionOk ? 1 : 0);
    assert.equal(calls.warnLogs.length, expectsExtractionOk ? 0 : 1);
  });
}

// ---------------------------------------------------------------------------
// §21 — Matriz de coverage
// ---------------------------------------------------------------------------

for (const coverageStatus of ['FULL', 'PARTIAL', 'FAILED'] as const) {
  test(`F1.6: coverage ${coverageStatus} is a SUCCESSFUL extraction attempt`, async () => {
    const { service, calls } = setup({ coverageStatus });

    const result = await service.executePendingDocumentRun('run-1');

    assert.equal(result.status, AnalysisRunStatus.completed);
    assert.equal(calls.warnLogs.length, 0, 'no es un fallo de extraccion');

    const [event] = parsedLogs(calls.infoLogs);
    assert.equal(event.event, 'source_extraction_persisted');
    assert.equal(event.coverageStatus, coverageStatus);
    assert.equal(event.extractionDerivationTrust, 'PRODUCER_ASSUMED');
    assert.equal(event.sourceType, 'PDF_DOCUMENT');
    assert.deepEqual(Object.keys(event).sort(), [
      'analysisRunId',
      'analysisRunSourceId',
      'coverageStatus',
      'event',
      'extractionDerivationTrust',
      'sourceType'
    ]);
  });
}

// ---------------------------------------------------------------------------
// §22 — Aislamiento por fuente
// ---------------------------------------------------------------------------

test('F1.6: a per-source failure does not stop the other sources', async () => {
  // Se ejercita la FASE directamente. El lifecycle productivo pasa hoy una sola
  // fuente por modo, y `combined` sigue sin implementarse; pero el aislamiento
  // por fuente es una propiedad de la fase y debe seguir siendo cierta el dia
  // que exista un modo multi-fuente.
  const { service, calls, extractionCalls } = setup({
    perSourceExtractionError: { 'ars-b': new Error('la segunda falla') }
  });

  await (service as unknown as {
    attemptSourceExtraction(claimed: unknown): Promise<void>;
  }).attemptSourceExtraction({
    id: 'run-1',
    analysisRunSourceIds: ['ars-a', 'ars-b', 'ars-c']
  });

  // Ninguna fuente se salta por el fallo de otra, y el orden es determinista.
  assert.deepEqual(extractionCalls, ['ars-a', 'ars-b', 'ars-c']);
  assert.equal(calls.infoLogs.length, 2, 'las dos que funcionaron se persistieron');
  assert.equal(calls.warnLogs.length, 1);
  // Sin transaccion global: lo ya persistido no se revierte.
  assert.equal(parsedLogs(calls.warnLogs)[0].analysisRunSourceId, 'ars-b');
});

test('F1.6: the extraction phase never throws, whatever the orchestrator does', async () => {
  const { service } = setup({ extractionError: new Error('boom') });

  await (service as unknown as {
    attemptSourceExtraction(claimed: unknown): Promise<void>;
  }).attemptSourceExtraction({ id: 'run-1', analysisRunSourceIds: ['ars-x'] });
});

// ---------------------------------------------------------------------------
// Contrato C — `combined` sigue sin implementarse
// ---------------------------------------------------------------------------

test('F1.6: a combined run behaves exactly as before and never reaches extraction', async () => {
  // El orquestador del fake de `setupCombined` lanza si se lo invoca: llegar al
  // final de este test prueba que no se toco. La source extraction NO es motivo
  // para empezar a ejecutar las dos fuentes de un run combined.
  const { service } = setupCombined(AnalysisRunInputMode.combined);

  await assert.rejects(service.executePendingDocumentRun('run-1'), (error: unknown) => {
    assert.ok(error instanceof ConflictException);
    assert.equal(
      (error as ConflictException).message,
      'El análisis combinado todavía no está implementado.'
    );
    return true;
  });

  const asText = setupCombined(AnalysisRunInputMode.combined);
  await assert.rejects(asText.service.executePendingTextRun('run-1'), ConflictException);
});

// ---------------------------------------------------------------------------
// §24 y contrato E — evidencia no soportada
// ---------------------------------------------------------------------------

test('F1.6: an image DocumentEvidence still fails the run exactly as before', async () => {
  // El ejecutor ya rechazaba `kind != pdf` ANTES de F1.6, y ese rechazo ocurre
  // antes del punto de insercion. Best-effort no convierte en exito un fallo
  // preexistente: el run falla igual que siempre y la extraccion ni se intenta.
  const { service, calls, extractionCalls } = setup({ documentKind: DocumentEvidenceKind.image });

  await assert.rejects(service.executePendingDocumentRun('run-1'), ConflictException);

  assert.equal(calls.updates.at(-1).data.errorCode, 'document_unavailable');
  assert.deepEqual(extractionCalls, [], 'no se intenta extraer una imagen');
  assert.equal(calls.warnLogs.length, 0);
});

test('F1.6: an unsupported-source rejection from F1.4 is a safe non-blocking warning', async () => {
  // Si el orquestador rechaza la fuente por su propia regla de elegibilidad, es
  // un fallo especifico de extraccion: warning seguro, slot ABSENT, y el
  // lifecycle existente decide el resto. No se fabrica un PDF `FAILED`.
  const unsupported = Object.assign(new Error('no soportada'), {
    name: 'SourceExtractionOrchestrationError',
    code: 'DOCUMENT_SOURCE_NOT_SUPPORTED_FOR_EXTRACTION',
    detail: { invariant: 'document_kind_is_not_pdf' }
  });
  const { service, calls } = setup({ extractionError: unsupported });

  const result = await service.executePendingDocumentRun('run-1');

  assert.equal(result.status, AnalysisRunStatus.completed);
  const [event] = parsedLogs(calls.warnLogs);
  assert.equal(event.errorCode, 'DOCUMENT_SOURCE_NOT_SUPPORTED_FOR_EXTRACTION');
  assert.equal(event.invariant, 'document_kind_is_not_pdf');
});

// ---------------------------------------------------------------------------
// Contrato D — F1.6 no agrega reintentos
// ---------------------------------------------------------------------------

test('F1.6: the phase runs once per execution, with no scheduler or queue of its own', async () => {
  const { service, extractionCalls } = setup();

  await service.executePendingDocumentRun('run-1');
  assert.deepEqual(extractionCalls, ['ars-doc-1'], 'una vez, no un bucle de reintento');

  // F1.6 no reintenta por su cuenta: si una extraccion best-effort falla y el
  // run completa, el slot puede quedar ABSENT. Lo unico que se conserva es que
  // el orquestador de F1.4 es idempotente, asi que una capa futura puede volver
  // a invocarlo. El lifecycle no ofrece ese mecanismo.
  const failing = setup({ extractionError: new Error('transitorio') });
  await failing.service.executePendingDocumentRun('run-1');
  assert.deepEqual(failing.extractionCalls, ['ars-doc-1'], 'un intento, sin reintento');
});

// ---------------------------------------------------------------------------
// §25 — Regresion de privacidad en los logs nuevos
// ---------------------------------------------------------------------------

test('F1.6 privacy: no captured log contains source material', async () => {
  const { service, calls } = setup({ coverageStatus: 'PARTIAL' });
  await service.executePendingDocumentRun('run-1');

  const everything = [
    ...calls.infoLogs,
    ...calls.warnLogs,
    ...calls.logs
  ].join('\n');

  // El artifact devuelto por el doble lleva canonical text a proposito.
  for (const forbidden of [
    'TEXTO_CANONICO_QUE_NO_DEBE_LOGGEARSE',
    'internal-key',
    'documentCanonicalText',
    'artifactBlobSha256',
    'exactExcerpt'
  ]) {
    assert.ok(!everything.includes(forbidden), `${forbidden} aparecio en los logs`);
  }
  assert.ok(everything.includes('PARTIAL'), 'control: si se loggea el coverage');
});

test('F1.6 privacy: control — the fake really returns canonical text', async () => {
  // Sin esto el test anterior pasaria con un doble que no devolviera nada.
  const { orchestrator } = fakeOrchestrator();
  const persisted = await orchestrator.ensureExtractionForAnalysisRunSource('ars-1');
  assert.equal(
    persisted.artifact.documentCanonicalText,
    'TEXTO_CANONICO_QUE_NO_DEBE_LOGGEARSE'
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AnalysisRunInputMode,
  AnalysisRunSourceType,
  AnalysisRunStatus,
  AnalysisRunTrigger,
  DocumentEvidenceKind,
  DocumentEvidenceStatus
} from '@prisma/client';

import { AutomaticDocumentAnalysisService } from './automatic-document-analysis.service';

function setup(options: {
  document?: null | {
    id: string;
    kind: DocumentEvidenceKind;
    mimeType: string;
  };
  existingRun?: { id: string } | null;
  executionError?: Error;
} = {}) {
  const calls = {
    documents: [] as unknown[],
    existingRuns: [] as unknown[],
    creates: [] as unknown[],
    executions: [] as string[],
    textEvidenceReads: 0,
    credentialWrites: 0,
    blockchainWrites: 0
  };
  const document =
    options.document === undefined
      ? {
          id: 'document-1',
          kind: DocumentEvidenceKind.pdf,
          mimeType: 'application/pdf'
        }
      : options.document;
  const service = new AutomaticDocumentAnalysisService(
    {
      documentEvidence: {
        async findFirst(args: unknown) {
          calls.documents.push(args);
          return document;
        }
      },
      textEvidence: {
        async findFirst() {
          calls.textEvidenceReads += 1;
        }
      },
      credential: {
        async update() {
          calls.credentialWrites += 1;
        }
      },
      blockchainRecord: {
        async create() {
          calls.blockchainWrites += 1;
        }
      },
      analysisRun: {
        async findFirst(args: unknown) {
          calls.existingRuns.push(args);
          return options.existingRun ?? null;
        }
      }
    } as never,
    {
      async createPendingRun(input: unknown) {
        calls.creates.push(input);
        return { runReference: 'run-1' };
      }
    } as never,
    {
      async executePendingDocumentRun(runId: string) {
        calls.executions.push(runId);
        if (options.executionError) throw options.executionError;
      }
    } as never
  );

  return { service, calls };
}

test('current PDF creates and executes one backend-controlled system run', async () => {
  const { service, calls } = setup();

  await service.analyzeIssuedCredentialIfEligible('credential-1');

  assert.deepEqual(calls.documents, [
    {
      where: {
        credentialId: 'credential-1',
        status: DocumentEvidenceStatus.current
      },
      orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, kind: true, mimeType: true }
    }
  ]);
  assert.deepEqual(calls.creates, [
    {
      credentialId: 'credential-1',
      requestedByUserId: null,
      inputMode: AnalysisRunInputMode.document,
      trigger: AnalysisRunTrigger.system,
      requestedPipelineVersion: 'unversioned_current',
      requestedTaxonomyVersion: 'unversioned_current'
    }
  ]);
  assert.deepEqual(calls.executions, ['run-1']);
  assert.equal(calls.textEvidenceReads, 0);
  assert.equal(calls.credentialWrites, 0);
  assert.equal(calls.blockchainWrites, 0);
});

test('missing or non-PDF current evidence skips analysis', async () => {
  for (const document of [
    null,
    {
      id: 'document-image',
      kind: DocumentEvidenceKind.image,
      mimeType: 'image/png'
    },
    {
      id: 'document-mismatch',
      kind: DocumentEvidenceKind.pdf,
      mimeType: 'image/png'
    }
  ]) {
    const { service, calls } = setup({ document });
    await service.analyzeIssuedCredentialIfEligible('credential-1');
    assert.equal(calls.existingRuns.length, 0);
    assert.equal(calls.creates.length, 0);
    assert.equal(calls.executions.length, 0);
  }
});

test('existing active or completed run for the exact evidence is reused', async () => {
  const { service, calls } = setup({ existingRun: { id: 'existing-run' } });

  await service.analyzeIssuedCredentialIfEligible('credential-1');

  assert.deepEqual(calls.existingRuns, [
    {
      where: {
        credentialId: 'credential-1',
        inputMode: AnalysisRunInputMode.document,
        status: {
          in: [
            AnalysisRunStatus.pending,
            AnalysisRunStatus.running,
            AnalysisRunStatus.completed
          ]
        },
        sources: {
          some: {
            sourceType: AnalysisRunSourceType.document_evidence,
            documentEvidenceId: 'document-1'
          }
        }
      },
      select: { id: true }
    }
  ]);
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.executions.length, 0);
});

test('execution failure propagates only to the best-effort caller after run creation', async () => {
  const failure = new Error('private FastAPI URL and storage key');
  const { service, calls } = setup({ executionError: failure });

  await assert.rejects(
    service.analyzeIssuedCredentialIfEligible('credential-1'),
    failure
  );
  assert.equal(calls.creates.length, 1);
  assert.deepEqual(calls.executions, ['run-1']);
});

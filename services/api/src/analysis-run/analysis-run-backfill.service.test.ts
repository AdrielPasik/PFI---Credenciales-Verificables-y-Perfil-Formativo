import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AnalysisRunStatus,
  CredentialStatus,
  DocumentEvidenceKind
} from '@prisma/client';

import { AnalysisRunBackfillService } from './analysis-run-backfill.service';

function pdfDocument(id = 'document-1') {
  return { id, kind: DocumentEvidenceKind.pdf, mimeType: 'application/pdf' };
}

function credentialRow(overrides: Partial<{
  id: string;
  status: CredentialStatus;
  title: string;
  subjectUserId: string;
  documentEvidences: Array<{ id: string; kind: DocumentEvidenceKind; mimeType: string }>;
}> = {}) {
  return {
    id: 'credential-1',
    status: CredentialStatus.issued,
    title: 'Arquitectura de software',
    subjectUserId: 'holder-1',
    documentEvidences: [pdfDocument()],
    ...overrides
  };
}

function setup(options: {
  credentials?: ReturnType<typeof credentialRow>[];
  userMatches?: Array<{ id: string }>;
  existingRunStatuses?: AnalysisRunStatus[];
  executionError?: Error;
  runErrorCode?: string | null;
} = {}) {
  const calls = {
    userFindMany: [] as unknown[],
    credentialFindMany: [] as unknown[],
    credentialFindUnique: [] as unknown[],
    analysisRunFindMany: [] as unknown[],
    analysisRunFindUnique: [] as unknown[],
    createPendingRun: [] as unknown[],
    executePendingDocumentRun: [] as string[],
    rebuildForUser: [] as string[]
  };

  const credentials = options.credentials ?? [credentialRow()];
  const existingRunStatuses = options.existingRunStatuses ?? [];

  const prisma = {
    user: {
      async findMany(args: unknown) {
        calls.userFindMany.push(args);
        return options.userMatches ?? [{ id: 'holder-1' }];
      }
    },
    credential: {
      async findMany(args: unknown) {
        calls.credentialFindMany.push(args);
        return credentials;
      },
      async findUnique(args: { where: { id: string } }) {
        calls.credentialFindUnique.push(args);
        return credentials.find((c) => c.id === args.where.id) ?? null;
      }
    },
    analysisRun: {
      async findMany(args: unknown) {
        calls.analysisRunFindMany.push(args);
        return existingRunStatuses.map((status) => ({ status }));
      },
      async findUnique(args: unknown) {
        calls.analysisRunFindUnique.push(args);
        return { errorCode: options.runErrorCode ?? 'ai_unavailable' };
      }
    }
  };

  let runCounter = 0;
  const analysisRunService = {
    async createPendingRun(input: unknown) {
      calls.createPendingRun.push(input);
      runCounter += 1;
      return { runReference: `run-${runCounter}` };
    }
  };

  const executionService = {
    async executePendingDocumentRun(runId: string) {
      calls.executePendingDocumentRun.push(runId);
      if (options.executionError) throw options.executionError;
      return {
        runReference: runId,
        credentialReference: 'credential-1',
        status: AnalysisRunStatus.completed,
        semanticAnalysisReference: `semantic-${runId}`,
        artifactStatus: 'completed',
        sourceCount: 1,
        completedAt: '2026-08-09T10:00:00.000Z'
      };
    }
  };

  const formativeProfileService = {
    async rebuildForUser(userId: string) {
      calls.rebuildForUser.push(userId);
      return { userId, currentProfile: null };
    }
  };

  const service = new AnalysisRunBackfillService(
    prisma as never,
    analysisRunService as never,
    executionService as never,
    formativeProfileService as never
  );

  return { service, calls };
}

test('requires exactly one selector: fails with none and with both', async () => {
  const { service } = setup();

  await assert.rejects(service.run({}, { force: false, execute: false, rebuildProfile: false }));
  await assert.rejects(
    service.run(
      { holderEmail: 'holder.demo@example.com', credentialId: 'credential-1' },
      { force: false, execute: false, rebuildProfile: false }
    )
  );
});

test('dry-run (no --execute) does not write and does not call AI, but reports planned', async () => {
  const { service, calls } = setup();

  const summary = await service.run(
    { holderEmail: 'holder.demo@example.com' },
    { force: false, execute: false, rebuildProfile: false }
  );

  assert.equal(summary.dryRun, true);
  assert.equal(calls.createPendingRun.length, 0);
  assert.equal(calls.executePendingDocumentRun.length, 0);
  assert.equal(calls.rebuildForUser.length, 0);
  assert.equal(summary.planned, 1);
  assert.equal(summary.processed, 0);
  assert.equal(summary.results[0].outcome, 'planned');
});

test('--holderEmail resolves the exact user by normalized email and selects only issued credentials', async () => {
  const { service, calls } = setup();

  await service.run(
    { holderEmail: '  Holder.Demo@Example.com  ' },
    { force: false, execute: false, rebuildProfile: false }
  );

  assert.deepEqual(calls.userFindMany, [
    {
      where: { email: { equals: 'holder.demo@example.com', mode: 'insensitive' } },
      select: { id: true },
      take: 2
    }
  ]);
  const credentialQuery = calls.credentialFindMany[0] as { where: Record<string, unknown> };
  assert.deepEqual(credentialQuery.where, {
    subjectUserId: 'holder-1',
    status: CredentialStatus.issued
  });
});

test('unknown holderEmail fails safely without guessing a match', async () => {
  const { service } = setup({ userMatches: [] });

  await assert.rejects(
    service.run(
      { holderEmail: 'unknown@example.com' },
      { force: false, execute: false, rebuildProfile: false }
    )
  );
});

test('--credentialId works without holderEmail', async () => {
  const { service, calls } = setup({
    credentials: [credentialRow({ id: 'credential-9' })]
  });

  const summary = await service.run(
    { credentialId: 'credential-9' },
    { force: false, execute: false, rebuildProfile: false }
  );

  assert.equal(calls.userFindMany.length, 0);
  assert.equal(summary.selector, 'credentialId');
  assert.equal(summary.candidatesFound, 1);
  assert.equal(summary.results[0].credentialId, 'credential-9');
});

test('credential without current PDF evidence is skipped with a clear reason', async () => {
  const { service, calls } = setup({
    credentials: [credentialRow({ documentEvidences: [] })]
  });

  const summary = await service.run(
    { credentialId: 'credential-1' },
    { force: false, execute: true, rebuildProfile: false }
  );

  assert.equal(summary.results[0].outcome, 'skipped');
  assert.equal(summary.results[0].skipReason, 'no_current_document_evidence');
  assert.equal(calls.createPendingRun.length, 0);
});

test('credential with non-PDF current evidence is skipped', async () => {
  const { service } = setup({
    credentials: [
      credentialRow({
        documentEvidences: [
          { id: 'doc-image', kind: DocumentEvidenceKind.image, mimeType: 'image/png' }
        ]
      })
    ]
  });

  const summary = await service.run(
    { credentialId: 'credential-1' },
    { force: false, execute: true, rebuildProfile: false }
  );

  assert.equal(summary.results[0].outcome, 'skipped');
  assert.equal(summary.results[0].skipReason, 'non_pdf_evidence');
});

test('draft or revoked credentials are skipped, not processed', async () => {
  const { service, calls } = setup({
    credentials: [credentialRow({ status: CredentialStatus.revoked })]
  });

  const summary = await service.run(
    { credentialId: 'credential-1' },
    { force: false, execute: true, rebuildProfile: false }
  );

  assert.equal(summary.results[0].outcome, 'skipped');
  assert.equal(summary.results[0].skipReason, 'not_issued');
  assert.equal(calls.analysisRunFindMany.length, 0);
});

test('without --force, a credential already analyzed for the current document is skipped', async () => {
  const { service, calls } = setup({
    existingRunStatuses: [AnalysisRunStatus.completed]
  });

  const summary = await service.run(
    { credentialId: 'credential-1' },
    { force: false, execute: true, rebuildProfile: false }
  );

  assert.equal(summary.results[0].outcome, 'skipped');
  assert.equal(summary.results[0].skipReason, 'already_analyzed');
  assert.equal(calls.createPendingRun.length, 0);
  const query = calls.analysisRunFindMany[0] as { where: Record<string, unknown> };
  assert.deepEqual(query.where, {
    credentialId: 'credential-1',
    inputMode: 'document',
    status: { in: [AnalysisRunStatus.pending, AnalysisRunStatus.running, AnalysisRunStatus.completed] },
    sources: {
      some: { sourceType: 'document_evidence', documentEvidenceId: 'document-1' }
    }
  });
});

test('with --force, a credential already completed for the current document creates a new run', async () => {
  const { service, calls } = setup({
    existingRunStatuses: [AnalysisRunStatus.completed]
  });

  const summary = await service.run(
    { credentialId: 'credential-1' },
    { force: true, execute: true, rebuildProfile: false }
  );

  assert.equal(summary.results[0].outcome, 'processed');
  assert.equal(calls.createPendingRun.length, 1);
});

test('--force never overrides a pending or running run for the same current document', async () => {
  const pendingRun = setup({ existingRunStatuses: [AnalysisRunStatus.pending] });
  const pendingSummary = await pendingRun.service.run(
    { credentialId: 'credential-1' },
    { force: true, execute: true, rebuildProfile: false }
  );
  assert.equal(pendingSummary.results[0].skipReason, 'already_pending');
  assert.equal(pendingRun.calls.createPendingRun.length, 0);

  const runningRun = setup({ existingRunStatuses: [AnalysisRunStatus.running] });
  const runningSummary = await runningRun.service.run(
    { credentialId: 'credential-1' },
    { force: true, execute: true, rebuildProfile: false }
  );
  assert.equal(runningSummary.results[0].skipReason, 'already_running');
  assert.equal(runningRun.calls.createPendingRun.length, 0);
});

test('a failed or canceled prior run never blocks a retry, even without --force', async () => {
  const { service, calls } = setup({
    existingRunStatuses: [AnalysisRunStatus.failed, AnalysisRunStatus.canceled]
  });

  const summary = await service.run(
    { credentialId: 'credential-1' },
    { force: false, execute: true, rebuildProfile: false }
  );

  assert.equal(summary.results[0].outcome, 'processed');
  assert.equal(calls.createPendingRun.length, 1);
});

test('replaced evidence does not block a new run for the current document (only current document id is checked)', async () => {
  // existingRunStatuses simula un run completed, pero el mock de
  // analysisRun.findMany ya filtra por documentEvidenceId=document-1 (el
  // current de este fixture) via el query real -- este test confirma que
  // el query pasado a Prisma referencia el documento CURRENT, no cualquier
  // documento historico de la credencial.
  const { service, calls } = setup({
    existingRunStatuses: [],
    credentials: [credentialRow({ documentEvidences: [pdfDocument('document-2-current')] })]
  });

  await service.run(
    { credentialId: 'credential-1' },
    { force: false, execute: true, rebuildProfile: false }
  );

  const query = calls.analysisRunFindMany[0] as { where: { sources: { some: { documentEvidenceId: string } } } };
  assert.equal(query.where.sources.some.documentEvidenceId, 'document-2-current');
});

test('an error on one credential does not stop the rest of the batch', async () => {
  const credentials = [
    credentialRow({ id: 'credential-fail', documentEvidences: [pdfDocument('doc-a')] }),
    credentialRow({ id: 'credential-ok', documentEvidences: [pdfDocument('doc-b')] })
  ];
  const prisma = {
    user: { async findMany() { return [{ id: 'holder-1' }]; } },
    credential: {
      async findMany() { return credentials; },
      async findUnique(args: { where: { id: string } }) {
        return credentials.find((c) => c.id === args.where.id) ?? null;
      }
    },
    analysisRun: {
      async findMany() { return []; },
      async findUnique() { return { errorCode: 'ai_unavailable' }; }
    }
  };
  let runCounter = 0;
  const analysisRunService = {
    async createPendingRun() {
      runCounter += 1;
      return { runReference: `run-${runCounter}` };
    }
  };
  let executionCallIndex = 0;
  const executionService = {
    async executePendingDocumentRun(runId: string) {
      executionCallIndex += 1;
      if (executionCallIndex === 1) {
        throw new Error('sanitized upstream failure');
      }
      return {
        runReference: runId,
        credentialReference: 'credential-ok',
        status: AnalysisRunStatus.completed,
        semanticAnalysisReference: 'semantic-ok',
        artifactStatus: 'completed',
        sourceCount: 1,
        completedAt: '2026-08-09T10:00:00.000Z'
      };
    }
  };
  const formativeProfileService = { async rebuildForUser() { return null; } };
  const service = new AnalysisRunBackfillService(
    prisma as never,
    analysisRunService as never,
    executionService as never,
    formativeProfileService as never
  );

  const summary = await service.run(
    { holderEmail: 'holder.demo@example.com' },
    { force: false, execute: true, rebuildProfile: false }
  );

  assert.equal(summary.processed, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.results.find((r) => r.credentialId === 'credential-fail')?.outcome, 'failed');
  assert.equal(summary.results.find((r) => r.credentialId === 'credential-ok')?.outcome, 'processed');
});

test('failed executions report a safe errorCode without exposing raw error details', async () => {
  const { service } = setup({
    executionError: new Error('raw upstream detail with storageKey abc123 and a token xyz'),
    runErrorCode: 'ai_unavailable'
  });

  const summary = await service.run(
    { credentialId: 'credential-1' },
    { force: false, execute: true, rebuildProfile: false }
  );

  assert.equal(summary.results[0].outcome, 'failed');
  assert.equal(summary.results[0].errorCode, 'ai_unavailable');
  assert.equal(JSON.stringify(summary).includes('storageKey'), false);
  assert.equal(JSON.stringify(summary).includes('token xyz'), false);
});

test('--rebuildProfile rebuilds the holder profile after successful executions, using the internal service', async () => {
  const { service, calls } = setup();

  const summary = await service.run(
    { credentialId: 'credential-1' },
    { force: false, execute: true, rebuildProfile: true }
  );

  assert.deepEqual(calls.rebuildForUser, ['holder-1']);
  assert.equal(summary.profileRebuilt, true);
});

test('--rebuildProfile is skipped (not called) when nothing succeeded', async () => {
  const { service, calls } = setup({
    credentials: [credentialRow({ documentEvidences: [] })]
  });

  const summary = await service.run(
    { credentialId: 'credential-1' },
    { force: false, execute: true, rebuildProfile: true }
  );

  assert.equal(calls.rebuildForUser.length, 0);
  assert.equal(summary.profileRebuilt, false);
  assert.equal(summary.profileRebuildSkippedReason, 'no_successful_executions');
});

test('--rebuildProfile is skipped in dry-run even if requested', async () => {
  const { service, calls } = setup();

  const summary = await service.run(
    { credentialId: 'credential-1' },
    { force: false, execute: false, rebuildProfile: true }
  );

  assert.equal(calls.rebuildForUser.length, 0);
  assert.equal(summary.profileRebuildSkippedReason, 'dry_run');
});

test('result payload never leaks storageKey, raw artifacts or analysisJson', async () => {
  const { service } = setup();

  const summary = await service.run(
    { credentialId: 'credential-1' },
    { force: false, execute: true, rebuildProfile: false }
  );

  const serialized = JSON.stringify(summary);
  for (const forbidden of ['storageKey', 'analysisJson', 'textForEmbedding', 'Authorization', 'DATABASE_URL']) {
    assert.equal(serialized.includes(forbidden), false, `leaked ${forbidden}`);
  }
});

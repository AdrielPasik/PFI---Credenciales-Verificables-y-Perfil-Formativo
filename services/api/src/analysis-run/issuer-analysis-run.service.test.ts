import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException
} from '@nestjs/common';
import {
  AnalysisRunInputMode,
  AnalysisRunSourceType,
  AnalysisRunStatus,
  AnalysisRunTrigger,
  CredentialStatus,
  SemanticAnalysisStatus
} from '@prisma/client';

import { IssuerAnalysisRunService } from './issuer-analysis-run.service';

function setup(options: {
  authorizeError?: Error;
  credential?: { id: string; status: CredentialStatus } | null;
  createError?: Error;
  executeError?: Error;
} = {}) {
  const calls = {
    events: [] as string[],
    authorizations: [] as unknown[],
    credentialQueries: [] as unknown[],
    creates: [] as any[],
    executions: [] as string[],
    credentialWrites: 0,
    textReads: 0,
    blockchainWrites: 0,
    directAiCalls: 0,
    directStorageReads: 0
  };
  const prisma = {
    credential: {
      async findFirst(args: unknown) {
        calls.events.push('credential');
        calls.credentialQueries.push(args);
        if (options.credential === null) return null;
        return options.credential ?? {
          id: 'credential-1',
          status: CredentialStatus.draft
        };
      },
      async update() {
        calls.credentialWrites += 1;
      }
    },
    textEvidence: {
      async findFirst() {
        calls.textReads += 1;
      }
    },
    blockchainRecord: {
      async create() {
        calls.blockchainWrites += 1;
      }
    }
  };
  const issuers = {
    async assertUserCanRunDocumentAnalysisForIssuer(...args: unknown[]) {
      calls.events.push('authorize');
      calls.authorizations.push(args);
      if (options.authorizeError) throw options.authorizeError;
    }
  };
  const analysisRuns = {
    async createPendingRun(input: any) {
      calls.events.push('create');
      calls.creates.push(input);
      if (options.createError) throw options.createError;
      return {
        runReference: 'run-1',
        credentialReference: input.credentialId,
        status: AnalysisRunStatus.pending,
        inputMode: input.inputMode,
        trigger: input.trigger,
        requestedPipelineVersion: input.requestedPipelineVersion,
        requestedTaxonomyVersion: input.requestedTaxonomyVersion,
        sourceTypes: [AnalysisRunSourceType.document_evidence],
        sourceCount: 1,
        createdAt: '2026-08-05T11:59:00.000Z'
      };
    }
  };
  const execution = {
    async executePendingDocumentRun(runId: string) {
      calls.events.push('execute');
      calls.executions.push(runId);
      if (options.executeError) throw options.executeError;
      return {
        runReference: runId,
        credentialReference: 'credential-1',
        status: AnalysisRunStatus.completed,
        semanticAnalysisReference: 'semantic-1',
        artifactStatus: SemanticAnalysisStatus.completed,
        sourceCount: 1,
        completedAt: '2026-08-05T12:00:00.000Z'
      };
    }
  };

  return {
    service: new IssuerAnalysisRunService(
      prisma as never,
      issuers as never,
      analysisRuns as never,
      execution as never
    ),
    calls
  };
}

test('authorizes, scopes, creates a backend-controlled document run and executes it', async () => {
  const { service, calls } = setup();
  const response = await service.triggerDocumentAnalysis(
    'issuer-1',
    'credential-1',
    'authenticated-user'
  );

  assert.deepEqual(calls.events, [
    'authorize',
    'credential',
    'create',
    'execute'
  ]);
  assert.deepEqual(calls.authorizations, [
    ['authenticated-user', 'issuer-1']
  ]);
  assert.deepEqual(calls.credentialQueries, [{
    where: { id: 'credential-1', issuerId: 'issuer-1' },
    select: { id: true, status: true }
  }]);
  assert.deepEqual(calls.creates, [{
    credentialId: 'credential-1',
    requestedByUserId: 'authenticated-user',
    inputMode: AnalysisRunInputMode.document,
    trigger: AnalysisRunTrigger.manual,
    requestedPipelineVersion: 'unversioned_current',
    requestedTaxonomyVersion: 'unversioned_current'
  }]);
  assert.deepEqual(calls.executions, ['run-1']);
  assert.deepEqual(response, {
    analysisRunId: 'run-1',
    credentialId: 'credential-1',
    status: AnalysisRunStatus.completed,
    semanticAnalysisId: 'semantic-1',
    artifactStatus: SemanticAnalysisStatus.completed,
    sourceCount: 1,
    completedAt: '2026-08-05T12:00:00.000Z'
  });
  assert.equal(calls.credentialWrites, 0);
  assert.equal(calls.textReads, 0);
  assert.equal(calls.blockchainWrites, 0);
  assert.equal(calls.directAiCalls, 0);
  assert.equal(calls.directStorageReads, 0);
});

test('authorization failures stop before credential lookup and run creation', async () => {
  const { service, calls } = setup({
    authorizeError: new ForbiddenException('Sin permiso institucional.')
  });
  await assert.rejects(
    service.triggerDocumentAnalysis(
      'issuer-arbitrary',
      'credential-1',
      'authenticated-user'
    ),
    ForbiddenException
  );
  assert.deepEqual(calls.events, ['authorize']);
});

test('missing and cross-issuer credentials share the safe not-found response', async () => {
  const { service, calls } = setup({ credential: null });
  await assert.rejects(
    service.triggerDocumentAnalysis(
      'issuer-1',
      'credential-from-another-issuer',
      'authenticated-user'
    ),
    (error: unknown) => {
      assert.ok(error instanceof NotFoundException);
      assert.equal(error.message, 'No se encontro la credencial solicitada.');
      return true;
    }
  );
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.executions.length, 0);
});

test('non-draft credential is rejected before creating a run', async () => {
  for (const status of [CredentialStatus.issued, CredentialStatus.revoked]) {
    const { service, calls } = setup({
      credential: { id: 'credential-1', status }
    });
    await assert.rejects(
      service.triggerDocumentAnalysis(
        'issuer-1',
        'credential-1',
        'authenticated-user'
      ),
      ConflictException
    );
    assert.equal(calls.creates.length, 0);
    assert.equal(calls.executions.length, 0);
  }
});

test('missing current document prevents execution through createPendingRun', async () => {
  const { service, calls } = setup({
    createError: new BadRequestException(
      'La credencial no tiene evidencia documental vigente.'
    )
  });
  await assert.rejects(
    service.triggerDocumentAnalysis(
      'issuer-1',
      'credential-1',
      'authenticated-user'
    ),
    BadRequestException
  );
  assert.equal(calls.executions.length, 0);
});

test('execution errors are propagated only when already sanitized HttpExceptions', async () => {
  const safeError = new ServiceUnavailableException(
    'El servicio de analisis no esta disponible.'
  );
  const { service, calls } = setup({ executeError: safeError });
  await assert.rejects(
    service.triggerDocumentAnalysis(
      'issuer-1',
      'credential-1',
      'authenticated-user'
    ),
    (error: unknown) => error === safeError
  );
  assert.deepEqual(calls.executions, ['run-1']);
  assert.equal(calls.creates.length, 1);
});

test('unexpected execution errors are replaced with a safe HTTP response', async () => {
  const { service } = setup({
    executeError: new Error(
      'raw upstream URL storageKey token stack artifact payload'
    )
  });
  await assert.rejects(
    service.triggerDocumentAnalysis(
      'issuer-1',
      'credential-1',
      'authenticated-user'
    ),
    (error: unknown) => {
      assert.ok(error instanceof ServiceUnavailableException);
      const serialized = JSON.stringify(error.getResponse());
      assert.equal(serialized.includes('upstream'), false);
      assert.equal(serialized.includes('storageKey'), false);
      assert.equal(serialized.includes('token'), false);
      assert.equal(serialized.includes('artifact'), false);
      return true;
    }
  );
});

// ─── C2b.2: triggerTextAnalysis ─────────────────────────────────────────────

function setupText(options: {
  authorizeError?: Error;
  credential?: { id: string; status: CredentialStatus } | null;
  currentText?: { id: string } | null;
  existingRun?: { id: string } | null;
  createError?: Error;
  executeError?: Error;
} = {}) {
  const calls = {
    events: [] as string[],
    authorizations: [] as unknown[],
    credentialQueries: [] as unknown[],
    textQueries: [] as unknown[],
    existingRunQueries: [] as unknown[],
    creates: [] as any[],
    executions: [] as string[]
  };
  const prisma = {
    credential: {
      async findFirst(args: unknown) {
        calls.events.push('credential');
        calls.credentialQueries.push(args);
        if (options.credential === null) return null;
        return options.credential ?? {
          id: 'credential-1',
          status: CredentialStatus.draft
        };
      }
    },
    textEvidence: {
      async findFirst(args: unknown) {
        calls.events.push('text');
        calls.textQueries.push(args);
        if (options.currentText === null) return null;
        return options.currentText ?? { id: 'text-1' };
      }
    },
    analysisRun: {
      async findFirst(args: unknown) {
        calls.events.push('existingRun');
        calls.existingRunQueries.push(args);
        return options.existingRun ?? null;
      }
    }
  };
  const issuers = {
    async assertUserCanRunDocumentAnalysisForIssuer(...args: unknown[]) {
      calls.events.push('authorize');
      calls.authorizations.push(args);
      if (options.authorizeError) throw options.authorizeError;
    }
  };
  const analysisRuns = {
    async createPendingRun(input: any) {
      calls.events.push('create');
      calls.creates.push(input);
      if (options.createError) throw options.createError;
      return {
        runReference: 'run-1',
        credentialReference: input.credentialId,
        status: AnalysisRunStatus.pending,
        inputMode: input.inputMode,
        trigger: input.trigger,
        requestedPipelineVersion: input.requestedPipelineVersion,
        requestedTaxonomyVersion: input.requestedTaxonomyVersion,
        sourceTypes: [AnalysisRunSourceType.text_evidence],
        sourceCount: 1,
        createdAt: '2026-08-10T12:00:00.000Z'
      };
    }
  };
  const execution = {
    async executePendingTextRun(runId: string) {
      calls.events.push('execute');
      calls.executions.push(runId);
      if (options.executeError) throw options.executeError;
      return {
        runReference: runId,
        credentialReference: 'credential-1',
        status: AnalysisRunStatus.completed,
        semanticAnalysisReference: 'semantic-1',
        artifactStatus: SemanticAnalysisStatus.completed,
        sourceCount: 1,
        completedAt: '2026-08-10T12:01:00.000Z'
      };
    }
  };

  return {
    service: new IssuerAnalysisRunService(
      prisma as never,
      issuers as never,
      analysisRuns as never,
      execution as never
    ),
    calls
  };
}

test('triggerTextAnalysis authorizes, scopes, creates a manual text run and executes it', async () => {
  const { service, calls } = setupText();
  const response = await service.triggerTextAnalysis(
    'issuer-1',
    'credential-1',
    'authenticated-user'
  );

  assert.deepEqual(calls.events, [
    'authorize',
    'credential',
    'text',
    'existingRun',
    'create',
    'execute'
  ]);
  assert.deepEqual(calls.authorizations, [
    ['authenticated-user', 'issuer-1']
  ]);
  assert.deepEqual(calls.creates, [{
    credentialId: 'credential-1',
    requestedByUserId: 'authenticated-user',
    inputMode: AnalysisRunInputMode.text,
    trigger: AnalysisRunTrigger.manual,
    requestedPipelineVersion: 'unversioned_current',
    requestedTaxonomyVersion: 'unversioned_current'
  }]);
  assert.deepEqual(calls.existingRunQueries, [{
    where: {
      credentialId: 'credential-1',
      inputMode: AnalysisRunInputMode.text,
      status: {
        in: [
          AnalysisRunStatus.pending,
          AnalysisRunStatus.running,
          AnalysisRunStatus.completed
        ]
      },
      sources: {
        some: {
          sourceType: AnalysisRunSourceType.text_evidence,
          textEvidenceId: 'text-1'
        }
      }
    },
    select: { id: true }
  }]);
  assert.deepEqual(response, {
    analysisRunId: 'run-1',
    credentialId: 'credential-1',
    status: AnalysisRunStatus.completed,
    semanticAnalysisId: 'semantic-1',
    artifactStatus: SemanticAnalysisStatus.completed,
    sourceCount: 1,
    completedAt: '2026-08-10T12:01:00.000Z'
  });
});

test('triggerTextAnalysis authorization failures stop before any credential lookup', async () => {
  const { service, calls } = setupText({
    authorizeError: new ForbiddenException('Sin permiso institucional.')
  });
  await assert.rejects(
    service.triggerTextAnalysis('issuer-arbitrary', 'credential-1', 'authenticated-user'),
    ForbiddenException
  );
  assert.deepEqual(calls.events, ['authorize']);
});

test('triggerTextAnalysis missing and cross-issuer credentials share the safe not-found response', async () => {
  const { service, calls } = setupText({ credential: null });
  await assert.rejects(
    service.triggerTextAnalysis('issuer-1', 'credential-other-issuer', 'authenticated-user'),
    (error: unknown) => {
      assert.ok(error instanceof NotFoundException);
      assert.equal(error.message, 'No se encontro la credencial solicitada.');
      return true;
    }
  );
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.executions.length, 0);
});

test('triggerTextAnalysis rejects non-draft credentials before checking for text evidence', async () => {
  for (const status of [CredentialStatus.issued, CredentialStatus.revoked]) {
    const { service, calls } = setupText({
      credential: { id: 'credential-1', status }
    });
    await assert.rejects(
      service.triggerTextAnalysis('issuer-1', 'credential-1', 'authenticated-user'),
      ConflictException
    );
    assert.equal(calls.events.includes('text'), false);
    assert.equal(calls.creates.length, 0);
  }
});

test('triggerTextAnalysis returns a controlled 422 when there is no current TextEvidence', async () => {
  const { service, calls } = setupText({ currentText: null });
  await assert.rejects(
    service.triggerTextAnalysis('issuer-1', 'credential-1', 'authenticated-user'),
    (error: unknown) => {
      assert.ok(error instanceof UnprocessableEntityException);
      assert.equal(
        error.message,
        'La credencial no tiene evidencia textual vigente para analizar.'
      );
      return true;
    }
  );
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.executions.length, 0);
});

test('triggerTextAnalysis rejects (does not duplicate) when a run already exists for the current TextEvidence', async () => {
  const { service, calls } = setupText({ existingRun: { id: 'run-existing' } });
  await assert.rejects(
    service.triggerTextAnalysis('issuer-1', 'credential-1', 'authenticated-user'),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.match(error.message, /Ya existe un analisis textual/);
      return true;
    }
  );
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.executions.length, 0);
});

test('triggerTextAnalysis execution errors are propagated only when already sanitized HttpExceptions', async () => {
  const safeError = new ServiceUnavailableException(
    'El servicio de analisis no esta disponible.'
  );
  const { service, calls } = setupText({ executeError: safeError });
  await assert.rejects(
    service.triggerTextAnalysis('issuer-1', 'credential-1', 'authenticated-user'),
    (error: unknown) => error === safeError
  );
  assert.deepEqual(calls.executions, ['run-1']);
  assert.equal(calls.creates.length, 1);
});

test('triggerTextAnalysis unexpected execution errors are replaced with a safe HTTP response', async () => {
  const { service } = setupText({
    executeError: new Error('raw upstream URL storageKey token stack artifact payload')
  });
  await assert.rejects(
    service.triggerTextAnalysis('issuer-1', 'credential-1', 'authenticated-user'),
    (error: unknown) => {
      assert.ok(error instanceof ServiceUnavailableException);
      const serialized = JSON.stringify(error.getResponse());
      assert.equal(serialized.includes('upstream'), false);
      assert.equal(serialized.includes('storageKey'), false);
      assert.equal(serialized.includes('token'), false);
      assert.equal(serialized.includes('artifact'), false);
      return true;
    }
  );
});

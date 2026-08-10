import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AnalysisRunInputMode,
  AnalysisRunSourceType,
  AnalysisRunStatus,
  AnalysisRunTrigger,
  CredentialStatus,
  CredentialType,
  DocumentEvidenceKind,
  TextEvidenceStatus
} from '@prisma/client';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';

import { AutomaticCourseTextAnalysisService } from './automatic-course-text-analysis.service';

type CredentialFixture = {
  id: string;
  type: CredentialType;
  status: CredentialStatus;
  title: string;
  description: string | null;
  credentialSubject: unknown;
  documentEvidences: Array<{ kind: DocumentEvidenceKind; mimeType: string }>;
};

const DEFAULT_CREDENTIAL: CredentialFixture = {
  id: 'credential-1',
  type: CredentialType.course,
  status: CredentialStatus.issued,
  title: 'Python Bootcamp',
  description:
    'Curso introductorio de Python con proyectos practicos y ejercicios guiados.',
  credentialSubject: {},
  documentEvidences: []
};

function setup(options: {
  credential?: null | Partial<CredentialFixture>;
  existingCurrentText?: { id: string } | null;
  ensureResult?: {
    id: string;
    sha256: string;
    status: TextEvidenceStatus;
    reused: boolean;
  };
  ensureError?: Error;
  existingRun?: { id: string } | null;
  createError?: Error;
  executionError?: Error;
} = {}) {
  const calls = {
    credentialReads: [] as unknown[],
    textReads: [] as unknown[],
    existingRunQueries: [] as unknown[],
    ensureCalls: [] as unknown[],
    creates: [] as unknown[],
    executions: [] as string[],
    logs: [] as string[]
  };

  const credential =
    options.credential === undefined
      ? DEFAULT_CREDENTIAL
      : options.credential === null
        ? null
        : { ...DEFAULT_CREDENTIAL, ...options.credential };

  const prisma = {
    credential: {
      async findUnique(args: unknown) {
        calls.credentialReads.push(args);
        return credential;
      }
    },
    textEvidence: {
      async findFirst(args: unknown) {
        calls.textReads.push(args);
        return options.existingCurrentText === undefined
          ? null
          : options.existingCurrentText;
      }
    },
    analysisRun: {
      async findFirst(args: unknown) {
        calls.existingRunQueries.push(args);
        return options.existingRun ?? null;
      }
    }
  };

  const textEvidenceService = {
    async ensureSystemGeneratedCurrentTextEvidenceForCredential(
      ...args: unknown[]
    ) {
      calls.ensureCalls.push(args);
      if (options.ensureError) throw options.ensureError;
      return (
        options.ensureResult ?? {
          id: 'text-evidence-system-1',
          sha256: 'a'.repeat(64),
          status: TextEvidenceStatus.current,
          reused: false
        }
      );
    }
  };

  const analysisRunService = {
    async createPendingRun(input: unknown) {
      calls.creates.push(input);
      if (options.createError) throw options.createError;
      return { runReference: 'run-1' };
    }
  };

  const executionService = {
    async executePendingTextRun(runId: string) {
      calls.executions.push(runId);
      if (options.executionError) throw options.executionError;
    }
  };

  const service = new AutomaticCourseTextAnalysisService(
    prisma as never,
    textEvidenceService as never,
    analysisRunService as never,
    executionService as never
  );
  Object.defineProperty(service, 'logger', {
    value: { error: (message: string) => calls.logs.push(message) }
  });

  return { service, calls };
}

test('generates a system TextEvidence and executes a system text run end-to-end', async () => {
  const { service, calls } = setup();

  await service.analyzeIssuedCourseIfEligible('credential-1', 'issuer-user-1');

  assert.equal(calls.ensureCalls.length, 1);
  const ensureArgs = calls.ensureCalls[0] as unknown[];
  assert.equal(ensureArgs[0], 'credential-1');
  const content = ensureArgs[1] as string;
  assert.match(content, /Nombre del curso:\nPython Bootcamp/);
  assert.match(content, /Descripcion:\n/);
  assert.equal(content.includes('platformName'), false);
  assert.equal(content.includes('externalUrl'), false);
  assert.equal(ensureArgs[2], 'issuer-user-1');

  assert.deepEqual(calls.creates, [
    {
      credentialId: 'credential-1',
      requestedByUserId: null,
      inputMode: AnalysisRunInputMode.text,
      trigger: AnalysisRunTrigger.system,
      requestedPipelineVersion: 'unversioned_current',
      requestedTaxonomyVersion: 'unversioned_current'
    }
  ]);
  assert.deepEqual(calls.executions, ['run-1']);
});

test('skips when the credential is not issued', async () => {
  for (const status of [CredentialStatus.draft, CredentialStatus.revoked]) {
    const { service, calls } = setup({ credential: { status } });
    await service.analyzeIssuedCourseIfEligible('credential-1', 'issuer-user-1');
    assert.equal(calls.textReads.length, 0);
    assert.equal(calls.creates.length, 0);
    assert.equal(calls.executions.length, 0);
  }
});

test('skips when the credential type is not course', async () => {
  for (const type of [
    CredentialType.academic_subject,
    CredentialType.certification,
    CredentialType.degree
  ]) {
    const { service, calls } = setup({ credential: { type } });
    await service.analyzeIssuedCourseIfEligible('credential-1', 'issuer-user-1');
    assert.equal(calls.textReads.length, 0);
    assert.equal(calls.creates.length, 0);
    assert.equal(calls.executions.length, 0);
  }
});

test('skips when there is a current PDF (document flow has priority)', async () => {
  const { service, calls } = setup({
    credential: {
      documentEvidences: [
        { kind: DocumentEvidenceKind.pdf, mimeType: 'application/pdf' }
      ]
    }
  });

  await service.analyzeIssuedCourseIfEligible('credential-1', 'issuer-user-1');

  assert.equal(calls.textReads.length, 0);
  assert.equal(calls.ensureCalls.length, 0);
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.executions.length, 0);
});

test('a non-PDF current document does not block the textual path', async () => {
  const { service, calls } = setup({
    credential: {
      documentEvidences: [
        { kind: DocumentEvidenceKind.image, mimeType: 'image/png' }
      ]
    }
  });

  await service.analyzeIssuedCourseIfEligible('credential-1', 'issuer-user-1');

  assert.equal(calls.creates.length, 1);
  assert.equal(calls.executions.length, 1);
});

test('skips without creating anything when the declared text is insufficient', async () => {
  const { service, calls } = setup({
    credential: { title: 'Curso', description: null }
  });

  await service.analyzeIssuedCourseIfEligible('credential-1', 'issuer-user-1');

  assert.equal(calls.ensureCalls.length, 0);
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.executions.length, 0);
  assert.equal(calls.logs.length, 0);
});

test('uses an existing current TextEvidence as-is instead of generating a new one', async () => {
  const { service, calls } = setup({
    existingCurrentText: { id: 'text-evidence-manual-1' }
  });

  await service.analyzeIssuedCourseIfEligible('credential-1', 'issuer-user-1');

  // Never generates/overwrites when a current TextEvidence already exists.
  assert.equal(calls.ensureCalls.length, 0);
  assert.deepEqual(calls.existingRunQueries, [
    {
      where: {
        credentialId: 'credential-1',
        inputMode: AnalysisRunInputMode.text,
        status: {
          in: [
            AnalysisRunStatus.pending,
            AnalysisRunStatus.running,
            AnalysisRunStatus.completed,
            AnalysisRunStatus.failed
          ]
        },
        sources: {
          some: {
            sourceType: AnalysisRunSourceType.text_evidence,
            textEvidenceId: 'text-evidence-manual-1'
          }
        }
      },
      select: { id: true }
    }
  ]);
  assert.equal(calls.creates.length, 1);
});

test('does not duplicate when a run already exists for the same TextEvidence, for every dedup status', async () => {
  for (const status of [
    AnalysisRunStatus.pending,
    AnalysisRunStatus.running,
    AnalysisRunStatus.completed,
    AnalysisRunStatus.failed
  ]) {
    const { service, calls } = setup({
      existingCurrentText: { id: 'text-evidence-1' },
      existingRun: { id: `existing-run-${status}` }
    });
    await service.analyzeIssuedCourseIfEligible('credential-1', 'issuer-user-1');
    assert.equal(calls.creates.length, 0);
    assert.equal(calls.executions.length, 0);
  }
});

test('never throws when TextEvidence generation fails -- logs a safe reason instead', async () => {
  const { service, calls } = setup({
    ensureError: new Error('raw db secret detail')
  });

  await service.analyzeIssuedCourseIfEligible('credential-1', 'issuer-user-1');

  assert.equal(calls.creates.length, 0);
  assert.equal(calls.logs.length, 1);
  const logged = JSON.parse(calls.logs[0]) as Record<string, unknown>;
  assert.equal(logged.event, 'automatic_course_text_analysis_failed');
  assert.equal(logged.credentialId, 'credential-1');
  assert.equal(logged.reason, 'unexpected_error');
  assert.equal(JSON.stringify(logged).includes('raw db secret'), false);
});

test('never throws when run creation is rejected -- logs the safe HttpException message', async () => {
  const { service, calls } = setup({
    createError: new ConflictException('La credencial no admite este tipo de analisis.')
  });

  await service.analyzeIssuedCourseIfEligible('credential-1', 'issuer-user-1');

  assert.equal(calls.executions.length, 0);
  assert.equal(calls.logs.length, 1);
  const logged = JSON.parse(calls.logs[0]) as Record<string, unknown>;
  assert.equal(logged.reason, 'La credencial no admite este tipo de analisis.');
});

test('never throws when execution fails -- issuance remains unaffected, error is logged safely', async () => {
  const { service, calls } = setup({
    executionError: new ServiceUnavailableException(
      'El servicio de análisis no está disponible.'
    )
  });

  await service.analyzeIssuedCourseIfEligible('credential-1', 'issuer-user-1');

  assert.equal(calls.creates.length, 1);
  assert.equal(calls.executions.length, 1);
  assert.equal(calls.logs.length, 1);
  const logged = JSON.parse(calls.logs[0]) as Record<string, unknown>;
  assert.equal(logged.reason, 'El servicio de análisis no está disponible.');
});

test('skips gracefully when the credential no longer exists', async () => {
  const { service, calls } = setup({ credential: null });

  await service.analyzeIssuedCourseIfEligible('credential-1', 'issuer-user-1');

  assert.equal(calls.textReads.length, 0);
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.logs.length, 0);
});

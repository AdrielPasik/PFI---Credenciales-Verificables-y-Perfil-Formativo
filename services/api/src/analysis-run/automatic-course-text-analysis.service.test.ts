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
  subjectUserId: string;
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
  subjectUserId: 'holder-user-1',
  credentialSubject: {},
  documentEvidences: []
};

const DEFAULT_CERTIFICATION_CREDENTIAL: CredentialFixture = {
  id: 'credential-1',
  type: CredentialType.certification,
  status: CredentialStatus.issued,
  title: 'AWS Cloud Practitioner',
  description:
    'Certificacion de fundamentos de nube orientada a arquitectura basica y buenas practicas.',
  subjectUserId: 'holder-user-1',
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
  rebuildError?: Error;
  baseCredential?: CredentialFixture;
} = {}) {
  const calls = {
    credentialReads: [] as unknown[],
    textReads: [] as unknown[],
    existingRunQueries: [] as unknown[],
    ensureCalls: [] as unknown[],
    creates: [] as unknown[],
    executions: [] as string[],
    rebuildCalls: [] as unknown[],
    logs: [] as string[]
  };

  const base = options.baseCredential ?? DEFAULT_CREDENTIAL;
  const credential =
    options.credential === undefined
      ? base
      : options.credential === null
        ? null
        : { ...base, ...options.credential };

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
      return { runReference: runId };
    }
  };

  const profileRebuildService = {
    async rebuildAfterAutomaticAnalysis(input: unknown) {
      calls.rebuildCalls.push(input);
      if (options.rebuildError) throw options.rebuildError;
    }
  };

  const service = new AutomaticCourseTextAnalysisService(
    prisma as never,
    textEvidenceService as never,
    analysisRunService as never,
    executionService as never,
    profileRebuildService as never
  );
  Object.defineProperty(service, 'logger', {
    value: { error: (message: string) => calls.logs.push(message) }
  });

  return { service, calls };
}

// ---------------------------------------------------------------------------
// course (C2b.3, sin cambios de comportamiento)
// ---------------------------------------------------------------------------

test('generates a system TextEvidence and executes a system text run end-to-end (course)', async () => {
  const { service, calls } = setup();

  await service.analyzeIssuedCredentialIfEligible('credential-1', 'issuer-user-1');

  assert.equal(calls.ensureCalls.length, 1);
  const ensureArgs = calls.ensureCalls[0] as unknown[];
  assert.equal(ensureArgs[0], 'credential-1');
  const content = ensureArgs[1] as string;
  assert.match(content, /Nombre del curso:\nPython Bootcamp/);
  assert.match(content, /Descripcion:\n/);
  assert.equal(content.includes('platformName'), false);
  assert.equal(content.includes('externalUrl'), false);
  assert.equal(ensureArgs[2], 'issuer-user-1');
  assert.equal(
    ensureArgs[3],
    'Texto generado para análisis desde datos declarados del curso'
  );

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
  assert.deepEqual(calls.rebuildCalls, [
    {
      credentialId: 'credential-1',
      holderUserId: 'holder-user-1',
      analysisRunId: 'run-1'
    }
  ]);
});

test('skips when the credential is not issued', async () => {
  for (const status of [CredentialStatus.draft, CredentialStatus.revoked]) {
    const { service, calls } = setup({ credential: { status } });
    await service.analyzeIssuedCredentialIfEligible('credential-1', 'issuer-user-1');
    assert.equal(calls.textReads.length, 0);
    assert.equal(calls.creates.length, 0);
    assert.equal(calls.executions.length, 0);
    assert.equal(calls.rebuildCalls.length, 0);
  }
});

// C4x fix: certification ya no se salta -- ver el bloque dedicado de
// certification mas abajo. Solo academic_subject/degree quedan afuera.
test('skips when the credential type is academic_subject or degree', async () => {
  for (const type of [CredentialType.academic_subject, CredentialType.degree]) {
    const { service, calls } = setup({ credential: { type } });
    await service.analyzeIssuedCredentialIfEligible('credential-1', 'issuer-user-1');
    assert.equal(calls.textReads.length, 0);
    assert.equal(calls.creates.length, 0);
    assert.equal(calls.executions.length, 0);
    assert.equal(calls.rebuildCalls.length, 0);
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

  await service.analyzeIssuedCredentialIfEligible('credential-1', 'issuer-user-1');

  assert.equal(calls.textReads.length, 0);
  assert.equal(calls.ensureCalls.length, 0);
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.executions.length, 0);
  assert.equal(calls.rebuildCalls.length, 0);
});

test('a non-PDF current document does not block the textual path and still triggers rebuild once', async () => {
  const { service, calls } = setup({
    credential: {
      documentEvidences: [
        { kind: DocumentEvidenceKind.image, mimeType: 'image/png' }
      ]
    }
  });

  await service.analyzeIssuedCredentialIfEligible('credential-1', 'issuer-user-1');

  assert.equal(calls.creates.length, 1);
  assert.equal(calls.executions.length, 1);
  assert.equal(calls.rebuildCalls.length, 1);
});

test('skips without creating anything when the declared text is insufficient, and never rebuilds', async () => {
  const { service, calls } = setup({
    credential: { title: 'Curso', description: null }
  });

  await service.analyzeIssuedCredentialIfEligible('credential-1', 'issuer-user-1');

  assert.equal(calls.ensureCalls.length, 0);
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.executions.length, 0);
  assert.equal(calls.logs.length, 0);
  assert.equal(calls.rebuildCalls.length, 0);
});

test('uses an existing current TextEvidence as-is instead of generating a new one', async () => {
  const { service, calls } = setup({
    existingCurrentText: { id: 'text-evidence-manual-1' }
  });

  await service.analyzeIssuedCredentialIfEligible('credential-1', 'issuer-user-1');

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
    await service.analyzeIssuedCredentialIfEligible('credential-1', 'issuer-user-1');
    assert.equal(calls.creates.length, 0);
    assert.equal(calls.executions.length, 0);
    assert.equal(calls.rebuildCalls.length, 0);
  }
});

test('never throws when TextEvidence generation fails -- logs a safe reason instead, never rebuilds', async () => {
  const { service, calls } = setup({
    ensureError: new Error('raw db secret detail')
  });

  await service.analyzeIssuedCredentialIfEligible('credential-1', 'issuer-user-1');

  assert.equal(calls.creates.length, 0);
  assert.equal(calls.rebuildCalls.length, 0);
  assert.equal(calls.logs.length, 1);
  const logged = JSON.parse(calls.logs[0]) as Record<string, unknown>;
  assert.equal(
    logged.event,
    'automatic_reusable_credential_text_analysis_failed'
  );
  assert.equal(logged.credentialId, 'credential-1');
  assert.equal(logged.reason, 'unexpected_error');
  assert.equal(JSON.stringify(logged).includes('raw db secret'), false);
});

test('never throws when run creation is rejected -- logs the safe HttpException message, never rebuilds', async () => {
  const { service, calls } = setup({
    createError: new ConflictException('La credencial no admite este tipo de analisis.')
  });

  await service.analyzeIssuedCredentialIfEligible('credential-1', 'issuer-user-1');

  assert.equal(calls.executions.length, 0);
  assert.equal(calls.rebuildCalls.length, 0);
  assert.equal(calls.logs.length, 1);
  const logged = JSON.parse(calls.logs[0]) as Record<string, unknown>;
  assert.equal(logged.reason, 'La credencial no admite este tipo de analisis.');
});

test('never throws when execution fails -- issuance remains unaffected, error is logged safely, never rebuilds', async () => {
  const { service, calls } = setup({
    executionError: new ServiceUnavailableException(
      'El servicio de análisis no está disponible.'
    )
  });

  await service.analyzeIssuedCredentialIfEligible('credential-1', 'issuer-user-1');

  assert.equal(calls.creates.length, 1);
  assert.equal(calls.executions.length, 1);
  assert.equal(calls.rebuildCalls.length, 0);
  assert.equal(calls.logs.length, 1);
  const logged = JSON.parse(calls.logs[0]) as Record<string, unknown>;
  assert.equal(logged.reason, 'El servicio de análisis no está disponible.');
});

test('skips gracefully when the credential no longer exists', async () => {
  const { service, calls } = setup({ credential: null });

  await service.analyzeIssuedCredentialIfEligible('credential-1', 'issuer-user-1');

  assert.equal(calls.textReads.length, 0);
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.rebuildCalls.length, 0);
  assert.equal(calls.logs.length, 0);
});

// ─── C2b.4: automatic profile rebuild after successful analysis ────────────

test('rebuild failure does not rethrow -- the analysis stays completed and is logged under its own event', async () => {
  const { service, calls } = setup({
    rebuildError: new Error('raw analysisJson content')
  });

  await service.analyzeIssuedCredentialIfEligible('credential-1', 'issuer-user-1');

  assert.equal(calls.executions.length, 1);
  assert.equal(calls.rebuildCalls.length, 1);
  // The fake profileRebuildService throws to simulate a defect in that
  // dependency; AutomaticCourseTextAnalysisService's own outer catch is a
  // second safety net and logs it under its own event -- in production,
  // AutomaticProfileRebuildService never actually throws (see its own
  // dedicated tests), so this only exercises defense-in-depth.
  assert.equal(calls.logs.length, 1);
  assert.equal(JSON.stringify(calls.logs).includes('raw analysisJson'), false);
});

// ---------------------------------------------------------------------------
// C4x fix: certification -- mismo patron seguro que course.
// ---------------------------------------------------------------------------

test('certification issued without PDF and with sufficient declared data generates/reuses TextEvidence and runs a system text AnalysisRun', async () => {
  const { service, calls } = setup({ baseCredential: DEFAULT_CERTIFICATION_CREDENTIAL });

  await service.analyzeIssuedCredentialIfEligible('credential-1', 'issuer-user-1');

  assert.equal(calls.ensureCalls.length, 1);
  const ensureArgs = calls.ensureCalls[0] as unknown[];
  const content = ensureArgs[1] as string;
  assert.match(content, /Nombre de la certificacion:\nAWS Cloud Practitioner/);
  assert.match(content, /Descripcion:\n/);
  assert.equal(
    ensureArgs[3],
    'Texto generado para análisis desde datos declarados de la certificación'
  );

  assert.equal(calls.creates.length, 1);
  assert.equal(calls.executions.length, 1);
  assert.equal(calls.rebuildCalls.length, 1);
});

test('certification with a current PDF does not trigger automatic text analysis', async () => {
  const { service, calls } = setup({
    baseCredential: DEFAULT_CERTIFICATION_CREDENTIAL,
    credential: {
      documentEvidences: [
        { kind: DocumentEvidenceKind.pdf, mimeType: 'application/pdf' }
      ]
    }
  });

  await service.analyzeIssuedCredentialIfEligible('credential-1', 'issuer-user-1');

  assert.equal(calls.ensureCalls.length, 0);
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.executions.length, 0);
  assert.equal(calls.rebuildCalls.length, 0);
});

test('certification with only a title does not trigger analysis', async () => {
  const { service, calls } = setup({
    baseCredential: DEFAULT_CERTIFICATION_CREDENTIAL,
    credential: { title: 'AWS', description: null }
  });

  await service.analyzeIssuedCredentialIfEligible('credential-1', 'issuer-user-1');

  assert.equal(calls.ensureCalls.length, 0);
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.executions.length, 0);
  assert.equal(calls.rebuildCalls.length, 0);
  assert.equal(calls.logs.length, 0);
});

test('certification with a substantial description triggers analysis', async () => {
  const { service, calls } = setup({
    baseCredential: DEFAULT_CERTIFICATION_CREDENTIAL,
    credential: {
      title: 'AWS',
      description:
        'Certificacion de fundamentos de nube: arquitectura basica, seguridad y costos.'
    }
  });

  await service.analyzeIssuedCredentialIfEligible('credential-1', 'issuer-user-1');

  assert.equal(calls.creates.length, 1);
  assert.equal(calls.executions.length, 1);
});

test('certification with title + skills/competencies (no description) triggers analysis', async () => {
  const { service, calls } = setup({
    baseCredential: DEFAULT_CERTIFICATION_CREDENTIAL,
    credential: {
      description: null,
      credentialSubject: {
        skills: ['Cloud'],
        competencies: ['Fundamentos de nube']
      }
    }
  });

  await service.analyzeIssuedCredentialIfEligible('credential-1', 'issuer-user-1');

  assert.equal(calls.ensureCalls.length, 1);
  const content = (calls.ensureCalls[0] as unknown[])[1] as string;
  assert.match(content, /Habilidades declaradas:\n- Cloud/);
  assert.match(content, /Competencias declaradas:\n- Fundamentos de nube/);
  assert.equal(calls.creates.length, 1);
  assert.equal(calls.executions.length, 1);
});

test('certification never copies modality/platformName into the generated content', async () => {
  const { service, calls } = setup({
    baseCredential: DEFAULT_CERTIFICATION_CREDENTIAL,
    credential: {
      credentialSubject: {
        modality: 'Online',
        platform_name: 'Udemy',
        skills: ['Cloud']
      }
    }
  });

  await service.analyzeIssuedCredentialIfEligible('credential-1', 'issuer-user-1');

  const content = (calls.ensureCalls[0] as unknown[])[1] as string;
  assert.equal(content.includes('Online'), false);
  assert.equal(content.includes('Udemy'), false);
  assert.equal(content.toLowerCase().includes('modality'), false);
  assert.equal(content.toLowerCase().includes('platform'), false);
});

test('certification never copies approvedSemanticSnapshot/approvedSemanticAnalysisId/lastSemanticAnalysisId/SemanticAnalysis data', async () => {
  const { service, calls } = setup({
    baseCredential: DEFAULT_CERTIFICATION_CREDENTIAL,
    credential: {
      credentialSubject: {
        skills: ['Cloud'],
        approvedSemanticSnapshot: { schema: 'must-not-leak' },
        approvedSemanticAnalysisId: 'must-not-leak',
        lastSemanticAnalysisId: 'must-not-leak',
        semanticAnalysis: { areas: ['must-not-leak'] }
      }
    }
  });

  await service.analyzeIssuedCredentialIfEligible('credential-1', 'issuer-user-1');

  const content = (calls.ensureCalls[0] as unknown[])[1] as string;
  assert.equal(content.includes('must-not-leak'), false);
  assert.equal(content.includes('approvedSemantic'), false);
  assert.equal(content.includes('SemanticAnalysis'), false);
});

test('certification reuses an existing current TextEvidence instead of generating a new one', async () => {
  const { service, calls } = setup({
    baseCredential: DEFAULT_CERTIFICATION_CREDENTIAL,
    existingCurrentText: { id: 'text-evidence-manual-1' }
  });

  await service.analyzeIssuedCredentialIfEligible('credential-1', 'issuer-user-1');

  assert.equal(calls.ensureCalls.length, 0);
  assert.equal(calls.creates.length, 1);
});

test('certification dedup includes failed runs and never retries indefinitely, for every dedup status', async () => {
  for (const status of [
    AnalysisRunStatus.pending,
    AnalysisRunStatus.running,
    AnalysisRunStatus.completed,
    AnalysisRunStatus.failed
  ]) {
    const { service, calls } = setup({
      baseCredential: DEFAULT_CERTIFICATION_CREDENTIAL,
      existingCurrentText: { id: 'text-evidence-1' },
      existingRun: { id: `existing-run-${status}` }
    });
    await service.analyzeIssuedCredentialIfEligible('credential-1', 'issuer-user-1');
    assert.equal(calls.creates.length, 0);
    assert.equal(calls.executions.length, 0);
    assert.equal(calls.rebuildCalls.length, 0);
  }
});

test('certification automatic analysis failure never reverts/affects issuance -- logs a safe reason', async () => {
  const { service, calls } = setup({
    baseCredential: DEFAULT_CERTIFICATION_CREDENTIAL,
    executionError: new ServiceUnavailableException(
      'El servicio de análisis no está disponible.'
    )
  });

  await service.analyzeIssuedCredentialIfEligible('credential-1', 'issuer-user-1');

  assert.equal(calls.creates.length, 1);
  assert.equal(calls.executions.length, 1);
  assert.equal(calls.rebuildCalls.length, 0);
  assert.equal(calls.logs.length, 1);
});

test('certification completed analysis still triggers the existing automatic profile rebuild (C2b.4, unchanged)', async () => {
  const { service, calls } = setup({ baseCredential: DEFAULT_CERTIFICATION_CREDENTIAL });

  await service.analyzeIssuedCredentialIfEligible('credential-1', 'issuer-user-1');

  assert.deepEqual(calls.rebuildCalls, [
    {
      credentialId: 'credential-1',
      holderUserId: 'holder-user-1',
      analysisRunId: 'run-1'
    }
  ]);
});

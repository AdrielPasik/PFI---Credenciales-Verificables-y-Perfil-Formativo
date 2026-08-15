import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException
} from '@nestjs/common';
import { CredentialStatus, CredentialType, Prisma, UserStatus } from '@prisma/client';

import { ReusableSemanticInterpretationService } from './reusable-semantic-interpretation.service';

const ISSUER_ID = 'issuer-1';
const CREDENTIAL_ID = 'credential-dest';
const SOURCE_CREDENTIAL_ID = 'credential-source';
const TEMPLATE_ID = 'template-1';
const APPROVED_AT = new Date('2026-08-14T10:00:00.000Z');
const CURRENT_USER = {
  id: 'issuer-user-1',
  email: 'issuer.admin@example.com',
  did: null,
  status: UserStatus.active
};

function prismaKnownError(code: string, message = 'simulated'): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: '6.19.3'
  });
}

function baseSubject(overrides: Record<string, unknown> = {}) {
  return {
    achievement_name: 'Introducción a UX',
    competencies: ['Investigación de usuarios'],
    learning_outcomes: ['Diseñar wireframes'],
    skills: [],
    ...overrides
  };
}

function credentialRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CREDENTIAL_ID,
    issuerId: ISSUER_ID,
    status: CredentialStatus.issued,
    type: CredentialType.course,
    title: 'Introducción a UX',
    description: 'Descripción original de UX',
    hours: 20,
    credentialSubject: baseSubject(),
    // C5b.1: usado unicamente para disparar el rebuild best-effort del
    // perfil tras un apply exitoso -- nunca expuesto en ningun DTO.
    subjectUserId: 'holder-1',
    ...overrides
  };
}

function sourceCredentialRow(overrides: Record<string, unknown> = {}) {
  return credentialRow({
    id: SOURCE_CREDENTIAL_ID,
    ...overrides
  });
}

function templateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TEMPLATE_ID,
    issuerId: ISSUER_ID,
    credentialType: CredentialType.course,
    title: 'Introducción a UX',
    description: 'Descripción original de UX',
    hours: 20,
    competencies: ['Investigación de usuarios'],
    learningOutcomes: ['Diseñar wireframes'],
    skills: [],
    approvedSemanticSnapshot: {
      schema: 'approved_template_semantic_snapshot_v2',
      status: 'completed',
      areas: [],
      skills: [],
      concepts: [],
      hoursDistribution: [],
      warnings: [],
      qualityFlags: []
    },
    approvedSemanticAnalysisId: 'semantic-1',
    approvedSemanticSourceCredentialId: SOURCE_CREDENTIAL_ID,
    approvedSemanticApprovedByUserId: 'user-approver',
    approvedSemanticApprovedAt: APPROVED_AT,
    approvedSemanticPipelineVersion: 'pipeline-v1',
    approvedSemanticTaxonomyVersion: 'taxonomy-v1',
    ...overrides
  };
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-approver',
    displayName: null,
    firstName: 'Ana',
    lastName: 'Aprobadora',
    email: 'ana@example.com',
    ...overrides
  };
}

interface SetupOptions {
  credentials?: Array<Record<string, unknown>>;
  templates?: Array<Record<string, unknown>>;
  users?: Array<Record<string, unknown>>;
  interpretations?: Array<Record<string, unknown>>;
  permissionError?: Error;
  transactionErrors?: Array<Error>;
  simulateUniqueViolationOnCreate?: boolean;
  // C5b.1: simula que el rebuild best-effort del perfil falla -- nunca
  // debe hacer que apply() falle ni relance.
  rebuildFails?: boolean;
}

function setup(options: SetupOptions = {}) {
  const credentials = new Map<string, Record<string, unknown>>(
    (options.credentials ?? [credentialRow(), sourceCredentialRow()]).map((c) => [
      c.id as string,
      c
    ])
  );
  const templates = new Map<string, Record<string, unknown>>(
    (options.templates ?? [templateRow()]).map((t) => [t.id as string, t])
  );
  const users = new Map<string, Record<string, unknown>>(
    (options.users ?? [userRow()]).map((u) => [u.id as string, u])
  );
  const interpretations: Array<Record<string, unknown>> = [
    ...(options.interpretations ?? [])
  ];
  const transactionErrorQueue = [...(options.transactionErrors ?? [])];

  const calls = {
    permissions: [] as unknown[],
    transactions: [] as unknown[],
    creates: [] as unknown[],
    updateMany: [] as unknown[],
    profileRebuilds: [] as Array<{ credentialId: string; holderUserId: string }>
  };

  let nextId = interpretations.length + 1;

  const delegates = {
    credential: {
      async findFirst({ where }: { where: { id: string; issuerId: string } }) {
        const row = credentials.get(where.id);
        if (!row || row.issuerId !== where.issuerId) return null;
        return row;
      }
    },
    issuerCourseTemplate: {
      async findFirst({ where }: { where: { id: string; issuerId: string } }) {
        const row = templates.get(where.id);
        if (!row || row.issuerId !== where.issuerId) return null;
        return row;
      }
    },
    user: {
      async findUnique({ where }: { where: { id: string } }) {
        return users.get(where.id) ?? null;
      }
    },
    credentialReusableSemanticInterpretation: {
      async findFirst({
        where
      }: {
        where: { credentialId: string; status?: string };
      }) {
        return (
          interpretations.find(
            (row) =>
              row.credentialId === where.credentialId &&
              (where.status === undefined || row.status === where.status)
          ) ?? null
        );
      },
      async updateMany({
        where,
        data
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) {
        calls.updateMany.push({ where, data });
        let count = 0;
        for (const row of interpretations) {
          if (row.id === where.id) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      },
      async create({ data }: { data: Record<string, unknown> }) {
        calls.creates.push(data);
        if (options.simulateUniqueViolationOnCreate) {
          throw prismaKnownError('P2002', 'Unique constraint failed');
        }
        const row = {
          id: `interp-${nextId}`,
          status: 'active',
          appliedAt: new Date(),
          ...data
        };
        nextId += 1;
        interpretations.push(row);
        return row;
      }
    }
  };

  const prisma = {
    ...delegates,
    async $transaction(
      callback: (tx: typeof delegates) => Promise<unknown>,
      transactionOptions: unknown
    ) {
      calls.transactions.push(transactionOptions);
      const queued = transactionErrorQueue.shift();
      if (queued) {
        throw queued;
      }
      return callback(delegates);
    }
  };

  const issuersService = {
    async assertUserCanApplyReusableSemanticInterpretationForIssuer(
      ...args: unknown[]
    ) {
      calls.permissions.push(args);
      if (options.permissionError) {
        throw options.permissionError;
      }
    }
  };

  // C5b.1: mismo contrato real de AutomaticProfileRebuildService -- nunca
  // lanza, siempre devuelve {status:'rebuilt'} o
  // {status:'failed', errorCode}.
  const profileRebuildService = {
    async rebuildAfterAutomaticAnalysis(input: {
      credentialId: string;
      holderUserId: string;
    }) {
      calls.profileRebuilds.push(input);
      if (options.rebuildFails) {
        return {
          status: 'failed' as const,
          errorCode: 'formative_profile_rebuild_failed' as const
        };
      }
      return { status: 'rebuilt' as const };
    }
  };

  return {
    service: new ReusableSemanticInterpretationService(
      prisma as never,
      issuersService as never,
      profileRebuildService as never
    ),
    calls,
    interpretations
  };
}

// ---------------------------------------------------------------------------
// candidate
// ---------------------------------------------------------------------------

test('candidate: happy path for course returns an allowlisted response, snapshot summary, and no current application when none is applied', async () => {
  const { service, calls } = setup();

  const result = await service.getCandidateForIssuer(
    ISSUER_ID,
    CREDENTIAL_ID,
    TEMPLATE_ID,
    CURRENT_USER
  );

  assert.deepEqual(calls.permissions, [[CURRENT_USER.id, ISSUER_ID]]);
  assert.equal(result.templateId, TEMPLATE_ID);
  assert.equal(result.templateTitle, 'Introducción a UX');
  assert.equal(result.approvalRevision, APPROVED_AT.toISOString());
  assert.equal(result.approvalDriftStatus, 'none_applied');
  assert.equal(result.templateContentStatus, 'matches_approved_source');
  assert.equal(result.destinationCompatibility, 'compatible');
  assert.deepEqual(result.changedFields, []);
  assert.equal(result.currentApplication, null);
  assert.equal(result.snapshotSummary.schema, 'approved_template_semantic_snapshot_v2');
  assert.equal(result.approvedByDisplayLabel, 'Ana Aprobadora');
});

test('candidate: happy path for certification', async () => {
  const destination = credentialRow({
    type: CredentialType.certification,
    credentialSubject: baseSubject({ skills: ['EC2'], learning_outcomes: [] })
  });
  const source = sourceCredentialRow({
    type: CredentialType.certification,
    credentialSubject: baseSubject({ skills: ['EC2'], learning_outcomes: [] })
  });
  const template = templateRow({
    credentialType: CredentialType.certification,
    skills: ['EC2'],
    learningOutcomes: []
  });
  const { service } = setup({ credentials: [destination, source], templates: [template] });

  const result = await service.getCandidateForIssuer(
    ISSUER_ID,
    CREDENTIAL_ID,
    TEMPLATE_ID,
    CURRENT_USER
  );

  assert.equal(result.destinationCompatibility, 'compatible');
});

test('candidate: rejects when the destination credential is not issued', async () => {
  const { service } = setup({ credentials: [credentialRow({ status: CredentialStatus.draft }), sourceCredentialRow()] });

  await assert.rejects(
    service.getCandidateForIssuer(ISSUER_ID, CREDENTIAL_ID, TEMPLATE_ID, CURRENT_USER),
    BadRequestException
  );
});

test('candidate: rejects when the destination credential type is not course/certification', async () => {
  const { service } = setup({
    credentials: [credentialRow({ type: CredentialType.academic_subject }), sourceCredentialRow()]
  });

  await assert.rejects(
    service.getCandidateForIssuer(ISSUER_ID, CREDENTIAL_ID, TEMPLATE_ID, CURRENT_USER),
    BadRequestException
  );
});

test('candidate: rejects when the template type does not match the destination credential type', async () => {
  const { service } = setup({
    templates: [templateRow({ credentialType: CredentialType.certification })]
  });

  await assert.rejects(
    service.getCandidateForIssuer(ISSUER_ID, CREDENTIAL_ID, TEMPLATE_ID, CURRENT_USER),
    BadRequestException
  );
});

test('candidate: rejects when the template has no approved snapshot yet', async () => {
  const { service } = setup({
    templates: [templateRow({ approvedSemanticSnapshot: null })]
  });

  await assert.rejects(
    service.getCandidateForIssuer(ISSUER_ID, CREDENTIAL_ID, TEMPLATE_ID, CURRENT_USER),
    UnprocessableEntityException
  );
});

test('candidate: rejects when the template approval is incomplete (has a snapshot but missing provenance)', async () => {
  const { service } = setup({
    templates: [templateRow({ approvedSemanticApprovedByUserId: null })]
  });

  await assert.rejects(
    service.getCandidateForIssuer(ISSUER_ID, CREDENTIAL_ID, TEMPLATE_ID, CURRENT_USER),
    UnprocessableEntityException
  );
});

test('candidate: uses the same not-found result for a cross-issuer credential and a cross-issuer template', async () => {
  const { service: serviceA } = setup();
  await assert.rejects(
    serviceA.getCandidateForIssuer('issuer-other', CREDENTIAL_ID, TEMPLATE_ID, CURRENT_USER),
    NotFoundException
  );

  const { service: serviceB } = setup();
  await assert.rejects(
    serviceB.getCandidateForIssuer(ISSUER_ID, CREDENTIAL_ID, 'template-other', CURRENT_USER),
    NotFoundException
  );
});

test('candidate: source credential missing -> destinationCompatibility and templateContentStatus are unknown, never thrown', async () => {
  const { service } = setup({
    credentials: [credentialRow()] // source credential absent
  });

  const result = await service.getCandidateForIssuer(
    ISSUER_ID,
    CREDENTIAL_ID,
    TEMPLATE_ID,
    CURRENT_USER
  );

  assert.equal(result.destinationCompatibility, 'unknown');
  assert.equal(result.templateContentStatus, 'unknown');
  assert.deepEqual(result.changedFields, []);
});

test('candidate: template content drift is reported as a warning without affecting destinationCompatibility when destination still matches the source', async () => {
  const template = templateRow({ title: 'Marketing digital', description: 'Descripción de marketing' });
  const { service } = setup({ templates: [template] });

  const result = await service.getCandidateForIssuer(
    ISSUER_ID,
    CREDENTIAL_ID,
    TEMPLATE_ID,
    CURRENT_USER
  );

  assert.equal(result.templateContentStatus, 'differs_from_approved_source');
  // La credencial destino (fixture por defecto) sigue igual a la fuente real.
  assert.equal(result.destinationCompatibility, 'compatible');
});

test('candidate: destinationCompatibility modified with allowlisted changedFields when destination drifted from the real source (C4b.0.2 regression scenario)', async () => {
  const destination = credentialRow({
    title: 'Marketing digital',
    description: 'Descripción de marketing',
    credentialSubject: baseSubject({ achievement_name: 'Marketing digital', competencies: ['SEO'] })
  });
  const { service } = setup({ credentials: [destination, sourceCredentialRow()] });

  const result = await service.getCandidateForIssuer(
    ISSUER_ID,
    CREDENTIAL_ID,
    TEMPLATE_ID,
    CURRENT_USER
  );

  assert.equal(result.destinationCompatibility, 'modified');
  const allowlist = ['title', 'description', 'competencies', 'learningOutcomes', 'skills', 'hours'];
  for (const field of result.changedFields) {
    assert.ok(allowlist.includes(field));
  }
  assert.ok(result.changedFields.includes('title'));
});

test('candidate: never leaks raw ids/snapshot beyond templateId', async () => {
  const { service } = setup();
  const result = await service.getCandidateForIssuer(
    ISSUER_ID,
    CREDENTIAL_ID,
    TEMPLATE_ID,
    CURRENT_USER
  );
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(SOURCE_CREDENTIAL_ID));
  assert.ok(!serialized.includes('semantic-1'));
  assert.ok(!serialized.includes('user-approver'));
  assert.ok(!serialized.includes('pipeline-v1'));
  assert.ok(!serialized.includes('taxonomy-v1'));
});

// ---------------------------------------------------------------------------
// approval drift (candidate.currentApplication)
// ---------------------------------------------------------------------------

test('approval drift: up_to_date when the active application matches the current template approval exactly', async () => {
  const active = {
    id: 'interp-existing',
    credentialId: CREDENTIAL_ID,
    templateId: TEMPLATE_ID,
    sourceSemanticAnalysisId: 'semantic-1',
    sourceCredentialId: SOURCE_CREDENTIAL_ID,
    sourceApprovedByUserId: 'user-approver',
    sourceApprovedAt: APPROVED_AT,
    sourcePipelineVersion: 'pipeline-v1',
    sourceTaxonomyVersion: 'taxonomy-v1',
    approvedSnapshot: { schema: 'approved_template_semantic_snapshot_v2', status: 'completed', areas: [], skills: [], concepts: [], hoursDistribution: [], warnings: [], qualityFlags: [] },
    snapshotVersion: 'approved_template_semantic_snapshot_v2',
    appliedByUserId: 'issuer-user-1',
    appliedAt: new Date('2026-08-14T11:00:00.000Z'),
    status: 'active'
  };
  const { service } = setup({ interpretations: [active] });

  const result = await service.getCandidateForIssuer(
    ISSUER_ID,
    CREDENTIAL_ID,
    TEMPLATE_ID,
    CURRENT_USER
  );

  assert.equal(result.approvalDriftStatus, 'up_to_date');
  assert.ok(result.currentApplication);
  assert.equal(result.currentApplication!.approvalDriftStatus, 'up_to_date');
});

test('approval drift: different_approval_available when the template was re-approved after the active row was applied', async () => {
  const active = {
    id: 'interp-existing',
    credentialId: CREDENTIAL_ID,
    templateId: TEMPLATE_ID,
    sourceSemanticAnalysisId: 'semantic-old',
    sourceCredentialId: SOURCE_CREDENTIAL_ID,
    sourceApprovedByUserId: 'user-approver',
    sourceApprovedAt: new Date('2026-08-01T00:00:00.000Z'),
    sourcePipelineVersion: 'pipeline-v1',
    sourceTaxonomyVersion: 'taxonomy-v1',
    approvedSnapshot: { schema: 'approved_template_semantic_snapshot_v2', status: 'completed', areas: [], skills: [], concepts: [], hoursDistribution: [], warnings: [], qualityFlags: [] },
    snapshotVersion: 'approved_template_semantic_snapshot_v2',
    appliedByUserId: 'issuer-user-1',
    appliedAt: new Date('2026-08-01T01:00:00.000Z'),
    status: 'active'
  };
  const { service } = setup({ interpretations: [active] });

  const result = await service.getCandidateForIssuer(
    ISSUER_ID,
    CREDENTIAL_ID,
    TEMPLATE_ID,
    CURRENT_USER
  );

  assert.equal(result.approvalDriftStatus, 'different_approval_available');
});

test('approval drift: none_applied when there is no active row for the credential', async () => {
  const { service } = setup();
  const result = await service.getCandidateForIssuer(
    ISSUER_ID,
    CREDENTIAL_ID,
    TEMPLATE_ID,
    CURRENT_USER
  );
  assert.equal(result.approvalDriftStatus, 'none_applied');
});

// ---------------------------------------------------------------------------
// apply: first, idempotent, supersede
// ---------------------------------------------------------------------------

test('apply: first application inserts an active row and returns changed=true, supersededPreviousApplication=false', async () => {
  const { service, calls, interpretations } = setup();

  const result = await service.applyForIssuer(ISSUER_ID, CREDENTIAL_ID, CURRENT_USER, {
    templateId: TEMPLATE_ID,
    approvalRevision: APPROVED_AT.toISOString()
  });

  assert.equal(result.changed, true);
  assert.equal(result.supersededPreviousApplication, false);
  assert.equal(result.application.templateId, TEMPLATE_ID);
  assert.equal(interpretations.length, 1);
  assert.equal(interpretations[0].status, 'active');
  assert.equal(calls.creates.length, 1);
  const created = calls.creates[0] as Record<string, unknown>;
  assert.equal(created.sourceSemanticAnalysisId, 'semantic-1');
  assert.equal(created.sourceCredentialId, SOURCE_CREDENTIAL_ID);
  assert.equal(created.sourceApprovedByUserId, 'user-approver');
  assert.equal(created.appliedByUserId, CURRENT_USER.id);
  assert.equal(created.snapshotVersion, 'approved_template_semantic_snapshot_v2');
  assert.deepEqual(calls.transactions, [
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  ]);
});

test('apply: re-applying the same approval is idempotent -- no write, appliedAt/appliedByUserId preserved', async () => {
  const active = {
    id: 'interp-existing',
    credentialId: CREDENTIAL_ID,
    templateId: TEMPLATE_ID,
    sourceSemanticAnalysisId: 'semantic-1',
    sourceCredentialId: SOURCE_CREDENTIAL_ID,
    sourceApprovedByUserId: 'user-approver',
    sourceApprovedAt: APPROVED_AT,
    sourcePipelineVersion: 'pipeline-v1',
    sourceTaxonomyVersion: 'taxonomy-v1',
    approvedSnapshot: { schema: 'approved_template_semantic_snapshot_v2', status: 'completed', areas: [], skills: [], concepts: [], hoursDistribution: [], warnings: [], qualityFlags: [] },
    snapshotVersion: 'approved_template_semantic_snapshot_v2',
    appliedByUserId: 'someone-else',
    appliedAt: new Date('2026-08-14T11:00:00.000Z'),
    status: 'active'
  };
  const { service, calls, interpretations } = setup({ interpretations: [active] });

  const result = await service.applyForIssuer(ISSUER_ID, CREDENTIAL_ID, CURRENT_USER, {
    templateId: TEMPLATE_ID,
    approvalRevision: APPROVED_AT.toISOString()
  });

  assert.equal(result.changed, false);
  assert.equal(result.supersededPreviousApplication, false);
  assert.equal(result.application.appliedByDisplayLabel !== undefined, true);
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.updateMany.length, 0);
  assert.equal(interpretations.length, 1);
  assert.equal(interpretations[0].appliedByUserId, 'someone-else');
});

test('apply: reapplying a different approval supersedes the old active row and inserts a new one, preserving history', async () => {
  const oldActive = {
    id: 'interp-old',
    credentialId: CREDENTIAL_ID,
    templateId: TEMPLATE_ID,
    sourceSemanticAnalysisId: 'semantic-old',
    sourceCredentialId: SOURCE_CREDENTIAL_ID,
    sourceApprovedByUserId: 'user-approver',
    sourceApprovedAt: new Date('2026-08-01T00:00:00.000Z'),
    sourcePipelineVersion: 'pipeline-v1',
    sourceTaxonomyVersion: 'taxonomy-v1',
    approvedSnapshot: { schema: 'approved_template_semantic_snapshot_v2', status: 'completed', areas: [], skills: [], concepts: [], hoursDistribution: [], warnings: [], qualityFlags: [] },
    snapshotVersion: 'approved_template_semantic_snapshot_v2',
    appliedByUserId: 'someone-else',
    appliedAt: new Date('2026-08-01T01:00:00.000Z'),
    status: 'active'
  };
  const { service, calls, interpretations } = setup({ interpretations: [oldActive] });

  const result = await service.applyForIssuer(ISSUER_ID, CREDENTIAL_ID, CURRENT_USER, {
    templateId: TEMPLATE_ID,
    approvalRevision: APPROVED_AT.toISOString()
  });

  assert.equal(result.changed, true);
  assert.equal(result.supersededPreviousApplication, true);
  assert.equal(interpretations.length, 2);
  const superseded = interpretations.find((row) => row.id === 'interp-old')!;
  assert.equal(superseded.status, 'superseded');
  assert.ok(superseded.supersededAt instanceof Date);
  assert.equal(superseded.supersededByUserId, CURRENT_USER.id);
  // El registro viejo nunca se muta mas alla de status/supersededAt/supersededByUserId.
  assert.equal(superseded.sourceSemanticAnalysisId, 'semantic-old');
  assert.equal(superseded.appliedByUserId, 'someone-else');
  const newActive = interpretations.find((row) => row.status === 'active')!;
  assert.equal(newActive.sourceSemanticAnalysisId, 'semantic-1');
  assert.equal(calls.updateMany.length, 1);
  assert.equal(calls.creates.length, 1);
});

// ---------------------------------------------------------------------------
// apply: destination drift / unknown gating
// ---------------------------------------------------------------------------

test('apply: destinationCompatibility modified without acknowledgeDestinationDrift -> 422, nothing persisted', async () => {
  const destination = credentialRow({
    title: 'Marketing digital',
    credentialSubject: baseSubject({ achievement_name: 'Marketing digital' })
  });
  const { service, calls, interpretations } = setup({
    credentials: [destination, sourceCredentialRow()]
  });

  await assert.rejects(
    service.applyForIssuer(ISSUER_ID, CREDENTIAL_ID, CURRENT_USER, {
      templateId: TEMPLATE_ID,
      approvalRevision: APPROVED_AT.toISOString()
    }),
    UnprocessableEntityException
  );
  assert.equal(interpretations.length, 0);
  assert.equal(calls.creates.length, 0);
});

test('apply: destinationCompatibility modified WITH acknowledgeDestinationDrift=true -> succeeds', async () => {
  const destination = credentialRow({
    title: 'Marketing digital',
    credentialSubject: baseSubject({ achievement_name: 'Marketing digital' })
  });
  const { service, interpretations } = setup({
    credentials: [destination, sourceCredentialRow()]
  });

  const result = await service.applyForIssuer(ISSUER_ID, CREDENTIAL_ID, CURRENT_USER, {
    templateId: TEMPLATE_ID,
    approvalRevision: APPROVED_AT.toISOString(),
    acknowledgeDestinationDrift: true
  });

  assert.equal(result.changed, true);
  assert.equal(interpretations.length, 1);
});

test('apply: destinationCompatibility unknown (source credential missing) always blocks, even with acknowledgeDestinationDrift=true', async () => {
  const { service, interpretations } = setup({ credentials: [credentialRow()] });

  await assert.rejects(
    service.applyForIssuer(ISSUER_ID, CREDENTIAL_ID, CURRENT_USER, {
      templateId: TEMPLATE_ID,
      approvalRevision: APPROVED_AT.toISOString(),
      acknowledgeDestinationDrift: true
    }),
    UnprocessableEntityException
  );
  assert.equal(interpretations.length, 0);
});

// ---------------------------------------------------------------------------
// TOCTOU protection
// ---------------------------------------------------------------------------

test('TOCTOU: apply rejects when the template approval changed since the client reviewed candidate (stale approvalRevision) -- never applies the new approval silently', async () => {
  const { service, interpretations } = setup();

  const staleRevision = new Date('2026-08-01T00:00:00.000Z').toISOString();

  await assert.rejects(
    service.applyForIssuer(ISSUER_ID, CREDENTIAL_ID, CURRENT_USER, {
      templateId: TEMPLATE_ID,
      approvalRevision: staleRevision
    }),
    ConflictException
  );
  assert.equal(interpretations.length, 0);
});

test('TOCTOU: apply succeeds when approvalRevision matches exactly what candidate returned', async () => {
  const { service } = setup();
  const candidate = await service.getCandidateForIssuer(
    ISSUER_ID,
    CREDENTIAL_ID,
    TEMPLATE_ID,
    CURRENT_USER
  );

  const result = await service.applyForIssuer(ISSUER_ID, CREDENTIAL_ID, CURRENT_USER, {
    templateId: TEMPLATE_ID,
    approvalRevision: candidate.approvalRevision
  });

  assert.equal(result.changed, true);
});

test('TOCTOU: after a re-approval, candidate exposes the new approvalRevision so the client can retry with it', async () => {
  const reapproved = templateRow({
    approvedSemanticAnalysisId: 'semantic-2',
    approvedSemanticApprovedAt: new Date('2026-08-15T00:00:00.000Z')
  });
  const { service } = setup({ templates: [reapproved] });

  const candidate = await service.getCandidateForIssuer(
    ISSUER_ID,
    CREDENTIAL_ID,
    TEMPLATE_ID,
    CURRENT_USER
  );
  assert.equal(candidate.approvalRevision, new Date('2026-08-15T00:00:00.000Z').toISOString());

  const result = await service.applyForIssuer(ISSUER_ID, CREDENTIAL_ID, CURRENT_USER, {
    templateId: TEMPLATE_ID,
    approvalRevision: candidate.approvalRevision
  });
  assert.equal(result.changed, true);
});

// ---------------------------------------------------------------------------
// concurrency: Serializable retry, P2002 reconciliation
// ---------------------------------------------------------------------------

test('concurrency: a single serialization conflict (P2034) is retried once and then succeeds', async () => {
  const { service, calls } = setup({
    transactionErrors: [prismaKnownError('P2034', 'Transaction failed due to a write conflict')]
  });

  const result = await service.applyForIssuer(ISSUER_ID, CREDENTIAL_ID, CURRENT_USER, {
    templateId: TEMPLATE_ID,
    approvalRevision: APPROVED_AT.toISOString()
  });

  assert.equal(result.changed, true);
  assert.equal(calls.transactions.length, 2);
});

test('concurrency: two consecutive serialization conflicts (P2034) exhaust the single retry and surface a safe 409, never a raw Prisma error', async () => {
  const { service, calls } = setup({
    transactionErrors: [
      prismaKnownError('P2034', 'conflict 1'),
      prismaKnownError('P2034', 'conflict 2')
    ]
  });

  await assert.rejects(
    service.applyForIssuer(ISSUER_ID, CREDENTIAL_ID, CURRENT_USER, {
      templateId: TEMPLATE_ID,
      approvalRevision: APPROVED_AT.toISOString()
    }),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.ok(!String((error as Error).message).includes('P2034'));
      return true;
    }
  );
  assert.equal(calls.transactions.length, 2);
});

test('concurrency: a P2002 on the unique-active constraint reconciles as idempotent when another transaction already applied the same approval', async () => {
  const { service } = setup({ simulateUniqueViolationOnCreate: true });

  // La otra transaccion "ganadora" ya dejo una fila active con la MISMA
  // identidad de aprobacion que este request tambien queria aplicar.
  // Como el fake create() siempre lanza P2002 en este test, simulamos el
  // resultado post-reconciliacion insertando manualmente la fila que la
  // otra transaccion habria creado, ANTES de que el service intente su
  // propia lectura de reconciliacion.
  const service2 = setup({
    interpretations: [
      {
        id: 'interp-winner',
        credentialId: CREDENTIAL_ID,
        templateId: TEMPLATE_ID,
        sourceSemanticAnalysisId: 'semantic-1',
        sourceCredentialId: SOURCE_CREDENTIAL_ID,
        sourceApprovedByUserId: 'user-approver',
        sourceApprovedAt: APPROVED_AT,
        sourcePipelineVersion: 'pipeline-v1',
        sourceTaxonomyVersion: 'taxonomy-v1',
        approvedSnapshot: { schema: 'approved_template_semantic_snapshot_v2', status: 'completed', areas: [], skills: [], concepts: [], hoursDistribution: [], warnings: [], qualityFlags: [] },
        snapshotVersion: 'approved_template_semantic_snapshot_v2',
        appliedByUserId: 'other-user',
        appliedAt: new Date('2026-08-14T11:00:00.000Z'),
        status: 'active'
      }
    ],
    simulateUniqueViolationOnCreate: true
  });
  void service;

  const result = await service2.service.applyForIssuer(
    ISSUER_ID,
    CREDENTIAL_ID,
    CURRENT_USER,
    { templateId: TEMPLATE_ID, approvalRevision: APPROVED_AT.toISOString() }
  );

  assert.equal(result.changed, false);
  assert.equal(result.supersededPreviousApplication, false);
});

test('concurrency: a P2002 that cannot be reconciled (winner applied a different approval) surfaces a safe 409, never the raw constraint name', async () => {
  const { service } = setup({
    interpretations: [
      {
        id: 'interp-winner',
        credentialId: CREDENTIAL_ID,
        templateId: TEMPLATE_ID,
        sourceSemanticAnalysisId: 'semantic-DIFFERENT',
        sourceCredentialId: SOURCE_CREDENTIAL_ID,
        sourceApprovedByUserId: 'user-approver',
        sourceApprovedAt: new Date('2026-08-10T00:00:00.000Z'),
        sourcePipelineVersion: 'pipeline-v1',
        sourceTaxonomyVersion: 'taxonomy-v1',
        approvedSnapshot: { schema: 'approved_template_semantic_snapshot_v2', status: 'completed', areas: [], skills: [], concepts: [], hoursDistribution: [], warnings: [], qualityFlags: [] },
        snapshotVersion: 'approved_template_semantic_snapshot_v2',
        appliedByUserId: 'other-user',
        appliedAt: new Date('2026-08-10T01:00:00.000Z'),
        status: 'active'
      }
    ],
    simulateUniqueViolationOnCreate: true
  });

  await assert.rejects(
    service.applyForIssuer(ISSUER_ID, CREDENTIAL_ID, CURRENT_USER, {
      templateId: TEMPLATE_ID,
      approvalRevision: APPROVED_AT.toISOString()
    }),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.ok(!String((error as Error).message).includes('constraint'));
      assert.ok(!String((error as Error).message).includes('crsi_one_active_per_credential_uq'));
      return true;
    }
  );
});

test('apply: a business rejection (404/400/409/422) is never retried', async () => {
  const { service, calls } = setup({ credentials: [] });

  await assert.rejects(
    service.applyForIssuer(ISSUER_ID, CREDENTIAL_ID, CURRENT_USER, {
      templateId: TEMPLATE_ID,
      approvalRevision: APPROVED_AT.toISOString()
    }),
    NotFoundException
  );
  assert.equal(calls.transactions.length, 1);
});

// ---------------------------------------------------------------------------
// C5b.1: rebuild best-effort del perfil del holder despues de un apply
// exitoso. Reutiliza AutomaticProfileRebuildService (mismo contrato que ya
// usa el resto del repo -- nunca lanza). Siempre DESPUES de que apply ya
// persistio, nunca dentro de la transaccion.
// ---------------------------------------------------------------------------

test('R: a first successful apply (changed=true) triggers a profile rebuild for the credential subject, after persistence completes', async () => {
  const { service, calls } = setup();

  const result = await service.applyForIssuer(ISSUER_ID, CREDENTIAL_ID, CURRENT_USER, {
    templateId: TEMPLATE_ID,
    approvalRevision: APPROVED_AT.toISOString()
  });

  assert.equal(result.changed, true);
  assert.deepEqual(calls.profileRebuilds, [
    { credentialId: CREDENTIAL_ID, holderUserId: 'holder-1' }
  ]);
});

test('S: an idempotent apply (changed=false) can still retry the rebuild -- never treated as an error, never creates a new interpretation row', async () => {
  const active = {
    id: 'interp-existing',
    credentialId: CREDENTIAL_ID,
    templateId: TEMPLATE_ID,
    sourceSemanticAnalysisId: 'semantic-1',
    sourceCredentialId: SOURCE_CREDENTIAL_ID,
    sourceApprovedByUserId: 'user-approver',
    sourceApprovedAt: APPROVED_AT,
    sourcePipelineVersion: 'pipeline-v1',
    sourceTaxonomyVersion: 'taxonomy-v1',
    approvedSnapshot: { schema: 'approved_template_semantic_snapshot_v2', status: 'completed', areas: [], skills: [], concepts: [], hoursDistribution: [], warnings: [], qualityFlags: [] },
    snapshotVersion: 'approved_template_semantic_snapshot_v2',
    appliedByUserId: 'issuer-user-1',
    appliedAt: new Date('2026-08-14T11:00:00.000Z'),
    status: 'active'
  };
  const { service, calls, interpretations } = setup({ interpretations: [active] });

  const result = await service.applyForIssuer(ISSUER_ID, CREDENTIAL_ID, CURRENT_USER, {
    templateId: TEMPLATE_ID,
    approvalRevision: APPROVED_AT.toISOString()
  });

  assert.equal(result.changed, false);
  assert.equal(interpretations.length, 1, 'idempotent apply never creates a new row');
  assert.deepEqual(calls.profileRebuilds, [
    { credentialId: CREDENTIAL_ID, holderUserId: 'holder-1' }
  ]);
});

test('T: apply stays a success even if the profile rebuild fails -- never retries apply, never surfaces the rebuild failure as an apply error', async () => {
  const { service, calls } = setup({ rebuildFails: true });

  const result = await service.applyForIssuer(ISSUER_ID, CREDENTIAL_ID, CURRENT_USER, {
    templateId: TEMPLATE_ID,
    approvalRevision: APPROVED_AT.toISOString()
  });

  assert.equal(result.changed, true);
  assert.equal(calls.profileRebuilds.length, 1);
  assert.equal(calls.transactions.length, 1, 'a failed rebuild must never trigger an apply retry');
});

test('rebuild is triggered on the P2002-reconciled idempotent path too', async () => {
  const { service, calls } = setup({
    interpretations: [
      {
        id: 'interp-winner',
        credentialId: CREDENTIAL_ID,
        templateId: TEMPLATE_ID,
        sourceSemanticAnalysisId: 'semantic-1',
        sourceCredentialId: SOURCE_CREDENTIAL_ID,
        sourceApprovedByUserId: 'user-approver',
        sourceApprovedAt: APPROVED_AT,
        sourcePipelineVersion: 'pipeline-v1',
        sourceTaxonomyVersion: 'taxonomy-v1',
        approvedSnapshot: { schema: 'approved_template_semantic_snapshot_v2', status: 'completed', areas: [], skills: [], concepts: [], hoursDistribution: [], warnings: [], qualityFlags: [] },
        snapshotVersion: 'approved_template_semantic_snapshot_v2',
        appliedByUserId: 'other-user',
        appliedAt: new Date('2026-08-14T11:00:00.000Z'),
        status: 'active'
      }
    ],
    simulateUniqueViolationOnCreate: true
  });

  const result = await service.applyForIssuer(ISSUER_ID, CREDENTIAL_ID, CURRENT_USER, {
    templateId: TEMPLATE_ID,
    approvalRevision: APPROVED_AT.toISOString()
  });

  assert.equal(result.changed, false);
  assert.deepEqual(calls.profileRebuilds, [
    { credentialId: CREDENTIAL_ID, holderUserId: 'holder-1' }
  ]);
});

test('rebuild is never triggered for a business rejection (no application was ever produced)', async () => {
  const { service, calls } = setup({ credentials: [] });

  await assert.rejects(
    service.applyForIssuer(ISSUER_ID, CREDENTIAL_ID, CURRENT_USER, {
      templateId: TEMPLATE_ID,
      approvalRevision: APPROVED_AT.toISOString()
    }),
    NotFoundException
  );
  assert.equal(calls.profileRebuilds.length, 0);
});

// ---------------------------------------------------------------------------
// frozen source (C4b.1b-R): la source Credential de una interpretacion ya
// aplicada debe permanecer historica y congelada -- una re-aprobacion
// posterior del template (con una source Credential DISTINTA) nunca puede
// cambiar retroactivamente contra que fuente se evalua una aplicacion ya
// persistida. candidate TOP-LEVEL evalua "que se aplicaria AHORA" (source
// actual del template); read y candidate.currentApplication describen "que
// esta aplicado" (source congelada de la fila active). Labels/contenidos
// deliberadamente distintos entre Approval A y B para que el test falle si
// se mezclan.
// ---------------------------------------------------------------------------

const SOURCE_A_ID = 'credential-source-a';
const SOURCE_B_ID = 'credential-source-b';

function sourceA(overrides: Record<string, unknown> = {}) {
  return credentialRow({
    id: SOURCE_A_ID,
    title: 'Introducción a UX',
    description: 'Descripción original de UX',
    credentialSubject: baseSubject({
      achievement_name: 'Introducción a UX',
      competencies: ['Investigación de usuarios']
    }),
    ...overrides
  });
}

function sourceB(overrides: Record<string, unknown> = {}) {
  return credentialRow({
    id: SOURCE_B_ID,
    title: 'Marketing digital',
    description: 'Descripción de marketing',
    credentialSubject: baseSubject({
      achievement_name: 'Marketing digital',
      competencies: ['SEO']
    }),
    ...overrides
  });
}

function activeFromApprovalA(overrides: Record<string, unknown> = {}) {
  return {
    id: 'interp-approval-a',
    credentialId: CREDENTIAL_ID,
    templateId: TEMPLATE_ID,
    sourceSemanticAnalysisId: 'semantic-A',
    sourceCredentialId: SOURCE_A_ID,
    sourceApprovedByUserId: 'user-approver',
    sourceApprovedAt: new Date('2026-08-01T00:00:00.000Z'),
    sourcePipelineVersion: 'pipeline-v1',
    sourceTaxonomyVersion: 'taxonomy-v1',
    approvedSnapshot: {
      schema: 'approved_template_semantic_snapshot_v2',
      status: 'completed',
      areas: [],
      skills: [],
      concepts: [],
      hoursDistribution: [],
      warnings: [],
      qualityFlags: []
    },
    snapshotVersion: 'approved_template_semantic_snapshot_v2',
    appliedByUserId: 'issuer-user-1',
    appliedAt: new Date('2026-08-01T01:00:00.000Z'),
    status: 'active',
    ...overrides
  };
}

function templateReapprovedAsB(overrides: Record<string, unknown> = {}) {
  return templateRow({
    title: 'Marketing digital',
    description: 'Descripción de marketing',
    competencies: ['SEO'],
    approvedSemanticAnalysisId: 'semantic-B',
    approvedSemanticSourceCredentialId: SOURCE_B_ID,
    approvedSemanticApprovedAt: new Date('2026-08-15T00:00:00.000Z'),
    ...overrides
  });
}

test('frozen source: after the template is re-approved with a DIFFERENT source Credential, read() keeps describing the original applied approval (A), never the new one (B)', async () => {
  // La credencial destino coincide EXACTAMENTE con source A -- asi que
  // compatible/modified distingue sin ambiguedad contra que fuente se
  // esta comparando.
  const destination = credentialRow({
    title: 'Introducción a UX',
    credentialSubject: baseSubject({
      achievement_name: 'Introducción a UX',
      competencies: ['Investigación de usuarios']
    })
  });
  const { service } = setup({
    credentials: [destination, sourceA(), sourceB()],
    templates: [templateReapprovedAsB()],
    interpretations: [activeFromApprovalA()]
  });

  const read = await service.getActiveForIssuer(ISSUER_ID, CREDENTIAL_ID, CURRENT_USER);

  assert.ok(read);
  // destino == source A -> compatible. Si comparara contra source B
  // ("Marketing digital") en cambio, esto daria 'modified'.
  assert.equal(read!.destinationCompatibility, 'compatible');
  assert.deepEqual(read!.changedFields, []);
  // El template ACTUAL ("Marketing digital") difiere de la source
  // CONGELADA (A, "Introducción a UX") -- advertencia honesta, nunca
  // bloquea, nunca sustituye la source congelada.
  assert.equal(read!.templateContentStatus, 'differs_from_approved_source');
  // Identidad congelada (semantic-A) vs aprobacion actual del template
  // (semantic-B) -- difieren por diseño (approvalDriftStatus siempre
  // mezcla congelado vs actual).
  assert.equal(read!.approvalDriftStatus, 'different_approval_available');

  const serialized = JSON.stringify(read);
  assert.ok(!serialized.includes(SOURCE_A_ID));
  assert.ok(!serialized.includes(SOURCE_B_ID));
  assert.ok(!serialized.includes('semantic-A'));
  assert.ok(!serialized.includes('semantic-B'));
});

test('frozen source: candidate.currentApplication mirrors read() -- same frozen source A, never the template current source B', async () => {
  const destination = credentialRow({
    title: 'Introducción a UX',
    credentialSubject: baseSubject({
      achievement_name: 'Introducción a UX',
      competencies: ['Investigación de usuarios']
    })
  });
  const { service } = setup({
    credentials: [destination, sourceA(), sourceB()],
    templates: [templateReapprovedAsB()],
    interpretations: [activeFromApprovalA()]
  });

  const candidate = await service.getCandidateForIssuer(
    ISSUER_ID,
    CREDENTIAL_ID,
    TEMPLATE_ID,
    CURRENT_USER
  );

  assert.ok(candidate.currentApplication);
  assert.equal(candidate.currentApplication!.destinationCompatibility, 'compatible');
  assert.equal(candidate.currentApplication!.templateContentStatus, 'differs_from_approved_source');
  assert.equal(candidate.currentApplication!.approvalDriftStatus, 'different_approval_available');
});

test('frozen source: candidate TOP-LEVEL evaluates the CURRENT approval (B/Marketing), simultaneously with currentApplication describing the frozen one (A/UX), without mixing them', async () => {
  const destination = credentialRow({
    title: 'Introducción a UX',
    credentialSubject: baseSubject({
      achievement_name: 'Introducción a UX',
      competencies: ['Investigación de usuarios']
    })
  });
  const { service } = setup({
    credentials: [destination, sourceA(), sourceB()],
    templates: [templateReapprovedAsB()],
    interpretations: [activeFromApprovalA()]
  });

  const candidate = await service.getCandidateForIssuer(
    ISSUER_ID,
    CREDENTIAL_ID,
    TEMPLATE_ID,
    CURRENT_USER
  );

  // Top-level: destino ("Introducción a UX") vs source ACTUAL del template
  // (B, "Marketing digital") -- deben diferir. Si compatible aca, el
  // codigo estaria comparando contra A en vez de B.
  assert.equal(candidate.destinationCompatibility, 'modified');
  assert.ok(candidate.changedFields.includes('title'));
  assert.ok(candidate.changedFields.includes('competencies'));
  // El template actual ("Marketing digital"/SEO) coincide EXACTAMENTE con
  // su propia source actual (B) -- matches, nunca differs, porque nunca
  // deberia compararse contra la source congelada A aca.
  assert.equal(candidate.templateContentStatus, 'matches_approved_source');
  assert.equal(candidate.approvalDriftStatus, 'different_approval_available');

  // currentApplication, en la MISMA respuesta, sigue describiendo la
  // aplicacion congelada (A) sin contaminarse del calculo top-level.
  assert.ok(candidate.currentApplication);
  assert.equal(candidate.currentApplication!.destinationCompatibility, 'compatible');
  assert.equal(candidate.currentApplication!.templateContentStatus, 'differs_from_approved_source');

  const serialized = JSON.stringify(candidate);
  assert.ok(!serialized.includes(SOURCE_A_ID));
  assert.ok(!serialized.includes(SOURCE_B_ID));
  assert.ok(!serialized.includes('semantic-A'));
  assert.ok(!serialized.includes('semantic-B'));
});

test('frozen source absent: read() never disappears/404s when the ORIGINAL applied source Credential can no longer be resolved, and never falls back to a different source', async () => {
  const destination = credentialRow();
  // Source A deliberadamente ausente del set de credenciales -- solo
  // source B (la actual del template) existe.
  const { service } = setup({
    credentials: [destination, sourceB()],
    templates: [templateReapprovedAsB()],
    interpretations: [activeFromApprovalA()]
  });

  const read = await service.getActiveForIssuer(ISSUER_ID, CREDENTIAL_ID, CURRENT_USER);

  assert.ok(read, 'la aplicacion sigue existiendo y siendo legible');
  assert.equal(read!.destinationCompatibility, 'unknown');
  assert.equal(read!.templateContentStatus, 'unknown');
  assert.deepEqual(read!.changedFields, []);
});

test('frozen source absent: candidate.currentApplication also reports unknown (never a silent fallback to the template current source), while candidate top-level keeps resolving normally against B', async () => {
  const destination = credentialRow({
    title: 'Marketing digital',
    description: 'Descripción de marketing',
    credentialSubject: baseSubject({ achievement_name: 'Marketing digital', competencies: ['SEO'] })
  });
  const { service } = setup({
    credentials: [destination, sourceB()],
    templates: [templateReapprovedAsB()],
    interpretations: [activeFromApprovalA()]
  });

  const candidate = await service.getCandidateForIssuer(
    ISSUER_ID,
    CREDENTIAL_ID,
    TEMPLATE_ID,
    CURRENT_USER
  );

  assert.ok(candidate.currentApplication);
  assert.equal(candidate.currentApplication!.destinationCompatibility, 'unknown');
  assert.equal(candidate.currentApplication!.templateContentStatus, 'unknown');
  // Top-level sigue resolviendo normalmente contra B (destino coincide
  // exactamente con B en este fixture).
  assert.equal(candidate.destinationCompatibility, 'compatible');
});

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------

test('read: returns null (never 404) when the credential exists but has no active interpretation', async () => {
  const { service } = setup();
  const result = await service.getActiveForIssuer(ISSUER_ID, CREDENTIAL_ID, CURRENT_USER);
  assert.equal(result, null);
});

test('read: returns the allowlisted summary when an active interpretation exists', async () => {
  const active = {
    id: 'interp-existing',
    credentialId: CREDENTIAL_ID,
    templateId: TEMPLATE_ID,
    sourceSemanticAnalysisId: 'semantic-1',
    sourceCredentialId: SOURCE_CREDENTIAL_ID,
    sourceApprovedByUserId: 'user-approver',
    sourceApprovedAt: APPROVED_AT,
    sourcePipelineVersion: 'pipeline-v1',
    sourceTaxonomyVersion: 'taxonomy-v1',
    approvedSnapshot: { schema: 'approved_template_semantic_snapshot_v2', status: 'completed', areas: [], skills: [], concepts: [], hoursDistribution: [], warnings: [], qualityFlags: [] },
    snapshotVersion: 'approved_template_semantic_snapshot_v2',
    appliedByUserId: 'issuer-user-1',
    appliedAt: new Date('2026-08-14T11:00:00.000Z'),
    status: 'active'
  };
  const { service } = setup({ interpretations: [active] });

  const result = await service.getActiveForIssuer(ISSUER_ID, CREDENTIAL_ID, CURRENT_USER);

  assert.ok(result);
  assert.equal(result!.templateId, TEMPLATE_ID);
  assert.equal(result!.appliedAt, active.appliedAt.toISOString());
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(SOURCE_CREDENTIAL_ID));
  assert.ok(!serialized.includes('issuer-user-1'));
});

test('read: 404 for a cross-issuer credential (never leaks existence)', async () => {
  const { service } = setup();
  await assert.rejects(
    service.getActiveForIssuer('issuer-other', CREDENTIAL_ID, CURRENT_USER),
    NotFoundException
  );
});

test('read: remains readable even after the credential was later revoked', async () => {
  const active = {
    id: 'interp-existing',
    credentialId: CREDENTIAL_ID,
    templateId: TEMPLATE_ID,
    sourceSemanticAnalysisId: 'semantic-1',
    sourceCredentialId: SOURCE_CREDENTIAL_ID,
    sourceApprovedByUserId: 'user-approver',
    sourceApprovedAt: APPROVED_AT,
    sourcePipelineVersion: 'pipeline-v1',
    sourceTaxonomyVersion: 'taxonomy-v1',
    approvedSnapshot: { schema: 'approved_template_semantic_snapshot_v2', status: 'completed', areas: [], skills: [], concepts: [], hoursDistribution: [], warnings: [], qualityFlags: [] },
    snapshotVersion: 'approved_template_semantic_snapshot_v2',
    appliedByUserId: 'issuer-user-1',
    appliedAt: new Date('2026-08-14T11:00:00.000Z'),
    status: 'active'
  };
  const { service } = setup({
    credentials: [credentialRow({ status: CredentialStatus.revoked }), sourceCredentialRow()],
    interpretations: [active]
  });

  const result = await service.getActiveForIssuer(ISSUER_ID, CREDENTIAL_ID, CURRENT_USER);
  assert.ok(result);
});

// ---------------------------------------------------------------------------
// authorization
// ---------------------------------------------------------------------------

test('all three operations are rejected before any credential/template read when the issuer authorization check fails', async () => {
  const forbidden = new ForbiddenException('forbidden');
  const { service: candidateService } = setup({ permissionError: forbidden });
  await assert.rejects(
    candidateService.getCandidateForIssuer(ISSUER_ID, CREDENTIAL_ID, TEMPLATE_ID, CURRENT_USER),
    ForbiddenException
  );

  const { service: applyService, interpretations } = setup({ permissionError: forbidden });
  await assert.rejects(
    applyService.applyForIssuer(ISSUER_ID, CREDENTIAL_ID, CURRENT_USER, {
      templateId: TEMPLATE_ID,
      approvalRevision: APPROVED_AT.toISOString()
    }),
    ForbiddenException
  );
  assert.equal(interpretations.length, 0);

  const { service: readService } = setup({ permissionError: forbidden });
  await assert.rejects(
    readService.getActiveForIssuer(ISSUER_ID, CREDENTIAL_ID, CURRENT_USER),
    ForbiddenException
  );
});

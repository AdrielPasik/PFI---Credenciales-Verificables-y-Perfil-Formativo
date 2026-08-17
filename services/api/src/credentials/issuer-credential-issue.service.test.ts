import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from '@nestjs/common';
import { UserStatus } from '@prisma/client';

import { IssuerCredentialIssueService } from './issuer-credential-issue.service';

const currentUser = {
  id: 'issuer-user-1',
  email: 'issuer.admin@example.com',
  did: null,
  status: UserStatus.active
};

// P1.1: el actor (currentUser, quien ejecuta la emision) es SIEMPRE
// distinto del holder (subjectUserId de la Credential) -- esto no es
// incidental, es deliberado para que cualquier test que confunda ambos
// falle de inmediato (ver "service uses the credential holder, never the
// issuer actor, as the profile rebuild target").
const DEFAULT_HOLDER_USER_ID = 'holder-1';

function createService(options?: {
  scopedCredential?: { id: string } | null;
  authorizationError?: Error;
  issuanceError?: Error;
  issuedCredential?: { subjectUserId: string };
  profileBaselineRebuildError?: Error;
  automaticAnalysisError?: Error;
  automaticCourseTextAnalysisError?: Error;
}) {
  const order: string[] = [];
  const authorizationCalls: unknown[] = [];
  const lookupCalls: unknown[] = [];
  const issueCalls: unknown[] = [];
  const readCalls: unknown[] = [];
  const profileBaselineRebuildCalls: unknown[] = [];
  const automaticAnalysisCalls: string[] = [];
  const automaticCourseTextAnalysisCalls: unknown[][] = [];
  const safeReadModel = {
    id: 'credential-1',
    status: 'issued',
    issuedAt: '2026-08-06T12:00:00.000Z',
    canonicalHash: `0x${'a'.repeat(64)}`,
    canonicalizationVersion: 'canon_v1',
    blockchainEvidence: {
      network: 'anvil',
      chainId: 31337,
      txHash: `0x${'b'.repeat(64)}`,
      status: 'registered',
      registeredAt: '2026-08-06T12:00:01.000Z'
    }
  };
  const service = new IssuerCredentialIssueService(
    {
      credential: {
        async findFirst(args: unknown) {
          order.push('scoped_lookup');
          lookupCalls.push(args);
          return options?.scopedCredential === undefined
            ? { id: 'credential-1' }
            : options.scopedCredential;
        }
      }
    } as never,
    {
      async assertUserCanIssueCredentialForIssuer(
        userId: string,
        issuerId: string
      ) {
        order.push('authorization');
        authorizationCalls.push({ userId, issuerId });
        if (options?.authorizationError) throw options.authorizationError;
      }
    } as never,
    {
      async issueCredential(...args: unknown[]) {
        order.push('legacy_issue');
        issueCalls.push(args);
        if (options?.issuanceError) throw options.issuanceError;
        return (
          options?.issuedCredential ?? {
            subjectUserId: DEFAULT_HOLDER_USER_ID
          }
        );
      }
    } as never,
    {
      async getCredentialForIssuer(...args: unknown[]) {
        order.push('safe_read');
        readCalls.push(args);
        return safeReadModel;
      }
    } as never,
    {
      async analyzeIssuedCredentialIfEligible(credentialId: string) {
        order.push('automatic_analysis');
        automaticAnalysisCalls.push(credentialId);
        if (options?.automaticAnalysisError) {
          throw options.automaticAnalysisError;
        }
      }
    } as never,
    {
      async analyzeIssuedCredentialIfEligible(...args: unknown[]) {
        order.push('automatic_course_text_analysis');
        automaticCourseTextAnalysisCalls.push(args);
        if (options?.automaticCourseTextAnalysisError) {
          throw options.automaticCourseTextAnalysisError;
        }
      }
    } as never,
    {
      async rebuildAfterIssuance(input: {
        credentialId: string;
        holderUserId: string;
      }) {
        order.push('profile_baseline_rebuild');
        profileBaselineRebuildCalls.push(input);
        if (options?.profileBaselineRebuildError) {
          throw options.profileBaselineRebuildError;
        }
        return { status: 'rebuilt' as const };
      }
    } as never
  );

  return {
    service,
    order,
    authorizationCalls,
    lookupCalls,
    issueCalls,
    readCalls,
    profileBaselineRebuildCalls,
    automaticAnalysisCalls,
    automaticCourseTextAnalysisCalls,
    safeReadModel
  };
}

test('service authorizes and scopes before reusing legacy issuance once', async () => {
  const context = createService();
  const response = await context.service.issueForIssuer(
    'issuer-1',
    'credential-1',
    currentUser
  );

  assert.deepEqual(context.order, [
    'authorization',
    'scoped_lookup',
    'legacy_issue',
    'profile_baseline_rebuild',
    'automatic_analysis',
    'automatic_course_text_analysis',
    'safe_read'
  ]);
  assert.deepEqual(context.lookupCalls, [
    {
      where: { id: 'credential-1', issuerId: 'issuer-1' },
      select: { id: true }
    }
  ]);
  assert.deepEqual(context.issueCalls, [
    ['credential-1', { issuerId: 'issuer-1' }, currentUser]
  ]);
  // P1.1: el rebuild baseline usa el holder de la Credential
  // (DEFAULT_HOLDER_USER_ID), NUNCA currentUser.id (el issuer actor).
  assert.deepEqual(context.profileBaselineRebuildCalls, [
    { credentialId: 'credential-1', holderUserId: DEFAULT_HOLDER_USER_ID }
  ]);
  assert.notEqual(DEFAULT_HOLDER_USER_ID, currentUser.id);
  assert.deepEqual(context.automaticAnalysisCalls, ['credential-1']);
  assert.deepEqual(context.automaticCourseTextAnalysisCalls, [
    ['credential-1', currentUser.id]
  ]);
  assert.deepEqual(context.readCalls, [
    ['issuer-1', 'credential-1', currentUser]
  ]);
  assert.deepEqual(response, context.safeReadModel);
});

test('service does not disclose or issue a cross-issuer credential', async () => {
  const context = createService({ scopedCredential: null });

  await assert.rejects(
    context.service.issueForIssuer(
      'issuer-1',
      'credential-from-other-issuer',
      currentUser
    ),
    (error: unknown) => {
      assert.ok(error instanceof NotFoundException);
      assert.equal(error.message, 'No se encontro la credencial solicitada.');
      return true;
    }
  );
  assert.deepEqual(context.order, ['authorization', 'scoped_lookup']);
  assert.deepEqual(context.issueCalls, []);
  assert.deepEqual(context.profileBaselineRebuildCalls, []);
  assert.deepEqual(context.automaticAnalysisCalls, []);
  assert.deepEqual(context.automaticCourseTextAnalysisCalls, []);
});

test('service stops before credential lookup when institutional authorization fails', async () => {
  const context = createService({
    authorizationError: new ForbiddenException('forbidden')
  });

  await assert.rejects(
    context.service.issueForIssuer('issuer-arbitrary', 'credential-1', currentUser),
    ForbiddenException
  );
  assert.deepEqual(context.order, ['authorization']);
  assert.deepEqual(context.lookupCalls, []);
  assert.deepEqual(context.profileBaselineRebuildCalls, []);
});

test('service preserves safe domain HttpExceptions from legacy issuance', async () => {
  const context = createService({
    issuanceError: new ConflictException('La credencial no esta en draft.')
  });

  await assert.rejects(
    context.service.issueForIssuer('issuer-1', 'credential-1', currentUser),
    ConflictException
  );
  assert.deepEqual(context.order, [
    'authorization',
    'scoped_lookup',
    'legacy_issue'
  ]);
  assert.deepEqual(context.readCalls, []);
  // P1.1: si la emision misma falla, el baseline NUNCA se intenta.
  assert.deepEqual(context.profileBaselineRebuildCalls, []);
  assert.deepEqual(context.automaticAnalysisCalls, []);
  assert.deepEqual(context.automaticCourseTextAnalysisCalls, []);
});

test('service sanitizes unexpected hashing or blockchain failures', async () => {
  const unsafeError = new Error(
    'privateKey=fake rpcUrl=https://private.example hash=0xsecret'
  );
  const context = createService({ issuanceError: unsafeError });

  await assert.rejects(
    context.service.issueForIssuer('issuer-1', 'credential-1', currentUser),
    (error: unknown) => {
      assert.ok(error instanceof BadGatewayException);
      const serialized = JSON.stringify(error.getResponse());
      assert.equal(serialized.includes('privateKey'), false);
      assert.equal(serialized.includes('rpcUrl'), false);
      assert.equal(serialized.includes('0xsecret'), false);
      return true;
    }
  );
});

test('automatic analysis failure never changes the successful issuance response', async () => {
  const context = createService({
    automaticAnalysisError: new Error(
      'FastAPI URL, token, storageKey and private payload'
    )
  });

  const response = await context.service.issueForIssuer(
    'issuer-1',
    'credential-1',
    currentUser
  );

  assert.deepEqual(context.order, [
    'authorization',
    'scoped_lookup',
    'legacy_issue',
    'profile_baseline_rebuild',
    'automatic_analysis',
    'automatic_course_text_analysis',
    'safe_read'
  ]);
  assert.deepEqual(response, context.safeReadModel);
  assert.equal(JSON.stringify(response).includes('FastAPI'), false);
  assert.equal(JSON.stringify(response).includes('storageKey'), false);
  assert.equal(JSON.stringify(response).includes('private payload'), false);
});

// ─── C2b.3: automatic course text analysis integration ─────────────────────

test('automatic course text analysis is invoked after issuance with the acting user id', async () => {
  const context = createService();

  await context.service.issueForIssuer('issuer-1', 'credential-1', currentUser);

  assert.deepEqual(context.automaticCourseTextAnalysisCalls, [
    ['credential-1', currentUser.id]
  ]);
});

test('automatic course text analysis failure never changes the successful issuance response', async () => {
  const context = createService({
    automaticCourseTextAnalysisError: new Error(
      'raw declared course content, credentialSubject and internal detail'
    )
  });

  const response = await context.service.issueForIssuer(
    'issuer-1',
    'credential-1',
    currentUser
  );

  assert.deepEqual(context.order, [
    'authorization',
    'scoped_lookup',
    'legacy_issue',
    'profile_baseline_rebuild',
    'automatic_analysis',
    'automatic_course_text_analysis',
    'safe_read'
  ]);
  assert.deepEqual(response, context.safeReadModel);
  assert.equal(JSON.stringify(response).includes('raw declared course'), false);
  assert.equal(JSON.stringify(response).includes('credentialSubject'), false);
});

test('automatic course text analysis still runs even when the document analysis attempt failed', async () => {
  // Both attempts are independent and best-effort: a failure in the
  // document path must not skip the textual attempt, and vice versa.
  const context = createService({
    automaticAnalysisError: new Error('document analysis internal failure')
  });

  await context.service.issueForIssuer('issuer-1', 'credential-1', currentUser);

  assert.deepEqual(context.order, [
    'authorization',
    'scoped_lookup',
    'legacy_issue',
    'profile_baseline_rebuild',
    'automatic_analysis',
    'automatic_course_text_analysis',
    'safe_read'
  ]);
  assert.deepEqual(context.automaticCourseTextAnalysisCalls, [
    ['credential-1', currentUser.id]
  ]);
});

// ─── P1.1: profile baseline rebuild integration ─────────────────────────────

test('P1.1: service uses the credential holder, never the issuer actor, as the profile rebuild target', async () => {
  const distinctHolderId = 'holder-distinct-from-actor';
  const context = createService({
    issuedCredential: { subjectUserId: distinctHolderId }
  });

  await context.service.issueForIssuer('issuer-1', 'credential-1', currentUser);

  assert.deepEqual(context.profileBaselineRebuildCalls, [
    { credentialId: 'credential-1', holderUserId: distinctHolderId }
  ]);
  assert.notEqual(distinctHolderId, currentUser.id);
});

test('P1.1: baseline rebuild runs BEFORE automatic analysis attempts, awaited (not in parallel)', async () => {
  const context = createService();

  await context.service.issueForIssuer('issuer-1', 'credential-1', currentUser);

  const baselineIndex = context.order.indexOf('profile_baseline_rebuild');
  const documentAnalysisIndex = context.order.indexOf('automatic_analysis');
  const textAnalysisIndex = context.order.indexOf(
    'automatic_course_text_analysis'
  );

  assert.ok(baselineIndex >= 0);
  assert.ok(baselineIndex < documentAnalysisIndex);
  assert.ok(baselineIndex < textAnalysisIndex);
});

test('P1.1: baseline rebuild failure never changes the successful issuance response, and analysis still runs', async () => {
  const context = createService({
    profileBaselineRebuildError: new Error(
      'raw internal detail that must never leak'
    )
  });

  const response = await context.service.issueForIssuer(
    'issuer-1',
    'credential-1',
    currentUser
  );

  assert.deepEqual(context.order, [
    'authorization',
    'scoped_lookup',
    'legacy_issue',
    'profile_baseline_rebuild',
    'automatic_analysis',
    'automatic_course_text_analysis',
    'safe_read'
  ]);
  assert.deepEqual(response, context.safeReadModel);
  assert.equal(JSON.stringify(response).includes('raw internal detail'), false);
  // Auto-analysis is still attempted even though the baseline failed --
  // the two steps are independent, best-effort, and neither skips the
  // other.
  assert.deepEqual(context.automaticAnalysisCalls, ['credential-1']);
  assert.deepEqual(context.automaticCourseTextAnalysisCalls, [
    ['credential-1', currentUser.id]
  ]);
});

test('P1.1: baseline rebuild is unconditional -- never gated by CredentialType eligibility rules', async () => {
  // AutomaticProfileRebuildService itself never filters by CredentialType
  // -- eligibility rules live entirely in the two automatic analysis
  // services, never in the baseline step. This test documents that the
  // baseline call always happens, regardless of what the (independent,
  // best-effort) analysis services do afterward -- this is exactly what
  // closes the academic_subject-without-PDF gap found by the P1 audit.
  const context = createService();

  await context.service.issueForIssuer('issuer-1', 'credential-1', currentUser);

  assert.equal(context.profileBaselineRebuildCalls.length, 1);
});

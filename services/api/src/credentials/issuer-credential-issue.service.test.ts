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

function createService(options?: {
  scopedCredential?: { id: string } | null;
  authorizationError?: Error;
  issuanceError?: Error;
  automaticAnalysisError?: Error;
}) {
  const order: string[] = [];
  const authorizationCalls: unknown[] = [];
  const lookupCalls: unknown[] = [];
  const issueCalls: unknown[] = [];
  const readCalls: unknown[] = [];
  const automaticAnalysisCalls: string[] = [];
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
    } as never
  );

  return {
    service,
    order,
    authorizationCalls,
    lookupCalls,
    issueCalls,
    readCalls,
    automaticAnalysisCalls,
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
    'automatic_analysis',
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
  assert.deepEqual(context.automaticAnalysisCalls, ['credential-1']);
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
  assert.deepEqual(context.automaticAnalysisCalls, []);
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
  assert.deepEqual(context.automaticAnalysisCalls, []);
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
    'automatic_analysis',
    'safe_read'
  ]);
  assert.deepEqual(response, context.safeReadModel);
  assert.equal(JSON.stringify(response).includes('FastAPI'), false);
  assert.equal(JSON.stringify(response).includes('storageKey'), false);
  assert.equal(JSON.stringify(response).includes('private payload'), false);
});

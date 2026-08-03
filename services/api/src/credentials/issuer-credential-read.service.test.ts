import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ForbiddenException,
  NotFoundException
} from '@nestjs/common';
import {
  CredentialSourceType,
  CredentialStatus,
  CredentialType,
  Prisma,
  UserStatus
} from '@prisma/client';
import { issuerCredentialReadSelect } from './issuer-credential-read.mapper';

import { IssuerCredentialReadService } from './issuer-credential-read.service';

const currentUser = {
  id: 'issuer-user-1',
  email: 'issuer.admin@example.com',
  did: 'did:example:issuer-admin-demo',
  status: UserStatus.active
} as const;

function createCredentialRecord() {
  return {
    id: 'credential-1',
    status: CredentialStatus.draft,
    type: CredentialType.course,
    title: 'Arquitectura de Software',
    description: 'Descripcion del curso',
    hours: new Prisma.Decimal('24.50'),
    sourceType: CredentialSourceType.manual_issuer,
    credentialSubject: {
      achievement_name: 'Arquitectura de Software',
      institution_name: 'Demo University'
    },
    createdAt: new Date('2026-07-30T12:00:00.000Z'),
    updatedAt: new Date('2026-07-30T12:05:00.000Z'),
    issuer: {
      name: 'Demo University',
      did: 'did:example:issuer-demo'
    },
    subjectUser: {
      email: 'holder.demo@example.com',
      did: null,
      displayName: 'Demo Holder',
      firstName: null,
      lastName: null
    },
    academicCourse: null,
    documentEvidences: []
  };
}

function createService(options?: {
  credential?: ReturnType<typeof createCredentialRecord> | null;
  authorize?: (userId: string, issuerId: string) => Promise<unknown>;
}) {
  const operationOrder: string[] = [];
  const authorizationCalls: Array<Record<string, unknown>> = [];
  const credentialLookupCalls: Array<Record<string, unknown>> = [];
  const prisma = {
    credential: {
      async findFirst(args: Record<string, unknown>) {
        operationOrder.push('credential_lookup');
        credentialLookupCalls.push(args);
        return options?.credential === undefined
          ? createCredentialRecord()
          : options.credential;
      },
      async create() {
        throw new Error('read endpoint must not create credentials');
      },
      async update() {
        throw new Error('read endpoint must not update credentials');
      },
      async delete() {
        throw new Error('read endpoint must not delete credentials');
      }
    }
  };
  const issuersService = {
    async assertUserCanReadCredentialsForIssuer(
      userId: string,
      issuerId: string
    ) {
      operationOrder.push('issuer_authorization');
      authorizationCalls.push({ userId, issuerId });

      if (options?.authorize) {
        return options.authorize(userId, issuerId);
      }

      return {
        id: 'membership-1'
      };
    }
  };

  return {
    service: new IssuerCredentialReadService(
      prisma as never,
      issuersService as never
    ),
    operationOrder,
    authorizationCalls,
    credentialLookupCalls
  };
}

test('service authorizes before the issuer-scoped credential lookup', async () => {
  const {
    service,
    operationOrder,
    authorizationCalls,
    credentialLookupCalls
  } = createService();

  const response = await service.getCredentialForIssuer(
    'issuer-1',
    'credential-1',
    currentUser
  );

  assert.deepEqual(operationOrder, [
    'issuer_authorization',
    'credential_lookup'
  ]);
  assert.deepEqual(authorizationCalls, [
    {
      userId: 'issuer-user-1',
      issuerId: 'issuer-1'
    }
  ]);
  assert.deepEqual(credentialLookupCalls, [
    {
      where: {
        id: 'credential-1',
        issuerId: 'issuer-1'
      },
      select: issuerCredentialReadSelect
    }
  ]);
  assert.equal(response.id, 'credential-1');
});

test('service does not query holder or credential before institutional authorization', async () => {
  const { service, operationOrder, credentialLookupCalls } = createService({
    async authorize() {
      throw new ForbiddenException('forbidden');
    }
  });

  await assert.rejects(
    service.getCredentialForIssuer(
      'issuer-arbitrary',
      'credential-1',
      currentUser
    ),
    ForbiddenException
  );

  assert.deepEqual(operationOrder, ['issuer_authorization']);
  assert.deepEqual(credentialLookupCalls, []);
});

test('service returns the same safe 404 for missing and cross-issuer credentials', async () => {
  for (const credentialId of ['missing-credential', 'other-issuer-credential']) {
    const { service } = createService({
      credential: null
    });

    await assert.rejects(
      async () =>
        service.getCredentialForIssuer(
          'issuer-1',
          credentialId,
          currentUser
        ),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        assert.deepEqual(error.getResponse(), {
          statusCode: 404,
          message: 'No se encontro la credencial solicitada.',
          error: 'Not Found'
        });
        return true;
      }
    );
  }
});

test('service preserves historical read access when the selected holder record is inactive', async () => {
  const credential = {
    ...createCredentialRecord(),
    subjectUser: {
      ...createCredentialRecord().subjectUser,
      status: UserStatus.archived
    }
  };
  const { service } = createService({
    credential
  });

  const response = await service.getCredentialForIssuer(
    'issuer-1',
    'credential-1',
    currentUser
  );

  assert.equal(response.holder.displayLabel, 'Demo Holder');
  assert.equal('status' in response.holder, false);
});

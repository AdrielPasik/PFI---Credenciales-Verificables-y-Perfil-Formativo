import assert from 'node:assert/strict';
import test from 'node:test';

import { ForbiddenException } from '@nestjs/common';
import {
  IssuerAuthorizationStatus,
  IssuerMembershipRole,
  IssuerMembershipStatus
} from '@prisma/client';

import { IssuersService } from './issuers.service';

function createMembershipFixture(
  overrides?: Partial<{
    role: IssuerMembershipRole;
    status: IssuerMembershipStatus;
    authorizationStatus: IssuerAuthorizationStatus;
  }>
) {
  return {
    id: 'membership-1',
    userId: 'issuer-user-1',
    issuerId: 'issuer-1',
    role: overrides?.role ?? IssuerMembershipRole.admin,
    status: overrides?.status ?? IssuerMembershipStatus.active,
    issuer: {
      id: 'issuer-1',
      authorizationStatus:
        overrides?.authorizationStatus ?? IssuerAuthorizationStatus.authorized,
      did: null,
      walletAddress: null
    }
  };
}

function createService(
  membership: ReturnType<typeof createMembershipFixture> | null
) {
  const findUniqueCalls: Array<Record<string, unknown>> = [];
  const service = new IssuersService({
    issuerMembership: {
      async findUnique(args: Record<string, unknown>) {
        findUniqueCalls.push(args);
        return membership;
      }
    }
  } as never);

  return {
    service,
    findUniqueCalls
  };
}

test('IssuersService allows an active admin to create drafts without DID or wallet requirements', async () => {
  const membership = createMembershipFixture();
  const { service, findUniqueCalls } = createService(membership);

  const result = await service.assertUserCanCreateDraftForIssuer(
    'issuer-user-1',
    'issuer-1'
  );

  assert.equal(result, membership);
  assert.deepEqual(findUniqueCalls, [
    {
      where: {
        userId_issuerId: {
          userId: 'issuer-user-1',
          issuerId: 'issuer-1'
        }
      },
      include: {
        issuer: true
      }
    }
  ]);
});

test('IssuersService allows an active operator to create drafts', async () => {
  const membership = createMembershipFixture({
    role: IssuerMembershipRole.operator
  });
  const { service } = createService(membership);

  const result = await service.assertUserCanCreateDraftForIssuer(
    'issuer-user-1',
    'issuer-1'
  );

  assert.equal(result, membership);
});

test('IssuersService rejects draft creation without a membership for the requested issuer', async () => {
  const { service } = createService(null);

  await assert.rejects(
    service.assertUserCanCreateDraftForIssuer(
      'issuer-user-1',
      'issuer-arbitrary'
    ),
    ForbiddenException
  );
});

test('IssuersService rejects inactive memberships for draft creation', async () => {
  const { service } = createService(
    createMembershipFixture({
      status: IssuerMembershipStatus.revoked
    })
  );

  await assert.rejects(
    service.assertUserCanCreateDraftForIssuer('issuer-user-1', 'issuer-1'),
    ForbiddenException
  );
});

test('IssuersService rejects pending memberships for draft creation', async () => {
  const { service } = createService(
    createMembershipFixture({
      status: IssuerMembershipStatus.pending
    })
  );

  await assert.rejects(
    service.assertUserCanCreateDraftForIssuer('issuer-user-1', 'issuer-1'),
    ForbiddenException
  );
});

test('IssuersService rejects viewer memberships for draft creation', async () => {
  const { service } = createService(
    createMembershipFixture({
      role: IssuerMembershipRole.viewer
    })
  );

  await assert.rejects(
    service.assertUserCanCreateDraftForIssuer('issuer-user-1', 'issuer-1'),
    ForbiddenException
  );
});

test('IssuersService rejects pending issuers for draft creation', async () => {
  const { service } = createService(
    createMembershipFixture({
      authorizationStatus: IssuerAuthorizationStatus.pending
    })
  );

  await assert.rejects(
    service.assertUserCanCreateDraftForIssuer('issuer-user-1', 'issuer-1'),
    ForbiddenException
  );
});

test('IssuersService rejects revoked issuers for draft creation', async () => {
  const { service } = createService(
    createMembershipFixture({
      authorizationStatus: IssuerAuthorizationStatus.revoked
    })
  );

  await assert.rejects(
    service.assertUserCanCreateDraftForIssuer('issuer-user-1', 'issuer-1'),
    ForbiddenException
  );
});

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
      select: {
        id: true,
        userId: true,
        issuerId: true,
        role: true,
        status: true,
        issuer: {
          select: {
            authorizationStatus: true
          }
        }
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

test('IssuersService allows active admins and operators to resolve holders', async () => {
  for (const role of [
    IssuerMembershipRole.admin,
    IssuerMembershipRole.operator
  ]) {
    const membership = createMembershipFixture({ role });
    const { service } = createService(membership);

    const result = await service.assertUserCanResolveHolderForIssuer(
      'issuer-user-1',
      'issuer-1'
    );

    assert.equal(result, membership);
  }
});

test('IssuersService rejects holder resolution without a membership', async () => {
  const { service } = createService(null);

  await assert.rejects(
    service.assertUserCanResolveHolderForIssuer(
      'issuer-user-1',
      'issuer-arbitrary'
    ),
    ForbiddenException
  );
});

test('IssuersService rejects pending and revoked memberships for holder resolution', async () => {
  for (const status of [
    IssuerMembershipStatus.pending,
    IssuerMembershipStatus.revoked
  ]) {
    const { service } = createService(
      createMembershipFixture({
        status
      })
    );

    await assert.rejects(
      service.assertUserCanResolveHolderForIssuer(
        'issuer-user-1',
        'issuer-1'
      ),
      ForbiddenException
    );
  }
});

test('IssuersService rejects viewer memberships for holder resolution', async () => {
  const { service } = createService(
    createMembershipFixture({
      role: IssuerMembershipRole.viewer
    })
  );

  await assert.rejects(
    service.assertUserCanResolveHolderForIssuer(
      'issuer-user-1',
      'issuer-1'
    ),
    ForbiddenException
  );
});

test('IssuersService rejects pending and revoked issuers for holder resolution', async () => {
  for (const authorizationStatus of [
    IssuerAuthorizationStatus.pending,
    IssuerAuthorizationStatus.revoked
  ]) {
    const { service } = createService(
      createMembershipFixture({
        authorizationStatus
      })
    );

    await assert.rejects(
      service.assertUserCanResolveHolderForIssuer(
        'issuer-user-1',
        'issuer-1'
      ),
      ForbiddenException
    );
  }
});

test('IssuersService allows active admins and operators to read issuer credentials', async () => {
  for (const role of [
    IssuerMembershipRole.admin,
    IssuerMembershipRole.operator
  ]) {
    const membership = createMembershipFixture({ role });
    const { service } = createService(membership);

    const result = await service.assertUserCanReadCredentialsForIssuer(
      'issuer-user-1',
      'issuer-1'
    );

    assert.equal(result, membership);
  }
});

test('IssuersService rejects credential reads without membership or for an arbitrary issuer', async () => {
  const { service } = createService(null);

  await assert.rejects(
    service.assertUserCanReadCredentialsForIssuer(
      'issuer-user-1',
      'issuer-arbitrary'
    ),
    ForbiddenException
  );
});

test('IssuersService rejects pending and revoked memberships for credential reads', async () => {
  for (const status of [
    IssuerMembershipStatus.pending,
    IssuerMembershipStatus.revoked
  ]) {
    const { service } = createService(
      createMembershipFixture({
        status
      })
    );

    await assert.rejects(
      service.assertUserCanReadCredentialsForIssuer(
        'issuer-user-1',
        'issuer-1'
      ),
      ForbiddenException
    );
  }
});

test('IssuersService rejects viewer memberships for credential reads', async () => {
  const { service } = createService(
    createMembershipFixture({
      role: IssuerMembershipRole.viewer
    })
  );

  await assert.rejects(
    service.assertUserCanReadCredentialsForIssuer(
      'issuer-user-1',
      'issuer-1'
    ),
    ForbiddenException
  );
});

test('IssuersService rejects pending and revoked issuers for credential reads', async () => {
  for (const authorizationStatus of [
    IssuerAuthorizationStatus.pending,
    IssuerAuthorizationStatus.revoked
  ]) {
    const { service } = createService(
      createMembershipFixture({
        authorizationStatus
      })
    );

    await assert.rejects(
      service.assertUserCanReadCredentialsForIssuer(
        'issuer-user-1',
        'issuer-1'
      ),
      ForbiddenException
    );
  }
});

test('IssuersService allows active admins and operators to update issuer drafts', async () => {
  for (const role of [
    IssuerMembershipRole.admin,
    IssuerMembershipRole.operator
  ]) {
    const membership = createMembershipFixture({ role });
    const { service } = createService(membership);

    const result = await service.assertUserCanUpdateDraftForIssuer(
      'issuer-user-1',
      'issuer-1'
    );

    assert.equal(result, membership);
  }
});

test('IssuersService rejects draft updates without membership or for an arbitrary issuer', async () => {
  const { service } = createService(null);

  await assert.rejects(
    service.assertUserCanUpdateDraftForIssuer(
      'issuer-user-1',
      'issuer-arbitrary'
    ),
    ForbiddenException
  );
});

test('IssuersService rejects pending and revoked memberships for draft updates', async () => {
  for (const status of [
    IssuerMembershipStatus.pending,
    IssuerMembershipStatus.revoked
  ]) {
    const { service } = createService(
      createMembershipFixture({ status })
    );

    await assert.rejects(
      service.assertUserCanUpdateDraftForIssuer(
        'issuer-user-1',
        'issuer-1'
      ),
      ForbiddenException
    );
  }
});

test('IssuersService rejects viewers for draft updates', async () => {
  const { service } = createService(
    createMembershipFixture({ role: IssuerMembershipRole.viewer })
  );

  await assert.rejects(
    service.assertUserCanUpdateDraftForIssuer('issuer-user-1', 'issuer-1'),
    ForbiddenException
  );
});

test('IssuersService rejects pending and revoked issuers for draft updates', async () => {
  for (const authorizationStatus of [
    IssuerAuthorizationStatus.pending,
    IssuerAuthorizationStatus.revoked
  ]) {
    const { service } = createService(
      createMembershipFixture({ authorizationStatus })
    );

    await assert.rejects(
      service.assertUserCanUpdateDraftForIssuer(
        'issuer-user-1',
        'issuer-1'
      ),
      ForbiddenException
    );
  }
});

test('IssuersService applies the shared institutional rules to academic catalog searches', async () => {
  for (const role of [
    IssuerMembershipRole.admin,
    IssuerMembershipRole.operator
  ]) {
    const membership = createMembershipFixture({ role });
    const { service } = createService(membership);

    assert.equal(
      await service.assertUserCanSearchAcademicCatalogForIssuer(
        'issuer-user-1',
        'issuer-1'
      ),
      membership
    );
  }

  const forbiddenMemberships = [
    null,
    createMembershipFixture({ role: IssuerMembershipRole.viewer }),
    createMembershipFixture({ status: IssuerMembershipStatus.pending }),
    createMembershipFixture({ status: IssuerMembershipStatus.revoked }),
    createMembershipFixture({
      authorizationStatus: IssuerAuthorizationStatus.pending
    }),
    createMembershipFixture({
      authorizationStatus: IssuerAuthorizationStatus.revoked
    })
  ];

  for (const membership of forbiddenMemberships) {
    const { service } = createService(membership);

    await assert.rejects(
      service.assertUserCanSearchAcademicCatalogForIssuer(
        'issuer-user-1',
        'issuer-arbitrary'
      ),
      ForbiddenException
    );
  }
});

test('IssuersService applies shared institutional rules to document evidence uploads', async () => {
  for (const role of [
    IssuerMembershipRole.admin,
    IssuerMembershipRole.operator
  ]) {
    const membership = createMembershipFixture({ role });
    const { service } = createService(membership);

    assert.equal(
      await service.assertUserCanAttachDocumentEvidenceForIssuer(
        'issuer-user-1',
        'issuer-1'
      ),
      membership
    );
  }

  const forbiddenMemberships = [
    null,
    createMembershipFixture({ role: IssuerMembershipRole.viewer }),
    createMembershipFixture({ status: IssuerMembershipStatus.pending }),
    createMembershipFixture({ status: IssuerMembershipStatus.revoked }),
    createMembershipFixture({
      authorizationStatus: IssuerAuthorizationStatus.pending
    }),
    createMembershipFixture({
      authorizationStatus: IssuerAuthorizationStatus.revoked
    })
  ];

  for (const membership of forbiddenMemberships) {
    const { service } = createService(membership);

    await assert.rejects(
      service.assertUserCanAttachDocumentEvidenceForIssuer(
        'issuer-user-1',
        'issuer-arbitrary'
      ),
      ForbiddenException
    );
  }
});

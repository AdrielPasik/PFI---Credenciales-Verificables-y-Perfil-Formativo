import assert from 'node:assert/strict';
import test from 'node:test';

import { UnauthorizedException } from '@nestjs/common';
import {
  IssuerAuthorizationStatus,
  IssuerMembershipRole,
  IssuerMembershipStatus,
  UserStatus
} from '@prisma/client';

import { AuthService } from './auth.service';
import { hashPassword } from './password-hashing';

function createJwtServiceStub() {
  return {
    signAsyncCalls: [] as Array<Record<string, unknown>>,
    async signAsync(payload: Record<string, unknown>, options: Record<string, unknown>) {
      this.signAsyncCalls.push({ payload, options });
      return 'signed-token';
    },
    async verifyAsync() {
      return {
        sub: 'user-123'
      };
    }
  };
}

test('AuthService.login succeeds with valid credentials and does not expose passwordHash', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  process.env.JWT_EXPIRES_IN = '2h';

  const jwtService = createJwtServiceStub();
  const prisma = {
    user: {
      async findUnique() {
        return {
          id: 'user-123',
          email: 'issuer.admin@example.com',
          did: 'did:example:issuer-admin-demo',
          status: UserStatus.active,
          authCredential: {
            passwordHash: await hashPassword('DemoIssuer123!')
          }
        };
      }
    }
  };

  const service = new AuthService(prisma as never, jwtService as never);
  const response = await service.login({
    email: 'issuer.admin@example.com',
    password: 'DemoIssuer123!'
  });

  assert.equal(response.accessToken, 'signed-token');
  assert.deepEqual(response.user, {
    id: 'user-123',
    email: 'issuer.admin@example.com',
    did: 'did:example:issuer-admin-demo',
    status: UserStatus.active
  });
  assert.equal('passwordHash' in response.user, false);
  assert.deepEqual(jwtService.signAsyncCalls, [
    {
      payload: {
        sub: 'user-123'
      },
      options: {
        secret: 'demo-secret',
        expiresIn: '2h'
      }
    }
  ]);
});

test('AuthService.login fails when email does not exist', async () => {
  process.env.JWT_SECRET = 'demo-secret';

  const service = new AuthService(
    {
      user: {
        async findUnique() {
          return null;
        }
      }
    } as never,
    createJwtServiceStub() as never
  );

  await assert.rejects(
    service.login({
      email: 'missing@example.com',
      password: 'DemoIssuer123!'
    }),
    UnauthorizedException
  );
});

test('AuthService.login fails when password is incorrect', async () => {
  process.env.JWT_SECRET = 'demo-secret';

  const service = new AuthService(
    {
      user: {
        async findUnique() {
          return {
            id: 'user-123',
            email: 'issuer.admin@example.com',
            did: 'did:example:issuer-admin-demo',
            status: UserStatus.active,
            authCredential: {
              passwordHash: await hashPassword('DemoIssuer123!')
            }
          };
        }
      }
    } as never,
    createJwtServiceStub() as never
  );

  await assert.rejects(
    service.login({
      email: 'issuer.admin@example.com',
      password: 'WrongPassword123!'
    }),
    UnauthorizedException
  );
});

test('AuthService.login fails when user is not active', async () => {
  process.env.JWT_SECRET = 'demo-secret';

  const service = new AuthService(
    {
      user: {
        async findUnique() {
          return {
            id: 'user-123',
            email: 'issuer.admin@example.com',
            did: 'did:example:issuer-admin-demo',
            status: UserStatus.suspended,
            authCredential: {
              passwordHash: await hashPassword('DemoIssuer123!')
            }
          };
        }
      }
    } as never,
    createJwtServiceStub() as never
  );

  await assert.rejects(
    service.login({
      email: 'issuer.admin@example.com',
      password: 'DemoIssuer123!'
    }),
    UnauthorizedException
  );
});

test('AuthService.resolveAuthenticatedUser accepts a valid JWT and loads current user from DB', async () => {
  process.env.JWT_SECRET = 'demo-secret';

  const service = new AuthService(
    {
      user: {
        async findUnique() {
          return {
            id: 'user-123',
            email: 'holder.demo@example.com',
            did: 'did:example:holder-demo',
            status: UserStatus.active
          };
        }
      }
    } as never,
    createJwtServiceStub() as never
  );

  const user = await service.resolveAuthenticatedUser('valid-token');

  assert.deepEqual(user, {
    id: 'user-123',
    email: 'holder.demo@example.com',
    did: 'did:example:holder-demo',
    status: UserStatus.active
  });
});

test('AuthService.resolveAuthenticatedUser rejects a valid token when the user no longer exists', async () => {
  process.env.JWT_SECRET = 'demo-secret';

  const service = new AuthService(
    {
      user: {
        async findUnique() {
          return null;
        }
      }
    } as never,
    createJwtServiceStub() as never
  );

  await assert.rejects(
    service.resolveAuthenticatedUser('valid-token'),
    UnauthorizedException
  );
});

test('AuthService.resolveAuthenticatedUser rejects an inactive authenticated user', async () => {
  process.env.JWT_SECRET = 'demo-secret';

  const service = new AuthService(
    {
      user: {
        async findUnique() {
          return {
            id: 'user-123',
            email: 'issuer.admin@example.com',
            did: 'did:example:issuer-admin-demo',
            status: UserStatus.suspended
          };
        }
      }
    } as never,
    createJwtServiceStub() as never
  );

  await assert.rejects(
    service.resolveAuthenticatedUser('valid-token'),
    UnauthorizedException
  );
});

test('AuthService.getCurrentUserProfile returns only active issuer memberships', async () => {
  process.env.JWT_SECRET = 'demo-secret';

  const findUniqueCalls: Array<Record<string, unknown>> = [];
  const service = new AuthService(
    {
      user: {
        async findUnique(args: Record<string, unknown>) {
          findUniqueCalls.push(args);
          return {
            id: 'user-123',
            email: 'issuer.admin@example.com',
            did: 'did:example:issuer-admin-demo',
            status: UserStatus.active,
            issuerMemberships: [
              {
                issuerId: 'issuer-1',
                role: IssuerMembershipRole.admin,
                status: IssuerMembershipStatus.active,
                issuer: {
                  name: 'Universidad Argentina de la Empresa (UADE)',
                  did: 'did:example:issuer-demo',
                  authorizationStatus: IssuerAuthorizationStatus.authorized
                }
              }
            ]
          };
        }
      }
    } as never,
    createJwtServiceStub() as never
  );

  const response = await service.getCurrentUserProfile('user-123');

  assert.deepEqual(response, {
    id: 'user-123',
    email: 'issuer.admin@example.com',
    did: 'did:example:issuer-admin-demo',
    status: UserStatus.active,
    issuerMemberships: [
      {
        issuerId: 'issuer-1',
        issuerName: 'Universidad Argentina de la Empresa (UADE)',
        issuerDid: 'did:example:issuer-demo',
        issuerAuthorizationStatus: IssuerAuthorizationStatus.authorized,
        role: IssuerMembershipRole.admin,
        status: IssuerMembershipStatus.active
      }
    ]
  });
  assert.equal('passwordHash' in response, false);
  assert.deepEqual(Object.keys(response.issuerMemberships[0]).sort(), [
    'issuerAuthorizationStatus',
    'issuerDid',
    'issuerId',
    'issuerName',
    'role',
    'status'
  ]);
  assert.deepEqual(findUniqueCalls, [
    {
      where: {
        id: 'user-123'
      },
      select: {
        id: true,
        email: true,
        did: true,
        status: true,
        issuerMemberships: {
          where: {
            status: IssuerMembershipStatus.active
          },
          select: {
            issuerId: true,
            role: true,
            status: true,
            issuer: {
              select: {
                name: true,
                did: true,
                authorizationStatus: true
              }
            }
          }
        }
      }
    }
  ]);
});

test('AuthService.getCurrentUserProfile preserves issuer status and orders active memberships deterministically', async () => {
  process.env.JWT_SECRET = 'demo-secret';

  const service = new AuthService(
    {
      user: {
        async findUnique() {
          return {
            id: 'user-123',
            email: 'issuer.admin@example.com',
            did: 'did:example:issuer-admin-demo',
            status: UserStatus.active,
            issuerMemberships: [
              {
                issuerId: 'issuer-z',
                role: IssuerMembershipRole.operator,
                status: IssuerMembershipStatus.active,
                issuer: {
                  name: 'Same Institution',
                  did: null,
                  authorizationStatus: IssuerAuthorizationStatus.pending
                }
              },
              {
                issuerId: 'issuer-a',
                role: IssuerMembershipRole.operator,
                status: IssuerMembershipStatus.active,
                issuer: {
                  name: 'Same Institution',
                  did: 'did:example:revoked',
                  authorizationStatus: IssuerAuthorizationStatus.revoked
                }
              },
              {
                issuerId: 'issuer-authorized',
                role: IssuerMembershipRole.admin,
                status: IssuerMembershipStatus.active,
                issuer: {
                  name: 'Alpha University',
                  did: 'did:example:alpha',
                  authorizationStatus: IssuerAuthorizationStatus.authorized
                }
              }
            ]
          };
        }
      }
    } as never,
    createJwtServiceStub() as never
  );

  const response = await service.getCurrentUserProfile('user-123');

  assert.deepEqual(response.issuerMemberships, [
    {
      issuerId: 'issuer-authorized',
      issuerName: 'Alpha University',
      issuerDid: 'did:example:alpha',
      issuerAuthorizationStatus: IssuerAuthorizationStatus.authorized,
      role: IssuerMembershipRole.admin,
      status: IssuerMembershipStatus.active
    },
    {
      issuerId: 'issuer-a',
      issuerName: 'Same Institution',
      issuerDid: 'did:example:revoked',
      issuerAuthorizationStatus: IssuerAuthorizationStatus.revoked,
      role: IssuerMembershipRole.operator,
      status: IssuerMembershipStatus.active
    },
    {
      issuerId: 'issuer-z',
      issuerName: 'Same Institution',
      issuerDid: null,
      issuerAuthorizationStatus: IssuerAuthorizationStatus.pending,
      role: IssuerMembershipRole.operator,
      status: IssuerMembershipStatus.active
    }
  ]);
});

test('AuthService.getCurrentUserProfile returns an empty membership list when none are active', async () => {
  process.env.JWT_SECRET = 'demo-secret';

  const service = new AuthService(
    {
      user: {
        async findUnique(args: {
          select: {
            issuerMemberships: {
              where: {
                status: IssuerMembershipStatus;
              };
            };
          };
        }) {
          assert.equal(
            args.select.issuerMemberships.where.status,
            IssuerMembershipStatus.active
          );

          return {
            id: 'holder-123',
            email: 'holder.demo@example.com',
            did: 'did:example:holder-demo',
            status: UserStatus.active,
            issuerMemberships: []
          };
        }
      }
    } as never,
    createJwtServiceStub() as never
  );

  const response = await service.getCurrentUserProfile('holder-123');

  assert.deepEqual(response.issuerMemberships, []);
});

test('AuthService.getCurrentUserProfile excludes pending and revoked memberships', async () => {
  process.env.JWT_SECRET = 'demo-secret';

  const memberships = [
    {
      issuerId: 'issuer-active',
      role: IssuerMembershipRole.admin,
      status: IssuerMembershipStatus.active,
      issuer: {
        name: 'Active Institution',
        did: 'did:example:active',
        authorizationStatus: IssuerAuthorizationStatus.authorized
      }
    },
    {
      issuerId: 'issuer-pending-membership',
      role: IssuerMembershipRole.operator,
      status: IssuerMembershipStatus.pending,
      issuer: {
        name: 'Pending Membership Institution',
        did: null,
        authorizationStatus: IssuerAuthorizationStatus.authorized
      }
    },
    {
      issuerId: 'issuer-revoked-membership',
      role: IssuerMembershipRole.operator,
      status: IssuerMembershipStatus.revoked,
      issuer: {
        name: 'Revoked Membership Institution',
        did: null,
        authorizationStatus: IssuerAuthorizationStatus.authorized
      }
    }
  ];

  const service = new AuthService(
    {
      user: {
        async findUnique(args: {
          select: {
            issuerMemberships: {
              where: {
                status: IssuerMembershipStatus;
              };
            };
          };
        }) {
          const requiredStatus = args.select.issuerMemberships.where.status;

          return {
            id: 'user-123',
            email: 'issuer.admin@example.com',
            did: 'did:example:issuer-admin-demo',
            status: UserStatus.active,
            issuerMemberships: memberships.filter(
              (membership) => membership.status === requiredStatus
            )
          };
        }
      }
    } as never,
    createJwtServiceStub() as never
  );

  const response = await service.getCurrentUserProfile('user-123');

  assert.deepEqual(response.issuerMemberships, [
    {
      issuerId: 'issuer-active',
      issuerName: 'Active Institution',
      issuerDid: 'did:example:active',
      issuerAuthorizationStatus: IssuerAuthorizationStatus.authorized,
      role: IssuerMembershipRole.admin,
      status: IssuerMembershipStatus.active
    }
  ]);
});

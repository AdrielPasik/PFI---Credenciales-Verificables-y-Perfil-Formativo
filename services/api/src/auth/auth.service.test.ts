import assert from 'node:assert/strict';
import test from 'node:test';

import { UnauthorizedException } from '@nestjs/common';
import {
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
                status: IssuerMembershipStatus.active
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
        role: IssuerMembershipRole.admin,
        status: IssuerMembershipStatus.active
      }
    ]
  });
  assert.equal('passwordHash' in response, false);
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
            status: 'active'
          },
          select: {
            issuerId: true,
            role: true,
            status: true
          }
        }
      }
    }
  ]);
});

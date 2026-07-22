import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InternalServerErrorException,
  UnauthorizedException
} from '@nestjs/common';
import { UserStatus } from '@prisma/client';

import { AuthGuard } from './auth.guard';

function createExecutionContext(request: Record<string, unknown>) {
  return {
    switchToHttp() {
      return {
        getRequest() {
          return request;
        }
      };
    }
  };
}

test('AuthGuard accepts a valid bearer token and attaches current user', async () => {
  const request: {
    headers: {
      authorization: string;
    };
    user?: unknown;
  } = {
    headers: {
      authorization: 'Bearer valid-token'
    }
  };

  const guard = new AuthGuard({
    async resolveAuthenticatedUser(token: string) {
      assert.equal(token, 'valid-token');
      return {
        id: 'user-123',
        email: 'holder.demo@example.com',
        did: 'did:example:holder-demo',
        status: UserStatus.active
      };
    }
  } as never);

  const canActivate = await guard.canActivate(
    createExecutionContext(request) as never
  );

  assert.equal(canActivate, true);
  assert.deepEqual(request.user, {
    id: 'user-123',
    email: 'holder.demo@example.com',
    did: 'did:example:holder-demo',
    status: UserStatus.active
  });
});

test('AuthGuard rejects requests without bearer token', async () => {
  const guard = new AuthGuard({
    async resolveAuthenticatedUser() {
      throw new Error('should not be called');
    }
  } as never);

  await assert.rejects(
    guard.canActivate(
      createExecutionContext({
        headers: {}
      }) as never
    ),
    UnauthorizedException
  );
});

test('AuthGuard propagates invalid or expired token errors', async () => {
  const guard = new AuthGuard({
    async resolveAuthenticatedUser() {
      throw new UnauthorizedException('Token invalido o expirado.');
    }
  } as never);

  await assert.rejects(
    guard.canActivate(
      createExecutionContext({
        headers: {
          authorization: 'Bearer invalid-token'
        }
      }) as never
    ),
    UnauthorizedException
  );
});

test('AuthGuard propagates missing JWT secret errors clearly', async () => {
  const guard = new AuthGuard({
    async resolveAuthenticatedUser() {
      throw new InternalServerErrorException('JWT_SECRET no esta configurado.');
    }
  } as never);

  await assert.rejects(
    guard.canActivate(
      createExecutionContext({
        headers: {
          authorization: 'Bearer valid-token'
        }
      }) as never
    ),
    InternalServerErrorException
  );
});

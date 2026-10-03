/**
 * PlatformAdminGuard -- slice S1.
 *
 * Mismo estilo que `auth/auth.guard.test.ts`: un `ExecutionContext` falso a
 * mano y un doble de Prisma, sin contenedor de Nest.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';

import { PlatformAdminGuard } from './platform-admin.guard';

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

const AUTHENTICATED_USER = {
  id: 'user-123',
  email: 'persona@example.com',
  did: null,
  status: UserStatus.active
};

/**
 * Doble de `PrismaService` que registra cada `where` recibido.
 *
 * `grantedUserIds` es un Set y no un booleano a proposito: asi un test puede
 * comprobar que el lookup se hace por el id del usuario AUTENTICADO y no por
 * otro valor que viniera del request.
 */
function createPrismaDouble(grantedUserIds: string[]) {
  const lookups: unknown[] = [];
  const granted = new Set(grantedUserIds);

  return {
    lookups,
    granted,
    prisma: {
      platformAdmin: {
        async findUnique(args: { where: { userId: string } }) {
          lookups.push(args);
          return granted.has(args.where.userId)
            ? { id: `platform-admin-${args.where.userId}` }
            : null;
        }
      }
    }
  };
}

test('PlatformAdminGuard rejects with 401 when request.user is absent', async () => {
  // Pasa si alguien montara el guard SIN AuthGuard por delante. Fail-closed:
  // 401, nunca 500 y nunca true. Y nunca consulta la base.
  const { prisma, lookups } = createPrismaDouble([]);
  const guard = new PlatformAdminGuard(prisma as never);

  await assert.rejects(
    guard.canActivate(createExecutionContext({ headers: {} }) as never),
    UnauthorizedException
  );

  assert.deepEqual(lookups, [], 'no debe consultar la base sin identidad');
});

test('PlatformAdminGuard rejects with 401 when request.user has no id', async () => {
  const { prisma, lookups } = createPrismaDouble([]);
  const guard = new PlatformAdminGuard(prisma as never);

  await assert.rejects(
    guard.canActivate(
      createExecutionContext({ headers: {}, user: {} }) as never
    ),
    UnauthorizedException
  );

  assert.deepEqual(lookups, []);
});

test('PlatformAdminGuard rejects with 403 an authenticated User without a PlatformAdmin row', async () => {
  const { prisma } = createPrismaDouble([]);
  const guard = new PlatformAdminGuard(prisma as never);

  await assert.rejects(
    guard.canActivate(
      createExecutionContext({
        headers: { authorization: 'Bearer valid-token' },
        user: AUTHENTICATED_USER
      }) as never
    ),
    ForbiddenException
  );
});

test('PlatformAdminGuard allows an authenticated User with a PlatformAdmin row', async () => {
  const { prisma } = createPrismaDouble([AUTHENTICATED_USER.id]);
  const guard = new PlatformAdminGuard(prisma as never);

  const canActivate = await guard.canActivate(
    createExecutionContext({
      headers: { authorization: 'Bearer valid-token' },
      user: AUTHENTICATED_USER
    }) as never
  );

  assert.equal(canActivate, true);
});

test('PlatformAdminGuard looks the grant up ONLY by the authenticated user id', async () => {
  // El request trae, a proposito, varios campos hostiles que un cliente podria
  // mandar para que la autorizacion se resuelva en nombre de otro. Ninguno
  // debe llegar al `where`.
  const { prisma, lookups } = createPrismaDouble([AUTHENTICATED_USER.id]);
  const guard = new PlatformAdminGuard(prisma as never);

  await guard.canActivate(
    createExecutionContext({
      headers: { authorization: 'Bearer valid-token' },
      user: AUTHENTICATED_USER,
      params: { userId: 'otro-user', platformAdminUserId: 'otro-user' },
      query: { userId: 'otro-user', actorUserId: 'otro-user' },
      body: {
        userId: 'otro-user',
        platformAdminUserId: 'otro-user',
        actorUserId: 'otro-user',
        creatorUserId: 'otro-user'
      }
    }) as never
  );

  assert.equal(lookups.length, 1);
  assert.deepEqual(lookups[0], {
    where: { userId: AUTHENTICATED_USER.id },
    select: { id: true }
  });
});

test('PlatformAdminGuard resolves the grant against the database on EVERY invocation', async () => {
  // Sin cache y sin claims en el token: revocar la fila corta el acceso de
  // inmediato, con el MISMO request/token que un momento antes pasaba.
  const { prisma, granted, lookups } = createPrismaDouble([
    AUTHENTICATED_USER.id
  ]);
  const guard = new PlatformAdminGuard(prisma as never);
  const request = {
    headers: { authorization: 'Bearer valid-token' },
    user: AUTHENTICATED_USER
  };

  assert.equal(
    await guard.canActivate(createExecutionContext(request) as never),
    true
  );

  granted.delete(AUTHENTICATED_USER.id);

  await assert.rejects(
    guard.canActivate(createExecutionContext(request) as never),
    ForbiddenException
  );

  assert.equal(lookups.length, 2, 'una consulta por invocacion, nunca cacheada');
});

test('PlatformAdminGuard does not mutate the request', async () => {
  // A diferencia de AuthGuard, que setea request.user, este guard solo
  // autoriza: no agrega ningun campo que otra capa pudiera empezar a leer.
  const { prisma } = createPrismaDouble([AUTHENTICATED_USER.id]);
  const guard = new PlatformAdminGuard(prisma as never);
  const request: Record<string, unknown> = {
    headers: { authorization: 'Bearer valid-token' },
    user: AUTHENTICATED_USER
  };

  await guard.canActivate(createExecutionContext(request) as never);

  assert.deepEqual(Object.keys(request).sort(), ['headers', 'user']);
  assert.equal(request.user, AUTHENTICATED_USER);
});

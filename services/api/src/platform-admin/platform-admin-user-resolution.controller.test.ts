/**
 * Superficie POST /admin/users/resolve -- slice S4.
 *
 * Metadata de Nest (ruta, metodo, codigo, guards y su ORDEN) mas la cadena de
 * guards REAL ejecutada a mano, para probar 401 / 403 / 200 sin levantar HTTP.
 * Mismo patron que `platform-admin-issuers.controller.test.ts`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BadRequestException,
  ForbiddenException,
  RequestMethod,
  UnauthorizedException
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA
} from '@nestjs/common/constants';
import { UserStatus } from '@prisma/client';

import { AuthGuard } from '../auth/auth.guard';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformAdminUserResolutionController } from './platform-admin-user-resolution.controller';

// ---------------------------------------------------------------------------
// 1-3. Metadata
// ---------------------------------------------------------------------------

test('1: la ruta es POST admin/users/resolve y responde 200, no 201', () => {
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, PlatformAdminUserResolutionController),
    'admin/users'
  );
  assert.equal(
    Reflect.getMetadata(
      PATH_METADATA,
      PlatformAdminUserResolutionController.prototype.resolveUser
    ),
    'resolve'
  );
  assert.equal(
    Reflect.getMetadata(
      METHOD_METADATA,
      PlatformAdminUserResolutionController.prototype.resolveUser
    ),
    RequestMethod.POST
  );
  // 201 mentiria: no se crea nada.
  assert.equal(
    Reflect.getMetadata(
      HTTP_CODE_METADATA,
      PlatformAdminUserResolutionController.prototype.resolveUser
    ),
    200
  );
});

test('2-3: exige AuthGuard y PlatformAdminGuard, EN ESE ORDEN', () => {
  assert.deepEqual(
    Reflect.getMetadata(
      GUARDS_METADATA,
      PlatformAdminUserResolutionController
    ),
    [AuthGuard, PlatformAdminGuard]
  );
});

test('el controller expone un unico metodo, y no es mutante de dominio', () => {
  const methods = Object.getOwnPropertyNames(
    PlatformAdminUserResolutionController.prototype
  ).filter((name) => name !== 'constructor');

  assert.deepEqual(methods, ['resolveUser']);
});

// ---------------------------------------------------------------------------
// 10-12. Validacion antes del service, y delegacion minima
// ---------------------------------------------------------------------------

test('10: el body se valida ANTES de llegar al service', async () => {
  const calls: unknown[] = [];
  const controller = new PlatformAdminUserResolutionController({
    async resolveUserByEmail(...args: unknown[]) {
      calls.push(args);
      return { email: 'x@y.co', displayLabel: 'X' };
    }
  } as never);

  await assert.rejects(
    controller.resolveUser({ email: 'sin-arroba' }),
    BadRequestException
  );
  await assert.rejects(controller.resolveUser(null), BadRequestException);
  await assert.rejects(controller.resolveUser({}), BadRequestException);

  assert.deepEqual(calls, [], 'el service no se invoca con un body invalido');
});

test('11-12: delega UNICAMENTE el email normalizado, nunca el body ni un actorId', async () => {
  const calls: unknown[] = [];
  const expected = { email: 'persona@dominio.com', displayLabel: 'Ada Lovelace' };
  const controller = new PlatformAdminUserResolutionController({
    async resolveUserByEmail(...args: unknown[]) {
      calls.push(args);
      return expected;
    }
  } as never);

  const response = await controller.resolveUser({
    email: '  Persona@Dominio.com  '
  });

  assert.equal(response, expected);
  // Un solo argumento, y es el string normalizado.
  assert.deepEqual(calls, [['persona@dominio.com']]);
});

test('11b: un body con claves de autoridad falla; nada llega al service', async () => {
  const calls: unknown[] = [];
  const controller = new PlatformAdminUserResolutionController({
    async resolveUserByEmail(...args: unknown[]) {
      calls.push(args);
      return { email: 'x@y.co', displayLabel: 'X' };
    }
  } as never);

  for (const hostil of [
    { email: 'persona@dominio.com', userId: 'otro-user' },
    { email: 'persona@dominio.com', platformAdminUserId: 'otro-user' },
    { email: 'persona@dominio.com', actorUserId: 'otro-user' },
    { email: 'persona@dominio.com', isPlatformAdmin: true },
    { email: 'persona@dominio.com', issuerId: 'issuer-1' }
  ]) {
    await assert.rejects(
      controller.resolveUser(hostil),
      BadRequestException,
      `deberia rechazar ${JSON.stringify(hostil)}`
    );
  }

  assert.deepEqual(calls, []);
});

// ---------------------------------------------------------------------------
// 4-9. Cadena de guards real
// ---------------------------------------------------------------------------

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

const PLATFORM_ADMIN_USER = {
  id: 'user-platform-admin',
  email: 'adriel@example.com',
  did: null,
  status: UserStatus.active
};

const NORMAL_USER = {
  id: 'user-normal',
  email: 'persona@example.com',
  did: null,
  status: UserStatus.active
};

async function runGuardChain(options: {
  authorization?: string;
  resolvedUser?: typeof PLATFORM_ADMIN_USER | null;
  grantedUserIds: string[];
}) {
  const request: Record<string, unknown> = {
    headers: options.authorization
      ? { authorization: options.authorization }
      : {},
    // Body hostil presente a proposito: los guards NUNCA deben leerlo.
    body: {
      email: 'persona@dominio.com',
      userId: 'otro-user',
      platformAdminUserId: 'otro-user'
    }
  };

  const authGuard = new AuthGuard({
    async resolveAuthenticatedUser(token: string) {
      if (!options.resolvedUser) {
        throw new UnauthorizedException('Token invalido o expirado.');
      }
      assert.ok(token.length > 0);
      return options.resolvedUser;
    }
  } as never);

  const platformAdminGuard = new PlatformAdminGuard({
    platformAdmin: {
      async findUnique({ where }: { where: { userId: string } }) {
        // Si el guard leyera el body, resolveria por 'otro-user' y este assert
        // lo delataria.
        assert.notEqual(where.userId, 'otro-user');
        return options.grantedUserIds.includes(where.userId)
          ? { id: `grant-${where.userId}` }
          : null;
      }
    }
  } as never);

  const context = createExecutionContext(request) as never;

  await authGuard.canActivate(context);
  await platformAdminGuard.canActivate(context);

  return request;
}

test('4: sin Authorization -> 401, y PlatformAdmin ni se consulta', async () => {
  await assert.rejects(
    runGuardChain({ grantedUserIds: [PLATFORM_ADMIN_USER.id] }),
    UnauthorizedException
  );
});

test('5: token invalido o expirado -> 401', async () => {
  await assert.rejects(
    runGuardChain({
      authorization: 'Bearer token-vencido',
      resolvedUser: null,
      grantedUserIds: [PLATFORM_ADMIN_USER.id]
    }),
    UnauthorizedException
  );
});

test('6: User normal autenticado -> 403', async () => {
  await assert.rejects(
    runGuardChain({
      authorization: 'Bearer token-valido',
      resolvedUser: NORMAL_USER,
      grantedUserIds: [PLATFORM_ADMIN_USER.id]
    }),
    ForbiddenException
  );
});

test('7: admin institucional SIN PlatformAdmin -> 403', async () => {
  // Un IssuerMembership(role=admin) no otorga capacidad de plataforma.
  await assert.rejects(
    runGuardChain({
      authorization: 'Bearer token-valido',
      resolvedUser: { ...NORMAL_USER, id: 'user-issuer-admin' },
      grantedUserIds: [PLATFORM_ADMIN_USER.id]
    }),
    ForbiddenException
  );
});

test('8-9: un PlatformAdmin SIN IssuerMembership pasa la cadena y resuelve', async () => {
  const request = await runGuardChain({
    authorization: 'Bearer token-valido',
    resolvedUser: PLATFORM_ADMIN_USER,
    grantedUserIds: [PLATFORM_ADMIN_USER.id]
  });

  assert.deepEqual(request.user, PLATFORM_ADMIN_USER);

  // No se consulto ninguna membership en toda la autorizacion: el doble del
  // guard solo conoce la tabla PlatformAdmin.
  const controller = new PlatformAdminUserResolutionController({
    async resolveUserByEmail(email: string) {
      assert.equal(email, 'persona@dominio.com');
      return { email, displayLabel: 'Ada Lovelace' };
    }
  } as never);

  const response = await controller.resolveUser({
    email: 'persona@dominio.com'
  });

  assert.deepEqual(response, {
    email: 'persona@dominio.com',
    displayLabel: 'Ada Lovelace'
  });
});

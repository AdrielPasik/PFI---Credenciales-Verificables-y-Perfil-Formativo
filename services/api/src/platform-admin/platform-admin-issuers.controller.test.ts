/**
 * Superficie /admin/issuers -- slice S3.
 *
 * Dos niveles de comprobacion:
 *   - metadata de Nest (rutas, metodos, guards y su ORDEN), con el mismo patron
 *     que `issuer-credential-issue.controller.test.ts`;
 *   - la cadena de guards REAL ejecutada a mano, para probar 401 / 403 / 200 sin
 *     levantar un servidor HTTP.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ForbiddenException, RequestMethod, UnauthorizedException } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA
} from '@nestjs/common/constants';
import { UserStatus } from '@prisma/client';

import { AuthGuard } from '../auth/auth.guard';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformAdminIssuersController } from './platform-admin-issuers.controller';

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

test('las rutas administrativas son GET bajo admin/issuers', () => {
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, PlatformAdminIssuersController),
    'admin/issuers'
  );

  assert.equal(
    Reflect.getMetadata(
      PATH_METADATA,
      PlatformAdminIssuersController.prototype.listIssuers
    ),
    '/'
  );
  assert.equal(
    Reflect.getMetadata(
      METHOD_METADATA,
      PlatformAdminIssuersController.prototype.listIssuers
    ),
    RequestMethod.GET
  );

  assert.equal(
    Reflect.getMetadata(
      PATH_METADATA,
      PlatformAdminIssuersController.prototype.listIssuerMemberships
    ),
    ':issuerId/memberships'
  );
  assert.equal(
    Reflect.getMetadata(
      METHOD_METADATA,
      PlatformAdminIssuersController.prototype.listIssuerMemberships
    ),
    RequestMethod.GET
  );
});

test('el controller exige AuthGuard y PlatformAdminGuard, EN ESE ORDEN', () => {
  // El orden importa: un request sin token valido tiene que resolver 401 antes
  // de llegar al 403 de plataforma.
  assert.deepEqual(
    Reflect.getMetadata(GUARDS_METADATA, PlatformAdminIssuersController),
    [AuthGuard, PlatformAdminGuard]
  );
});

test('el controller NO expone ningun metodo mutante', () => {
  const methods = Object.getOwnPropertyNames(
    PlatformAdminIssuersController.prototype
  ).filter((name) => name !== 'constructor');

  assert.deepEqual(methods.sort(), ['listIssuerMemberships', 'listIssuers']);

  const prototype = PlatformAdminIssuersController.prototype as unknown as Record<
    string,
    unknown
  >;

  for (const name of methods) {
    const method = Reflect.getMetadata(METHOD_METADATA, prototype[name] as never);
    assert.equal(method, RequestMethod.GET, `${name} debe ser GET`);
  }
});

// ---------------------------------------------------------------------------
// Delegacion
// ---------------------------------------------------------------------------

test('listIssuers delega sin argumentos y devuelve lo del service', async () => {
  const calls: unknown[] = [];
  const expected = { items: [] };
  const controller = new PlatformAdminIssuersController({
    async listIssuers(...args: unknown[]) {
      calls.push(args);
      return expected;
    }
  } as never);

  const response = await controller.listIssuers();

  assert.equal(response, expected);
  assert.deepEqual(calls, [[]]);
});

test('listIssuerMemberships delega UNICAMENTE el issuerId del path', async () => {
  const calls: unknown[] = [];
  const expected = { issuer: { id: 'issuer-1', name: 'X' }, items: [] };
  const controller = new PlatformAdminIssuersController({
    async listIssuerMemberships(...args: unknown[]) {
      calls.push(args);
      return expected;
    }
  } as never);

  const response = await controller.listIssuerMemberships('issuer-1');

  assert.equal(response, expected);
  assert.deepEqual(calls, [['issuer-1']]);
});

// ---------------------------------------------------------------------------
// Cadena de guards real: 401 / 403 / 200
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

/** Ejecuta la cadena [AuthGuard, PlatformAdminGuard] tal como la monta Nest. */
async function runGuardChain(options: {
  authorization?: string;
  resolvedUser?: typeof PLATFORM_ADMIN_USER | null;
  grantedUserIds: string[];
}) {
  const request: Record<string, unknown> = {
    headers: options.authorization
      ? { authorization: options.authorization }
      : {}
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

test('401: sin Authorization, AuthGuard corta antes de consultar PlatformAdmin', async () => {
  await assert.rejects(
    runGuardChain({ grantedUserIds: [PLATFORM_ADMIN_USER.id] }),
    UnauthorizedException
  );
});

test('401: token invalido o expirado', async () => {
  await assert.rejects(
    runGuardChain({
      authorization: 'Bearer token-vencido',
      resolvedUser: null,
      grantedUserIds: [PLATFORM_ADMIN_USER.id]
    }),
    UnauthorizedException
  );
});

test('403: un User normal autenticado no pasa el plano de plataforma', async () => {
  await assert.rejects(
    runGuardChain({
      authorization: 'Bearer token-valido',
      resolvedUser: NORMAL_USER,
      grantedUserIds: [PLATFORM_ADMIN_USER.id]
    }),
    ForbiddenException
  );
});

test('403: un admin institucional SIN PlatformAdmin tampoco pasa', async () => {
  // Un IssuerMembership(role=admin) no otorga capacidad de plataforma: el guard
  // consulta unicamente la tabla PlatformAdmin, que no tiene issuerId.
  await assert.rejects(
    runGuardChain({
      authorization: 'Bearer token-valido',
      resolvedUser: { ...NORMAL_USER, id: 'user-issuer-admin' },
      grantedUserIds: [PLATFORM_ADMIN_USER.id]
    }),
    ForbiddenException
  );
});

test('200: un PlatformAdmin pasa la cadena y obtiene la lectura', async () => {
  const request = await runGuardChain({
    authorization: 'Bearer token-valido',
    resolvedUser: PLATFORM_ADMIN_USER,
    grantedUserIds: [PLATFORM_ADMIN_USER.id]
  });

  assert.deepEqual(request.user, PLATFORM_ADMIN_USER);

  const controller = new PlatformAdminIssuersController({
    async listIssuers() {
      return { items: [{ id: 'issuer-1' }] };
    }
  } as never);

  const response = await controller.listIssuers();
  assert.equal(response.items.length, 1);
});

test('200: un PlatformAdmin SIN IssuerMembership puede consultar las memberships de un issuer', async () => {
  // Es la propiedad central de S3: estas lecturas son de plataforma, no
  // institucionales. No se consulta IssuerMembership en ningun punto de la
  // autorizacion -- el doble del guard solo conoce la tabla PlatformAdmin.
  await runGuardChain({
    authorization: 'Bearer token-valido',
    resolvedUser: PLATFORM_ADMIN_USER,
    grantedUserIds: [PLATFORM_ADMIN_USER.id]
  });

  const controller = new PlatformAdminIssuersController({
    async listIssuerMemberships(issuerId: string) {
      // El issuer es uno sobre el que el actor NO tiene membership.
      assert.equal(issuerId, 'issuer-ajeno');
      return {
        issuer: { id: 'issuer-ajeno', name: 'Institucion ajena' },
        items: [
          {
            userId: 'otro-user',
            email: 'otro@example.com',
            displayLabel: 'Otro',
            role: 'admin',
            status: 'active',
            createdAt: new Date('2026-01-01T00:00:00.000Z')
          }
        ]
      };
    }
  } as never);

  const response = await controller.listIssuerMemberships('issuer-ajeno');
  assert.equal(response.items.length, 1);
});

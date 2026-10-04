/**
 * Superficie POST /admin/issuers/:issuerId/memberships -- slice S5a.
 *
 * Metadata de Nest (ruta, metodo, 201, guards y su ORDEN), delegacion, y la
 * cadena de guards REAL ejecutada a mano para 401 / 403 / 201.
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
import { PlatformAdminIssuersController } from './platform-admin-issuers.controller';
import { PlatformAdminMembershipGrantController } from './platform-admin-membership-grant.controller';

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

test('la ruta es POST admin/issuers/:issuerId/memberships', () => {
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, PlatformAdminMembershipGrantController),
    'admin/issuers'
  );
  assert.equal(
    Reflect.getMetadata(
      PATH_METADATA,
      PlatformAdminMembershipGrantController.prototype.grantMembership
    ),
    ':issuerId/memberships'
  );
  assert.equal(
    Reflect.getMetadata(
      METHOD_METADATA,
      PlatformAdminMembershipGrantController.prototype.grantMembership
    ),
    RequestMethod.POST
  );
});

test('responde 201 Created: se crea un recurso, asi que el default de Nest es el correcto', () => {
  // A diferencia de S4, que necesita @HttpCode(200) explicito porque NO crea
  // nada, aca el 201 por defecto es exactamente lo que corresponde.
  assert.equal(
    Reflect.getMetadata(
      HTTP_CODE_METADATA,
      PlatformAdminMembershipGrantController.prototype.grantMembership
    ),
    undefined
  );
});

test('exige AuthGuard y PlatformAdminGuard, EN ESE ORDEN', () => {
  assert.deepEqual(
    Reflect.getMetadata(
      GUARDS_METADATA,
      PlatformAdminMembershipGrantController
    ),
    [AuthGuard, PlatformAdminGuard]
  );
});

test('el controller expone un unico metodo', () => {
  const methods = Object.getOwnPropertyNames(
    PlatformAdminMembershipGrantController.prototype
  ).filter((name) => name !== 'constructor');

  assert.deepEqual(methods, ['grantMembership']);
});

test('comparte prefijo con el controller de lecturas sin colisionar: GET vs POST', () => {
  // Nest resuelve por metodo+path. Mantenerlos en controllers separados es lo
  // que deja al de S3 verdaderamente read-only.
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, PlatformAdminIssuersController),
    Reflect.getMetadata(PATH_METADATA, PlatformAdminMembershipGrantController)
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

// ---------------------------------------------------------------------------
// Delegacion: tres fuentes, ninguna del body salvo el email
// ---------------------------------------------------------------------------

const CURRENT_USER = {
  id: 'user-platform-admin',
  email: 'adriel@example.com',
  did: null,
  status: UserStatus.active
};

function createController(onGrant?: (...args: unknown[]) => unknown) {
  const calls: unknown[][] = [];
  const controller = new PlatformAdminMembershipGrantController({
    async grantMembership(...args: unknown[]) {
      calls.push(args);
      return (
        onGrant?.(...args) ?? {
          issuer: { id: 'issuer-uade', name: 'UADE' },
          membership: {
            userId: 'user-juan',
            email: 'juan@uade.edu.ar',
            displayLabel: 'Juan Pérez',
            role: 'admin',
            status: 'active',
            createdAt: new Date('2026-10-04T12:00:00.000Z')
          }
        }
      );
    }
  } as never);

  return { controller, calls };
}

test('delega exactamente (issuerId del path, email normalizado, actor del token)', async () => {
  const { controller, calls } = createController();

  await controller.grantMembership(
    'issuer-uade',
    { userEmail: '  JUAN@UADE.EDU.AR  ' },
    CURRENT_USER
  );

  assert.deepEqual(calls, [
    ['issuer-uade', 'juan@uade.edu.ar', 'user-platform-admin']
  ]);
});

test('el actor sale de @CurrentUser(), nunca del body', async () => {
  const { controller, calls } = createController();

  // El body no puede llevar actorId -- el validador lo rechaza -- pero ademas
  // el controller solo lee `currentUser.id`.
  await controller.grantMembership(
    'issuer-uade',
    { userEmail: 'juan@uade.edu.ar' },
    { ...CURRENT_USER, id: 'actor-real' }
  );

  assert.equal((calls[0] as unknown[])[2], 'actor-real');
});

test('el body se valida ANTES de llegar al service', async () => {
  const { controller, calls } = createController();

  for (const body of [
    null,
    {},
    { userEmail: 'sin-arroba' },
    { userEmail: 'juan@uade.edu.ar', role: 'admin' },
    { userEmail: 'juan@uade.edu.ar', userId: 'otro' },
    { userEmail: 'juan@uade.edu.ar', issuerId: 'otro-issuer' },
    { userEmail: 'juan@uade.edu.ar', status: 'active' },
    { userEmail: 'juan@uade.edu.ar', actorId: 'otro' },
    { userEmail: 'juan@uade.edu.ar', onboardingIntent: 'institutional' }
  ]) {
    await assert.rejects(
      controller.grantMembership('issuer-uade', body, CURRENT_USER),
      BadRequestException,
      `deberia rechazar ${JSON.stringify(body)}`
    );
  }

  assert.deepEqual(calls, [], 'el service no se invoca con un body invalido');
});

test('un issuerId en el body NO puede sobrescribir el del path', async () => {
  // Doble defensa: el validador lo rechaza con 400, asi que el path sigue
  // siendo la unica fuente.
  const { controller, calls } = createController();

  await assert.rejects(
    controller.grantMembership(
      'issuer-del-path',
      { userEmail: 'juan@uade.edu.ar', issuerId: 'issuer-inyectado' },
      CURRENT_USER
    ),
    BadRequestException
  );
  assert.deepEqual(calls, []);
});

test('devuelve lo del service tal cual, sin reempaquetar', async () => {
  const esperado = {
    issuer: { id: 'issuer-uade', name: 'UADE' },
    membership: {
      userId: 'user-juan',
      email: 'juan@uade.edu.ar',
      displayLabel: 'Juan Pérez',
      role: 'admin' as const,
      status: 'active' as const,
      createdAt: new Date('2026-10-04T12:00:00.000Z')
    }
  };
  const { controller } = createController(() => esperado);

  const response = await controller.grantMembership(
    'issuer-uade',
    { userEmail: 'juan@uade.edu.ar' },
    CURRENT_USER
  );

  assert.equal(response, esperado);
});

// ---------------------------------------------------------------------------
// Cadena de guards real: 401 / 403 / 201
// ---------------------------------------------------------------------------

function createExecutionContext(request: Record<string, unknown>) {
  return {
    switchToHttp() {
      return { getRequest: () => request };
    }
  };
}

const PLATFORM_ADMIN_USER = CURRENT_USER;
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
    // Body hostil a proposito: los guards NUNCA deben leerlo.
    body: {
      userEmail: 'juan@uade.edu.ar',
      actorId: 'otro-user',
      platformAdminUserId: 'otro-user'
    },
    params: { issuerId: 'issuer-uade' }
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
        assert.notEqual(
          where.userId,
          'otro-user',
          'el guard no debe leer el body'
        );
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

test('401: sin Authorization, y PlatformAdmin ni se consulta', async () => {
  await assert.rejects(
    runGuardChain({ grantedUserIds: [PLATFORM_ADMIN_USER.id] }),
    UnauthorizedException
  );
});

test('401: token invalido o expirado', async () => {
  await assert.rejects(
    runGuardChain({
      authorization: 'Bearer vencido',
      resolvedUser: null,
      grantedUserIds: [PLATFORM_ADMIN_USER.id]
    }),
    UnauthorizedException
  );
});

test('403: un User normal autenticado no puede otorgar memberships', async () => {
  await assert.rejects(
    runGuardChain({
      authorization: 'Bearer valido',
      resolvedUser: NORMAL_USER,
      grantedUserIds: [PLATFORM_ADMIN_USER.id]
    }),
    ForbiddenException
  );
});

test('403: un admin institucional SIN PlatformAdmin tampoco puede', async () => {
  // Un IssuerMembership(role=admin) no otorga capacidad de plataforma: el guard
  // consulta unicamente la tabla PlatformAdmin, que no tiene issuerId.
  await assert.rejects(
    runGuardChain({
      authorization: 'Bearer valido',
      resolvedUser: { ...NORMAL_USER, id: 'user-issuer-admin' },
      grantedUserIds: [PLATFORM_ADMIN_USER.id]
    }),
    ForbiddenException
  );
});

test('201: un PlatformAdmin SIN membership sobre el issuer de destino puede otorgar', async () => {
  // Propiedad central de S5a: es una operacion de plataforma. En toda la
  // autorizacion no se consulta IssuerMembership -- el doble del guard solo
  // conoce la tabla PlatformAdmin.
  const request = await runGuardChain({
    authorization: 'Bearer valido',
    resolvedUser: PLATFORM_ADMIN_USER,
    grantedUserIds: [PLATFORM_ADMIN_USER.id]
  });

  assert.deepEqual(request.user, PLATFORM_ADMIN_USER);

  const { controller, calls } = createController();
  const response = await controller.grantMembership(
    'issuer-ajeno',
    { userEmail: 'juan@uade.edu.ar' },
    PLATFORM_ADMIN_USER
  );

  assert.equal((calls[0] as unknown[])[0], 'issuer-ajeno');
  assert.equal(response.membership.role, 'admin');
});

test('201: self-assignment pasa la cadena igual que cualquier otro grant', async () => {
  await runGuardChain({
    authorization: 'Bearer valido',
    resolvedUser: PLATFORM_ADMIN_USER,
    grantedUserIds: [PLATFORM_ADMIN_USER.id]
  });

  const { controller, calls } = createController();
  await controller.grantMembership(
    'issuer-uade',
    { userEmail: PLATFORM_ADMIN_USER.email },
    PLATFORM_ADMIN_USER
  );

  // actor y sujeto coinciden, y el actor sigue saliendo del token.
  assert.deepEqual(calls, [
    ['issuer-uade', 'adriel@example.com', 'user-platform-admin']
  ]);
});

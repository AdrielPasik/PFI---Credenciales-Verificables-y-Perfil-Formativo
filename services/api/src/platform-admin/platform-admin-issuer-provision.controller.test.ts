/**
 * Superficie POST /admin/issuers -- slice S5b.
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
import { PlatformAdminIssuerProvisionController } from './platform-admin-issuer-provision.controller';
import { PlatformAdminIssuersController } from './platform-admin-issuers.controller';
import { PlatformAdminMembershipGrantController } from './platform-admin-membership-grant.controller';

const VALIDO = {
  name: 'Universidad X',
  legalName: 'Universidad X',
  initialAdminUserEmail: 'admin@universidadx.edu'
};

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

test('la ruta es POST admin/issuers', () => {
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, PlatformAdminIssuerProvisionController),
    'admin/issuers'
  );
  assert.equal(
    Reflect.getMetadata(
      PATH_METADATA,
      PlatformAdminIssuerProvisionController.prototype.provisionIssuer
    ),
    '/'
  );
  assert.equal(
    Reflect.getMetadata(
      METHOD_METADATA,
      PlatformAdminIssuerProvisionController.prototype.provisionIssuer
    ),
    RequestMethod.POST
  );
});

test('responde 201 Created: se crea un recurso, asi que el default de Nest es el correcto', () => {
  assert.equal(
    Reflect.getMetadata(
      HTTP_CODE_METADATA,
      PlatformAdminIssuerProvisionController.prototype.provisionIssuer
    ),
    undefined
  );
});

test('exige AuthGuard y PlatformAdminGuard, EN ESE ORDEN', () => {
  // El orden importa: 401 antes del 403 de plataforma.
  assert.deepEqual(
    Reflect.getMetadata(
      GUARDS_METADATA,
      PlatformAdminIssuerProvisionController
    ),
    [AuthGuard, PlatformAdminGuard]
  );
});

test('el controller expone un unico metodo', () => {
  const methods = Object.getOwnPropertyNames(
    PlatformAdminIssuerProvisionController.prototype
  ).filter((name) => name !== 'constructor');

  assert.deepEqual(methods, ['provisionIssuer']);
});

test('tercer controller con el prefijo admin/issuers, sin colisionar con S3 ni S5a', () => {
  // Nest resuelve por metodo+path: `POST ''` (S5b) convive con `GET ''` (S3) y
  // con `POST ':issuerId/memberships'` (S5a).
  const prefijo = 'admin/issuers';

  for (const controller of [
    PlatformAdminIssuersController,
    PlatformAdminMembershipGrantController,
    PlatformAdminIssuerProvisionController
  ]) {
    assert.equal(Reflect.getMetadata(PATH_METADATA, controller), prefijo);
  }

  // El GET de S3 sobre la misma ruta raiz.
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
  // Misma ruta, metodo distinto: no hay colision.
  assert.notEqual(
    Reflect.getMetadata(
      METHOD_METADATA,
      PlatformAdminIssuerProvisionController.prototype.provisionIssuer
    ),
    Reflect.getMetadata(
      METHOD_METADATA,
      PlatformAdminIssuersController.prototype.listIssuers
    )
  );
});

// ---------------------------------------------------------------------------
// Delegacion: el cliente controla tres strings, el actor sale del token
// ---------------------------------------------------------------------------

const CURRENT_USER = {
  id: 'user-platform-admin',
  email: 'adriel@example.com',
  did: null,
  status: UserStatus.active
};

function createController(onProvision?: (...args: unknown[]) => unknown) {
  const calls: unknown[][] = [];
  const controller = new PlatformAdminIssuerProvisionController({
    async provisionIssuer(...args: unknown[]) {
      calls.push(args);
      return (
        onProvision?.(...args) ?? {
          issuer: {
            id: 'issuer-nuevo',
            name: 'Universidad X',
            legalName: 'Universidad X',
            authorizationStatus: 'authorized',
            technicalIdentity: {
              didConfigured: false,
              walletConfigured: false,
              readyToIssue: false
            },
            createdAt: new Date('2026-10-04T12:00:00.000Z')
          },
          initialAdminMembership: {
            userId: 'user-admin-x',
            email: 'admin@universidadx.edu',
            displayLabel: 'Ana Gómez',
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

test('delega exactamente (request normalizado, actor del token)', async () => {
  const { controller, calls } = createController();

  await controller.provisionIssuer(
    {
      name: '  Universidad   X  ',
      legalName: '  Universidad X S.A.  ',
      initialAdminUserEmail: '  ADMIN@UniversidadX.EDU  '
    },
    CURRENT_USER
  );

  assert.deepEqual(calls, [
    [
      {
        name: 'Universidad X',
        legalName: 'Universidad X S.A.',
        initialAdminUserEmail: 'admin@universidadx.edu'
      },
      'user-platform-admin'
    ]
  ]);
});

test('el actor sale de @CurrentUser(), nunca del body', async () => {
  const { controller, calls } = createController();

  await controller.provisionIssuer(VALIDO, {
    ...CURRENT_USER,
    id: 'actor-real'
  });

  assert.equal((calls[0] as unknown[])[1], 'actor-real');
});

test('el body se valida ANTES de llegar al service', async () => {
  const { controller, calls } = createController();

  for (const body of [
    null,
    {},
    { name: 'Universidad X' },
    { ...VALIDO, name: '   ' },
    { ...VALIDO, legalName: '' },
    { ...VALIDO, initialAdminUserEmail: 'sin-arroba' },
    { ...VALIDO, authorizationStatus: 'authorized' },
    { ...VALIDO, authorizedAt: new Date().toISOString() },
    { ...VALIDO, did: 'did:example:falso' },
    { ...VALIDO, walletAddress: '0xdeadbeef' },
    { ...VALIDO, role: 'admin' },
    { ...VALIDO, status: 'active' },
    { ...VALIDO, userId: 'user-inyectado' },
    { ...VALIDO, initialAdminUserId: 'user-inyectado' },
    { ...VALIDO, actorId: 'otro' },
    { ...VALIDO, issuerId: 'issuer-existente' },
    { ...VALIDO, metadata: { x: 1 } },
    { ...VALIDO, onboardingIntent: 'institutional' },
    { ...VALIDO, password: 'hunter2' }
  ]) {
    await assert.rejects(
      controller.provisionIssuer(body, CURRENT_USER),
      BadRequestException,
      `deberia rechazar ${JSON.stringify(body)}`
    );
  }

  assert.deepEqual(calls, [], 'el service no se invoca con un body invalido');
});

test('devuelve lo del service tal cual, sin reempaquetar', async () => {
  const esperado = {
    issuer: {
      id: 'issuer-nuevo',
      name: 'Universidad X',
      legalName: 'Universidad X',
      authorizationStatus: 'authorized' as const,
      technicalIdentity: {
        didConfigured: false,
        walletConfigured: false,
        readyToIssue: false
      },
      createdAt: new Date('2026-10-04T12:00:00.000Z')
    },
    initialAdminMembership: {
      userId: 'user-admin-x',
      email: 'admin@universidadx.edu',
      displayLabel: 'Ana Gómez',
      role: 'admin' as const,
      status: 'active' as const,
      createdAt: new Date('2026-10-04T12:00:00.000Z')
    }
  };
  const { controller } = createController(() => esperado);

  const response = await controller.provisionIssuer(VALIDO, CURRENT_USER);

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
  issuerMemberships?: Array<{ userId: string; role: string }>;
}) {
  const request: Record<string, unknown> = {
    headers: options.authorization
      ? { authorization: options.authorization }
      : {},
    // Body hostil a proposito: los guards NUNCA deben leerlo.
    body: {
      ...VALIDO,
      actorId: 'otro-user',
      platformAdminUserId: 'otro-user',
      authorizationStatus: 'authorized'
    },
    params: {}
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
    },
    // Si el guard consultara memberships, este doble lo delataria: la
    // autorizacion de S5b NO puede depender de IssuerMembership.
    issuerMembership: {
      async findUnique() {
        throw new Error(
          'la autorizacion de plataforma NO debe consultar IssuerMembership'
        );
      },
      async findMany() {
        throw new Error(
          'la autorizacion de plataforma NO debe consultar IssuerMembership'
        );
      }
    }
  } as never);

  const context = createExecutionContext(request) as never;
  await authGuard.canActivate(context);
  await platformAdminGuard.canActivate(context);
  return request;
}

test('1: sin token -> 401, y PlatformAdmin ni se consulta', async () => {
  await assert.rejects(
    runGuardChain({ grantedUserIds: [PLATFORM_ADMIN_USER.id] }),
    UnauthorizedException
  );
});

test('2: token invalido o expirado -> 401', async () => {
  await assert.rejects(
    runGuardChain({
      authorization: 'Bearer vencido',
      resolvedUser: null,
      grantedUserIds: [PLATFORM_ADMIN_USER.id]
    }),
    UnauthorizedException
  );
});

test('3: un User normal autenticado -> 403', async () => {
  await assert.rejects(
    runGuardChain({
      authorization: 'Bearer valido',
      resolvedUser: NORMAL_USER,
      grantedUserIds: [PLATFORM_ADMIN_USER.id]
    }),
    ForbiddenException
  );
});

test('4: un admin institucional SIN PlatformAdmin -> 403', async () => {
  // Un IssuerMembership(role=admin) no otorga capacidad de plataforma: el
  // guard consulta unicamente la tabla PlatformAdmin, que no tiene issuerId.
  // Ser admin de UADE no habilita a dar de alta "Universidad X".
  await assert.rejects(
    runGuardChain({
      authorization: 'Bearer valido',
      resolvedUser: { ...NORMAL_USER, id: 'user-issuer-admin' },
      grantedUserIds: [PLATFORM_ADMIN_USER.id],
      issuerMemberships: [{ userId: 'user-issuer-admin', role: 'admin' }]
    }),
    ForbiddenException
  );
});

test('5: un PlatformAdmin SIN ninguna membership PUEDE provisionar', async () => {
  // Propiedad central de S5b: es una operacion de plataforma, y no podria
  // exigir membership -- el issuer no existe todavia. En toda la autorizacion
  // no se consulta IssuerMembership (el doble lanzaria).
  const request = await runGuardChain({
    authorization: 'Bearer valido',
    resolvedUser: PLATFORM_ADMIN_USER,
    grantedUserIds: [PLATFORM_ADMIN_USER.id]
  });

  assert.deepEqual(request.user, PLATFORM_ADMIN_USER);

  const { controller, calls } = createController();
  const response = await controller.provisionIssuer(VALIDO, PLATFORM_ADMIN_USER);

  assert.equal((calls[0] as unknown[])[1], PLATFORM_ADMIN_USER.id);
  assert.equal(response.issuer.authorizationStatus, 'authorized');
});

test('6: un PlatformAdmin puede ponerse a SI MISMO como primer admin', async () => {
  await runGuardChain({
    authorization: 'Bearer valido',
    resolvedUser: PLATFORM_ADMIN_USER,
    grantedUserIds: [PLATFORM_ADMIN_USER.id]
  });

  const { controller, calls } = createController();
  await controller.provisionIssuer(
    { ...VALIDO, initialAdminUserEmail: PLATFORM_ADMIN_USER.email },
    PLATFORM_ADMIN_USER
  );

  // El email del actor es un email como cualquier otro: se resuelve
  // server-side, y el acceso institucional vendra de la membership creada.
  assert.deepEqual(calls, [
    [
      {
        name: 'Universidad X',
        legalName: 'Universidad X',
        initialAdminUserEmail: 'adriel@example.com'
      },
      'user-platform-admin'
    ]
  ]);
});

test('7: provisionar NO le da acceso institucional al actor', async () => {
  // El controller delega el email del PRIMER ADMIN, que es otra persona. El
  // actor solo viaja como `actorId` para la auditoria: en ningun momento se
  // deriva una membership para el.
  const { controller, calls } = createController();

  await controller.provisionIssuer(VALIDO, PLATFORM_ADMIN_USER);

  const [request, actorId] = calls[0] as [
    { initialAdminUserEmail: string },
    string
  ];
  assert.equal(request.initialAdminUserEmail, 'admin@universidadx.edu');
  assert.equal(actorId, 'user-platform-admin');
  assert.notEqual(request.initialAdminUserEmail, PLATFORM_ADMIN_USER.email);
});

test('un authorizationStatus en el body NO puede alterar el alta', async () => {
  // Doble defensa: el validador lo rechaza con 400, asi que el servidor sigue
  // siendo la unica fuente de la habilitacion operacional.
  const { controller, calls } = createController();

  await assert.rejects(
    controller.provisionIssuer(
      { ...VALIDO, authorizationStatus: 'authorized' },
      PLATFORM_ADMIN_USER
    ),
    BadRequestException
  );
  assert.deepEqual(calls, []);
});

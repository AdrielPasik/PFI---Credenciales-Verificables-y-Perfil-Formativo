/**
 * Resolucion administrativa de un User por email -- slice S4.
 *
 * Lo que se defiende: 404 UNIFORME para todo lo no elegible (sin enumerar
 * estado de cuentas), ambiguedad de casing -> error de integridad en vez de
 * elegir, respuesta de dos campos, y cero escrituras.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InternalServerErrorException,
  NotFoundException
} from '@nestjs/common';
import { UserStatus } from '@prisma/client';

import { PlatformAdminUserResolutionService } from './platform-admin-user-resolution.service';

const UNIFORM_404 = 'No se encontro un usuario elegible con el email indicado.';

interface FakeUser {
  id?: string;
  email: string | null;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  status: UserStatus;
  did?: string | null;
}

const FORBIDDEN = (name: string) => () => {
  throw new Error(`la resolucion administrativa no debe invocar ${name}`);
};

/**
 * Doble de Prisma.
 *
 * Solo `user.findMany` funciona. Todo lo demas -- incluidas las escrituras y
 * `$transaction` -- lanza, asi que una mutacion no pasaria desapercibida.
 */
function createDouble(users: FakeUser[]) {
  const findManyArgs: unknown[] = [];

  const prisma = {
    user: {
      async findMany(args: {
        where: { email: { equals: string; mode?: string } };
        select: Record<string, boolean>;
        take?: number;
      }) {
        findManyArgs.push(args);
        const target = args.where.email.equals.toLowerCase();
        const matched = users.filter(
          (user) => (user.email ?? '').toLowerCase() === target
        );
        // Respeta `take`, igual que la base.
        const limited =
          typeof args.take === 'number' ? matched.slice(0, args.take) : matched;

        // Devuelve SOLO las claves pedidas en el select, para que un test pueda
        // comprobar que el service no recibe (ni puede filtrar) lo que no pidio.
        return limited.map((user) => {
          const projected: Record<string, unknown> = {};
          for (const key of Object.keys(args.select)) {
            projected[key] = (user as unknown as Record<string, unknown>)[key];
          }
          return projected;
        });
      },
      findUnique: FORBIDDEN('user.findUnique'),
      create: FORBIDDEN('user.create'),
      update: FORBIDDEN('user.update'),
      updateMany: FORBIDDEN('user.updateMany'),
      delete: FORBIDDEN('user.delete'),
      deleteMany: FORBIDDEN('user.deleteMany')
    },
    authCredential: {
      create: FORBIDDEN('authCredential.create'),
      update: FORBIDDEN('authCredential.update')
    },
    issuer: {
      create: FORBIDDEN('issuer.create'),
      update: FORBIDDEN('issuer.update'),
      findMany: FORBIDDEN('issuer.findMany')
    },
    issuerMembership: {
      create: FORBIDDEN('issuerMembership.create'),
      update: FORBIDDEN('issuerMembership.update'),
      findUnique: FORBIDDEN('issuerMembership.findUnique')
    },
    platformAdmin: {
      create: FORBIDDEN('platformAdmin.create'),
      update: FORBIDDEN('platformAdmin.update')
    },
    auditLog: {
      create: FORBIDDEN('auditLog.create')
    },
    $transaction: FORBIDDEN('$transaction'),
    $queryRaw: FORBIDDEN('$queryRaw'),
    $executeRaw: FORBIDDEN('$executeRaw')
  };

  return { prisma, findManyArgs };
}

const ACTIVE_USER: FakeUser = {
  id: 'user-1',
  email: 'persona@dominio.com',
  displayName: null,
  firstName: 'Ada',
  lastName: 'Lovelace',
  status: UserStatus.active,
  did: 'did:web:api.example:did:users:user-1'
};

// ---------------------------------------------------------------------------
// 1. Happy path
// ---------------------------------------------------------------------------

test('1: un User active existente devuelve email + displayLabel', async () => {
  const { prisma } = createDouble([ACTIVE_USER]);
  const service = new PlatformAdminUserResolutionService(prisma as never);

  const response = await service.resolveUserByEmail('persona@dominio.com');

  assert.deepEqual(response, {
    email: 'persona@dominio.com',
    displayLabel: 'Ada Lovelace'
  });
});

test('la respuesta tiene EXACTAMENTE dos claves', async () => {
  const { prisma } = createDouble([ACTIVE_USER]);
  const service = new PlatformAdminUserResolutionService(prisma as never);

  const response = await service.resolveUserByEmail('persona@dominio.com');

  assert.deepEqual(Object.keys(response).sort(), ['displayLabel', 'email']);
});

// ---------------------------------------------------------------------------
// 2-6. 404 uniforme
// ---------------------------------------------------------------------------

test('2: User inexistente -> 404 uniforme', async () => {
  const { prisma } = createDouble([]);
  const service = new PlatformAdminUserResolutionService(prisma as never);

  await assert.rejects(
    service.resolveUserByEmail('nadie@dominio.com'),
    (error: unknown) => {
      assert.ok(error instanceof NotFoundException);
      assert.equal((error as Error).message, UNIFORM_404);
      return true;
    }
  );
});

for (const status of [
  UserStatus.pending,
  UserStatus.suspended,
  UserStatus.archived
]) {
  test(`3-5: User ${status} -> MISMO 404 uniforme que "no existe"`, async () => {
    const { prisma } = createDouble([{ ...ACTIVE_USER, status }]);
    const service = new PlatformAdminUserResolutionService(prisma as never);

    await assert.rejects(
      service.resolveUserByEmail('persona@dominio.com'),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        // El mensaje NO distingue el estado: eso evita enumerar cuentas.
        assert.equal((error as Error).message, UNIFORM_404);
        assert.equal((error as Error).message.includes(status), false);
        return true;
      }
    );
  });
}

test('6: User con email null -> no elegible, mismo 404', async () => {
  // No es alcanzable por el lookup (filtra por email), pero el chequeo existe
  // igual: misma defensa que `normalizeStoredEmail` en resolveHolder.
  const { prisma } = createDouble([{ ...ACTIVE_USER, email: null }]);
  const service = new PlatformAdminUserResolutionService(prisma as never);

  await assert.rejects(
    service.resolveUserByEmail('persona@dominio.com'),
    (error: unknown) => {
      assert.equal((error as Error).message, UNIFORM_404);
      return true;
    }
  );
});

test('6b: un email almacenado con formato invalido tampoco es elegible', async () => {
  const { prisma } = createDouble([{ ...ACTIVE_USER, email: 'roto@' }]);
  const service = new PlatformAdminUserResolutionService(prisma as never);

  await assert.rejects(
    service.resolveUserByEmail('roto@'),
    (error: unknown) => {
      assert.equal((error as Error).message, UNIFORM_404);
      return true;
    }
  );
});

test('los cuatro casos no elegibles son INDISTINGUIBLES entre si', async () => {
  const mensajes: string[] = [];

  const escenarios: FakeUser[][] = [
    [],
    [{ ...ACTIVE_USER, status: UserStatus.pending }],
    [{ ...ACTIVE_USER, status: UserStatus.suspended }],
    [{ ...ACTIVE_USER, status: UserStatus.archived }],
    [{ ...ACTIVE_USER, email: null }]
  ];

  for (const users of escenarios) {
    const { prisma } = createDouble(users);
    const service = new PlatformAdminUserResolutionService(prisma as never);
    try {
      await service.resolveUserByEmail('persona@dominio.com');
      assert.fail('deberia haber fallado');
    } catch (error) {
      mensajes.push((error as Error).message);
    }
  }

  assert.equal(new Set(mensajes).size, 1, 'un solo mensaje para los 5 casos');
  assert.equal(mensajes[0], UNIFORM_404);
});

// ---------------------------------------------------------------------------
// 7. Ambiguedad de casing
// ---------------------------------------------------------------------------

test('7: >1 match case-insensitive -> error interno, NUNCA elige uno', async () => {
  const { prisma } = createDouble([
    ACTIVE_USER,
    { ...ACTIVE_USER, id: 'user-2', email: 'Persona@Dominio.com' }
  ]);
  const service = new PlatformAdminUserResolutionService(prisma as never);

  await assert.rejects(
    service.resolveUserByEmail('persona@dominio.com'),
    (error: unknown) => {
      assert.ok(error instanceof InternalServerErrorException);
      // No es un 404: el email SI existe, el problema es de integridad.
      assert.ok(!(error instanceof NotFoundException));
      return true;
    }
  );
});

test('7b: la ambiguedad no revela cual de los dos Users habria ganado', async () => {
  const { prisma } = createDouble([
    ACTIVE_USER,
    { ...ACTIVE_USER, id: 'user-2', email: 'PERSONA@DOMINIO.COM' }
  ]);
  const service = new PlatformAdminUserResolutionService(prisma as never);

  try {
    await service.resolveUserByEmail('persona@dominio.com');
    assert.fail('deberia haber fallado');
  } catch (error) {
    const message = (error as Error).message;
    assert.equal(message.includes('user-1'), false);
    assert.equal(message.includes('user-2'), false);
  }
});

// ---------------------------------------------------------------------------
// 8-9. Forma de la query
// ---------------------------------------------------------------------------

test('8-9: usa findMany con take: 2 y busqueda case-insensitive', async () => {
  const { prisma, findManyArgs } = createDouble([ACTIVE_USER]);
  const service = new PlatformAdminUserResolutionService(prisma as never);

  await service.resolveUserByEmail('persona@dominio.com');

  const args = findManyArgs[0] as {
    where: { email: { equals: string; mode: string } };
    take: number;
  };
  assert.equal(args.take, 2);
  assert.equal(args.where.email.equals, 'persona@dominio.com');
  assert.equal(args.where.email.mode, 'insensitive');
});

test('9b: resuelve un User cuyo email esta almacenado con otro casing', async () => {
  // Es el motivo real del `mode: insensitive`: el unique de PostgreSQL es
  // case-sensitive, asi que el valor guardado puede diferir del normalizado.
  const { prisma } = createDouble([
    { ...ACTIVE_USER, email: 'Persona@Dominio.COM' }
  ]);
  const service = new PlatformAdminUserResolutionService(prisma as never);

  const response = await service.resolveUserByEmail('persona@dominio.com');

  // El email devuelto es el NORMALIZADO, no el casing almacenado.
  assert.equal(response.email, 'persona@dominio.com');
});

// ---------------------------------------------------------------------------
// 10-13. No filtra nada
// ---------------------------------------------------------------------------

test('10-13: no devuelve userId, did, status ni nombres crudos', async () => {
  const { prisma } = createDouble([
    { ...ACTIVE_USER, displayName: 'Ada L.', did: 'did:web:secreto' }
  ]);
  const service = new PlatformAdminUserResolutionService(prisma as never);

  const response = await service.resolveUserByEmail('persona@dominio.com');
  const serialized = JSON.stringify(response);

  for (const key of [
    'id',
    'userId',
    'did',
    'status',
    'firstName',
    'lastName',
    'displayName',
    'createdAt',
    'updatedAt',
    'platformAdmin',
    'issuerMemberships',
    'authCredential',
    'passwordHash',
    'metadata'
  ]) {
    assert.equal(key in response, false, `no debe exponer ${key}`);
  }

  assert.equal(serialized.includes('user-1'), false);
  assert.equal(serialized.includes('did:web:secreto'), false);
  assert.equal(serialized.includes('active'), false);
  // `Ada` aparece dentro de displayLabel, que es la proyeccion segura; lo que
  // no debe aparecer es el campo crudo.
  assert.equal('firstName' in response, false);
});

test('10b: el `id` ni se le PIDE a la base', async () => {
  // Es lo que hace estructuralmente imposible filtrar un userId: el select no
  // lo incluye, asi que el service nunca lo tiene en la mano.
  const { prisma, findManyArgs } = createDouble([ACTIVE_USER]);
  const service = new PlatformAdminUserResolutionService(prisma as never);

  await service.resolveUserByEmail('persona@dominio.com');

  const args = findManyArgs[0] as { select: Record<string, boolean> };
  assert.deepEqual(Object.keys(args.select).sort(), [
    'displayName',
    'email',
    'firstName',
    'lastName',
    'status'
  ]);
  assert.equal('id' in args.select, false);
  assert.equal('did' in args.select, false);
  assert.equal('authCredential' in args.select, false);
});

// ---------------------------------------------------------------------------
// 14. displayLabel por el helper
// ---------------------------------------------------------------------------

test('14: displayLabel usa buildHolderDisplayLabel con toda su cadena de fallback', async () => {
  const escenarios: Array<[Partial<FakeUser>, string]> = [
    [{ displayName: 'Administrador UADE' }, 'Administrador UADE'],
    [{ displayName: null, firstName: 'Ada', lastName: 'Lovelace' }, 'Ada Lovelace'],
    [{ displayName: null, firstName: 'Ada', lastName: null }, 'Ada'],
    [{ displayName: null, firstName: null, lastName: 'Lovelace' }, 'Lovelace'],
    // Sin ningun nombre: cae al email, que S4 siempre tiene porque solo
    // devuelve Users con email valido.
    [
      { displayName: null, firstName: null, lastName: null },
      'persona@dominio.com'
    ]
  ];

  for (const [override, esperado] of escenarios) {
    const { prisma } = createDouble([{ ...ACTIVE_USER, ...override }]);
    const service = new PlatformAdminUserResolutionService(prisma as never);

    const response = await service.resolveUserByEmail('persona@dominio.com');

    assert.equal(response.displayLabel, esperado);
    assert.ok(response.displayLabel.length > 0, 'displayLabel nunca es vacio');
  }
});

// ---------------------------------------------------------------------------
// 15. Cero escrituras
// ---------------------------------------------------------------------------

test('15: ninguna operacion de escritura, ninguna transaccion, ningun SQL crudo', async () => {
  // El doble lanza en toda escritura, en `$transaction` y en `$queryRaw`, asi
  // que basta con que el happy path y los caminos de error terminen como se
  // espera para que quede probado que no se invocan.
  const { prisma } = createDouble([ACTIVE_USER]);
  const service = new PlatformAdminUserResolutionService(prisma as never);

  await service.resolveUserByEmail('persona@dominio.com');

  const vacio = createDouble([]);
  await assert.rejects(
    new PlatformAdminUserResolutionService(vacio.prisma as never).resolveUserByEmail(
      'nadie@dominio.com'
    ),
    NotFoundException
  );

  const ambiguo = createDouble([
    ACTIVE_USER,
    { ...ACTIVE_USER, id: 'user-2', email: 'Persona@Dominio.com' }
  ]);
  await assert.rejects(
    new PlatformAdminUserResolutionService(
      ambiguo.prisma as never
    ).resolveUserByEmail('persona@dominio.com'),
    InternalServerErrorException
  );
});

test('15b: una sola consulta por resolucion', async () => {
  const { prisma, findManyArgs } = createDouble([ACTIVE_USER]);
  const service = new PlatformAdminUserResolutionService(prisma as never);

  await service.resolveUserByEmail('persona@dominio.com');

  assert.equal(findManyArgs.length, 1);
});

// ---------------------------------------------------------------------------
// Plano de plataforma
// ---------------------------------------------------------------------------

test('no consulta IssuerMembership ni Issuer: no depende de contexto institucional', async () => {
  // El doble lanza si se tocan esos delegates. Un Platform Admin sin ninguna
  // membership resuelve igual.
  const { prisma } = createDouble([ACTIVE_USER]);
  const service = new PlatformAdminUserResolutionService(prisma as never);

  const response = await service.resolveUserByEmail('persona@dominio.com');

  assert.equal(response.email, 'persona@dominio.com');
});

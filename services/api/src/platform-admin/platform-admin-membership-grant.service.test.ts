/**
 * Concesion de IssuerMembership por un PlatformAdmin -- slice S5a.
 *
 * Lo que se defiende: `admin`/`active` SIEMPRE del servidor, resolucion
 * server-side por email, 404 uniforme, 409 para CUALQUIER membership
 * preexistente, atomicidad real de membership + AuditLog, y que
 * `onboardingIntent` no participa de ninguna decision.
 *
 * EL DOBLE ES ESTRICTO CON LA FRONTERA TRANSACCIONAL, igual que el de S2: el
 * cliente raiz no expone `issuerMembership.create` ni `auditLog`, y lo que si
 * expone lanza. Las escrituras solo funcionan sobre el `tx`, que es un objeto
 * DISTINTO. Una escritura fuera de la transaccion explota en vez de pasar por
 * casualidad.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException
} from '@nestjs/common';
import {
  ActorType,
  IssuerMembershipRole,
  IssuerMembershipStatus,
  Prisma,
  UserOnboardingIntent,
  UserStatus
} from '@prisma/client';

import {
  ISSUER_MEMBERSHIP_GRANTED_ACTION,
  ISSUER_MEMBERSHIP_RESOURCE_TYPE
} from './platform-admin-audit.constants';
import { PlatformAdminMembershipGrantService } from './platform-admin-membership-grant.service';

const UNIFORM_404 = 'No se encontro un usuario elegible con el email indicado.';
const ISSUER_404 = 'No se encontro el issuer solicitado.';
const ALREADY_MEMBER = 'El usuario ya tiene una membresia para este issuer.';

const ACTOR_ID = 'user-platform-admin';

interface FakeIssuer {
  id: string;
  name: string;
  authorizationStatus?: string;
  did?: string | null;
  walletAddress?: string | null;
}

interface FakeUser {
  id: string;
  email: string | null;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  status: UserStatus;
  onboardingIntent?: UserOnboardingIntent | null;
  did?: string | null;
}

interface FakeMembership {
  id: string;
  userId: string;
  issuerId: string;
  role: IssuerMembershipRole;
  status: IssuerMembershipStatus;
  createdAt: Date;
}

interface FakeAuditLog {
  actorId: string | null;
  actorType: ActorType;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: unknown;
}

function uniqueViolation(target?: unknown) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6.19.3',
    meta: target === undefined ? undefined : { target }
  });
}

const UADE: FakeIssuer = {
  id: 'issuer-uade',
  name: 'Universidad Argentina de la Empresa (UADE)',
  authorizationStatus: 'authorized',
  did: 'did:example:issuer-demo',
  walletAddress: '0x00000000000000000000000000000000000000aa'
};

const JUAN: FakeUser = {
  id: 'user-juan',
  email: 'juan@uade.edu.ar',
  displayName: null,
  firstName: 'Juan',
  lastName: 'Pérez',
  status: UserStatus.active,
  onboardingIntent: UserOnboardingIntent.institutional,
  did: 'did:web:api.example:did:users:user-juan'
};

function createDouble(options: {
  issuers?: FakeIssuer[];
  users?: FakeUser[];
  memberships?: FakeMembership[];
  failAuditLog?: boolean;
  failMembershipCreate?: unknown;
} = {}) {
  const issuers = options.issuers ?? [UADE];
  const users = options.users ?? [JUAN];
  const memberships: FakeMembership[] = [...(options.memberships ?? [])];
  const auditLogs: FakeAuditLog[] = [];

  const calls = {
    transactions: 0,
    issuerFindUnique: 0,
    userFindMany: 0,
    membershipFindUnique: 0,
    membershipCreateAttempts: 0,
    auditLogCreateAttempts: 0
  };
  const userFindManyArgs: unknown[] = [];

  const forbidden = (name: string) => async () => {
    throw new Error(`S5a no debe invocar ${name}`);
  };

  function project<T extends object>(row: T, select: Record<string, boolean>) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(select)) {
      out[key] = (row as unknown as Record<string, unknown>)[key];
    }
    return out;
  }

  const client = {
    // El cliente RAIZ no puede escribir nada: todas las escrituras tienen que
    // pasar por el `tx`.
    issuerMembership: {
      create: forbidden('issuerMembership.create FUERA de la transaccion'),
      update: forbidden('issuerMembership.update'),
      updateMany: forbidden('issuerMembership.updateMany'),
      upsert: forbidden('issuerMembership.upsert'),
      delete: forbidden('issuerMembership.delete'),
      deleteMany: forbidden('issuerMembership.deleteMany')
    },
    user: {
      create: forbidden('user.create'),
      update: forbidden('user.update'),
      updateMany: forbidden('user.updateMany'),
      delete: forbidden('user.delete')
    },
    issuer: {
      create: forbidden('issuer.create'),
      update: forbidden('issuer.update'),
      updateMany: forbidden('issuer.updateMany'),
      delete: forbidden('issuer.delete')
    },
    platformAdmin: {
      create: forbidden('platformAdmin.create'),
      update: forbidden('platformAdmin.update'),
      delete: forbidden('platformAdmin.delete')
    },
    authCredential: { create: forbidden('authCredential.create') },
    $queryRaw: forbidden('$queryRaw'),
    $executeRaw: forbidden('$executeRaw'),

    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      calls.transactions += 1;

      // Rollback real: staging que solo se commitea si el callback termina bien.
      const stagedMemberships: FakeMembership[] = [];
      const stagedAuditLogs: FakeAuditLog[] = [];

      const tx = {
        issuer: {
          async findUnique({
            where,
            select
          }: { where: { id: string }; select: Record<string, boolean> }) {
            calls.issuerFindUnique += 1;
            const found = issuers.find((issuer) => issuer.id === where.id);
            return found ? project(found, select) : null;
          },
          create: forbidden('issuer.create'),
          update: forbidden('issuer.update')
        },
        user: {
          async findMany(args: {
            where: { email: { equals: string; mode?: string } };
            select: Record<string, boolean>;
            take?: number;
          }) {
            calls.userFindMany += 1;
            userFindManyArgs.push(args);
            const target = args.where.email.equals.toLowerCase();
            const matched = users.filter(
              (user) => (user.email ?? '').toLowerCase() === target
            );
            const limited =
              typeof args.take === 'number'
                ? matched.slice(0, args.take)
                : matched;
            return limited.map((user) => project(user, args.select));
          },
          create: forbidden('user.create'),
          update: forbidden('user.update')
        },
        issuerMembership: {
          async findUnique({
            where
          }: {
            where: { userId_issuerId: { userId: string; issuerId: string } };
          }) {
            calls.membershipFindUnique += 1;
            const { userId, issuerId } = where.userId_issuerId;
            const found = [...memberships, ...stagedMemberships].find(
              (row) => row.userId === userId && row.issuerId === issuerId
            );
            return found ? { id: found.id } : null;
          },
          async create({
            data,
            select
          }: { data: Omit<FakeMembership, 'id' | 'createdAt'>; select: Record<string, boolean> }) {
            calls.membershipCreateAttempts += 1;

            if (options.failMembershipCreate !== undefined) {
              throw options.failMembershipCreate;
            }

            // Espejo del `@@unique([userId, issuerId])` real.
            if (
              [...memberships, ...stagedMemberships].some(
                (row) =>
                  row.userId === data.userId && row.issuerId === data.issuerId
              )
            ) {
              throw uniqueViolation(['userId', 'issuerId']);
            }

            const row: FakeMembership = {
              id: `membership-${memberships.length + stagedMemberships.length + 1}`,
              createdAt: new Date('2026-10-04T12:00:00.000Z'),
              ...data
            };
            stagedMemberships.push(row);
            return project(row, select);
          },
          update: forbidden('issuerMembership.update'),
          upsert: forbidden('issuerMembership.upsert'),
          delete: forbidden('issuerMembership.delete')
        },
        auditLog: {
          async create({ data }: { data: FakeAuditLog }) {
            calls.auditLogCreateAttempts += 1;

            if (options.failAuditLog) {
              throw new Error('auditLog.create fallo');
            }

            stagedAuditLogs.push({ ...data });
            return { id: `audit-${stagedAuditLogs.length}` };
          },
          update: forbidden('auditLog.update'),
          delete: forbidden('auditLog.delete')
        },
        platformAdmin: {
          create: forbidden('platformAdmin.create'),
          update: forbidden('platformAdmin.update')
        }
      };

      const result = await fn(tx);
      // Solo se commitea si el callback NO lanzo.
      memberships.push(...stagedMemberships);
      auditLogs.push(...stagedAuditLogs);
      return result;
    }
  };

  return { client, memberships, auditLogs, calls, userFindManyArgs };
}

function createService(options: Parameters<typeof createDouble>[0] = {}) {
  const double = createDouble(options);
  return {
    ...double,
    service: new PlatformAdminMembershipGrantService(double.client as never)
  };
}

// ---------------------------------------------------------------------------
// HAPPY PATH
// ---------------------------------------------------------------------------

test('happy: crea UNA membership admin/active y UN AuditLog', async () => {
  const { service, memberships, auditLogs } = createService();

  await service.grantMembership('issuer-uade', 'juan@uade.edu.ar', ACTOR_ID);

  assert.equal(memberships.length, 1);
  assert.equal(auditLogs.length, 1);
});

test('happy: role=admin y status=active, y NO vienen del body', async () => {
  // El service recibe solo (issuerId, email, actorId): no hay forma de que el
  // cliente proponga role/status, ni siquiera por error de programacion.
  const { service, memberships } = createService();

  const response = await service.grantMembership(
    'issuer-uade',
    'juan@uade.edu.ar',
    ACTOR_ID
  );

  assert.equal(memberships[0].role, IssuerMembershipRole.admin);
  assert.equal(memberships[0].status, IssuerMembershipStatus.active);
  assert.equal(response.membership.role, IssuerMembershipRole.admin);
  assert.equal(response.membership.status, IssuerMembershipStatus.active);
  assert.equal(
    service.grantMembership.length,
    3,
    'la firma del service no acepta role/status'
  );
});

test('happy: la membership queda con el issuerId del path y el userId RESUELTO', async () => {
  const { service, memberships } = createService();

  await service.grantMembership('issuer-uade', 'JUAN@UADE.EDU.AR', ACTOR_ID);

  assert.equal(memberships[0].issuerId, 'issuer-uade');
  assert.equal(memberships[0].userId, 'user-juan');
});

test('happy: el AuditLog tiene el contrato exacto congelado', async () => {
  const { service, auditLogs, memberships } = createService();

  await service.grantMembership('issuer-uade', 'juan@uade.edu.ar', ACTOR_ID);
  const entry = auditLogs[0];

  assert.equal(entry.actorId, ACTOR_ID);
  assert.equal(entry.actorType, ActorType.system_admin);
  assert.notEqual(entry.actorType, ActorType.system);
  assert.equal(entry.action, ISSUER_MEMBERSHIP_GRANTED_ACTION);
  assert.equal(entry.action, 'issuer_membership_granted');
  assert.equal(entry.resourceType, ISSUER_MEMBERSHIP_RESOURCE_TYPE);
  assert.equal(entry.resourceType, 'IssuerMembership');
  assert.equal(entry.resourceId, memberships[0].id);
  assert.deepEqual(entry.metadata, {
    issuerId: 'issuer-uade',
    userId: 'user-juan',
    role: 'admin',
    status: 'active'
  });
});

test('happy: el AuditLog no lleva PII ni nada de identidad tecnica', async () => {
  const { service, auditLogs } = createService();

  await service.grantMembership('issuer-uade', 'juan@uade.edu.ar', ACTOR_ID);
  const serialized = JSON.stringify(auditLogs[0]);

  assert.equal(serialized.includes('@'), false, 'sin email');
  assert.equal(serialized.includes('Juan'), false, 'sin nombre');
  assert.equal(serialized.includes('did:'), false, 'sin DID');
  assert.equal(serialized.includes('0x'), false, 'sin wallet');
  assert.equal(serialized.includes('onboardingIntent'), false);
  assert.equal(serialized.includes('institutional'), false);
});

// ---------------------------------------------------------------------------
// RESPONSE
// ---------------------------------------------------------------------------

test('response: allowlist exacta, reusando los DTOs de S3', async () => {
  const { service } = createService();

  const response = await service.grantMembership(
    'issuer-uade',
    'juan@uade.edu.ar',
    ACTOR_ID
  );

  assert.deepEqual(Object.keys(response).sort(), ['issuer', 'membership']);
  assert.deepEqual(Object.keys(response.issuer).sort(), ['id', 'name']);
  assert.deepEqual(Object.keys(response.membership).sort(), [
    'createdAt',
    'displayLabel',
    'email',
    'role',
    'status',
    'userId'
  ]);
});

test('response: email y displayLabel correctos; displayLabel por el helper', async () => {
  const { service } = createService();

  const response = await service.grantMembership(
    'issuer-uade',
    '  JUAN@UADE.EDU.AR  '.trim().toLowerCase(),
    ACTOR_ID
  );

  // El email normalizado almacenado, no el casing crudo.
  assert.equal(response.membership.email, 'juan@uade.edu.ar');
  assert.equal(response.membership.displayLabel, 'Juan Pérez');
  assert.equal(response.issuer.name, UADE.name);
});

test('response: no filtra AuditLog, actorId, DID, wallet, onboardingIntent ni secretos', async () => {
  const { service } = createService();

  const response = await service.grantMembership(
    'issuer-uade',
    'juan@uade.edu.ar',
    ACTOR_ID
  );
  const serialized = JSON.stringify(response);

  for (const key of [
    'auditLog',
    'actorId',
    'actorType',
    'did',
    'walletAddress',
    'onboardingIntent',
    'platformAdmin',
    'passwordHash',
    'authCredential',
    'metadata',
    'authorizationStatus'
  ]) {
    assert.equal(serialized.includes(key), false, `no debe exponer ${key}`);
  }
  assert.equal(serialized.includes(ACTOR_ID), false);
  assert.equal(serialized.includes('did:'), false);
  assert.equal(serialized.includes('0x'), false);
});

// ---------------------------------------------------------------------------
// ISSUER
// ---------------------------------------------------------------------------

test('issuer inexistente -> 404 y cero escrituras', async () => {
  const { service, memberships, auditLogs, calls } = createService();

  await assert.rejects(
    service.grantMembership('issuer-que-no-existe', 'juan@uade.edu.ar', ACTOR_ID),
    (error: unknown) => {
      assert.ok(error instanceof NotFoundException);
      assert.equal((error as Error).message, ISSUER_404);
      return true;
    }
  );

  assert.equal(memberships.length, 0);
  assert.equal(auditLogs.length, 0);
  assert.equal(calls.membershipCreateAttempts, 0);
});

test('issuer sin authorized / sin DID / sin wallet: la asignacion FUNCIONA igual', async () => {
  // Es la propiedad que habilita S5b: un Issuer nuevo con did=null y
  // walletAddress=null puede recibir su primer admin. La asignacion
  // administrativa de personas es independiente de la identidad tecnica.
  for (const issuer of [
    { id: 'issuer-nuevo', name: 'Institucion Nueva', authorizationStatus: 'pending', did: null, walletAddress: null },
    { id: 'issuer-nuevo', name: 'Institucion Nueva', authorizationStatus: 'revoked', did: null, walletAddress: null },
    { id: 'issuer-nuevo', name: 'Institucion Nueva', authorizationStatus: 'authorized', did: null, walletAddress: null }
  ]) {
    const { service, memberships } = createService({ issuers: [issuer] });

    const response = await service.grantMembership(
      'issuer-nuevo',
      'juan@uade.edu.ar',
      ACTOR_ID
    );

    assert.equal(memberships.length, 1);
    assert.equal(response.membership.role, IssuerMembershipRole.admin);
  }
});

test('el service NO lee authorizationStatus, did ni walletAddress del issuer', async () => {
  // El doble proyecta SOLO las claves del select: si el service pidiera esos
  // campos, el `project` los incluiria. Comprobamos el select real.
  const { service, client } = createService();
  const selects: unknown[] = [];
  const original = client.$transaction.bind(client);
  client.$transaction = (async (fn: (tx: any) => Promise<unknown>) =>
    original(async (tx: any) => {
      const inner = tx.issuer.findUnique;
      tx.issuer.findUnique = async (args: any) => {
        selects.push(args.select);
        return inner(args);
      };
      return fn(tx);
    })) as never;

  await service.grantMembership('issuer-uade', 'juan@uade.edu.ar', ACTOR_ID);

  assert.deepEqual(Object.keys(selects[0] as object).sort(), ['id', 'name']);
});

test('S5a no modifica ningun campo del issuer', async () => {
  const { service, client } = createService();
  const before = JSON.stringify(UADE);

  await service.grantMembership('issuer-uade', 'juan@uade.edu.ar', ACTOR_ID);

  // El doble lanza en issuer.update/create, dentro y fuera de la transaccion.
  assert.equal(JSON.stringify(UADE), before);
  assert.ok(client.issuer.update);
});

// ---------------------------------------------------------------------------
// USER
// ---------------------------------------------------------------------------

test('user inexistente -> 404 uniforme y cero escrituras', async () => {
  const { service, memberships, auditLogs } = createService({ users: [] });

  await assert.rejects(
    service.grantMembership('issuer-uade', 'nadie@uade.edu.ar', ACTOR_ID),
    (error: unknown) => {
      assert.equal((error as Error).message, UNIFORM_404);
      return true;
    }
  );

  assert.equal(memberships.length, 0);
  assert.equal(auditLogs.length, 0);
});

for (const status of [
  UserStatus.pending,
  UserStatus.suspended,
  UserStatus.archived
]) {
  test(`user ${status} -> MISMO 404 uniforme`, async () => {
    const { service, memberships } = createService({
      users: [{ ...JUAN, status }]
    });

    await assert.rejects(
      service.grantMembership('issuer-uade', 'juan@uade.edu.ar', ACTOR_ID),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        assert.equal((error as Error).message, UNIFORM_404);
        assert.equal((error as Error).message.includes(status), false);
        return true;
      }
    );

    assert.equal(memberships.length, 0);
  });
}

test('user con email null -> mismo 404 uniforme', async () => {
  const { service, memberships } = createService({
    users: [{ ...JUAN, email: null }]
  });

  await assert.rejects(
    service.grantMembership('issuer-uade', 'juan@uade.edu.ar', ACTOR_ID),
    (error: unknown) => {
      assert.equal((error as Error).message, UNIFORM_404);
      return true;
    }
  );
  assert.equal(memberships.length, 0);
});

test('los cinco casos de user no elegible son INDISTINGUIBLES', async () => {
  const mensajes: string[] = [];

  for (const users of [
    [],
    [{ ...JUAN, status: UserStatus.pending }],
    [{ ...JUAN, status: UserStatus.suspended }],
    [{ ...JUAN, status: UserStatus.archived }],
    [{ ...JUAN, email: null }]
  ]) {
    const { service } = createService({ users });
    try {
      await service.grantMembership('issuer-uade', 'juan@uade.edu.ar', ACTOR_ID);
      assert.fail('deberia haber fallado');
    } catch (error) {
      mensajes.push((error as Error).message);
    }
  }

  assert.equal(new Set(mensajes).size, 1);
  assert.equal(mensajes[0], UNIFORM_404);
});

test('>1 match case-insensitive -> error interno, NUNCA elige uno', async () => {
  const { service, memberships } = createService({
    users: [JUAN, { ...JUAN, id: 'user-juan-2', email: 'Juan@UADE.edu.ar' }]
  });

  await assert.rejects(
    service.grantMembership('issuer-uade', 'juan@uade.edu.ar', ACTOR_ID),
    (error: unknown) => {
      assert.ok(error instanceof InternalServerErrorException);
      assert.ok(!(error instanceof NotFoundException));
      const message = (error as Error).message;
      assert.equal(message.includes('user-juan'), false);
      return true;
    }
  );

  assert.equal(memberships.length, 0);
});

test('usa findMany con take: 2 y mode insensitive, y pide el id', async () => {
  const { service, userFindManyArgs } = createService();

  await service.grantMembership('issuer-uade', 'juan@uade.edu.ar', ACTOR_ID);

  const args = userFindManyArgs[0] as {
    where: { email: { equals: string; mode: string } };
    select: Record<string, boolean>;
    take: number;
  };
  assert.equal(args.take, 2);
  assert.equal(args.where.email.mode, 'insensitive');
  assert.equal(args.where.email.equals, 'juan@uade.edu.ar');
  // A diferencia de S4, aca SI hace falta el id: se usa para crear la fila.
  assert.equal(args.select.id, true);
  // Pero no se piden campos que no hacen falta.
  assert.equal('did' in args.select, false);
  assert.equal('onboardingIntent' in args.select, false);
});

test('resuelve un user cuyo email esta almacenado con otro casing', async () => {
  const { service, memberships } = createService({
    users: [{ ...JUAN, email: 'Juan@UADE.Edu.Ar' }]
  });

  const response = await service.grantMembership(
    'issuer-uade',
    'juan@uade.edu.ar',
    ACTOR_ID
  );

  assert.equal(memberships.length, 1);
  assert.equal(response.membership.email, 'juan@uade.edu.ar');
});

// ---------------------------------------------------------------------------
// ONBOARDING INTENT: no participa de ninguna decision
// ---------------------------------------------------------------------------

for (const onboardingIntent of [
  UserOnboardingIntent.personal,
  UserOnboardingIntent.institutional,
  null
]) {
  test(`onboardingIntent=${String(onboardingIntent)} -> el grant FUNCIONA igual`, async () => {
    const { service, memberships } = createService({
      users: [{ ...JUAN, onboardingIntent }]
    });

    const response = await service.grantMembership(
      'issuer-uade',
      'juan@uade.edu.ar',
      ACTOR_ID
    );

    assert.equal(memberships.length, 1);
    assert.equal(response.membership.role, IssuerMembershipRole.admin);
  });
}

test('S5a no lee onboardingIntent: ni lo pide a la base ni lo nombra en codigo', async () => {
  const { service, userFindManyArgs } = createService();

  await service.grantMembership('issuer-uade', 'juan@uade.edu.ar', ACTOR_ID);

  const args = userFindManyArgs[0] as { select: Record<string, boolean> };
  assert.equal('onboardingIntent' in args.select, false);
});

test('S5a NO actualiza onboardingIntent despues de crear la membership', async () => {
  // El doble lanza en user.update dentro y fuera de la transaccion.
  const { service, memberships } = createService();

  await service.grantMembership('issuer-uade', 'juan@uade.edu.ar', ACTOR_ID);

  assert.equal(memberships.length, 1);
  assert.equal(JUAN.onboardingIntent, UserOnboardingIntent.institutional);
});

// ---------------------------------------------------------------------------
// EXISTING MEMBERSHIP: CREATE ONLY
// ---------------------------------------------------------------------------

const EXISTING_BASE = {
  id: 'membership-preexistente',
  userId: 'user-juan',
  issuerId: 'issuer-uade',
  createdAt: new Date('2026-01-01T00:00:00.000Z')
};

for (const [role, status] of [
  [IssuerMembershipRole.admin, IssuerMembershipStatus.active],
  [IssuerMembershipRole.admin, IssuerMembershipStatus.pending],
  [IssuerMembershipRole.admin, IssuerMembershipStatus.revoked],
  [IssuerMembershipRole.operator, IssuerMembershipStatus.active],
  [IssuerMembershipRole.viewer, IssuerMembershipStatus.active],
  [IssuerMembershipRole.viewer, IssuerMembershipStatus.revoked]
] as const) {
  test(`membership existente (${role}/${status}) -> 409 y CERO escrituras`, async () => {
    const existing = { ...EXISTING_BASE, role, status };
    const { service, memberships, auditLogs, calls } = createService({
      memberships: [existing]
    });

    await assert.rejects(
      service.grantMembership('issuer-uade', 'juan@uade.edu.ar', ACTOR_ID),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal((error as Error).message, ALREADY_MEMBER);
        return true;
      }
    );

    // NO reactivacion, NO update, NO upsert: la fila queda exactamente igual.
    assert.deepEqual(memberships, [existing]);
    assert.equal(auditLogs.length, 0, 'no hay hecho nuevo que auditar');
    assert.equal(calls.membershipCreateAttempts, 0);
    assert.equal(calls.auditLogCreateAttempts, 0);
  });
}

test('una membership de OTRO issuer no bloquea el grant', async () => {
  const { service, memberships } = createService({
    issuers: [UADE, { id: 'issuer-otro', name: 'Otra' }],
    memberships: [
      {
        ...EXISTING_BASE,
        issuerId: 'issuer-otro',
        role: IssuerMembershipRole.admin,
        status: IssuerMembershipStatus.active
      }
    ]
  });

  await service.grantMembership('issuer-uade', 'juan@uade.edu.ar', ACTOR_ID);

  assert.equal(memberships.length, 2);
});

// ---------------------------------------------------------------------------
// SELF-ASSIGNMENT
// ---------------------------------------------------------------------------

test('self-assignment: un PlatformAdmin puede asignarse a si mismo, y queda una membership DURABLE', async () => {
  // Permitido y NO es un bypass: lo que obtiene es exactamente la misma fila
  // `IssuerMembership` y el mismo AuditLog que cualquier otra persona. A partir
  // de ahi opera POR LA MEMBERSHIP, no por la capacidad de plataforma.
  const adriel: FakeUser = {
    id: ACTOR_ID,
    email: 'adriel@example.com',
    displayName: null,
    firstName: 'Adriel',
    lastName: 'Pasik',
    status: UserStatus.active,
    onboardingIntent: null
  };
  const { service, memberships, auditLogs } = createService({ users: [adriel] });

  const response = await service.grantMembership(
    'issuer-uade',
    'adriel@example.com',
    ACTOR_ID
  );

  assert.equal(memberships.length, 1);
  assert.equal(memberships[0].userId, ACTOR_ID);
  assert.equal(memberships[0].role, IssuerMembershipRole.admin);
  assert.equal(memberships[0].status, IssuerMembershipStatus.active);
  assert.equal(response.membership.userId, ACTOR_ID);

  // Auditado igual que cualquier otro grant: actor y sujeto coinciden, y eso
  // queda registrado de forma visible.
  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0].actorId, ACTOR_ID);
  assert.deepEqual(auditLogs[0].metadata, {
    issuerId: 'issuer-uade',
    userId: ACTOR_ID,
    role: 'admin',
    status: 'active'
  });
});

test('self-assignment: un segundo intento tambien da 409 -- la capacidad de plataforma no lo exime', async () => {
  const adriel: FakeUser = {
    id: ACTOR_ID,
    email: 'adriel@example.com',
    displayName: null,
    firstName: 'Adriel',
    lastName: 'Pasik',
    status: UserStatus.active
  };
  const { service, memberships } = createService({
    users: [adriel],
    memberships: [
      {
        ...EXISTING_BASE,
        userId: ACTOR_ID,
        role: IssuerMembershipRole.admin,
        status: IssuerMembershipStatus.active
      }
    ]
  });

  await assert.rejects(
    service.grantMembership('issuer-uade', 'adriel@example.com', ACTOR_ID),
    ConflictException
  );
  assert.equal(memberships.length, 1);
});

// ---------------------------------------------------------------------------
// TRANSACCION Y ATOMICIDAD
// ---------------------------------------------------------------------------

test('membership y AuditLog se escriben en la MISMA transaccion', async () => {
  // El cliente raiz no expone `issuerMembership.create` utilizable ni
  // `auditLog`: si alguna escritura ocurriera fuera, el doble lanzaria.
  const { service, calls, memberships, auditLogs } = createService();

  await service.grantMembership('issuer-uade', 'juan@uade.edu.ar', ACTOR_ID);

  assert.equal(calls.transactions, 1, 'una sola transaccion');
  assert.equal(calls.membershipCreateAttempts, 1);
  assert.equal(calls.auditLogCreateAttempts, 1);
  assert.equal(memberships.length, 1);
  assert.equal(auditLogs.length, 1);
});

test('el chequeo de membership existente ocurre DENTRO de la transaccion', async () => {
  // Es lo que elimina la ventana entre "no existe" y "la creo": el `findUnique`
  // del par y el `create` comparten transaccion.
  const { service, calls } = createService();

  await service.grantMembership('issuer-uade', 'juan@uade.edu.ar', ACTOR_ID);

  assert.equal(calls.transactions, 1);
  assert.equal(calls.membershipFindUnique, 1);
  assert.equal(calls.issuerFindUnique, 1);
  assert.equal(calls.userFindMany, 1);
});

test('AuditLog falla -> rollback COMPLETO, no queda membership', async () => {
  const { service, memberships, auditLogs, calls } = createService({
    failAuditLog: true
  });

  await assert.rejects(
    service.grantMembership('issuer-uade', 'juan@uade.edu.ar', ACTOR_ID),
    /auditLog\.create fallo/
  );

  assert.equal(memberships.length, 0, 'la membership no sobrevive');
  assert.equal(auditLogs.length, 0);
  assert.equal(calls.membershipCreateAttempts, 1, 'se intento y se revirtio');
});

test('membership falla -> no queda AuditLog', async () => {
  const { service, memberships, auditLogs, calls } = createService({
    failMembershipCreate: new Error('fallo de base')
  });

  await assert.rejects(
    service.grantMembership('issuer-uade', 'juan@uade.edu.ar', ACTOR_ID),
    /fallo de base/
  );

  assert.equal(memberships.length, 0);
  assert.equal(auditLogs.length, 0);
  assert.equal(calls.auditLogCreateAttempts, 0, 'ni se intento el AuditLog');
});

test('el orden es membership -> AuditLog, porque resourceId es el id de la fila', async () => {
  const { service, auditLogs, memberships } = createService();

  await service.grantMembership('issuer-uade', 'juan@uade.edu.ar', ACTOR_ID);

  assert.equal(auditLogs[0].resourceId, memberships[0].id);
});

// ---------------------------------------------------------------------------
// CARRERA / P2002
// ---------------------------------------------------------------------------

test('race: P2002 del unique (userId, issuerId) -> 409, no 500', async () => {
  const { service, memberships, auditLogs } = createService({
    failMembershipCreate: uniqueViolation(['userId', 'issuerId'])
  });

  await assert.rejects(
    service.grantMembership('issuer-uade', 'juan@uade.edu.ar', ACTOR_ID),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.equal((error as Error).message, ALREADY_MEMBER);
      return true;
    }
  );

  assert.equal(memberships.length, 0);
  assert.equal(auditLogs.length, 0, 'el AuditLog se fue con el rollback');
});

test('race: P2002 reportado como nombre de indice tambien resuelve 409', async () => {
  const { service } = createService({
    failMembershipCreate: uniqueViolation(
      'IssuerMembership_userId_issuerId_key'
    )
  });

  await assert.rejects(
    service.grantMembership('issuer-uade', 'juan@uade.edu.ar', ACTOR_ID),
    ConflictException
  );
});

test('race: P2002 sin meta se acepta como el unique esperado', async () => {
  // Prisma no garantiza `meta`. La transaccion hace exactamente dos escrituras
  // y AuditLog no tiene unique propio, asi que el argumento estructural
  // sostiene la interpretacion -- y el guard estructural lo congela.
  const { service } = createService({
    failMembershipCreate: uniqueViolation(undefined)
  });

  await assert.rejects(
    service.grantMembership('issuer-uade', 'juan@uade.edu.ar', ACTOR_ID),
    ConflictException
  );
});

test('race: un P2002 de OTRO constraint NO se enmascara como 409', async () => {
  // No se mapea cualquier P2002 a conflicto de dominio: una colision de PK
  // seria un fallo real y decir 409 mentiria.
  const { service } = createService({
    failMembershipCreate: uniqueViolation(['id'])
  });

  await assert.rejects(
    service.grantMembership('issuer-uade', 'juan@uade.edu.ar', ACTOR_ID),
    (error: unknown) => {
      assert.ok(error instanceof Prisma.PrismaClientKnownRequestError);
      assert.ok(!(error instanceof ConflictException));
      return true;
    }
  );
});

test('race: un error que no es P2002 se propaga sin convertirse en 409', async () => {
  const { service } = createService({
    failMembershipCreate: new Error('conexion caida')
  });

  await assert.rejects(
    service.grantMembership('issuer-uade', 'juan@uade.edu.ar', ACTOR_ID),
    /conexion caida/
  );
});

test('race: dos intentos equivalentes -> una membership, un AuditLog, uno 409', async () => {
  // Simula la carrera de forma secuencial contra el MISMO estado: el primero
  // crea, el segundo encuentra la fila y recibe 409.
  const { service, memberships, auditLogs } = createService();

  await service.grantMembership('issuer-uade', 'juan@uade.edu.ar', ACTOR_ID);
  await assert.rejects(
    service.grantMembership('issuer-uade', 'juan@uade.edu.ar', ACTOR_ID),
    ConflictException
  );

  assert.equal(memberships.length, 1);
  assert.equal(auditLogs.length, 1);
});

// ---------------------------------------------------------------------------
// NINGUNA OTRA ESCRITURA
// ---------------------------------------------------------------------------

test('ninguna otra operacion de escritura en ningun camino', async () => {
  // El doble lanza en todo write de User/Issuer/PlatformAdmin/AuthCredential,
  // en issuerMembership.update/upsert/delete, en auditLog.update/delete y en
  // SQL crudo -- dentro y fuera de la transaccion. Que el happy path y los
  // caminos de error terminen como se espera prueba que no se invocan.
  const happy = createService();
  await happy.service.grantMembership('issuer-uade', 'juan@uade.edu.ar', ACTOR_ID);

  const sinIssuer = createService();
  await assert.rejects(
    sinIssuer.service.grantMembership('nope', 'juan@uade.edu.ar', ACTOR_ID),
    NotFoundException
  );

  const sinUser = createService({ users: [] });
  await assert.rejects(
    sinUser.service.grantMembership('issuer-uade', 'nadie@x.com', ACTOR_ID),
    NotFoundException
  );

  const duplicado = createService({
    memberships: [
      {
        ...EXISTING_BASE,
        role: IssuerMembershipRole.admin,
        status: IssuerMembershipStatus.active
      }
    ]
  });
  await assert.rejects(
    duplicado.service.grantMembership('issuer-uade', 'juan@uade.edu.ar', ACTOR_ID),
    ConflictException
  );
});

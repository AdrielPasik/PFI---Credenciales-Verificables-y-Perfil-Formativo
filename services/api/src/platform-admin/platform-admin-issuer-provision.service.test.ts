/**
 * Alta de un Issuer con su primer admin -- slice S5b.
 *
 * Lo que se defiende: `authorized` + `authorizedAt` SIEMPRE del servidor,
 * `did`/`walletAddress` nacen `null`, la membership inicial es siempre
 * `admin`/`active`, los DOS AuditLog tienen la forma exacta, la atomicidad de
 * las CUATRO filas es real (cualquier fallo deja CERO escrituras), y
 * `onboardingIntent` no participa de ninguna decision -- al punto de que no se
 * le pide a la base.
 *
 * EL DOBLE ES ESTRICTO CON LA FRONTERA TRANSACCIONAL, igual que el de S2 y S5a:
 * el cliente raiz no expone ninguna escritura, y lo que si expone lanza. Las
 * escrituras solo funcionan sobre el `tx`, que es un objeto DISTINTO. Una
 * escritura fuera de la transaccion explota en vez de pasar por casualidad.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import {
  ActorType,
  IssuerAuthorizationStatus,
  IssuerMembershipRole,
  IssuerMembershipStatus,
  UserOnboardingIntent,
  UserStatus
} from '@prisma/client';

import { PlatformAdminIssuerProvisionService } from './platform-admin-issuer-provision.service';
import {
  ISSUER_MEMBERSHIP_GRANTED_ACTION,
  ISSUER_MEMBERSHIP_RESOURCE_TYPE,
  ISSUER_PROVISIONED_ACTION,
  ISSUER_RESOURCE_TYPE
} from './platform-admin-audit.constants';

const UNIFORM_404 = 'No se encontro un usuario elegible con el email indicado.';

const ACTOR_ID = 'user-platform-admin';

const REQUEST = {
  name: 'Universidad X',
  legalName: 'Universidad X',
  initialAdminUserEmail: 'admin@universidadx.edu'
};

interface FakeUser {
  id: string;
  email: string | null;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  status: UserStatus;
  onboardingIntent?: UserOnboardingIntent | null;
  did?: string | null;
  passwordHash?: string;
}

interface FakeIssuer {
  id: string;
  name: string;
  legalName: string | null;
  authorizationStatus: IssuerAuthorizationStatus;
  authorizedAt: Date | null;
  revokedAt: Date | null;
  did: string | null;
  walletAddress: string | null;
  allowedCredentialTypes: string[];
  metadata: unknown;
  createdAt: Date;
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

const ADMIN_X: FakeUser = {
  id: 'user-admin-x',
  email: 'admin@universidadx.edu',
  displayName: null,
  firstName: 'Ana',
  lastName: 'Gómez',
  status: UserStatus.active,
  onboardingIntent: UserOnboardingIntent.institutional,
  did: 'did:web:api.example:did:users:user-admin-x',
  passwordHash: 'NUNCA-DEBE-SALIR'
};

function createDouble(
  options: {
    users?: FakeUser[];
    failIssuerCreate?: unknown;
    failMembershipCreate?: unknown;
    /** 1 = falla el issuer_provisioned, 2 = falla el issuer_membership_granted. */
    failAuditLogAt?: 1 | 2;
  } = {}
) {
  const users = options.users ?? [ADMIN_X];

  /** Lo que quedo COMMITEADO. Si la transaccion aborta, sigue vacio. */
  const issuers: FakeIssuer[] = [];
  const memberships: FakeMembership[] = [];
  const auditLogs: FakeAuditLog[] = [];

  const calls = {
    transactions: 0,
    userFindMany: 0,
    issuerCreateAttempts: 0,
    membershipCreateAttempts: 0,
    auditLogCreateAttempts: 0
  };
  const userFindManyArgs: Array<Record<string, unknown>> = [];
  const issuerCreateArgs: Array<Record<string, unknown>> = [];
  const membershipCreateArgs: Array<Record<string, unknown>> = [];

  const forbidden = (name: string) => async () => {
    throw new Error(`S5b no debe invocar ${name}`);
  };

  function project<T extends object>(row: T, select: Record<string, boolean>) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(select)) {
      out[key] = (row as unknown as Record<string, unknown>)[key];
    }
    return out;
  }

  const client = {
    // El cliente RAIZ no puede escribir NADA: todo pasa por el `tx`.
    issuer: {
      create: forbidden('issuer.create FUERA de la transaccion'),
      update: forbidden('issuer.update'),
      updateMany: forbidden('issuer.updateMany'),
      upsert: forbidden('issuer.upsert'),
      delete: forbidden('issuer.delete'),
      deleteMany: forbidden('issuer.deleteMany')
    },
    issuerMembership: {
      create: forbidden('issuerMembership.create FUERA de la transaccion'),
      update: forbidden('issuerMembership.update'),
      upsert: forbidden('issuerMembership.upsert'),
      delete: forbidden('issuerMembership.delete')
    },
    user: {
      create: forbidden('user.create'),
      update: forbidden('user.update'),
      updateMany: forbidden('user.updateMany'),
      delete: forbidden('user.delete')
    },
    platformAdmin: {
      create: forbidden('platformAdmin.create'),
      update: forbidden('platformAdmin.update'),
      delete: forbidden('platformAdmin.delete')
    },
    authCredential: { create: forbidden('authCredential.create') },
    academicCourse: { create: forbidden('academicCourse.create') },
    program: { create: forbidden('program.create') },
    issuerCourseTemplate: { create: forbidden('issuerCourseTemplate.create') },
    credential: { create: forbidden('credential.create') },
    auditLog: {
      create: forbidden('auditLog.create FUERA de la transaccion'),
      update: forbidden('auditLog.update'),
      delete: forbidden('auditLog.delete')
    },
    $queryRaw: forbidden('$queryRaw'),
    $executeRaw: forbidden('$executeRaw'),

    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      calls.transactions += 1;

      // Rollback real: staging que solo se commitea si el callback termina
      // bien. Es lo que hace que los tests de atomicidad signifiquen algo.
      const stagedIssuers: FakeIssuer[] = [];
      const stagedMemberships: FakeMembership[] = [];
      const stagedAuditLogs: FakeAuditLog[] = [];

      const tx = {
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
          update: forbidden('user.update'),
          delete: forbidden('user.delete')
        },
        issuer: {
          async create({
            data,
            select
          }: {
            data: Record<string, unknown>;
            select: Record<string, boolean>;
          }) {
            calls.issuerCreateAttempts += 1;
            issuerCreateArgs.push(data);

            if (options.failIssuerCreate !== undefined) {
              throw options.failIssuerCreate;
            }

            // Espejo de los defaults REALES del schema: lo que el service no
            // manda, queda en su default.
            const row: FakeIssuer = {
              id: `issuer-${issuers.length + stagedIssuers.length + 1}`,
              name: '',
              legalName: null,
              authorizationStatus: IssuerAuthorizationStatus.pending,
              authorizedAt: null,
              revokedAt: null,
              did: null,
              walletAddress: null,
              allowedCredentialTypes: [],
              metadata: null,
              createdAt: new Date('2026-10-04T12:00:00.000Z'),
              ...(data as Partial<FakeIssuer>)
            };
            stagedIssuers.push(row);
            return project(row, select);
          },
          update: forbidden('issuer.update'),
          upsert: forbidden('issuer.upsert'),
          delete: forbidden('issuer.delete'),
          findUnique: forbidden('issuer.findUnique'),
          findFirst: forbidden('issuer.findFirst -- no hay chequeo de nombre duplicado'),
          findMany: forbidden('issuer.findMany -- no hay chequeo de nombre duplicado')
        },
        issuerMembership: {
          async create({
            data,
            select
          }: {
            data: Omit<FakeMembership, 'id' | 'createdAt'>;
            select: Record<string, boolean>;
          }) {
            calls.membershipCreateAttempts += 1;
            membershipCreateArgs.push(data);

            if (options.failMembershipCreate !== undefined) {
              throw options.failMembershipCreate;
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
          delete: forbidden('issuerMembership.delete'),
          findUnique: forbidden(
            'issuerMembership.findUnique -- el issuer es nuevo, no puede haber membership previa'
          )
        },
        auditLog: {
          async create({ data }: { data: FakeAuditLog }) {
            calls.auditLogCreateAttempts += 1;

            if (options.failAuditLogAt === calls.auditLogCreateAttempts) {
              throw new Error(
                `auditLog.create #${calls.auditLogCreateAttempts} fallo`
              );
            }

            stagedAuditLogs.push({ ...data });
            return { id: `audit-${stagedAuditLogs.length}` };
          },
          update: forbidden('auditLog.update'),
          delete: forbidden('auditLog.delete')
        },
        platformAdmin: {
          create: forbidden('platformAdmin.create'),
          update: forbidden('platformAdmin.update'),
          findUnique: forbidden('platformAdmin.findUnique')
        },
        authCredential: { create: forbidden('authCredential.create') },
        academicCourse: { create: forbidden('academicCourse.create') },
        program: { create: forbidden('program.create') },
        issuerCourseTemplate: {
          create: forbidden('issuerCourseTemplate.create')
        },
        credential: { create: forbidden('credential.create') }
      };

      const result = await fn(tx);
      // Solo se commitea si el callback NO lanzo.
      issuers.push(...stagedIssuers);
      memberships.push(...stagedMemberships);
      auditLogs.push(...stagedAuditLogs);
      return result;
    }
  };

  return {
    client,
    issuers,
    memberships,
    auditLogs,
    calls,
    userFindManyArgs,
    issuerCreateArgs,
    membershipCreateArgs
  };
}

function createService(options: Parameters<typeof createDouble>[0] = {}) {
  const double = createDouble(options);
  return {
    ...double,
    service: new PlatformAdminIssuerProvisionService(double.client as never)
  };
}

// ---------------------------------------------------------------------------
// HAPPY PATH -- las cuatro filas
// ---------------------------------------------------------------------------

test('happy: crea 1 Issuer, 1 IssuerMembership y 2 AuditLogs', async () => {
  const { service, issuers, memberships, auditLogs, calls } = createService();

  await service.provisionIssuer(REQUEST, ACTOR_ID);

  assert.equal(issuers.length, 1);
  assert.equal(memberships.length, 1);
  assert.equal(auditLogs.length, 2);
  assert.equal(calls.transactions, 1);
});

test('happy: ninguna otra escritura -- ni User, ni AuthCredential, ni catalogo', async () => {
  // El doble lanza ante cualquier otra escritura, asi que basta con que el
  // happy path termine bien. Los contadores confirman el conteo exacto.
  const { service, calls } = createService();

  await service.provisionIssuer(REQUEST, ACTOR_ID);

  assert.deepEqual(calls, {
    transactions: 1,
    userFindMany: 1,
    issuerCreateAttempts: 1,
    membershipCreateAttempts: 1,
    auditLogCreateAttempts: 2
  });
});

// ---------------------------------------------------------------------------
// ISSUER CREATION
// ---------------------------------------------------------------------------

test('issuer: authorizationStatus = authorized y authorizedAt lo pone el SERVIDOR', async () => {
  const antes = Date.now();
  const { service, issuers, issuerCreateArgs } = createService();

  await service.provisionIssuer(REQUEST, ACTOR_ID);

  const despues = Date.now();

  assert.equal(
    issuers[0].authorizationStatus,
    IssuerAuthorizationStatus.authorized
  );
  assert.ok(issuers[0].authorizedAt instanceof Date);
  const authorizedAt = (issuers[0].authorizedAt as Date).getTime();
  assert.ok(
    authorizedAt >= antes && authorizedAt <= despues,
    'authorizedAt se genera en el servidor, en el momento del alta'
  );

  // Y vienen del `data` del create, no de un default del schema: el schema por
  // defecto deja `pending` + `null`.
  assert.equal(
    issuerCreateArgs[0].authorizationStatus,
    IssuerAuthorizationStatus.authorized
  );
  assert.ok(issuerCreateArgs[0].authorizedAt instanceof Date);
});

test('issuer: did = null y walletAddress = null -- nace SIN identidad tecnica', async () => {
  const { service, issuers, issuerCreateArgs } = createService();

  await service.provisionIssuer(REQUEST, ACTOR_ID);

  assert.equal(issuers[0].did, null);
  assert.equal(issuers[0].walletAddress, null);

  // El service no los menciona en el `data`: quedan en el default del schema.
  // Mas fuerte que mandarlos como `null` explicito -- no hay ninguna linea que
  // alguien pueda cambiar a un valor.
  assert.equal('did' in issuerCreateArgs[0], false);
  assert.equal('walletAddress' in issuerCreateArgs[0], false);
});

test('issuer: name y legalName son los del request, y NADA MAS se escribe', async () => {
  const { service, issuers, issuerCreateArgs } = createService();

  await service.provisionIssuer(REQUEST, ACTOR_ID);

  assert.equal(issuers[0].name, 'Universidad X');
  assert.equal(issuers[0].legalName, 'Universidad X');

  // La forma EXACTA del `data`: cuatro claves. Si alguien agregara `metadata`,
  // `did` o cualquier otra, este test lo muestra en el diff.
  assert.deepEqual(Object.keys(issuerCreateArgs[0]).sort(), [
    'authorizationStatus',
    'authorizedAt',
    'legalName',
    'name'
  ]);
});

test('issuer: metadata NO se escribe -- no hay ningun lector productivo de ese campo', async () => {
  const { service, issuers } = createService();

  await service.provisionIssuer(REQUEST, ACTOR_ID);

  assert.equal(issuers[0].metadata, null);
});

test('issuer: revokedAt queda null', async () => {
  const { service, issuers } = createService();

  await service.provisionIssuer(REQUEST, ACTOR_ID);

  assert.equal(issuers[0].revokedAt, null);
});

test('issuer: NO se consulta la base por nombre duplicado', async () => {
  // El doble lanza ante `issuer.findFirst`/`findMany`. El schema no tiene
  // unique sobre name/legalName, y S5b NO inventa una comprobacion
  // application-level: tendria race condition y asumiria que dos nombres
  // iguales son la misma entidad. Ver la nota al pie del service.
  const { service, issuers } = createService();

  await service.provisionIssuer(REQUEST, ACTOR_ID);
  await service.provisionIssuer(REQUEST, ACTOR_ID);

  // Dos altas con el MISMO nombre conviven, deliberadamente.
  assert.equal(issuers.length, 2);
  assert.notEqual(issuers[0].id, issuers[1].id);
  assert.equal(issuers[0].name, issuers[1].name);
});

// ---------------------------------------------------------------------------
// INITIAL MEMBERSHIP
// ---------------------------------------------------------------------------

test('membership: issuerId del issuer NUEVO, userId del User resuelto, admin + active', async () => {
  const { service, issuers, memberships, membershipCreateArgs } =
    createService();

  await service.provisionIssuer(REQUEST, ACTOR_ID);

  assert.equal(memberships[0].issuerId, issuers[0].id);
  assert.equal(memberships[0].userId, ADMIN_X.id);
  assert.equal(memberships[0].role, IssuerMembershipRole.admin);
  assert.equal(memberships[0].status, IssuerMembershipStatus.active);

  // La forma EXACTA del `data`: cuatro claves, todas server-owned salvo los dos
  // ids.
  assert.deepEqual(Object.keys(membershipCreateArgs[0]).sort(), [
    'issuerId',
    'role',
    'status',
    'userId'
  ]);
});

test('membership: role/status no pueden venir del request -- el service solo recibe tres strings', async () => {
  const { service, memberships } = createService();

  // `provisionIssuer(request, actorUserId)`: el request es el objeto de tres
  // campos que devuelve el validador. No hay forma de que role/status entren,
  // ni siquiera por error de programacion.
  assert.equal(service.provisionIssuer.length, 2);

  await service.provisionIssuer(REQUEST, ACTOR_ID);

  assert.equal(memberships[0].role, IssuerMembershipRole.admin);
  assert.equal(memberships[0].status, IssuerMembershipStatus.active);
});

test('membership: se CREA, nunca update ni upsert', async () => {
  // El doble lanza ante `issuerMembership.update`/`upsert`/`delete`, y tambien
  // ante `findUnique`: el issuer es nuevo, no puede haber membership previa
  // para ese par, asi que el pre-chequeo de S5a no tiene sentido aca.
  const { service, memberships } = createService();

  await service.provisionIssuer(REQUEST, ACTOR_ID);

  assert.equal(memberships.length, 1);
});

test('self-assignment: el PlatformAdmin puede ser su propio primer admin', async () => {
  const yo: FakeUser = { ...ADMIN_X, id: ACTOR_ID, email: 'adriel@example.com' };
  const { service, memberships, auditLogs } = createService({ users: [yo] });

  await service.provisionIssuer(
    { ...REQUEST, initialAdminUserEmail: 'adriel@example.com' },
    ACTOR_ID
  );

  // actor y sujeto coinciden, y el acceso institucional sigue viniendo de la
  // membership creada, no de la capacidad de plataforma.
  assert.equal(memberships[0].userId, ACTOR_ID);
  assert.equal(memberships[0].role, IssuerMembershipRole.admin);
  assert.equal(auditLogs[0].actorId, ACTOR_ID);
  assert.equal(
    (auditLogs[0].metadata as { initialAdminUserId: string })
      .initialAdminUserId,
    ACTOR_ID
  );
});

test('el PlatformAdmin que pone a OTRA persona queda SIN membership propia', async () => {
  // Propiedad central: provisionar no da acceso institucional al actor.
  const { service, memberships } = createService();

  await service.provisionIssuer(REQUEST, ACTOR_ID);

  assert.equal(memberships.length, 1);
  assert.equal(memberships[0].userId, ADMIN_X.id);
  assert.notEqual(memberships[0].userId, ACTOR_ID);
  assert.equal(
    memberships.some((row) => row.userId === ACTOR_ID),
    false,
    'el actor no se autoasigna por el solo hecho de provisionar'
  );
});

// ---------------------------------------------------------------------------
// USER RESOLUTION
// ---------------------------------------------------------------------------

test('resolucion: User active con email valido -> elegible', async () => {
  const { service, memberships } = createService();

  await service.provisionIssuer(REQUEST, ACTOR_ID);

  assert.equal(memberships[0].userId, ADMIN_X.id);
});

test('resolucion: email inexistente -> 404 uniforme, y CERO escrituras', async () => {
  const { service, issuers, memberships, auditLogs, calls } = createService();

  await assert.rejects(
    service.provisionIssuer(
      { ...REQUEST, initialAdminUserEmail: 'nadie@universidadx.edu' },
      ACTOR_ID
    ),
    (error: unknown) => {
      assert.ok(error instanceof NotFoundException);
      assert.match((error as Error).message, new RegExp(UNIFORM_404));
      return true;
    }
  );

  assert.deepEqual(issuers, []);
  assert.deepEqual(memberships, []);
  assert.deepEqual(auditLogs, []);
  // El Issuer ni se intenta: la resolucion va PRIMERO.
  assert.equal(calls.issuerCreateAttempts, 0);
});

test('resolucion: pending / suspended / archived / email null -> el MISMO 404', async () => {
  // No se filtra el estado interno de una cuenta ajena.
  for (const user of [
    { ...ADMIN_X, status: UserStatus.pending },
    { ...ADMIN_X, status: UserStatus.suspended },
    { ...ADMIN_X, status: UserStatus.archived },
    { ...ADMIN_X, email: null },
    { ...ADMIN_X, email: '   ' },
    { ...ADMIN_X, email: 'sin-arroba' }
  ]) {
    const { service, issuers, memberships, auditLogs } = createService({
      users: [user]
    });

    await assert.rejects(
      service.provisionIssuer(
        { ...REQUEST, initialAdminUserEmail: ADMIN_X.email as string },
        ACTOR_ID
      ),
      (error: unknown) => {
        assert.ok(
          error instanceof NotFoundException,
          `status=${user.status} email=${JSON.stringify(user.email)}`
        );
        assert.match((error as Error).message, new RegExp(UNIFORM_404));
        return true;
      }
    );

    assert.deepEqual(issuers, []);
    assert.deepEqual(memberships, []);
    assert.deepEqual(auditLogs, []);
  }
});

test('resolucion: mas de un match case-insensitive -> 500 generico, nunca se elige uno', async () => {
  const { service, issuers, memberships } = createService({
    users: [
      ADMIN_X,
      { ...ADMIN_X, id: 'user-duplicado', email: 'ADMIN@universidadx.edu' }
    ]
  });

  await assert.rejects(
    service.provisionIssuer(REQUEST, ACTOR_ID),
    InternalServerErrorException
  );

  assert.deepEqual(issuers, []);
  assert.deepEqual(memberships, []);
});

test('resolucion: usa mode insensitive y take 2', async () => {
  const { service, userFindManyArgs } = createService();

  await service.provisionIssuer(REQUEST, ACTOR_ID);

  const args = userFindManyArgs[0] as {
    where: { email: { equals: string; mode: string } };
    take: number;
  };
  assert.equal(args.where.email.mode, 'insensitive');
  assert.equal(args.where.email.equals, 'admin@universidadx.edu');
  assert.equal(args.take, 2);
});

test('resolucion: el select NO pide onboardingIntent, ni passwordHash, ni did', async () => {
  // Estructural, no por convencion: si el campo no se trae, no se puede usar
  // para decidir ni filtrar por accidente.
  const { service, userFindManyArgs } = createService();

  await service.provisionIssuer(REQUEST, ACTOR_ID);

  const select = (userFindManyArgs[0] as { select: Record<string, boolean> })
    .select;

  assert.deepEqual(Object.keys(select).sort(), [
    'displayName',
    'email',
    'firstName',
    'id',
    'lastName',
    'status'
  ]);
  assert.equal('onboardingIntent' in select, false);
  assert.equal('passwordHash' in select, false);
  assert.equal('did' in select, false);
});

test('resolucion: onboardingIntent personal / institutional / null -> TODOS elegibles', async () => {
  for (const onboardingIntent of [
    UserOnboardingIntent.personal,
    UserOnboardingIntent.institutional,
    null,
    undefined
  ]) {
    const { service, memberships, issuers } = createService({
      users: [{ ...ADMIN_X, onboardingIntent }]
    });

    await service.provisionIssuer(REQUEST, ACTOR_ID);

    assert.equal(
      memberships.length,
      1,
      `onboardingIntent=${String(onboardingIntent)} deberia ser elegible`
    );
    assert.equal(memberships[0].role, IssuerMembershipRole.admin);
    assert.equal(issuers.length, 1);
  }
});

test('resolucion: matchea un email almacenado que difiere solo en mayusculas', async () => {
  // `mode: 'insensitive'` es lo que lo encuentra -- el indice `@unique` de
  // `User.email` es case-SENSITIVE en PostgreSQL, asi que el dato almacenado
  // puede tener cualquier capitalizacion.
  const { service, memberships } = createService({
    users: [{ ...ADMIN_X, email: 'Admin@UniversidadX.EDU' }]
  });

  await service.provisionIssuer(REQUEST, ACTOR_ID);

  assert.equal(memberships[0].userId, ADMIN_X.id);
});

// ---------------------------------------------------------------------------
// AUDITLOG 1 -- ISSUER PROVISIONED
// ---------------------------------------------------------------------------

test('audit 1: issuer_provisioned con la forma EXACTA', async () => {
  const { service, issuers, auditLogs } = createService();

  await service.provisionIssuer(REQUEST, ACTOR_ID);

  assert.deepEqual(auditLogs[0], {
    actorId: ACTOR_ID,
    actorType: ActorType.system_admin,
    action: ISSUER_PROVISIONED_ACTION,
    resourceType: ISSUER_RESOURCE_TYPE,
    resourceId: issuers[0].id,
    metadata: {
      name: 'Universidad X',
      authorizationStatus: 'authorized',
      didConfigured: false,
      walletConfigured: false,
      initialAdminUserId: ADMIN_X.id
    }
  });

  assert.equal(auditLogs[0].action, 'issuer_provisioned');
  assert.equal(auditLogs[0].resourceType, 'Issuer');
});

test('audit 1: la metadata no lleva PII extra ni identidad tecnica', async () => {
  const { service, auditLogs } = createService();

  await service.provisionIssuer(REQUEST, ACTOR_ID);

  const metadata = auditLogs[0].metadata as Record<string, unknown>;

  assert.deepEqual(Object.keys(metadata).sort(), [
    'authorizationStatus',
    'didConfigured',
    'initialAdminUserId',
    'name',
    'walletConfigured'
  ]);
  for (const prohibida of [
    'email',
    'initialAdminUserEmail',
    'displayLabel',
    'firstName',
    'lastName',
    'did',
    'walletAddress',
    'onboardingIntent',
    'legalName',
    'passwordHash',
    'token'
  ]) {
    assert.equal(
      prohibida in metadata,
      false,
      `la metadata no debe llevar ${prohibida}`
    );
  }
});

// ---------------------------------------------------------------------------
// AUDITLOG 2 -- INITIAL MEMBERSHIP (contrato de S5a, sin variantes)
// ---------------------------------------------------------------------------

test('audit 2: issuer_membership_granted REUSA el contrato congelado de S5a', async () => {
  const { service, issuers, memberships, auditLogs } = createService();

  await service.provisionIssuer(REQUEST, ACTOR_ID);

  assert.deepEqual(auditLogs[1], {
    actorId: ACTOR_ID,
    actorType: ActorType.system_admin,
    action: ISSUER_MEMBERSHIP_GRANTED_ACTION,
    resourceType: ISSUER_MEMBERSHIP_RESOURCE_TYPE,
    resourceId: memberships[0].id,
    metadata: {
      issuerId: issuers[0].id,
      userId: ADMIN_X.id,
      role: 'admin',
      status: 'active'
    }
  });

  // NO una variante distinta por ser el primer admin: una consulta de
  // auditoria tiene que encontrar esta fila con la misma forma que las que
  // vengan despues por S5a.
  assert.equal(auditLogs[1].action, 'issuer_membership_granted');
  assert.equal(auditLogs[1].resourceType, 'IssuerMembership');
});

test('audits: exactamente DOS, y el actor sale del token en los dos', async () => {
  const { service, auditLogs } = createService();

  await service.provisionIssuer(REQUEST, 'actor-del-token');

  assert.equal(auditLogs.length, 2);
  for (const log of auditLogs) {
    assert.equal(log.actorId, 'actor-del-token');
    assert.equal(log.actorType, ActorType.system_admin);
  }
  // Dos entidades distintas: de ahi que sean dos filas y no una.
  assert.deepEqual(
    auditLogs.map((log) => log.resourceType),
    ['Issuer', 'IssuerMembership']
  );
});

// ---------------------------------------------------------------------------
// TRANSACCION Y ATOMICIDAD
// ---------------------------------------------------------------------------

test('transaccion: todo ocurre dentro de UNA sola $transaction', async () => {
  const { service, calls } = createService();

  await service.provisionIssuer(REQUEST, ACTOR_ID);

  assert.equal(calls.transactions, 1);
});

test('atomicidad 4: issuer.create falla -> NADA se escribe', async () => {
  const { service, issuers, memberships, auditLogs, calls } = createService({
    failIssuerCreate: new Error('issuer.create fallo')
  });

  await assert.rejects(service.provisionIssuer(REQUEST, ACTOR_ID), /issuer\.create fallo/);

  assert.deepEqual(issuers, []);
  assert.deepEqual(memberships, []);
  assert.deepEqual(auditLogs, []);
  assert.equal(calls.membershipCreateAttempts, 0);
  assert.equal(calls.auditLogCreateAttempts, 0);
});

test('atomicidad 3: membership.create falla -> el Issuer NO persiste', async () => {
  const { service, issuers, memberships, auditLogs, calls } = createService({
    failMembershipCreate: new Error('membership.create fallo')
  });

  await assert.rejects(
    service.provisionIssuer(REQUEST, ACTOR_ID),
    /membership\.create fallo/
  );

  // Se INTENTO crear el issuer...
  assert.equal(calls.issuerCreateAttempts, 1);
  // ...y sin embargo no quedo nada commiteado. Sin esto, un Issuer `authorized`
  // sin ningun admin quedaria huerfano y nadie podria operarlo ni borrarlo.
  assert.deepEqual(issuers, []);
  assert.deepEqual(memberships, []);
  assert.deepEqual(auditLogs, []);
  assert.equal(calls.auditLogCreateAttempts, 0);
});

test('atomicidad 1: el AuditLog issuer_provisioned falla -> rollback TOTAL', async () => {
  const { service, issuers, memberships, auditLogs, calls } = createService({
    failAuditLogAt: 1
  });

  await assert.rejects(
    service.provisionIssuer(REQUEST, ACTOR_ID),
    /auditLog\.create #1 fallo/
  );

  assert.equal(calls.issuerCreateAttempts, 1);
  assert.equal(calls.membershipCreateAttempts, 1);
  assert.deepEqual(issuers, []);
  assert.deepEqual(memberships, []);
  assert.deepEqual(auditLogs, []);
});

test('atomicidad 2: el AuditLog issuer_membership_granted falla -> rollback TOTAL', async () => {
  // El caso mas sutil: tres filas ya estaban staged. Si no se revirtieran,
  // habria un issuer provisionado con admin y con auditoria del alta, pero sin
  // registro de QUIEN recibio el acceso.
  const { service, issuers, memberships, auditLogs, calls } = createService({
    failAuditLogAt: 2
  });

  await assert.rejects(
    service.provisionIssuer(REQUEST, ACTOR_ID),
    /auditLog\.create #2 fallo/
  );

  assert.equal(calls.auditLogCreateAttempts, 2);
  assert.deepEqual(issuers, []);
  assert.deepEqual(memberships, []);
  assert.deepEqual(auditLogs, []);
});

test('atomicidad: no hay provisioning parcial en NINGUN punto de fallo', async () => {
  // Barrido de los cuatro puntos de fallo en una sola asercion de invariante:
  // o las cuatro filas, o ninguna.
  const escenarios: Array<[string, Parameters<typeof createDouble>[0]]> = [
    ['issuer.create', { failIssuerCreate: new Error('x') }],
    ['membership.create', { failMembershipCreate: new Error('x') }],
    ['audit 1', { failAuditLogAt: 1 }],
    ['audit 2', { failAuditLogAt: 2 }],
    ['resolucion', { users: [] }]
  ];

  for (const [nombre, options] of escenarios) {
    const { service, issuers, memberships, auditLogs } = createService(options);

    await assert.rejects(service.provisionIssuer(REQUEST, ACTOR_ID));

    const total = issuers.length + memberships.length + auditLogs.length;
    assert.equal(total, 0, `${nombre}: quedaron ${total} filas escritas`);
  }
});

// ---------------------------------------------------------------------------
// RESPONSE
// ---------------------------------------------------------------------------

test('response: allowlist EXACTA, dos claves raiz', async () => {
  const { service } = createService();

  const response = await service.provisionIssuer(REQUEST, ACTOR_ID);

  assert.deepEqual(Object.keys(response).sort(), [
    'initialAdminMembership',
    'issuer'
  ]);
  assert.deepEqual(Object.keys(response.issuer).sort(), [
    'authorizationStatus',
    'createdAt',
    'id',
    'legalName',
    'name',
    'technicalIdentity'
  ]);
  assert.deepEqual(Object.keys(response.initialAdminMembership).sort(), [
    'createdAt',
    'displayLabel',
    'email',
    'role',
    'status',
    'userId'
  ]);
  // S8c9 (decision D): tres booleanos legacy + tres preguntas aditivas.
  assert.deepEqual(Object.keys(response.issuer.technicalIdentity).sort(), [
    'administrativelyAuthorized',
    'configurationReady',
    'didConfigured',
    'hasCredentialCapabilities',
    'readyToIssue',
    'walletConfigured'
  ]);
});

test('response: issuer id/name/legalName correctos y authorizationStatus authorized', async () => {
  const { service, issuers } = createService();

  const response = await service.provisionIssuer(REQUEST, ACTOR_ID);

  assert.equal(response.issuer.id, issuers[0].id);
  assert.equal(response.issuer.name, 'Universidad X');
  assert.equal(response.issuer.legalName, 'Universidad X');
  assert.equal(response.issuer.authorizationStatus, 'authorized');
  assert.ok(response.issuer.createdAt instanceof Date);
});

test('response: didConfigured / walletConfigured / readyToIssue en false', async () => {
  // EL PUNTO IMPORTANTE: authorized operacionalmente NO es listo tecnicamente
  // para emitir.
  const { service } = createService();

  const response = await service.provisionIssuer(REQUEST, ACTOR_ID);

  assert.deepEqual(response.issuer.technicalIdentity, {
    didConfigured: false,
    walletConfigured: false,
    readyToIssue: false,
    administrativelyAuthorized: true,
    configurationReady: false,
    hasCredentialCapabilities: false
  });
});

test('response: la membership inicial es admin + active', async () => {
  const { service } = createService();

  const response = await service.provisionIssuer(REQUEST, ACTOR_ID);

  assert.equal(response.initialAdminMembership.role, 'admin');
  assert.equal(response.initialAdminMembership.status, 'active');
  assert.equal(response.initialAdminMembership.userId, ADMIN_X.id);
  assert.ok(response.initialAdminMembership.createdAt instanceof Date);
});

test('response: displayLabel sale de buildHolderDisplayLabel, sin regla propia', async () => {
  const { service } = createService();

  const response = await service.provisionIssuer(REQUEST, ACTOR_ID);

  // firstName + lastName, que es lo que el helper compone cuando no hay
  // displayName.
  assert.equal(response.initialAdminMembership.displayLabel, 'Ana Gómez');

  // Y con displayName presente, gana ese.
  const conDisplayName = createService({
    users: [{ ...ADMIN_X, displayName: 'Ana G. (Rectorado)' }]
  });
  const otra = await conDisplayName.service.provisionIssuer(REQUEST, ACTOR_ID);
  assert.equal(
    otra.initialAdminMembership.displayLabel,
    'Ana G. (Rectorado)'
  );
});

test('response: email es el almacenado normalizado, y el contrato sigue siendo nullable', async () => {
  const { service } = createService({
    users: [{ ...ADMIN_X, email: 'Admin@UniversidadX.EDU' }]
  });

  const response = await service.provisionIssuer(REQUEST, ACTOR_ID);

  // Se devuelve en minusculas: el service normaliza el ALMACENADO antes de
  // validarlo y de exponerlo.
  assert.equal(response.initialAdminMembership.email, 'admin@universidadx.edu');

  // El tipo del contrato compartido es `string | null` (congelado en S3 y
  // reafirmado en S5a); en este camino nunca es null porque la resolucion
  // exige un email valido, pero NO se introduce `null -> ""`.
  const email: string | null = response.initialAdminMembership.email;
  assert.equal(typeof email, 'string');
  assert.notEqual(email, '');
});

test('response: NO lleva AuditLog, actorId, el VALOR de did/wallet, metadata ni secretos', async () => {
  const { service } = createService();

  const response = await service.provisionIssuer(REQUEST, ACTOR_ID);
  const plano = JSON.stringify(response);

  for (const filtracion of [
    'auditLog',
    'audit',
    'actorId',
    ACTOR_ID,
    'metadata',
    'authorizedAt',
    'revokedAt',
    'onboardingIntent',
    'institutional',
    'passwordHash',
    'NUNCA-DEBE-SALIR',
    'did:web',
    'platformAdmin',
    'authCredential',
    'token'
  ]) {
    assert.equal(
      plano.includes(filtracion),
      false,
      `la respuesta no debe contener ${filtracion}`
    );
  }

  // Y los booleanos SI estan: lo que se expone es derivado, nunca el valor.
  assert.equal(response.issuer.technicalIdentity.didConfigured, false);
});

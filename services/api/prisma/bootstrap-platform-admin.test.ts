/**
 * Bootstrap del primer PlatformAdmin -- slice S2.
 *
 * Lo que se defiende:
 *   - el grant se otorga a un User que YA existe, y nada mas se escribe;
 *   - PlatformAdmin y AuditLog viven en la MISMA transaccion;
 *   - N ejecuciones dejan 1 PlatformAdmin y 1 AuditLog;
 *   - el unico writer de PlatformAdmin sigue estando fuera de `src/`.
 *
 * EL DOBLE ES ESTRICTO CON LA FRONTERA TRANSACCIONAL. El cliente raiz NO expone
 * `auditLog`, y su `platformAdmin.create` lanza. Las escrituras solo funcionan
 * sobre el `tx` que entrega `$transaction`, que es un objeto DISTINTO. Asi, una
 * escritura fuera de la transaccion no "pasa el test por casualidad": explota.
 * (El doble de `public-verification.fixture.ts` pasa el mismo objeto como `tx`,
 * lo que no permite distinguirlo; aca hace falta distinguirlo.)
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import test from 'node:test';

import { ActorType, Prisma, UserStatus } from '@prisma/client';

import {
  PLATFORM_ADMIN_GRANTED_ACTION,
  PLATFORM_ADMIN_RESOURCE_TYPE
} from '../src/platform-admin/platform-admin-audit.constants';
import {
  grantPlatformAdminByEmail,
  normalizeBootstrapEmail,
  parseBootstrapPlatformAdminArgs
} from './bootstrap-platform-admin';

// ---------------------------------------------------------------------------
// Doble
// ---------------------------------------------------------------------------

interface FakeUser {
  id: string;
  email: string | null;
  status: UserStatus;
}

interface FakeGrant {
  id: string;
  userId: string;
}

interface FakeAuditLog {
  actorId: string | null;
  actorType: ActorType;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: unknown;
}

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6.19.3'
  });
}

function createBootstrapDouble(options: {
  users?: FakeUser[];
  grants?: FakeGrant[];
  /** Hace fallar el AuditLog para comprobar el rollback del grant. */
  failAuditLog?: boolean;
  /**
   * Simula perder la carrera: el INSERT del grant levanta P2002 y, como en
   * PostgreSQL, el ganador ya esta persistido cuando eso ocurre.
   */
  loseRaceTo?: FakeGrant;
}) {
  const users = options.users ?? [];
  const grants: FakeGrant[] = [...(options.grants ?? [])];
  const auditLogs: FakeAuditLog[] = [];

  const calls = {
    userFindMany: 0,
    userCreate: 0,
    userUpdate: 0,
    userUpdateMany: 0,
    authCredentialCreate: 0,
    issuerCreate: 0,
    issuerMembershipCreate: 0,
    transactions: 0,
    grantCreateAttempts: 0,
    auditLogCreateAttempts: 0
  };

  function forbidden(name: string) {
    return async () => {
      throw new Error(`el bootstrap no debe invocar ${name}`);
    };
  }

  const rootPlatformAdmin = {
    async findUnique({ where }: { where: { userId: string } }) {
      const found = grants.find((grant) => grant.userId === where.userId);
      return found ? { id: found.id } : null;
    },
    async create() {
      throw new Error('escritura de PlatformAdmin FUERA de la transaccion');
    }
  };

  const client = {
    user: {
      async findMany({ where }: { where: { email: { equals: string } } }) {
        calls.userFindMany += 1;
        const target = where.email.equals.toLowerCase();
        return users
          .filter((user) => (user.email ?? '').toLowerCase() === target)
          .map((user) => ({ ...user }));
      },
      create: async () => {
        calls.userCreate += 1;
        throw new Error('el bootstrap no debe invocar user.create');
      },
      update: async () => {
        calls.userUpdate += 1;
        throw new Error('el bootstrap no debe invocar user.update');
      },
      updateMany: async () => {
        calls.userUpdateMany += 1;
        throw new Error('el bootstrap no debe invocar user.updateMany');
      }
    },
    platformAdmin: rootPlatformAdmin,
    authCredential: {
      create: async () => {
        calls.authCredentialCreate += 1;
        return forbidden('authCredential.create')();
      }
    },
    issuer: {
      create: async () => {
        calls.issuerCreate += 1;
        return forbidden('issuer.create')();
      }
    },
    issuerMembership: {
      create: async () => {
        calls.issuerMembershipCreate += 1;
        return forbidden('issuerMembership.create')();
      }
    },
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      calls.transactions += 1;

      // Rollback real: se trabaja sobre un staging y solo se commitea si el
      // callback termina bien.
      const stagedGrants: FakeGrant[] = [];
      const stagedAuditLogs: FakeAuditLog[] = [];

      const tx = {
        platformAdmin: {
          async create({ data }: { data: { userId: string } }) {
            calls.grantCreateAttempts += 1;

            if (options.loseRaceTo) {
              // El ganador quedo persistido antes de que nuestro INSERT
              // levantara la violacion.
              if (!grants.some((grant) => grant.id === options.loseRaceTo!.id)) {
                grants.push(options.loseRaceTo);
              }
              throw uniqueViolation();
            }

            if (
              grants.some((grant) => grant.userId === data.userId) ||
              stagedGrants.some((grant) => grant.userId === data.userId)
            ) {
              throw uniqueViolation();
            }

            const grant = {
              id: `platform-admin-${grants.length + stagedGrants.length + 1}`,
              userId: data.userId
            };
            stagedGrants.push(grant);
            return { id: grant.id };
          }
        },
        auditLog: {
          async create({ data }: { data: FakeAuditLog }) {
            calls.auditLogCreateAttempts += 1;

            if (options.failAuditLog) {
              throw new Error('auditLog.create fallo');
            }

            stagedAuditLogs.push({ ...data });
            return { id: `audit-${stagedAuditLogs.length}` };
          }
        }
      };

      try {
        const result = await fn(tx);
        grants.push(...stagedGrants);
        auditLogs.push(...stagedAuditLogs);
        return result;
      } catch (error) {
        // Se descarta el staging entero: ni grant ni AuditLog sobreviven.
        throw error;
      }
    }
  };

  return { client, grants, auditLogs, calls };
}

const ACTIVE_USER: FakeUser = {
  id: 'user-1',
  email: 'adriel@example.com',
  status: UserStatus.active
};

function assertNoDomainWrites(calls: { [key: string]: number }) {
  assert.equal(calls.userCreate, 0, 'nunca crea Users');
  assert.equal(calls.userUpdate, 0, 'nunca modifica el User');
  assert.equal(calls.userUpdateMany, 0, 'nunca modifica el User');
  assert.equal(calls.authCredentialCreate, 0, 'nunca crea AuthCredential');
  assert.equal(calls.issuerCreate, 0, 'nunca crea Issuers');
  assert.equal(calls.issuerMembershipCreate, 0, 'nunca crea IssuerMemberships');
}

// ---------------------------------------------------------------------------
// Parseo de argumentos
// ---------------------------------------------------------------------------

test('args: --email se lee y se recorta; --help cortocircuita', () => {
  assert.deepEqual(parseBootstrapPlatformAdminArgs(['--email', 'a@b.co']), {
    help: false,
    email: 'a@b.co'
  });
  assert.deepEqual(
    parseBootstrapPlatformAdminArgs(['--email', '  a@b.co  ']).email,
    'a@b.co'
  );
  assert.equal(parseBootstrapPlatformAdminArgs(['--help']).help, true);
  assert.equal(parseBootstrapPlatformAdminArgs([]).email, null);
});

test('args: un flag sin valor es un error, no un null silencioso', () => {
  assert.throws(
    () => parseBootstrapPlatformAdminArgs(['--email']),
    /Falta valor para el argumento --email/
  );
  assert.throws(
    () => parseBootstrapPlatformAdminArgs(['--email', '--help']),
    /Falta valor para el argumento --email/
  );
});

test('email: normaliza igual que el repo (trim + lowercase) y valida formato', () => {
  assert.equal(normalizeBootstrapEmail('  Adriel@Example.COM '), 'adriel@example.com');
  assert.throws(() => normalizeBootstrapEmail(undefined), /--email es requerido/);
  assert.throws(() => normalizeBootstrapEmail(''), /--email es requerido/);
  assert.throws(() => normalizeBootstrapEmail('   '), /--email es requerido/);
  assert.throws(() => normalizeBootstrapEmail('sin-arroba'), /formato valido/);
  assert.throws(() => normalizeBootstrapEmail('a@b'), /formato valido/);
});

// ---------------------------------------------------------------------------
// 1-3. Happy path
// ---------------------------------------------------------------------------

test('1: un User activo sin PlatformAdmin recibe exactamente 1 grant', async () => {
  const { client, grants, calls } = createBootstrapDouble({ users: [ACTIVE_USER] });

  const summary = await grantPlatformAdminByEmail(client as never, 'Adriel@Example.com');

  assert.equal(summary.status, 'created');
  assert.equal(summary.userId, ACTIVE_USER.id);
  assert.equal(summary.email, 'adriel@example.com');
  assert.equal(grants.length, 1);
  assert.deepEqual(grants[0].userId, ACTIVE_USER.id);
  assertNoDomainWrites(calls);
});

test('2: el happy path escribe exactamente 1 AuditLog', async () => {
  const { client, auditLogs } = createBootstrapDouble({ users: [ACTIVE_USER] });

  await grantPlatformAdminByEmail(client as never, ACTIVE_USER.email);

  assert.equal(auditLogs.length, 1);
});

test('3: el AuditLog tiene actor system sin actorId, la accion correcta y metadata sin email', async () => {
  const { client, auditLogs, grants } = createBootstrapDouble({
    users: [ACTIVE_USER]
  });

  await grantPlatformAdminByEmail(client as never, ACTIVE_USER.email);
  const entry = auditLogs[0];

  assert.equal(entry.actorId, null);
  assert.equal(entry.actorType, ActorType.system);
  assert.equal(entry.action, PLATFORM_ADMIN_GRANTED_ACTION);
  assert.equal(entry.action, 'platform_admin_granted');
  assert.equal(entry.resourceType, PLATFORM_ADMIN_RESOURCE_TYPE);
  assert.equal(entry.resourceType, 'PlatformAdmin');
  // resourceId apunta al GRANT recien creado, no al User.
  assert.equal(entry.resourceId, grants[0].id);
  assert.notEqual(entry.resourceId, ACTIVE_USER.id);

  assert.deepEqual(entry.metadata, { userId: ACTIVE_USER.id });
  // Nada de PII ni de secretos en la metadata.
  assert.equal(JSON.stringify(entry.metadata).includes('@'), false);
  assert.equal(JSON.stringify(entry).includes(ACTIVE_USER.email as string), false);
});

test('3b: actorType es `system`, nunca `system_admin`', async () => {
  // `system_admin` queda reservado para un PlatformAdmin humano actuando por
  // HTTP (S5a/S5b). En el bootstrap no hay actor humano en una request.
  const { client, auditLogs } = createBootstrapDouble({ users: [ACTIVE_USER] });

  await grantPlatformAdminByEmail(client as never, ACTIVE_USER.email);

  assert.notEqual(auditLogs[0].actorType, ActorType.system_admin);
});

// ---------------------------------------------------------------------------
// 4-5. Transaccion y rollback
// ---------------------------------------------------------------------------

test('4: PlatformAdmin y AuditLog se escriben dentro de la MISMA transaccion', async () => {
  // El cliente raiz no expone `auditLog` y su `platformAdmin.create` lanza:
  // si alguna de las dos escrituras ocurriera fuera, este test explotaria.
  const { client, calls, grants, auditLogs } = createBootstrapDouble({
    users: [ACTIVE_USER]
  });

  await grantPlatformAdminByEmail(client as never, ACTIVE_USER.email);

  assert.equal(calls.transactions, 1, 'una sola transaccion');
  assert.equal(calls.grantCreateAttempts, 1);
  assert.equal(calls.auditLogCreateAttempts, 1);
  assert.equal(grants.length, 1);
  assert.equal(auditLogs.length, 1);
});

test('5: si AuditLog falla, el PlatformAdmin hace rollback -- no queda grant', async () => {
  const { client, grants, auditLogs, calls } = createBootstrapDouble({
    users: [ACTIVE_USER],
    failAuditLog: true
  });

  await assert.rejects(
    grantPlatformAdminByEmail(client as never, ACTIVE_USER.email),
    /auditLog\.create fallo/
  );

  assert.equal(grants.length, 0, 'el grant no sobrevive al fallo del AuditLog');
  assert.equal(auditLogs.length, 0);
  assert.equal(calls.grantCreateAttempts, 1, 'el grant se intento y se revirtio');
  assertNoDomainWrites(calls);
});

// ---------------------------------------------------------------------------
// 6-7. User no elegible
// ---------------------------------------------------------------------------

test('6: User inexistente -> error explicito y 0 escrituras', async () => {
  const { client, grants, auditLogs, calls } = createBootstrapDouble({ users: [] });

  await assert.rejects(
    grantPlatformAdminByEmail(client as never, 'nadie@example.com'),
    /No existe ningun User con el email nadie@example\.com/
  );

  assert.equal(grants.length, 0);
  assert.equal(auditLogs.length, 0);
  assert.equal(calls.transactions, 0, 'ni siquiera se abre la transaccion');
  assertNoDomainWrites(calls);
});

for (const status of [
  UserStatus.pending,
  UserStatus.suspended,
  UserStatus.archived
]) {
  test(`7: User ${status} no es elegible -> error y 0 escrituras`, async () => {
    const { client, grants, auditLogs, calls } = createBootstrapDouble({
      users: [{ ...ACTIVE_USER, status }]
    });

    await assert.rejects(
      grantPlatformAdminByEmail(client as never, ACTIVE_USER.email),
      new RegExp(`esta en estado ${status} y no es elegible`)
    );

    assert.equal(grants.length, 0);
    assert.equal(auditLogs.length, 0);
    assert.equal(calls.transactions, 0);
    assertNoDomainWrites(calls);
  });
}

test('7b: User con email nulo no es elegible', async () => {
  // No es alcanzable por el lookup (filtra por email), pero el chequeo existe
  // igual: misma defensa que `normalizeStoredEmail` en resolveHolder.
  const { client, grants, calls } = createBootstrapDouble({
    users: [{ id: 'user-sin-email', email: '', status: UserStatus.active }]
  });

  await assert.rejects(
    grantPlatformAdminByEmail(client as never, 'adriel@example.com'),
    /No existe ningun User/
  );

  assert.equal(grants.length, 0);
  assert.equal(calls.transactions, 0);
});

test('7c: dos Users que difieren solo en mayusculas -> aborta sin escribir', async () => {
  // `User.email @unique` es case-SENSITIVE en PostgreSQL, asi que esto puede
  // existir. Otorgar la capacidad al primero que aparezca seria peor que
  // abortar.
  const { client, grants, calls } = createBootstrapDouble({
    users: [
      ACTIVE_USER,
      { id: 'user-2', email: 'Adriel@Example.com', status: UserStatus.active }
    ]
  });

  await assert.rejects(
    grantPlatformAdminByEmail(client as never, 'adriel@example.com'),
    /mas de un User con el email/
  );

  assert.equal(grants.length, 0);
  assert.equal(calls.transactions, 0);
});

// ---------------------------------------------------------------------------
// 8. Idempotencia
// ---------------------------------------------------------------------------

test('8: la segunda ejecucion devuelve already_exists sin escribir nada', async () => {
  const { client, grants, auditLogs, calls } = createBootstrapDouble({
    users: [ACTIVE_USER]
  });

  const first = await grantPlatformAdminByEmail(client as never, ACTIVE_USER.email);
  const second = await grantPlatformAdminByEmail(client as never, ACTIVE_USER.email);
  const third = await grantPlatformAdminByEmail(client as never, ACTIVE_USER.email);

  assert.equal(first.status, 'created');
  assert.equal(second.status, 'already_exists');
  assert.equal(third.status, 'already_exists');

  // N ejecuciones -> exactamente 1 grant y exactamente 1 AuditLog.
  assert.equal(grants.length, 1);
  assert.equal(auditLogs.length, 1);

  // Y la segunda/tercera no abren transaccion: el pre-check corta antes.
  assert.equal(calls.transactions, 1);
  assert.equal(calls.grantCreateAttempts, 1);
  assert.equal(calls.auditLogCreateAttempts, 1);

  // La fila no se modifica: mismo id en las tres respuestas.
  assert.equal(second.platformAdminId, first.platformAdminId);
  assert.equal(third.platformAdminId, first.platformAdminId);
  assertNoDomainWrites(calls);
});

test('8b: already_exists no reescribe grantedAt ni toca la fila', async () => {
  const { client, grants, auditLogs } = createBootstrapDouble({
    users: [ACTIVE_USER],
    grants: [{ id: 'grant-preexistente', userId: ACTIVE_USER.id }]
  });

  const summary = await grantPlatformAdminByEmail(client as never, ACTIVE_USER.email);

  assert.equal(summary.status, 'already_exists');
  assert.equal(summary.platformAdminId, 'grant-preexistente');
  assert.deepEqual(grants, [{ id: 'grant-preexistente', userId: ACTIVE_USER.id }]);
  assert.equal(auditLogs.length, 0, 'no hubo hecho nuevo que auditar');
});

// ---------------------------------------------------------------------------
// 12. Carrera / P2002
// ---------------------------------------------------------------------------

test('12: perder la carrera (P2002) termina en already_exists, sin AuditLog extra', async () => {
  const winner = { id: 'grant-del-ganador', userId: ACTIVE_USER.id };
  const { client, grants, auditLogs, calls } = createBootstrapDouble({
    users: [ACTIVE_USER],
    loseRaceTo: winner
  });

  const summary = await grantPlatformAdminByEmail(client as never, ACTIVE_USER.email);

  assert.equal(summary.status, 'already_exists');
  assert.equal(summary.platformAdminId, winner.id);

  // Exactamente 1 grant: el del ganador.
  assert.deepEqual(grants, [winner]);
  // Y CERO AuditLog de este proceso: el nuestro se fue con el rollback, y el
  // del ganador lo escribio su propia transaccion (no modelada por este doble).
  assert.equal(auditLogs.length, 0, 'nunca dos AuditLog de grant por una sola fila');
  assert.equal(calls.transactions, 1);
  assertNoDomainWrites(calls);
});

test('12b: un P2002 sin ganador persistido se propaga en vez de mentir', async () => {
  // Defensivo: si el unique salta pero no hay fila, el estado es inconsistente
  // y el script NO debe reportar already_exists.
  const racing = createBootstrapDouble({ users: [ACTIVE_USER] });
  racing.client.$transaction = (async () => {
    throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '6.19.3'
    });
  }) as never;

  await assert.rejects(
    grantPlatformAdminByEmail(racing.client as never, ACTIVE_USER.email),
    Prisma.PrismaClientKnownRequestError
  );
  assert.equal(racing.grants.length, 0);
});

test('12c: un error que no es P2002 se propaga sin convertirse en already_exists', async () => {
  const racing = createBootstrapDouble({ users: [ACTIVE_USER] });
  racing.client.$transaction = (async () => {
    throw new Error('conexion caida');
  }) as never;

  await assert.rejects(
    grantPlatformAdminByEmail(racing.client as never, ACTIVE_USER.email),
    /conexion caida/
  );
  assert.equal(racing.grants.length, 0);
  assert.equal(racing.auditLogs.length, 0);
});

// ---------------------------------------------------------------------------
// 11. La invariante de S1 sigue en pie
// ---------------------------------------------------------------------------

const API_ROOT = join(__dirname, '..');
const SRC = join(API_ROOT, 'src');

function sourceFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => entry.split('/').join(sep));
}

test('11: el unico writer de PlatformAdmin vive fuera de services/api/src', () => {
  // El guard de S1 (`src/platform-admin/__guards__/...`) ya exige 0 writers en
  // `src/` y NO se relaja. Aca se afirma el lado complementario: el writer
  // existe, y existe en `prisma/`.
  const bootstrap = readFileSync(
    join(API_ROOT, 'prisma', 'bootstrap-platform-admin.ts'),
    'utf8'
  );

  assert.match(bootstrap, /transaction\.platformAdmin\.create/);
  assert.match(bootstrap, /transaction\.auditLog\.create/);
});

test('11b: ningun archivo de src/ importa el bootstrap', () => {
  // Este es el agujero que el guard de S1 NO cubre: ese test busca llamadas a
  // `platformAdmin.<write>` dentro de `src/`, y un `src/foo.ts` que importara
  // `grantPlatformAdminByEmail` y lo llamara no coincidiria con ese patron,
  // pero pondria el writer en el grafo de dependencias de la superficie HTTP.
  const offenders = sourceFiles(SRC).filter((file) => {
    const code = readFileSync(join(SRC, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ');
    return /bootstrap-platform-admin/.test(code);
  });

  assert.deepEqual(offenders, []);
});

test('11c: el bootstrap no quedo enganchado a ningun seed ni al arranque de Nest', () => {
  // El grant tiene que exigir una accion operacional explicita.
  for (const file of [
    'seed.ts',
    'seed-demo-identities.ts',
    'seed-course-platform-user.ts'
  ]) {
    const code = readFileSync(join(API_ROOT, 'prisma', file), 'utf8');
    assert.doesNotMatch(
      code,
      /bootstrap-platform-admin|platformAdmin/,
      `${file} no debe conceder la capacidad`
    );
  }

  const appModule = readFileSync(join(SRC, 'app.module.ts'), 'utf8');
  assert.doesNotMatch(appModule, /bootstrap-platform-admin/);
});

test('11d: el bootstrap no escribe Users, AuthCredential, Issuer ni IssuerMembership', () => {
  // Guard estructural, complementario a los tests de comportamiento: ninguna de
  // esas escrituras debe aparecer en el codigo ejecutable del script.
  const code = readFileSync(
    join(API_ROOT, 'prisma', 'bootstrap-platform-admin.ts'),
    'utf8'
  )
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

  for (const forbidden of [
    /\buser\.create\b/,
    /\buser\.update\b/,
    /\buser\.updateMany\b/,
    /\bauthCredential\./,
    /\bissuer\.create\b/,
    /\bissuerMembership\./,
    /\$executeRaw/,
    /\$queryRaw/
  ]) {
    assert.doesNotMatch(code, forbidden);
  }
});

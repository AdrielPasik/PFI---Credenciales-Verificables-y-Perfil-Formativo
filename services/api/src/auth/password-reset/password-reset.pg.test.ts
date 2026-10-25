/**
 * Recuperacion de contrasena contra PostgreSQL REAL (16.6).
 *
 * ESTE es el test que valida las garantias transaccionales. Los de `concurrency`
 * demuestran que el codigo toma el lock y condiciona sus UPDATE; solo aca se prueba
 * que PostgreSQL los cumple de verdad: el advisory lock serializa, el segundo UPDATE
 * condicional espera el bloqueo de fila y afecta 0 filas, y un fallo revierte todo.
 *
 * OBLIGATORIO antes de habilitar la recuperacion en produccion.
 *
 * COMO EJECUTARLO (PowerShell, con Docker; cualquier PostgreSQL 16 local sirve):
 *
 *   docker run --rm -d --name scope-pg-test -e POSTGRES_PASSWORD=test `
 *     -e POSTGRES_DB=scope_recovery_test -p 55432:5432 postgres:16
 *
 *   $env:DATABASE_URL = "postgresql://postgres:test@127.0.0.1:55432/scope_recovery_test"
 *   npx prisma migrate deploy --schema prisma/schema.prisma      # desde services/api
 *
 *   $env:TEST_DATABASE_URL = $env:DATABASE_URL
 *   npm run test:password-recovery-pg --workspace services/api
 *
 *   docker stop scope-pg-test
 *
 * SALVAGUARDA. Sin `TEST_DATABASE_URL` el test se OMITE (cuenta como "skipped", no
 * como "pass"), salvo que se invoque con `npm run test:password-recovery-pg`, donde
 * su ausencia es un FALLO: nadie puede creer que se verifico algo que no corrio.
 * Con URL, se niega a correr salvo que el host sea local Y el nombre de la base
 * contenga "test". No hay ninguna variable que levante esa restriccion, y escribe
 * usuarios y tokens: jamas RDS ni una base con datos reales.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';

import { PrismaClient } from '@prisma/client';

import { LogMailTransport } from '../../mail/log-mail-transport';
import { hashPassword, verifyPasswordHash } from '../password-hashing';
import { BackgroundTaskRunner } from './background-task-runner';
import { GLOBAL_QUOTA_MAX, PASSWORD_RESET_ISSUE_LOCK_KEY } from './password-reset.limits';
import { PasswordResetService } from './password-reset.service';
import { hashPasswordResetToken } from './password-reset-token';
import {
  LINK_PATTERN,
  NEW_PASSWORD,
  OLD_PASSWORD,
  codeOf,
  configureRecoveryEnv,
  installLogCapture
} from './__fixtures__/recovery-harness';

configureRecoveryEnv();
installLogCapture();

const URL_UNDER_TEST = process.env.TEST_DATABASE_URL?.trim();
const REQUIRED = process.env.npm_lifecycle_event === 'test:password-recovery-pg';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const skipReason = URL_UNDER_TEST
  ? false
  : 'TEST_DATABASE_URL no esta definida: las garantias de PostgreSQL NO se verificaron. Ver el encabezado del archivo para ejecutarlo.';

if (!URL_UNDER_TEST && REQUIRED) {
  throw new Error(
    'test:password-recovery-pg requiere TEST_DATABASE_URL (PostgreSQL local de pruebas). Ver el encabezado de password-reset.pg.test.ts.'
  );
}

function assertSafeTarget(raw: string): void {
  const url = new URL(raw);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));

  if (!LOCAL_HOSTS.has(url.hostname) || !/test/i.test(database)) {
    throw new Error(
      'TEST_DATABASE_URL rechazada: este test escribe datos y solo corre contra una base LOCAL cuyo nombre contenga "test". No existe ninguna variable que levante esta restriccion.'
    );
  }
}

if (URL_UNDER_TEST) {
  assertSafeTarget(URL_UNDER_TEST);
}

// ---------------------------------------------------------------------------
// Infraestructura de la prueba
// ---------------------------------------------------------------------------

const prisma = URL_UNDER_TEST ? new PrismaClient({ datasourceUrl: URL_UNDER_TEST }) : undefined!;
const createdUserIds: string[] = [];

after(async () => {
  if (!URL_UNDER_TEST) return;
  // ON DELETE CASCADE: borrar el usuario borra su credencial y sus tokens.
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

function build(client: unknown = prisma) {
  const tasks = new BackgroundTaskRunner();
  const transport = new LogMailTransport({ write: () => undefined });
  const service = new PasswordResetService(client as never, transport, tasks);
  const tokenOf = (index = -1) => {
    const message = transport.outbox.at(index);
    assert.ok(message, 'no hay correo');
    return LINK_PATTERN.exec(message.text)![1];
  };
  return { service, tasks, transport, tokenOf };
}

async function createUser(password = OLD_PASSWORD) {
  const user = await prisma.user.create({
    data: { email: `pgtest-${randomUUID()}@example.test`, firstName: 'Ada', lastName: 'Lovelace' },
    select: { id: true, email: true }
  });
  createdUserIds.push(user.id);
  await prisma.authCredential.create({
    data: { userId: user.id, passwordHash: await hashPassword(password) }
  });
  return { id: user.id, email: user.email as string };
}

const credentialOf = (userId: string) =>
  prisma.authCredential.findUniqueOrThrow({ where: { userId } });
const tokensOf = (userId: string) =>
  prisma.passwordResetToken.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
const live = <T extends { consumedAt: Date | null; invalidatedAt: Date | null; expiresAt: Date }>(
  rows: T[]
): T[] => rows.filter((r) => !r.consumedAt && !r.invalidatedAt && r.expiresAt.getTime() > Date.now());
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Envuelve el cliente para inyectar un fallo en una sentencia dentro de la transaccion. */
function failing(delegate: string, method: string, error: Error, onlyFirst = true) {
  let armed = true;
  return new Proxy(prisma, {
    get(target, property, receiver) {
      if (property !== '$transaction') return Reflect.get(target, property, receiver);
      return (callback: (tx: unknown) => Promise<unknown>, options?: unknown) =>
        (target.$transaction as (cb: unknown, o?: unknown) => Promise<unknown>)(
          (tx: Record<string, unknown>) =>
            callback(
              new Proxy(tx, {
                get(inner, name, innerReceiver) {
                  if (name !== delegate) return Reflect.get(inner, name, innerReceiver);
                  return new Proxy(inner[delegate] as object, {
                    get(model, fn, modelReceiver) {
                      if (fn === method && armed) {
                        if (onlyFirst) armed = false;
                        return async () => {
                          throw error;
                        };
                      }
                      return Reflect.get(model, fn, modelReceiver);
                    }
                  });
                }
              })
            ),
          options
        );
    }
  });
}

// ---------------------------------------------------------------------------
// Sanidad del entorno
// ---------------------------------------------------------------------------

test('the test database is migrated and is PostgreSQL 16', { skip: skipReason }, async () => {
  const [{ version }] = await prisma.$queryRaw<Array<{ version: string }>>`SELECT version()`;
  assert.match(version, /PostgreSQL 1[6-9]/);

  await assert.doesNotReject(
    prisma.passwordResetToken.count(),
    'falta la tabla: corre `npx prisma migrate deploy` contra esta base'
  );
  const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'AuthCredential' AND column_name = 'sessionVersion'`;
  assert.equal(columns.length, 1);
});

test('the advisory lock statement the service issues is valid SQL on this server', { skip: skipReason }, async () => {
  await assert.doesNotReject(
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PASSWORD_RESET_ISSUE_LOCK_KEY}::bigint)`;
    })
  );
});

// ---------------------------------------------------------------------------
// Emision: dos solicitudes simultaneas
// ---------------------------------------------------------------------------

test('CONTROL: without a lock, two concurrent read-then-insert transactions DO leave two live tokens', { skip: skipReason }, async () => {
  const user = await createUser();
  let reads = 0;
  const bothRead = new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      if (reads === 2) {
        clearInterval(interval);
        resolve();
      }
    }, 5);
  });

  // Dos transacciones que hacen exactamente "si no hay vigente, inserto".
  const naive = async (suffix: string) =>
    prisma.$transaction(async (tx) => {
      const existing = await tx.passwordResetToken.count({
        where: { userId: user.id, consumedAt: null, invalidatedAt: null }
      });
      reads += 1;
      await bothRead;
      if (existing === 0) {
        await tx.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: hashPasswordResetToken(`control-${suffix}-${randomUUID()}`),
            expiresAt: new Date(Date.now() + 60_000)
          }
        });
      }
    });

  await Promise.all([naive('a'), naive('b')]);

  assert.equal(
    live(await tokensOf(user.id)).length,
    2,
    'en READ COMMITTED las dos leyeron "ninguno" e insertaron: el lock es NECESARIO'
  );
});

test('two simultaneous requests for one account leave exactly ONE live token', { skip: skipReason }, async () => {
  const user = await createUser();
  const { service, tasks, transport } = build();

  service.requestReset({ email: user.email });
  service.requestReset({ email: user.email });
  await tasks.idle();

  const rows = await tokensOf(user.id);
  assert.equal(rows.length, 1);
  assert.equal(live(rows).length, 1);
  assert.equal(transport.outbox.length, 1);
});

test('eight simultaneous requests for one account still leave exactly ONE live token', { skip: skipReason }, async () => {
  const user = await createUser();
  const { service, tasks, transport } = build();

  for (let index = 0; index < 8; index += 1) service.requestReset({ email: user.email });
  await tasks.idle();

  assert.equal((await tokensOf(user.id)).length, 1);
  assert.equal(live(await tokensOf(user.id)).length, 1);
  assert.equal(transport.outbox.length, 1);
});

// ---------------------------------------------------------------------------
// Un solo enlace vigente: la solicitud nueva invalida el anterior
// ---------------------------------------------------------------------------

/** Un enlace vivo emitido hace 5 minutos: fuera del cooldown de 60 s. */
async function seedOlderLiveToken(userId: string) {
  return prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashPasswordResetToken(`older-${randomUUID()}`),
      createdAt: new Date(Date.now() - 5 * 60 * 1000),
      expiresAt: new Date(Date.now() + 25 * 60 * 1000)
    }
  });
}

test('a new request invalidates the previous live link in the real database', { skip: skipReason }, async () => {
  const user = await createUser();
  const older = await seedOlderLiveToken(user.id);
  const { service, tasks } = build();

  service.requestReset({ email: user.email });
  await tasks.idle();

  const rows = await tokensOf(user.id);
  assert.equal(rows.length, 2);
  assert.notEqual(rows.find((row) => row.id === older.id)!.invalidatedAt, null, 'el anterior quedo invalidado');
  assert.equal(live(rows).length, 1, 'y queda exactamente uno vigente');
  assert.notEqual(live(rows)[0].id, older.id);
});

test('simultaneous requests with an older live link leave exactly one live token and invalidate the old one', { skip: skipReason }, async () => {
  const user = await createUser();
  const older = await seedOlderLiveToken(user.id);
  const { service, tasks, transport } = build();

  for (let index = 0; index < 6; index += 1) service.requestReset({ email: user.email });
  await tasks.idle();

  const rows = await tokensOf(user.id);
  assert.equal(rows.length, 2, 'el anterior y UNO nuevo; las otras 5 vieron al nuevo y se descartaron');
  assert.notEqual(rows.find((row) => row.id === older.id)!.invalidatedAt, null);
  assert.equal(live(rows).length, 1);
  assert.equal(transport.outbox.length, 1);
});

// ---------------------------------------------------------------------------
// Confirmacion: consumo unico
// ---------------------------------------------------------------------------

async function requested(user: { id: string; email: string }) {
  const harness = build();
  harness.service.requestReset({ email: user.email });
  await harness.tasks.idle();
  return { ...harness, token: harness.tokenOf() };
}

test('CONTROL: PostgreSQL row locking — a second conditional UPDATE waits, re-evaluates, and affects 0 rows', { skip: skipReason }, async () => {
  const user = await createUser();
  const { token } = await requested(user);
  const where = { tokenHash: hashPasswordResetToken(token), consumedAt: null, invalidatedAt: null };

  const startedAt = Date.now();
  let secondElapsed = 0;

  const first = prisma.$transaction(async (tx) => {
    const result = await tx.passwordResetToken.updateMany({ where, data: { consumedAt: new Date() } });
    await sleep(400); // retiene el bloqueo de fila antes de confirmar
    return result.count;
  });
  await sleep(80);
  const second = prisma.$transaction(async (tx) => {
    const result = await tx.passwordResetToken.updateMany({ where, data: { consumedAt: new Date() } });
    secondElapsed = Date.now() - startedAt;
    return result.count;
  });

  const [a, b] = await Promise.all([first, second]);

  assert.deepEqual([a, b], [1, 0], 'exactamente un UPDATE gano');
  assert.ok(secondElapsed >= 350, `el segundo ESPERO el bloqueo de fila (${secondElapsed} ms)`);
});

test('two simultaneous confirmations of one token: exactly one succeeds, one change, one sessionVersion bump', { skip: skipReason }, async () => {
  const user = await createUser();
  const { service, token } = await requested(user);

  const results = await Promise.allSettled([
    service.confirmReset({ token, password: 'PgWinnerNumberOne1' }),
    service.confirmReset({ token, password: 'PgWinnerNumberTwo2' })
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(codeOf(rejected[0].reason), 'PASSWORD_RESET_TOKEN_INVALID');

  const credential = await credentialOf(user.id);
  assert.equal(credential.sessionVersion, 1, 'un unico incremento efectivo');
  const winner = results.findIndex((r) => r.status === 'fulfilled');
  assert.ok(await verifyPasswordHash(['PgWinnerNumberOne1', 'PgWinnerNumberTwo2'][winner], credential.passwordHash));
  assert.equal(await verifyPasswordHash(OLD_PASSWORD, credential.passwordHash), false);

  const [row] = await tokensOf(user.id);
  assert.notEqual(row.consumedAt, null);
  assert.equal(row.invalidatedAt, null);
});

test('six simultaneous confirmations of one token: still exactly one change', { skip: skipReason }, async () => {
  const user = await createUser();
  const { service, token } = await requested(user);

  const results = await Promise.allSettled(
    Array.from({ length: 6 }, (_, index) =>
      service.confirmReset({ token, password: `PgParallelPassword${index}` })
    )
  );

  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await credentialOf(user.id)).sessionVersion, 1);
});

test('confirm changes the password, bumps the version once and kills every other live token', { skip: skipReason }, async () => {
  const user = await createUser();
  const other = await createUser('OtherUserPass123');
  const { service, token } = await requested(user);
  await requested(other);
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashPasswordResetToken(`stray-${randomUUID()}`),
      expiresAt: new Date(Date.now() + 600_000)
    }
  });

  await service.confirmReset({ token, password: NEW_PASSWORD });

  assert.equal(live(await tokensOf(user.id)).length, 0);
  assert.equal(live(await tokensOf(other.id)).length, 1, 'otra cuenta intacta');
  assert.equal((await credentialOf(other.id)).sessionVersion, 0);
  assert.ok(await verifyPasswordHash(NEW_PASSWORD, (await credentialOf(user.id)).passwordHash));
});

// ---------------------------------------------------------------------------
// Integridad ante fallos
// ---------------------------------------------------------------------------

test('a failure AFTER the consume rolls everything back in the real database', { skip: skipReason }, async () => {
  const user = await createUser();
  const { token } = await requested(user);
  const before = await credentialOf(user.id);
  const broken = build(failing('authCredential', 'updateMany', new Error('injected failure')));

  await assert.rejects(
    broken.service.confirmReset({ token, password: NEW_PASSWORD }),
    /injected failure/
  );

  const after = await credentialOf(user.id);
  const [row] = await tokensOf(user.id);
  assert.equal(row.consumedAt, null, 'el UPDATE de consumo YA ejecutado se revirtio');
  assert.equal(after.passwordHash, before.passwordHash);
  assert.equal(after.sessionVersion, 0);

  // Y como no se consumio, el enlace sigue sirviendo.
  const retry = build();
  assert.deepEqual(await retry.service.confirmReset({ token, password: NEW_PASSWORD }), {
    status: 'password_reset'
  });
});

test('a reservation that fails mid-flight releases the advisory lock and leaves no trace', { skip: skipReason }, async () => {
  const first = await createUser();
  const second = await createUser();
  const broken = build(failing('passwordResetToken', 'create', new Error('insert failed')));
  const healthy = build();

  broken.service.requestReset({ email: first.email });
  healthy.service.requestReset({ email: second.email });
  await Promise.all([broken.tasks.idle(), healthy.tasks.idle()]);

  assert.equal((await tokensOf(first.id)).length, 0, 'la reserva fallida no dejo filas');
  assert.equal(live(await tokensOf(second.id)).length, 1, 'la otra no quedo bloqueada');
});

// ---------------------------------------------------------------------------
// Cupo global
// ---------------------------------------------------------------------------

test('concurrent requests from different accounts never exceed the global cap', { skip: skipReason }, async () => {
  const filler = await createUser();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const baseline = await prisma.passwordResetToken.count({ where: { createdAt: { gt: since } } });
  const freeSlots = 5;
  const toInsert = GLOBAL_QUOTA_MAX - freeSlots - baseline;
  assert.ok(toInsert >= 0, 'la base de pruebas ya tiene demasiados tokens recientes: usa una base limpia');
  await prisma.passwordResetToken.createMany({
    data: Array.from({ length: toInsert }, (_, index) => ({
      userId: filler.id,
      tokenHash: hashPasswordResetToken(`filler-${randomUUID()}-${index}`),
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 30 * 60 * 1000)
    }))
  });

  const accounts = await Promise.all(Array.from({ length: 12 }, () => createUser()));
  const harness = build();
  for (const account of accounts) harness.service.requestReset({ email: account.email });
  await harness.tasks.idle();

  const total = await prisma.passwordResetToken.count({ where: { createdAt: { gt: since } } });
  assert.equal(total, GLOBAL_QUOTA_MAX, 'exactamente el tope, ni uno mas');
  assert.equal(harness.transport.outbox.length, freeSlots);

  // Limpieza: estas filas cuentan para el cupo de las pruebas siguientes.
  await prisma.passwordResetToken.deleteMany({ where: { userId: filler.id } });
});

// ---------------------------------------------------------------------------
// Alcance del lock
// ---------------------------------------------------------------------------

test('the issuance lock is GLOBAL (a held lock delays another account) but never blocks plain reads', { skip: skipReason }, async () => {
  const holder = await createUser();
  const other = await createUser();
  const { service: reader, tasks: readerTasks, token: readableToken } = await requested(holder);
  void readerTasks;

  const holding = prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PASSWORD_RESET_ISSUE_LOCK_KEY}::bigint)`;
    await sleep(500);
  });
  await sleep(100);

  // Una lectura comun (verify) NO espera al lock.
  const readStartedAt = Date.now();
  await reader.verifyToken({ token: readableToken });
  assert.ok(Date.now() - readStartedAt < 300, 'verify no quedo detras del lock');

  // Una emision de OTRA cuenta SI espera: el lock es global.
  const contender = build();
  const issueStartedAt = Date.now();
  contender.service.requestReset({ email: other.email });
  await contender.tasks.idle();
  assert.ok(Date.now() - issueStartedAt >= 300, 'la emision esperó al lock global');
  assert.equal(live(await tokensOf(other.id)).length, 1, 'y termino bien en cuanto se libero');

  await holding;
});

// ---------------------------------------------------------------------------
// Recorrido de punta a punta sobre la base real
// ---------------------------------------------------------------------------

test('the full flow on a real database: request, verify, confirm, version bump, no reuse', { skip: skipReason }, async () => {
  const user = await createUser();
  const { service, token } = await requested(user);

  assert.deepEqual(await service.verifyToken({ token }), { status: 'valid' });
  assert.deepEqual(await service.verifyToken({ token }), { status: 'valid' });
  assert.deepEqual(await service.confirmReset({ token, password: NEW_PASSWORD }), {
    status: 'password_reset'
  });

  const credential = await credentialOf(user.id);
  assert.equal(credential.sessionVersion, 1);
  assert.ok(await verifyPasswordHash(NEW_PASSWORD, credential.passwordHash));
  await assert.rejects(service.verifyToken({ token }), (e: unknown) => codeOf(e) === 'PASSWORD_RESET_TOKEN_INVALID');
  await assert.rejects(
    service.confirmReset({ token, password: 'AnotherPassword789' }),
    (e: unknown) => codeOf(e) === 'PASSWORD_RESET_TOKEN_INVALID'
  );
});

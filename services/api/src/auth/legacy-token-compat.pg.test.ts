/**
 * T2 -- la migracion de recuperacion aplicada sobre DATOS PREEXISTENTES, en un
 * PostgreSQL real y descartable.
 *
 * Reproduce, en una base nueva y local, la secuencia de produccion:
 *   1. esquema ANTERIOR (todas las migraciones menos la de recuperacion);
 *   2. filas creadas como las crea la API desplegada (sin `sessionVersion`);
 *   3. se aplica SOLO la migracion nueva con `prisma migrate deploy`;
 *   4. las filas existentes quedan en `sessionVersion = 0` y un token de la API
 *      desplegada (sin `sv`) sigue valiendo en el codigo nuevo;
 *   5. al subir la version a 1, ese mismo token deja de valer.
 * Tambien fija por que el orden es "migrar primero": el codigo nuevo contra el esquema
 * ANTERIOR falla (columna inexistente).
 *
 * SOLO claves y datos de prueba. NUNCA RDS: se niega a correr salvo que el host sea
 * local Y el nombre de la base contenga "test"; crea (y borra) su propia base
 * `scope_legacy_compat_test_<aleatorio>` en ese servidor.
 *
 * COMO EJECUTARLO (PowerShell, con Docker; cualquier PostgreSQL 16 local sirve):
 *
 *   docker run --rm -d --name scope-pg-test -e POSTGRES_PASSWORD=test `
 *     -e POSTGRES_DB=scope_recovery_test -p 127.0.0.1:55432:5432 postgres:16
 *
 *   $env:TEST_DATABASE_URL = "postgresql://postgres:test@127.0.0.1:55432/scope_recovery_test"
 *   npm run test:legacy-token-compat-pg --workspace services/api
 *
 *   docker stop scope-pg-test
 *
 * SALVAGUARDA. Sin `TEST_DATABASE_URL` el test se OMITE (cuenta como "skipped", no como
 * "pass"), salvo con `npm run test:legacy-token-compat-pg`, donde su ausencia es un
 * FALLO: nadie puede creer que se verifico algo que no corrio.
 */

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';

import { AuthService } from './auth.service';
import { hashPassword } from './password-hashing';

const SECRET = 'legacy-token-compat-pg-test-secret';
const PASSWORD = 'CorrectHorse123';
const NEW_MIGRATION = '20261023120000_add_password_reset_token_and_session_version';

process.env.JWT_SECRET = SECRET;
delete process.env.JWT_EXPIRES_IN;
delete process.env.PUBLIC_DID_BASE_URL;

const ADMIN_URL = process.env.TEST_DATABASE_URL?.trim();
const REQUIRED = process.env.npm_lifecycle_event === 'test:legacy-token-compat-pg';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const skipReason = ADMIN_URL
  ? false
  : 'TEST_DATABASE_URL no esta definida: la migracion sobre datos preexistentes NO se verifico. Ver el encabezado del archivo.';

if (!ADMIN_URL && REQUIRED) {
  throw new Error(
    'test:legacy-token-compat-pg requiere TEST_DATABASE_URL (PostgreSQL local de pruebas). Ver el encabezado de legacy-token-compat.pg.test.ts.'
  );
}

function parseSafeTarget(raw: string): URL {
  const url = new URL(raw);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));

  if (!LOCAL_HOSTS.has(url.hostname) || !/test/i.test(database)) {
    throw new Error(
      'TEST_DATABASE_URL rechazada: este test crea y borra bases y solo corre contra un PostgreSQL LOCAL cuya base contenga "test". No existe ninguna variable que levante esta restriccion.'
    );
  }
  return url;
}

const adminUrl = ADMIN_URL ? parseSafeTarget(ADMIN_URL) : undefined;
const DB_NAME = `scope_legacy_compat_test_${randomBytes(4).toString('hex')}`;

function urlFor(database: string): string {
  const url = new URL(adminUrl!.toString());
  url.pathname = `/${database}`;
  return url.toString();
}

const API_DIR = path.resolve(__dirname, '..', '..');
const PRISMA_CLI = require.resolve('prisma/build/index.js', { paths: [API_DIR] });

/** Copia el schema y las migraciones a un directorio temporal, opcionalmente sin la nueva. */
function stageMigrations(withNew: boolean): string {
  const root = mkdtempSync(path.join(tmpdir(), 'scope-compat-'));
  const prismaDir = path.join(root, 'prisma');
  mkdirSync(prismaDir, { recursive: true });
  cpSync(path.join(API_DIR, 'prisma', 'schema.prisma'), path.join(prismaDir, 'schema.prisma'));
  cpSync(path.join(API_DIR, 'prisma', 'migrations'), path.join(prismaDir, 'migrations'), {
    recursive: true,
    filter: (source) => withNew || !source.includes(NEW_MIGRATION)
  });
  return root;
}

function migrateDeploy(stage: string, database: string): { output: string; status: number | null } {
  const result = spawnSync(
    process.execPath,
    [PRISMA_CLI, 'migrate', 'deploy', '--schema', path.join(stage, 'prisma', 'schema.prisma')],
    {
      cwd: stage,
      env: {
        ...process.env,
        DATABASE_URL: urlFor(database),
        CHECKPOINT_DISABLE: '1',
        PRISMA_HIDE_UPDATE_MESSAGE: '1'
      },
      encoding: 'utf8'
    }
  );
  return { output: `${result.stdout ?? ''}${result.stderr ?? ''}`, status: result.status };
}

let admin: PrismaClient;
let client: PrismaClient;
let service: AuthService;
const staged: string[] = [];

const jwt = new JwtService({});
const USER_ID = randomUUID();
const EMAIL = 'preexistente@example.com';

before(async () => {
  if (!ADMIN_URL) return;
  admin = new PrismaClient({ datasourceUrl: ADMIN_URL });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${DB_NAME}"`);
});

after(async () => {
  if (!ADMIN_URL) return;
  await client?.$disconnect();
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  await admin.$disconnect();
  for (const dir of staged) rmSync(dir, { recursive: true, force: true });
});

/** Firma como la API desplegada (8a567f5): solo { sub }. */
const legacyToken = (sub: string, expiresIn: string | number = '1h') =>
  new JwtService({}).signAsync({ sub }, { secret: SECRET, expiresIn: expiresIn as never });

const columnExists = async (table: string, column: string) => {
  const rows = await client.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint AS n FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    table,
    column
  );
  return Number(rows[0].n) === 1;
};
const migrationsApplied = async () => {
  const rows = await client.$queryRawUnsafe<Array<{ migration_name: string }>>(
    `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`
  );
  return rows.map((r) => r.migration_name);
};

const opts = { skip: skipReason };

test('T2.1: se arma el esquema ANTERIOR (sin la migracion de recuperacion)', opts, async () => {
  const stage = stageMigrations(false);
  staged.push(stage);
  const staged_names = readdirSync(path.join(stage, 'prisma', 'migrations')).filter((n) => /^\d{14}_/.test(n));
  assert.ok(!staged_names.includes(NEW_MIGRATION));

  const { output, status } = migrateDeploy(stage, DB_NAME);
  assert.equal(status, 0, output);

  client = new PrismaClient({ datasourceUrl: urlFor(DB_NAME) });
  service = new AuthService(client as never, jwt);

  assert.ok(!(await migrationsApplied()).includes(NEW_MIGRATION));
  assert.equal(await columnExists('AuthCredential', 'sessionVersion'), false, 'la columna aun no existe');
  assert.equal(
    (await client.$queryRawUnsafe<Array<{ r: string | null }>>(`SELECT to_regclass('public."PasswordResetToken"')::text AS r`))[0].r,
    null,
    'la tabla aun no existe'
  );
});

test('T2.2: filas creadas COMO LA API DESPLEGADA (SQL sin sessionVersion) conviven con el esquema anterior', opts, async () => {
  const hash = await hashPassword(PASSWORD);
  await client.$executeRawUnsafe(
    `INSERT INTO "User" (id, email, status, "firstName", "lastName", "createdAt", "updatedAt")
     VALUES ($1, $2, 'active'::"UserStatus", 'Ada', 'Lovelace', now(), now())`,
    USER_ID,
    EMAIL
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "AuthCredential" (id, "userId", "passwordHash", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, now(), now())`,
    randomUUID(),
    USER_ID,
    hash
  );

  const rows = await client.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*)::bigint AS n FROM "AuthCredential"`);
  assert.equal(Number(rows[0].n), 1);
});

test('T2.3: el codigo NUEVO contra el esquema ANTERIOR falla -- por eso se migra primero', opts, async () => {
  const token = await legacyToken(USER_ID);

  await assert.rejects(
    service.resolveAuthenticatedUser(token),
    (error: unknown) => !(error instanceof UnauthorizedException),
    'debe ser un error de base (columna inexistente), no un 401: el servicio queda roto, no "seguro"'
  );
});

test('T2.4: se aplica SOLO la migracion nueva con prisma migrate deploy', opts, async () => {
  const appliedBefore = await migrationsApplied();
  const stage = stageMigrations(true);
  staged.push(stage);

  const { output, status } = migrateDeploy(stage, DB_NAME);
  assert.equal(status, 0, output);
  assert.match(output, new RegExp(NEW_MIGRATION));

  const appliedAfter = await migrationsApplied();
  assert.equal(appliedAfter.length, appliedBefore.length + 1);
  assert.deepEqual(appliedAfter.filter((n) => !appliedBefore.includes(n)), [NEW_MIGRATION]);
  assert.equal(await columnExists('AuthCredential', 'sessionVersion'), true);
});

test('T2.5: la fila preexistente quedo en sessionVersion = 0 sin backfill, y nada mas cambio', opts, async () => {
  const rows = await client.$queryRawUnsafe<Array<{ sessionVersion: number; userId: string }>>(
    `SELECT "sessionVersion", "userId" FROM "AuthCredential"`
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userId, USER_ID);
  assert.equal(rows[0].sessionVersion, 0);

  const user = await client.$queryRawUnsafe<Array<{ email: string; status: string }>>(
    `SELECT email, status::text AS status FROM "User" WHERE id=$1`,
    USER_ID
  );
  assert.deepEqual(user, [{ email: EMAIL, status: 'active' }]);

  const tokens = await client.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*)::bigint AS n FROM "PasswordResetToken"`);
  assert.equal(Number(tokens[0].n), 0, 'la tabla nueva nace vacia');
});

test('T2.6: un token de la API desplegada sigue valiendo en el codigo nuevo tras migrar', opts, async () => {
  const user = await service.resolveAuthenticatedUser(await legacyToken(USER_ID));

  assert.equal(user.id, USER_ID);
  assert.equal(user.email, EMAIL);
});

test('T2.7: API ANTERIOR + esquema NUEVO es compatible (la consulta anterior no conoce la columna)', opts, async () => {
  const user = await client.user.findUnique({
    where: { id: USER_ID },
    select: { id: true, email: true, did: true, status: true }
  });

  assert.equal(user?.id, USER_ID);
});

test('T2.8: el login nuevo firma sv = 0 con la version PERSISTIDA, y ese token vale', opts, async () => {
  const { accessToken } = await service.login({ email: EMAIL, password: PASSWORD });
  const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8')) as { sv: number };

  assert.equal(payload.sv, 0);
  assert.equal((await service.resolveAuthenticatedUser(accessToken)).id, USER_ID);
});

test('T2.9: al subir la version a 1, el token legado Y el del login previo dejan de valer; uno nuevo si', opts, async () => {
  const legacy = await legacyToken(USER_ID);
  const { accessToken: previous } = await service.login({ email: EMAIL, password: PASSWORD });

  await client.authCredential.update({ where: { userId: USER_ID }, data: { sessionVersion: { increment: 1 } } });

  await assert.rejects(service.resolveAuthenticatedUser(legacy), UnauthorizedException);
  await assert.rejects(service.resolveAuthenticatedUser(previous), UnauthorizedException);

  const { accessToken: after } = await service.login({ email: EMAIL, password: PASSWORD });
  assert.equal((await service.resolveAuthenticatedUser(after)).id, USER_ID);
});

test('T2.10: una cuenta CREADA despues de migrar nace en 0 sin que el codigo escriba la version', opts, async () => {
  const { accessToken } = await service.register({
    email: 'nueva@example.com',
    password: PASSWORD,
    firstName: 'Grace',
    lastName: 'Hopper'
  });
  const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8')) as { sv: number };
  const row = await client.$queryRawUnsafe<Array<{ sessionVersion: number }>>(
    `SELECT c."sessionVersion" FROM "AuthCredential" c JOIN "User" u ON u.id=c."userId" WHERE u.email='nueva@example.com'`
  );

  assert.equal(payload.sv, 0);
  assert.equal(row[0].sessionVersion, 0);
});

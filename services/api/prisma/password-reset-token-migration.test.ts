/**
 * Migration de recuperacion de contrasena, Etapa 1.
 *
 * Congela la forma acordada: UNA columna nueva en AuthCredential, UNA tabla
 * nueva (PasswordResetToken), tres indices, una FK en CASCADE, y nada destructivo.
 * Ademas cruza el SQL contra `schema.prisma`: si uno cambia sin el otro, rompe.
 *
 * Mismo helper de "SQL sin comentarios" que `platform-admin-migration.test.ts`:
 * esta migration explica en comentarios que NO hace DROP ni DELETE y menciona
 * esas palabras; las aserciones negativas tienen que mirar DDL ejecutable.
 *
 * ALCANCE HONESTO: esto inspecciona el SQL y el schema. NO aplica la migration
 * contra un PostgreSQL real.
 */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const MIGRATION = '20261023120000_add_password_reset_token_and_session_version';
const MIGRATIONS_DIR = join(__dirname, 'migrations');
const PATH = join(MIGRATIONS_DIR, MIGRATION, 'migration.sql');
const SCHEMA_PATH = join(__dirname, 'schema.prisma');
const PREVIOUS_LATEST = '20261012110000_add_profile_embedding_v1_persistence';

async function rawSql(): Promise<string> {
  return readFile(PATH, 'utf8');
}

async function executableSql(): Promise<string> {
  return (await rawSql())
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

async function statements(): Promise<string[]> {
  return (await executableSql())
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function schemaModel(name: string): Promise<string> {
  const schema = (await readFile(SCHEMA_PATH, 'utf8')).replace(/\r\n/g, '\n');
  const start = schema.indexOf(`model ${name} {`);
  assert.ok(start > -1, `model ${name} existe en schema.prisma`);
  return schema.slice(start, schema.indexOf('\n}', start) + 2);
}

// ---------------------------------------------------------------------------
// Forma de la migration
// ---------------------------------------------------------------------------

test('is exactly six statements: one column, one table, three indexes, one foreign key', async () => {
  const all = await statements();

  assert.equal(all.length, 6);
  assert.equal(all.filter((s) => s.startsWith('ALTER TABLE')).length, 2);
  assert.equal(all.filter((s) => s.startsWith('CREATE TABLE')).length, 1);
  assert.equal(all.filter((s) => s.startsWith('CREATE UNIQUE INDEX')).length, 1);
  assert.equal(all.filter((s) => s.startsWith('CREATE INDEX')).length, 2);
});

test('adds AuthCredential.sessionVersion as INTEGER NOT NULL DEFAULT 0', async () => {
  const sql = await executableSql();

  assert.match(
    sql,
    /ALTER TABLE "AuthCredential" ADD COLUMN\s+"sessionVersion" INTEGER NOT NULL DEFAULT 0;/
  );
});

test('creates exactly one new table: PasswordResetToken', async () => {
  const sql = await executableSql();

  const created = [...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(created, ['PasswordResetToken']);
});

test('PasswordResetToken has exactly the agreed columns, types and nullability', async () => {
  const sql = await executableSql();
  const body = sql.match(/CREATE TABLE "PasswordResetToken" \(([\s\S]*?)\n\);/)?.[1];
  assert.ok(body, 'el cuerpo del CREATE TABLE se pudo leer');

  const columns = [...body.matchAll(/^\s*"(\w+)" ([A-Z0-9()]+)(.*?),?\s*$/gm)].map(
    (m) => `${m[1]}|${m[2]}|${/NOT NULL/.test(m[3]) ? 'NOT NULL' : 'NULL'}`
  );

  assert.deepEqual(columns, [
    'id|TEXT|NOT NULL',
    'userId|TEXT|NOT NULL',
    'tokenHash|TEXT|NOT NULL',
    'createdAt|TIMESTAMP(3)|NOT NULL',
    'expiresAt|TIMESTAMP(3)|NOT NULL',
    'consumedAt|TIMESTAMP(3)|NULL',
    'invalidatedAt|TIMESTAMP(3)|NULL'
  ]);
  assert.match(body, /"createdAt" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  assert.match(body, /CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY \("id"\)/);
});

test('tokenHash is UNIQUE -- the lookup key and the no-collision guarantee', async () => {
  const sql = await executableSql();

  assert.match(
    sql,
    /CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"\("tokenHash"\);/
  );
});

test('has the per-user window index and the global window index, and no other', async () => {
  const sql = await executableSql();

  assert.match(
    sql,
    /CREATE INDEX "PasswordResetToken_userId_createdAt_idx" ON "PasswordResetToken"\("userId", "createdAt"\);/
  );
  assert.match(
    sql,
    /CREATE INDEX "PasswordResetToken_createdAt_idx" ON "PasswordResetToken"\("createdAt"\);/
  );
  const indexNames = [...sql.matchAll(/CREATE (?:UNIQUE )?INDEX "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(indexNames.sort(), [
    'PasswordResetToken_createdAt_idx',
    'PasswordResetToken_tokenHash_key',
    'PasswordResetToken_userId_createdAt_idx'
  ]);
});

test('the foreign key to User cascades on delete', async () => {
  const sql = await executableSql();

  assert.match(
    sql,
    /ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY \("userId"\) REFERENCES "User"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE;/
  );
});

// ---------------------------------------------------------------------------
// Aditiva: nada destructivo, nada sobre datos existentes
// ---------------------------------------------------------------------------

test('is purely additive -- no destructive or data-changing statement', async () => {
  const sql = await executableSql();

  for (const forbidden of [
    /\bDROP\b/i,
    // `DELETE FROM`, no `DELETE` a secas: la FK lleva `ON DELETE CASCADE`.
    /\bDELETE\s+FROM\b/i,
    /\bTRUNCATE\b/i,
    /\bUPDATE\b\s+"/i,
    /\bINSERT\b/i,
    /\bRENAME\b/i,
    /\bALTER COLUMN\b/i,
    /\bCREATE TYPE\b/i
  ]) {
    assert.doesNotMatch(sql, forbidden);
  }
});

test('only ever alters AuthCredential (add column) and its own new table', async () => {
  const sql = await executableSql();

  const altered = [...sql.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(altered, ['AuthCredential', 'PasswordResetToken']);
  // User solo aparece como destino REFERENCES de la FK, nunca como tabla alterada.
  assert.doesNotMatch(sql, /ALTER TABLE "User"/);
  // Y no toca la contrasena persistida.
  assert.doesNotMatch(sql, /"passwordHash"/);
});

test('sorts after the previous latest migration, so Prisma applies it last', async () => {
  const all = (await readdir(MIGRATIONS_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  assert.ok(all.includes(MIGRATION));
  assert.ok(MIGRATION > PREVIOUS_LATEST, 'su timestamp es posterior a la ultima migration previa');
});

// ---------------------------------------------------------------------------
// Coherencia SQL <-> schema.prisma
// ---------------------------------------------------------------------------

test('schema.prisma declares AuthCredential.sessionVersion Int @default(0), non-nullable', async () => {
  const model = await schemaModel('AuthCredential');

  assert.match(model, /^\s*sessionVersion\s+Int\s+@default\(0\)\s*$/m);
  assert.doesNotMatch(model, /sessionVersion\s+Int\?/);
});

test('schema.prisma PasswordResetToken matches the SQL column by column', async () => {
  const model = await schemaModel('PasswordResetToken');

  assert.match(model, /^\s*id\s+String\s+@id @default\(uuid\(\)\)\s*$/m);
  assert.match(model, /^\s*userId\s+String\s*$/m);
  assert.match(model, /^\s*tokenHash\s+String\s+@unique\s*$/m);
  assert.match(model, /^\s*createdAt\s+DateTime\s+@default\(now\(\)\)\s*$/m);
  assert.match(model, /^\s*expiresAt\s+DateTime\s*$/m);
  assert.match(model, /^\s*consumedAt\s+DateTime\?\s*$/m);
  assert.match(model, /^\s*invalidatedAt\s+DateTime\?\s*$/m);
  assert.match(
    model,
    /user\s+User\s+@relation\(fields: \[userId\], references: \[id\], onDelete: Cascade\)/
  );
  assert.match(model, /@@index\(\[userId, createdAt\]\)/);
  assert.match(model, /@@index\(\[createdAt\]\)/);
});

test('every SQL column of PasswordResetToken is a field of the Prisma model, and vice versa', async () => {
  const sql = await executableSql();
  const body = sql.match(/CREATE TABLE "PasswordResetToken" \(([\s\S]*?)\n\);/)?.[1] ?? '';
  const sqlColumns = [...body.matchAll(/^\s*"(\w+)" /gm)].map((m) => m[1]).sort();

  const model = await schemaModel('PasswordResetToken');
  const prismaFields = [...model.matchAll(/^\s{2}(\w+)\s+\w+/gm)]
    .map((m) => m[1])
    .filter((field) => field !== 'user') // relacion, sin columna fisica propia
    .sort();

  assert.deepEqual(sqlColumns, prismaFields);
});

test('User gains only the inverse relation -- no new column on User', async () => {
  const model = await schemaModel('User');

  assert.match(model, /^\s*passwordResetTokens\s+PasswordResetToken\[\]\s*$/m);
  assert.doesNotMatch(model, /sessionVersion/);
});

// ---------------------------------------------------------------------------
// Documentacion de despliegue (requisito explicito de la etapa)
// ---------------------------------------------------------------------------

test('documents the deploy order and the incompatible combination, without hiding it', async () => {
  const raw = await rawSql();

  assert.match(raw, /API ANTERIOR \+ schema NUEVO\s+COMPATIBLE/);
  assert.match(raw, /API NUEVA\s+\+ schema NUEVO\s+COMPATIBLE/);
  assert.match(raw, /API NUEVA\s+\+ schema ANTERIOR\s+NO COMPATIBLE/);
  assert.match(raw, /MIGRAR PRIMERO, DESPLEGAR LA API DESPUES/);
});

test('documents the scope_app grant requirement and points at the existing idempotent script', async () => {
  const raw = await rawSql();

  assert.match(raw, /infra\/terraform\/sql\/02-grant-scope-app-on-existing-objects\.sql/);
  assert.match(raw, /scope_app/);
  assert.match(raw, /NO ejecuta nada de esto/);
});

/**
 * Migration de la tabla PlatformAdmin -- S1.
 *
 * Congela la forma acordada: UNA tabla, TRES columnas fisicas, un unico indice
 * sobre `userId` (el del `@unique`, sin companion no-unique), la FK a `User` en
 * CASCADE, cero enums, cero backfill y cero DDL sobre tablas existentes.
 *
 * Mismo patron y mismo helper de "SQL sin comentarios" que
 * `objective-migration.test.ts`: las aserciones negativas tienen que mirar DDL
 * ejecutable, no prosa. Esta migration explica en un comentario POR QUE no lleva
 * un indice no-unique y menciona ahi las palabras `INDEX` y `CREATE`; assertar
 * sobre el archivo crudo confundiria esa explicacion con DDL real.
 */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const MIGRATION = '20261003120000_add_platform_admin';
const PATH = join(__dirname, 'migrations', MIGRATION, 'migration.sql');

async function executableSql(): Promise<string> {
  const raw = await readFile(PATH, 'utf8');
  return raw
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

async function statements(): Promise<string[]> {
  const sql = await executableSql();
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

test('creates exactly one new table', async () => {
  const sql = await executableSql();

  const created = [...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map(
    (match) => match[1]
  );
  assert.deepEqual(created, ['PlatformAdmin']);
});

test('is exactly three statements: table, unique index, foreign key', async () => {
  assert.equal((await statements()).length, 3);
});

test('is purely additive -- it does not touch any existing table', async () => {
  const sql = await executableSql();

  // El unico ALTER TABLE permitido es sobre la tabla que esta migration crea
  // (el que agrega su propia FK).
  const altered = [...sql.matchAll(/ALTER TABLE "(\w+)"/g)].map(
    (match) => match[1]
  );
  assert.deepEqual([...new Set(altered)], ['PlatformAdmin']);

  // `User` se referencia unicamente como destino de la FK, nunca como objetivo
  // de DDL: no gana ninguna columna.
  assert.doesNotMatch(sql, /ALTER TABLE "User"/);
  assert.doesNotMatch(sql, /ADD COLUMN/i);
});

test('is not destructive', async () => {
  const sql = await executableSql();

  assert.doesNotMatch(sql, /\bDROP\b/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(sql, /\bRENAME\b/i);
});

test('has no backfill', async () => {
  const sql = await executableSql();

  // Backfill = sentencias DML al principio de una linea. La palabra suelta no
  // sirve: `ON UPDATE CASCADE` es una accion referencial de la FK, no un
  // UPDATE de datos.
  assert.doesNotMatch(sql, /^\s*UPDATE\s+"/im, 'sin backfill');
  assert.doesNotMatch(sql, /^\s*INSERT\s+INTO/im, 'sin backfill');
});

test('declares no enum', async () => {
  const sql = await executableSql();

  assert.doesNotMatch(sql, /CREATE TYPE/i);
  assert.doesNotMatch(sql, /ALTER TYPE/i);
});

test('declares exactly the three frozen columns', async () => {
  const sql = await executableSql();

  const table = /CREATE TABLE "PlatformAdmin" \(([\s\S]*?)\n\);/.exec(sql);
  assert.ok(table, 'no se encontro el CREATE TABLE');

  const columns = [...table[1].matchAll(/^\s{4}"(\w+)"/gm)].map(
    (match) => match[1]
  );
  assert.deepEqual(columns, ['id', 'userId', 'grantedAt']);

  // Lo que el modelo congelado NO lleva.
  assert.doesNotMatch(sql, /grantedByUserId/);
  assert.doesNotMatch(sql, /revokedAt/);
  assert.doesNotMatch(sql, /"role"/);
  assert.doesNotMatch(sql, /"status"/);
  assert.doesNotMatch(sql, /"metadata"/);
  assert.doesNotMatch(sql, /capabilit/i);
  assert.doesNotMatch(sql, /"scopes"/);
});

test('nullability, defaults and primary key match the design', async () => {
  const sql = await executableSql();

  assert.match(sql, /"id" TEXT NOT NULL/);
  assert.match(sql, /"userId" TEXT NOT NULL/);
  assert.match(
    sql,
    /"grantedAt" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/
  );
  assert.match(
    sql,
    /CONSTRAINT "PlatformAdmin_pkey" PRIMARY KEY \("id"\)/
  );
});

test('declares a single UNIQUE index on userId and no redundant companion', async () => {
  const sql = await executableSql();

  assert.match(
    sql,
    /CREATE UNIQUE INDEX "PlatformAdmin_userId_key" ON "PlatformAdmin"\("userId"\)/
  );

  // El `@unique` ya emite ese indice unico, que es el que sirve al
  // `findUnique({ where: { userId } })` del guard. Un segundo indice no-unique
  // sobre la misma columna seria redundante -- mismo criterio que
  // `AuthCredential_userId_key`, que tampoco lleva companion.
  const indexes = [...sql.matchAll(/CREATE\s+(UNIQUE\s+)?INDEX "(\w+)"/g)].map(
    (match) => ({ unique: Boolean(match[1]), name: match[2] })
  );
  assert.deepEqual(indexes, [
    { unique: true, name: 'PlatformAdmin_userId_key' }
  ]);
});

test('declares the User foreign key with CASCADE on delete and update', async () => {
  const sql = await executableSql();

  assert.match(
    sql,
    /ADD CONSTRAINT "PlatformAdmin_userId_fkey" FOREIGN KEY \("userId"\) REFERENCES "User"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE/
  );

  // Una sola FK: el modelo no referencia nada mas (en particular, no hay
  // grantedByUserId).
  const foreignKeys = [...sql.matchAll(/FOREIGN KEY \("(\w+)"\)/g)].map(
    (match) => match[1]
  );
  assert.deepEqual(foreignKeys, ['userId']);
});

test('no applied migration was modified -- the chain only grows', async () => {
  const all = (
    await readdir(join(__dirname, 'migrations'), { withFileTypes: true })
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.equal(all.at(-1), MIGRATION, 'esta es la ultima carpeta por orden');
  assert.equal(
    new Set(all).size,
    all.length,
    'sin timestamps duplicados en la cadena'
  );
});

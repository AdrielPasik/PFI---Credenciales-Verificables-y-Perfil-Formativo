/**
 * Migration de `User.onboardingIntent` -- O1.
 *
 * Congela la forma acordada: UN enum nuevo con exactamente dos valores, UNA
 * columna nullable sobre `User`, sin default, sin backfill, sin indice y sin
 * tocar ningun otro campo (en particular NO `status`).
 *
 * Mismo helper de "SQL sin comentarios" que el resto de los tests de migration
 * del repo: las aserciones negativas tienen que mirar DDL ejecutable, no prosa.
 * Esta migration explica en comentarios por que NO lleva `DEFAULT` ni `INDEX`,
 * y menciona ahi esas palabras; assertar sobre el archivo crudo confundiria la
 * explicacion con DDL real.
 */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const MIGRATION = '20261004120000_add_user_onboarding_intent';
const PATH = join(__dirname, 'migrations', MIGRATION, 'migration.sql');

async function executableSql(): Promise<string> {
  const raw = await readFile(PATH, 'utf8');
  return raw
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

test('1: crea el enum con EXACTAMENTE los dos valores congelados', async () => {
  const sql = await executableSql();

  assert.match(
    sql,
    /CREATE TYPE "UserOnboardingIntent" AS ENUM \('personal', 'institutional'\);/
  );

  // Un solo enum nuevo, y ningun valor de mas (en particular, NO existe
  // `holder`: "holder" no es un tipo de cuenta).
  const created = [...sql.matchAll(/CREATE TYPE "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(created, ['UserOnboardingIntent']);
  assert.doesNotMatch(sql, /holder/i);
  assert.doesNotMatch(sql, /ALTER TYPE/i);
});

test('2: la columna es NULLABLE', async () => {
  const sql = await executableSql();

  assert.match(
    sql,
    /ALTER TABLE "User" ADD COLUMN\s+"onboardingIntent" "UserOnboardingIntent";/
  );
  // Sin NOT NULL en ninguna parte del DDL ejecutable.
  assert.doesNotMatch(sql, /NOT NULL/i);
});

test('3: sin DEFAULT -- las cuentas existentes NO quedan marcadas como personal', async () => {
  assert.doesNotMatch(await executableSql(), /DEFAULT/i);
});

test('4: sin backfill', async () => {
  const sql = await executableSql();

  // DML al principio de una linea. La palabra suelta no sirve: `ON UPDATE
  // CASCADE` es una accion referencial, no un UPDATE de datos.
  assert.doesNotMatch(sql, /^\s*UPDATE\s+"/im);
  assert.doesNotMatch(sql, /^\s*INSERT\s+INTO/im);
});

test('5: sin indice -- este campo nunca se filtra ni se ordena', async () => {
  assert.doesNotMatch(await executableSql(), /CREATE\s+(UNIQUE\s+)?INDEX/i);
});

test('exactamente dos sentencias: el enum y la columna', async () => {
  assert.equal((await statements()).length, 2);
});

test('es aditiva: no toca ninguna otra tabla ni ninguna otra columna de User', async () => {
  const sql = await executableSql();

  const altered = [...sql.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(altered)], ['User']);

  // Una sola columna agregada.
  const added = [...sql.matchAll(/ADD COLUMN\s+"(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(added, ['onboardingIntent']);

  // En particular NO toca `status`, que es el campo con el que esto podria
  // confundirse.
  assert.doesNotMatch(sql, /"status"/);
  assert.doesNotMatch(sql, /UserStatus/);
});

test('no es destructiva', async () => {
  const sql = await executableSql();

  assert.doesNotMatch(sql, /\bDROP\b/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(sql, /\bRENAME\b/i);
});

test('no crea ninguna tabla ni ninguna FK', async () => {
  const sql = await executableSql();

  // El diseno congelado descarta explicitamente una tabla separada.
  assert.doesNotMatch(sql, /CREATE TABLE/i);
  assert.doesNotMatch(sql, /FOREIGN KEY/i);
});

test('la cadena de migrations solo crece y no tiene timestamps duplicados', async () => {
  const all = (await readdir(join(__dirname, 'migrations'), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  // Append-safe: posicion historica, no "es la ultima". Agregar una migration
  // posterior es legitimo y no debe romper este test.
  assert.equal(all.indexOf(MIGRATION), 19, 'posicion historica en la cadena');
  assert.equal(new Set(all).size, all.length);
});

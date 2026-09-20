/**
 * Migracion de enlaces recuperables — regresion estructural sobre el SQL.
 *
 * Aditiva, nullable y sin backfill: las filas historicas no se tocan.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const DIR = join(__dirname, 'migrations', '20260919120000_add_share_token_recovery');
const SQL = readFileSync(join(DIR, 'migration.sql'), 'utf8')
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

function statements(): string[] {
  return SQL.split(';').map((statement) => statement.trim()).filter((statement) => statement.length > 0);
}

test('una sola sentencia: agregar la columna nullable', () => {
  assert.deepEqual(statements(), ['ALTER TABLE "SharingGrant" ADD COLUMN "tokenRecovery" TEXT']);
});

test('sin NOT NULL, sin default y sin backfill', () => {
  assert.equal(/NOT NULL/i.test(SQL), false);
  assert.equal(/DEFAULT/i.test(SQL), false);
  assert.equal(/UPDATE|INSERT/i.test(SQL), false);
});

test('no es destructiva ni reescribe el hash publico', () => {
  assert.equal(/DROP|TRUNCATE|DELETE/i.test(SQL), false);
  assert.equal(SQL.includes('tokenHash'), false);
});

test('no se modifico ninguna migracion ya aplicada', () => {
  // La cadena solo crece: esta es la ultima carpeta por orden lexicografico.
  const all = readdirSync(join(__dirname, 'migrations'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.equal(all.at(-1), '20260919120000_add_share_token_recovery');
});

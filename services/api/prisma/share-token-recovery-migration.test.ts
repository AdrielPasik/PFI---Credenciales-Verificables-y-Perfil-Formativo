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
  // La cadena solo crece: esta migracion tiene que seguir PRESENTE y en su
  // POSICION historica dentro del orden lexicografico.
  //
  // Antes se afirmaba que era la ultima carpeta (`at(-1)`), pero esa asercion
  // se auto-invalidaba con la siguiente migration del repo: agregar al final es
  // legitimo y no modifica nada ya aplicado. `indexOf` contra la posicion
  // historica es append-safe y conserva intacto lo que el test queria detectar:
  // borrarla o renombrarla devuelve -1, e insertar una migration
  // cronologicamente anterior le corre el indice. Los tres casos siguen
  // fallando.
  const all = readdirSync(join(__dirname, 'migrations'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.equal(all.indexOf('20260919120000_add_share_token_recovery'), 17);
});

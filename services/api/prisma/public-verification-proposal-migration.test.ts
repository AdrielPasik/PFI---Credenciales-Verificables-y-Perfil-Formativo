/**
 * Migracion de intake + propuesta publica — regresion estructural sobre el SQL.
 *
 * Se lee el archivo, no la base. Los comentarios se borran antes de afirmar nada.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const SQL = readFileSync(
  join(__dirname, 'migrations', '20260917120000_add_public_verification_proposal', 'migration.sql'),
  'utf8'
)
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

function statements(): string[] {
  return SQL.split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

test('aditiva: sin escrituras de datos ni drops', () => {
  for (const statement of statements()) {
    assert.doesNotMatch(statement, /^(INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/i, statement.slice(0, 60));
  }
});

test('la unica alteracion de una tabla existente es agregar objectiveType', () => {
  const alters = statements().filter(
    (statement) => statement.startsWith('ALTER TABLE') && !statement.startsWith('ALTER TABLE "VerificationProposalAttempt"')
  );
  assert.deepEqual(alters, ['ALTER TABLE "VerificationRequest" ADD COLUMN "objectiveType" "ObjectiveType" NOT NULL']);
});

test('crea exactamente la tabla de intentos y un enum de resultado sin valor de "transporte"', () => {
  const tables = statements()
    .filter((statement) => statement.startsWith('CREATE TABLE'))
    .map((statement) => /CREATE TABLE "([A-Za-z]+)"/.exec(statement)?.[1]);
  assert.deepEqual(tables, ['VerificationProposalAttempt']);

  const types = statements().filter((statement) => statement.startsWith('CREATE TYPE'));
  assert.equal(types.length, 1);
  assert.match(types[0], /\('SUCCEEDED', 'FAILED', 'DISCARDED'\)/);
});

test('el libro de intentos no guarda IP, respuesta de proveedor, prompt ni error', () => {
  const table = statements().find((statement) => statement.startsWith('CREATE TABLE "VerificationProposalAttempt"'))!;
  for (const forbidden of ['ip', 'ipAddress', 'clientIp', 'response', 'rawResponse', 'prompt', 'error', 'errorDetail', 'model', 'provider']) {
    assert.equal(new RegExp(`"${forbidden}"`, 'i').test(table), false, forbidden);
  }
});

test('A LO SUMO un intento abierto por solicitud: unico PARCIAL sobre outcome IS NULL', () => {
  assert.match(
    SQL,
    /CREATE UNIQUE INDEX "VerificationProposalAttempt_one_open_per_request" ON "VerificationProposalAttempt"\("verificationRequestId"\) WHERE "outcome" IS NULL/
  );
});

test('cuota y cooldown por enlace indexados sobre (sharingGrantId, startedAt)', () => {
  assert.match(SQL, /ON "VerificationProposalAttempt"\("sharingGrantId", "startedAt"\)/);
});

test('un intento cerrado tiene resultado y marca; uno abierto ninguno', () => {
  assert.match(SQL, /\("outcome" IS NULL\) = \("finishedAt" IS NULL\)/);
});

test('el lease termina despues de arrancar', () => {
  assert.match(SQL, /"leaseExpiresAt" > "startedAt"/);
});

test('ningun identificador supera los 63 bytes de Postgres', () => {
  const names = [...SQL.matchAll(/(?:INDEX|CONSTRAINT) "([^"]+)"/g)].map((match) => match[1]);
  assert.ok(names.length > 0);
  for (const name of names) {
    assert.ok(Buffer.byteLength(name, 'utf8') <= 63, `${name} (${Buffer.byteLength(name, 'utf8')})`);
  }
});

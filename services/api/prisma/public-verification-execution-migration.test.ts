/**
 * Migracion de ejecucion publica F3 — regresion estructural sobre el SQL.
 *
 * Se lee el archivo, no la base. Los comentarios se borran antes de afirmar nada.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const SQL = readFileSync(
  join(__dirname, 'migrations', '20260918120000_add_public_verification_execution', 'migration.sql'),
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

test('VerificationRun solo gana executionAttempts, con default 0 y CHECK 0..3', () => {
  assert.match(SQL, /ALTER TABLE "VerificationRun" ADD COLUMN "executionAttempts" INTEGER NOT NULL DEFAULT 0/);
  assert.match(SQL, /CHECK \("executionAttempts" >= 0 AND "executionAttempts" <= 3\)/);
  const runAlters = statements().filter((statement) => statement.startsWith('ALTER TABLE "VerificationRun"'));
  assert.equal(runAlters.length, 2);
});

test('el lease es UNA fila por enlace: PK sobre sharingGrantId, FK en cascada', () => {
  assert.match(SQL, /CONSTRAINT "VerificationExecutionLease_pkey" PRIMARY KEY \("sharingGrantId"\)/);
  assert.match(
    SQL,
    /FOREIGN KEY \("sharingGrantId"\) REFERENCES "SharingGrant"\("id"\) ON DELETE CASCADE/
  );
  const tables = statements()
    .filter((statement) => statement.startsWith('CREATE TABLE'))
    .map((statement) => /CREATE TABLE "([A-Za-z]+)"/.exec(statement)?.[1]);
  assert.deepEqual(tables, ['VerificationExecutionLease']);
});

test('el lease no puede quedar a medio tomar: dueno, adquisicion y vencimiento juntos', () => {
  assert.match(SQL, /"ownerToken" IS NULL AND "acquiredAt" IS NULL AND "expiresAt" IS NULL AND "verificationRunId" IS NULL/);
  assert.match(SQL, /"ownerToken" IS NOT NULL AND "acquiredAt" IS NOT NULL AND "expiresAt" IS NOT NULL AND "expiresAt" > "acquiredAt"/);
});

test('el lease no guarda IP, identidad del tercero ni datos del proveedor', () => {
  const table = statements().find((statement) => statement.startsWith('CREATE TABLE "VerificationExecutionLease"'))!;
  for (const forbidden of ['ip', 'ipAddress', 'userAgent', 'prompt', 'provider', 'model', 'error']) {
    assert.equal(new RegExp(`"${forbidden}"`, 'i').test(table), false, forbidden);
  }
});

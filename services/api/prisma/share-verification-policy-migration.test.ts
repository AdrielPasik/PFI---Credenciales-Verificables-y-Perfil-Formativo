/**
 * Migracion del consentimiento de computo — regresion estructural sobre el SQL.
 *
 * Se lee el archivo, no la base: este slice no aplica ninguna migracion y no
 * abre conexion contra ningun `DATABASE_URL`.
 *
 * Las assertions son sobre SQL EJECUTABLE. Los comentarios se borran antes de
 * mirar nada, asi que ningun test puede pasar porque la palabra aparezca en una
 * explicacion.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const MIGRATION_DIR = '20260915120000_add_share_verification_policy';
const RAW = readFileSync(join(__dirname, 'migrations', MIGRATION_DIR, 'migration.sql'), 'utf8');

const SQL = RAW.split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

function statements(): string[] {
  return SQL.split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

// ---------------------------------------------------------------------------
// Alcance: estrictamente aditiva
// ---------------------------------------------------------------------------

test('crea EXACTAMENTE las dos tablas del consentimiento', () => {
  const created = statements()
    .filter((statement) => statement.startsWith('CREATE TABLE'))
    .map((statement) => /CREATE TABLE "([A-Za-z]+)"/.exec(statement)?.[1]);
  assert.deepEqual(created, [
    'ShareVerificationPolicy',
    'ShareVerificationCredentialAuthorization'
  ]);
});

test('no altera ninguna tabla existente salvo para agregar sus foreign keys', () => {
  // Un ALTER que no sea ADD CONSTRAINT sobre las tablas nuevas significaria que
  // la migracion dejo de ser aditiva.
  for (const statement of statements().filter((entry) => entry.startsWith('ALTER TABLE'))) {
    assert.match(statement, /^ALTER TABLE "ShareVerification\w+" ADD CONSTRAINT/);
  }
});

test('no toca SharingGrant, Credential, ReasoningRun ni Objective', () => {
  for (const table of ['SharingGrant', 'Credential', 'ReasoningRun', 'Objective', 'User']) {
    assert.equal(
      SQL.includes(`ALTER TABLE "${table}"`),
      false,
      `la migracion no debe alterar ${table}`
    );
  }
});

test('no hay backfill ni ningun INSERT', () => {
  // LA INVARIANTE CENTRAL: ningun SharingGrant preexistente puede ganar
  // autoridad de computo al aplicarse esto. Si hubiera un INSERT, algun enlace
  // historico nacería con politica.
  // Se mira el VERBO con el que arranca cada sentencia, no el texto suelto:
  // "ON UPDATE CASCADE" es parte de una foreign key, no una escritura de datos.
  for (const statement of statements()) {
    assert.doesNotMatch(
      statement,
      /^(INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/i,
      statement.slice(0, 60)
    );
  }
});

test('no crea ningun enum nuevo', () => {
  assert.equal(/CREATE TYPE/i.test(SQL), false);
});

// ---------------------------------------------------------------------------
// Default deshabilitado
// ---------------------------------------------------------------------------

test('enabled nace en false', () => {
  const table = statements().find((statement) =>
    statement.startsWith('CREATE TABLE "ShareVerificationPolicy"')
  )!;
  assert.match(table, /"enabled" BOOLEAN NOT NULL DEFAULT false/);
});

test('policyVersion nace en 1 y es entero no nulo', () => {
  const table = statements().find((statement) =>
    statement.startsWith('CREATE TABLE "ShareVerificationPolicy"')
  )!;
  assert.match(table, /"policyVersion" INTEGER NOT NULL DEFAULT 1/);
});

test('las marcas de habilitado/deshabilitado son opcionales', () => {
  const table = statements().find((statement) =>
    statement.startsWith('CREATE TABLE "ShareVerificationPolicy"')
  )!;
  // Sin NOT NULL: una politica recien creada todavia no paso por ambos estados.
  assert.match(table, /"enabledAt" TIMESTAMP\(3\)(,|\s*$)/m);
  assert.match(table, /"disabledAt" TIMESTAMP\(3\)(,|\s*$)/m);
});

// ---------------------------------------------------------------------------
// Unicidad y relaciones
// ---------------------------------------------------------------------------

test('la politica es 1:1 con su SharingGrant', () => {
  assert.ok(
    statements().some((statement) =>
      /CREATE UNIQUE INDEX "ShareVerificationPolicy_sharingGrantId_key" ON "ShareVerificationPolicy"\("sharingGrantId"\)/.test(
        statement
      )
    )
  );
});

test('una credencial no puede autorizarse dos veces en la misma politica', () => {
  assert.ok(
    statements().some((statement) =>
      /CREATE UNIQUE INDEX .*ON "ShareVerificationCredentialAuthorization"\("policyId", "credentialId"\)/.test(
        statement
      )
    )
  );
});

test('la autorizacion es relacional: FK real contra Credential, no un id suelto', () => {
  const fk = statements().find((statement) =>
    /ADD CONSTRAINT "ShareVerificationCredentialAuthorization_credentialId_fkey"/.test(statement)
  );
  assert.ok(fk, 'falta la foreign key hacia Credential');
  assert.match(fk!, /REFERENCES "Credential"\("id"\)/);
});

test('borrar una autorizacion NUNCA puede propagarse hacia la credencial', () => {
  // RESTRICT en los dos sentidos de lectura: una credencial con consentimiento
  // vigente no puede desaparecer, y nada aca borra credenciales.
  const fk = statements().find((statement) =>
    /ADD CONSTRAINT "ShareVerificationCredentialAuthorization_credentialId_fkey"/.test(statement)
  )!;
  assert.match(fk, /ON DELETE RESTRICT/);
  assert.equal(/REFERENCES "Credential".*ON DELETE CASCADE/.test(fk), false);
});

test('la politica y sus autorizaciones caen con el grant', () => {
  const policyFk = statements().find((statement) =>
    /ADD CONSTRAINT "ShareVerificationPolicy_sharingGrantId_fkey"/.test(statement)
  )!;
  assert.match(policyFk, /REFERENCES "SharingGrant"\("id"\) ON DELETE CASCADE/);

  const authFk = statements().find((statement) =>
    /ADD CONSTRAINT "ShareVerificationCredentialAuthorization_policyId_fkey"/.test(statement)
  )!;
  assert.match(authFk, /REFERENCES "ShareVerificationPolicy"\("id"\) ON DELETE CASCADE/);
});

test('las dos columnas de busqueda estan indexadas', () => {
  for (const column of ['policyId', 'credentialId']) {
    assert.ok(
      statements().some((statement) =>
        new RegExp(
          `CREATE INDEX "ShareVerificationCredentialAuthorization_${column}_idx"`
        ).test(statement)
      ),
      column
    );
  }
});

test('ningun nombre de indice o constraint supera los 63 bytes de Postgres', () => {
  // Postgres TRUNCA en silencio los identificadores largos. Esta migracion tuvo
  // un nombre de 66 bytes que Prisma habria visto como drift.
  const names = [...SQL.matchAll(/(?:INDEX|CONSTRAINT) "([^"]+)"/g)].map((match) => match[1]);
  assert.ok(names.length > 0);
  for (const name of names) {
    assert.ok(Buffer.byteLength(name, 'utf8') <= 63, `${name} (${Buffer.byteLength(name, 'utf8')})`);
  }
});

test('el UNIQUE de autorizaciones usa el identificador exacto de Prisma', () => {
  assert.match(
    SQL,
    /CREATE UNIQUE INDEX "ShareVerificationCredentialAuthorization_policyId_credentia_key" ON "ShareVerificationCredentialAuthorization"\("policyId", "credentialId"\)/
  );
});

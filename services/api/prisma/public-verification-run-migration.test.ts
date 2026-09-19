/**
 * Migracion de la fundacion de verificacion publica — regresion estructural.
 *
 * Se lee el archivo, no la base. Los comentarios se borran antes de afirmar nada.
 *
 * La propiedad central: el inventario publico tiene EXACTAMENTE las mismas reglas
 * de forma que el del holder. Se verifica comparando contra la migracion de F3.1,
 * no contra una copia escrita en este test.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function executable(dir: string): string {
  return readFileSync(join(__dirname, 'migrations', dir, 'migration.sql'), 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

const SQL = executable('20260916120000_add_public_verification_run');
const HOLDER_SQL = executable('20260906120000_add_reasoning_run');

function statements(sql: string): string[] {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function checkBody(sql: string, name: string): string {
  const statement = statements(sql).find((entry) => entry.includes(`"${name}" CHECK`));
  assert.ok(statement, `falta el CHECK ${name}`);
  return statement!.slice(statement!.indexOf('CHECK')).replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// Alcance
// ---------------------------------------------------------------------------

test('crea EXACTAMENTE las tres tablas de la fundacion', () => {
  const created = statements(SQL)
    .filter((statement) => statement.startsWith('CREATE TABLE'))
    .map((statement) => /CREATE TABLE "([A-Za-z]+)"/.exec(statement)?.[1]);
  assert.deepEqual(created, ['VerificationRequest', 'VerificationRun', 'VerificationRunInventoryItem']);
});

test('crea UN solo enum nuevo, sin estado "expired"', () => {
  const types = statements(SQL).filter((statement) => statement.startsWith('CREATE TYPE'));
  assert.equal(types.length, 1);
  assert.match(types[0], /"VerificationRequestStatus"/);
  // Un estado que ningun codigo escribe seria una mentira del esquema.
  assert.equal(types[0].includes('expired'), false);
});

test('reusa los enums del holder en lugar de duplicarlos', () => {
  assert.match(SQL, /"disposition" "ReasoningRunInventoryDisposition" NOT NULL/);
  assert.match(SQL, /"status" "ReasoningRunStatus" NOT NULL DEFAULT 'pending'/);
  assert.equal(/CREATE TYPE "\w*Disposition"/.test(SQL), false);
});

test('estrictamente aditiva: sin escrituras de datos ni alteraciones de tablas existentes', () => {
  for (const statement of statements(SQL)) {
    assert.doesNotMatch(statement, /^(INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/i, statement.slice(0, 60));
    if (statement.startsWith('ALTER TABLE')) {
      assert.match(statement, /^ALTER TABLE "Verification\w+" ADD CONSTRAINT/);
    }
  }
});

test('VerificationRun no tiene ownerUserId, objectiveId, score, ranking ni prompt', () => {
  const run = statements(SQL).find((statement) => statement.startsWith('CREATE TABLE "VerificationRun"'))!;
  for (const forbidden of ['ownerUserId', 'objectiveId', 'score', 'ranking', 'percentage', 'prompt', 'providerResponse', 'rawResponse']) {
    assert.equal(run.includes(`"${forbidden}"`), false, forbidden);
  }
});

// ---------------------------------------------------------------------------
// Unicidad y autoridad
// ---------------------------------------------------------------------------

test('una solicitud produce a lo sumo un run: UNIQUE estructural', () => {
  assert.match(SQL, /CREATE UNIQUE INDEX "VerificationRun_verificationRequestId_key" ON "VerificationRun"\("verificationRequestId"\)/);
});

test('UN solo secreto de sesion: solo el token de la solicitud, como hash UNIQUE', () => {
  assert.match(SQL, /CREATE UNIQUE INDEX "VerificationRequest_requestTokenHash_key"/);
  // Sin token de resultado aparte: la autoridad sobre el run es la de la solicitud.
  for (const forbidden of ['resultTokenHash', '"requestToken"', '"resultToken"']) {
    assert.equal(SQL.includes(forbidden), false, forbidden);
  }
});

test('los UNIQUE parciales del inventario espejan los del holder', () => {
  for (const column of ['documentEvidenceId', 'textEvidenceId', 'runLocalSourceId']) {
    assert.match(
      SQL,
      new RegExp(`CREATE UNIQUE INDEX "[^"]+" ON "VerificationRunInventoryItem"\\("verificationRunId", "${column}"\\)`),
      column
    );
  }
});

test('ningun nombre de indice o constraint supera los 63 bytes de Postgres', () => {
  // Postgres TRUNCA en silencio los identificadores largos. Si el nombre escrito
  // no es el que Prisma espera, `migrate` detecta drift.
  const names = [...SQL.matchAll(/(?:INDEX|CONSTRAINT) "([^"]+)"/g)].map((match) => match[1]);
  assert.ok(names.length > 0);
  for (const name of names) {
    assert.ok(Buffer.byteLength(name, 'utf8') <= 63, `${name} (${Buffer.byteLength(name, 'utf8')})`);
  }
});

// ---------------------------------------------------------------------------
// Foreign keys
// ---------------------------------------------------------------------------

test('un borrado del enlace NO puede llevarse en silencio un run congelado', () => {
  // SharingGrant cae en cascada con su User. Con CASCADE aca, un borrado de
  // usuario hecho fuera de la aplicacion se llevaria el registro de auditoria.
  assert.match(
    SQL,
    /"VerificationRun_sharingGrantId_fkey" FOREIGN KEY \("sharingGrantId"\) REFERENCES "SharingGrant"\("id"\) ON DELETE RESTRICT/
  );
});

test('una solicitud sin consumir es efimera: cae con su enlace', () => {
  // Una CONSUMIDA queda protegida igual: su run la referencia en RESTRICT y el
  // run referencia al enlace en RESTRICT.
  assert.match(
    SQL,
    /"VerificationRequest_sharingGrantId_fkey" FOREIGN KEY \("sharingGrantId"\) REFERENCES "SharingGrant"\("id"\) ON DELETE CASCADE/
  );
});

test('la solicitud no puede desaparecer por debajo de su run', () => {
  assert.match(SQL, /"VerificationRun_verificationRequestId_fkey" FOREIGN KEY \("verificationRequestId"\) REFERENCES "VerificationRequest"\("id"\) ON DELETE RESTRICT/);
});

test('credencial y evidencia del inventario en RESTRICT, igual que el holder', () => {
  for (const [column, table] of [
    ['credentialId', 'Credential'],
    ['documentEvidenceId', 'DocumentEvidence'],
    ['textEvidenceId', 'TextEvidence'],
    ['selectedAnalysisRunSourceId', 'AnalysisRunSource']
  ]) {
    assert.match(
      SQL,
      new RegExp(`"VerificationRunInventoryItem_${column}_fkey" FOREIGN KEY \\("${column}"\\) REFERENCES "${table}"\\("id"\\) ON DELETE RESTRICT`),
      column
    );
  }
});

// ---------------------------------------------------------------------------
// CHECKs: identicos a los del holder
// ---------------------------------------------------------------------------

test('la forma de fila por familia es IDENTICA a la del holder', () => {
  assert.equal(
    checkBody(SQL, 'VerificationRunInventoryItem_row_family_shape'),
    checkBody(HOLDER_SQL, 'ReasoningRunInventoryItem_row_family_shape')
  );
});

test('el binding de la extraccion seleccionada es IDENTICO al del holder', () => {
  assert.equal(
    checkBody(SQL, 'VerificationRunInventoryItem_selected_extraction_binding'),
    checkBody(HOLDER_SQL, 'ReasoningRunInventoryItem_selected_extraction_binding')
  );
});

test('una solicitud no puede quedar a medio consumir', () => {
  assert.match(checkBody(SQL, 'VerificationRequest_consumed_shape'), /\("status" = 'consumed'\) = \("consumedAt" IS NOT NULL\)/);
});

test('confirmada o consumida siempre lleva definicion y marca de confirmacion', () => {
  const body = checkBody(SQL, 'VerificationRequest_confirmed_shape');
  assert.match(body, /'requirements_confirmed', 'consumed'/);
  assert.match(body, /"confirmedObjectiveDefinition" IS NOT NULL AND "confirmedAt" IS NOT NULL/);
});

test('el snapshot de politica no puede ser menor que 1', () => {
  assert.match(checkBody(SQL, 'VerificationRun_policy_version_positive'), /"policyVersionSnapshot" >= 1/);
});

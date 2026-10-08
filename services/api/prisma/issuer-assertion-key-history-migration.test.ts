/**
 * HISTORIA DE CLAVES DE ASERCION -- S8c8, items 104-113.
 *
 * Estatico: se afirma sobre el texto del schema y de la migracion. Sin base de
 * datos, sin `migrate deploy`, sin shadow DB y sin red.
 */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const PRISMA_DIR = __dirname;
const MIGRATION_NAME = '20261008193000_add_issuer_assertion_key_history';

async function schema(): Promise<string> {
  return readFile(join(PRISMA_DIR, 'schema.prisma'), 'utf8');
}

async function migration(): Promise<string> {
  return readFile(
    join(PRISMA_DIR, 'migrations', MIGRATION_NAME, 'migration.sql'),
    'utf8'
  );
}

/** SQL EJECUTABLE: los comentarios explican a proposito lo que esta prohibido. */
function executableSql(contents: string): string {
  return contents
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

async function model(name: string): Promise<string> {
  const raw = await schema();
  const match = new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`).exec(raw);
  assert.ok(match, `no se encontro el modelo ${name}`);
  return match[1];
}

// ---------------------------------------------------------------------------
// 104: SOLO UNA RELACION ADITIVA
// ---------------------------------------------------------------------------

test('104: la migration crea UNA tabla y no altera ninguna existente', async () => {
  const sql = executableSql(await migration());

  assert.equal((sql.match(/CREATE TABLE/g) ?? []).length, 1);
  assert.match(sql, /CREATE TABLE "IssuerAssertionKeyBinding"/);

  // Nada de ALTER, DROP ni renombres sobre lo que ya existe.
  for (const forbidden of [
    'ALTER TABLE "SignerProfile"',
    'ALTER TABLE "IssuerTechnicalIdentity"',
    'ALTER TABLE "Credential"',
    'ALTER TABLE "BlockchainRecord"',
    'DROP TABLE',
    'DROP COLUMN',
    'DROP CONSTRAINT',
    'RENAME',
    'ALTER TYPE',
    'CREATE TYPE'
  ]) {
    assert.ok(!sql.includes(forbidden), `no debe contener ${forbidden}`);
  }
});

test('113: los punteros VIGENTES siguen existiendo intactos', async () => {
  const identity = await model('IssuerTechnicalIdentity');

  // Historia y vigencia son conceptos distintos: la historia se agrega SIN
  // tocar los punteros, que siguen siendo la autoridad de uso nuevo.
  assert.match(identity, /assertionSignerProfileId String\s+@unique/);
  assert.match(identity, /anchorSignerProfileId\s+String/);

  // La migration LEE el puntero vigente para el backfill, pero no lo altera ni
  // lo borra: historia y vigencia conviven.
  const sql = executableSql(await migration());
  assert.match(sql, /SELECT "issuerId", "assertionSignerProfileId"/);
  assert.ok(!sql.includes('DROP COLUMN "assertionSignerProfileId"'));
  assert.ok(!sql.includes('ALTER COLUMN "assertionSignerProfileId"'));
  assert.ok(!sql.includes('anchorSignerProfileId'));
});

// ---------------------------------------------------------------------------
// 105: BACKFILL DESDE LA RELACION VIGENTE
// ---------------------------------------------------------------------------

test('105: el backfill sale de IssuerTechnicalIdentity y de nada mas', async () => {
  const sql = executableSql(await migration());

  assert.match(
    sql,
    /INSERT INTO "IssuerAssertionKeyBinding" \("issuerId", "signerProfileId"\)\s*SELECT "issuerId", "assertionSignerProfileId"\s*FROM "IssuerTechnicalIdentity"/
  );

  // Idempotente: reaplicarla no falla.
  assert.match(sql, /ON CONFLICT DO NOTHING/);

  // Exactamente UN insert.
  assert.equal((sql.match(/INSERT INTO/g) ?? []).length, 1);
});

test('106-107: el backfill no lee ni reescribe datos transaccionales', async () => {
  const sql = executableSql(await migration());

  for (const forbidden of [
    'Credential',
    'BlockchainRecord',
    'proof',
    'canonicalHash',
    'verificationMethod',
    'UPDATE "',
    'DELETE FROM'
  ]) {
    assert.ok(!sql.includes(forbidden), `el backfill no debe tocar ${forbidden}`);
  }
});

test('no se fabrica ningun timestamp', async () => {
  const sql = executableSql(await migration());

  for (const forbidden of ['now()', 'CURRENT_TIMESTAMP', 'DEFAULT', 'createdAt']) {
    assert.ok(!sql.includes(forbidden), `no debe contener ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// 108-110: SIN SECRETOS Y SIN DUPLICADOS
// ---------------------------------------------------------------------------

test('108-110: la tabla tiene SOLO las dos columnas de la relacion', async () => {
  const binding = await model('IssuerAssertionKeyBinding');

  const columns = [...binding.matchAll(/^\s{2}(\w+)\s+\w/gm)].map((m) => m[1]);
  assert.deepEqual(columns.sort(), [
    'issuer',
    'issuerId',
    'signerProfile',
    'signerProfileId'
  ]);

  // Ningun secreto, y ninguna copia de la metadata que SignerProfile posee.
  for (const forbidden of [
    'secretRef',
    'privateKey',
    'publicKeyX',
    'publicKeyY',
    'publicKeyCompressed',
    'address',
    'status',
    'keyVersion',
    'custody',
    'purpose',
    'retiredAt'
  ]) {
    assert.ok(
      !binding.includes(forbidden),
      `la historia no debe duplicar ${forbidden}: SignerProfile es la autoridad`
    );
  }

  const sql = executableSql(await migration());
  for (const forbidden of ['secretRef', 'privateKey', 'publicKey', 'address']) {
    assert.ok(!sql.includes(forbidden), `el DDL no debe contener ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// EXCLUSIVIDAD Y POLITICA DE BORRADO
// ---------------------------------------------------------------------------

test('un perfil de asercion pertenece como maximo a UN issuer', async () => {
  const binding = await model('IssuerAssertionKeyBinding');
  assert.match(binding, /signerProfileId String @unique/);

  const sql = executableSql(await migration());
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "IssuerAssertionKeyBinding_signerProfileId_key"/
  );
});

test('la identidad es compuesta y hay indice por issuer', async () => {
  const binding = await model('IssuerAssertionKeyBinding');

  assert.match(binding, /@@id\(\[issuerId, signerProfileId\]\)/);
  assert.match(binding, /@@index\(\[issuerId\]\)/);

  const sql = executableSql(await migration());
  assert.match(sql, /PRIMARY KEY \("issuerId","signerProfileId"\)/);
  assert.match(sql, /CREATE INDEX "IssuerAssertionKeyBinding_issuerId_idx"/);
});

test('borrar un SignerProfile NO puede borrar la historia en cascada', async () => {
  const binding = await model('IssuerAssertionKeyBinding');

  // `Restrict` explicito del lado de la clave: la historia es lo que vuelve
  // verificables las credentials firmadas con ella.
  assert.match(
    binding,
    /signerProfile SignerProfile @relation\(fields: \[signerProfileId\], references: \[id\], onDelete: Restrict\)/
  );

  const sql = executableSql(await migration());
  assert.match(
    sql,
    /"IssuerAssertionKeyBinding_signerProfileId_fkey"[\s\S]*?ON DELETE RESTRICT/
  );
});

test('la historia sigue la politica de retencion del issuer', async () => {
  const binding = await model('IssuerAssertionKeyBinding');

  // Igual que `IssuerTechnicalIdentity.issuer`, que ya es Cascade: la historia
  // esta acotada a un issuer que dejo de existir.
  assert.match(
    binding,
    /issuer\s+Issuer\s+@relation\(fields: \[issuerId\], references: \[id\], onDelete: Cascade\)/
  );

  const identity = await model('IssuerTechnicalIdentity');
  assert.match(identity, /issuer\s+Issuer\s+@relation\([^)]*onDelete: Cascade\)/);
});

// ---------------------------------------------------------------------------
// 111-112: LAS MIGRATIONS ANTERIORES QUEDAN INTACTAS
// ---------------------------------------------------------------------------

test('111-112: la migration es la ultima y no reescribe ninguna anterior', async () => {
  const entries = (
    await readdir(join(PRISMA_DIR, 'migrations'), { withFileTypes: true })
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.equal(entries[entries.length - 1], MIGRATION_NAME);

  // La de S8c1 sigue creando la identidad tecnica y la procedencia.
  const s8c1 = await readFile(
    join(
      PRISMA_DIR,
      'migrations',
      '20261006120000_add_issuer_technical_identity_and_evidence_provenance',
      'migration.sql'
    ),
    'utf8'
  );
  assert.match(s8c1, /CREATE TABLE "IssuerTechnicalIdentity"/);
  assert.ok(!s8c1.includes('IssuerAssertionKeyBinding'));

  // Y la de S8c6 sigue siendo la que hizo nullable los hechos de cadena.
  const s8c6 = await readFile(
    join(
      PRISMA_DIR,
      'migrations',
      '20261008120000_make_blockchain_record_chain_fields_nullable',
      'migration.sql'
    ),
    'utf8'
  );
  assert.match(s8c6, /ALTER COLUMN "txHash" DROP NOT NULL/);
  assert.ok(!s8c6.includes('IssuerAssertionKeyBinding'));
});

test('NO existe ninguna tabla de historia de ANCHOR', async () => {
  // S8c6 ya congela el anchor historico en cada registracion real, y esa fila
  // es mejor historia que una tabla: dice exactamente que cuenta firmo que
  // hash. Crear una por simetria agregaria una segunda verdad.
  const raw = await schema();

  for (const forbidden of [
    'model IssuerAnchorKeyBinding',
    'model IssuerAnchorKeyHistory',
    'model AnchorKeyBinding'
  ]) {
    assert.ok(!raw.includes(forbidden), `no debe existir ${forbidden}`);
  }

  const record = await model('BlockchainRecord');
  assert.match(record, /anchorSignerProfileId\s+String\?/);
});

/**
 * Migration del intent PENDING durable -- S8c6, matriz 1 y 47.
 *
 * Aserciones ESTRUCTURALES sobre el SQL y el schema. No se aplica nada contra
 * ninguna base: no hay RDS, no hay Neon, no hay shadow database y no se ejecuta
 * `migrate deploy`.
 *
 * Lo que congela:
 *
 *   * los TRES campos que se vuelven nullable son exactamente los HECHOS DE LA
 *     CADENA, y ninguno mas;
 *   * no se agrega ninguna columna de ciclo de vida especulativa;
 *   * no se introduce ningun DEFAULT que le daria a una fila pendiente un
 *     hecho de cadena falso;
 *   * no hay backfill ni reescritura de filas existentes;
 *   * `txHash` no tiene restriccion de unicidad que haya que preservar.
 */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const PRISMA_DIR = __dirname;
const MIGRATION_NAME =
  '20261008120000_make_blockchain_record_chain_fields_nullable';

async function schema(): Promise<string> {
  return readFile(join(PRISMA_DIR, 'schema.prisma'), 'utf8');
}

async function migration(): Promise<string> {
  return readFile(
    join(PRISMA_DIR, 'migrations', MIGRATION_NAME, 'migration.sql'),
    'utf8'
  );
}

/** SQL sin comentarios: las aserciones negativas miran DDL real, no prosa. */
function executableSql(contents: string): string {
  return contents
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

async function modelBody(name: string): Promise<string> {
  const raw = await schema();
  const match = new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`).exec(raw);
  assert.ok(match, `no se encontro el modelo ${name}`);
  return match[1];
}

// ---------------------------------------------------------------------------
// 1: LOS TRES CAMPOS DE CADENA
// ---------------------------------------------------------------------------

test('1: exactamente los tres hechos de la cadena pasan a ser nullable', async () => {
  const sql = executableSql(await migration());

  // Un solo ALTER TABLE, tres DROP NOT NULL.
  assert.equal((sql.match(/ALTER TABLE/g) ?? []).length, 1);
  assert.match(sql, /ALTER TABLE "BlockchainRecord"/);

  const dropped = [...sql.matchAll(/ALTER COLUMN "(\w+)" DROP NOT NULL/g)].map(
    (match) => match[1]
  );
  assert.deepEqual(dropped.sort(), [
    'issuerAddress',
    'registeredAt',
    'txHash'
  ]);
});

test('el schema declara esos tres como opcionales y el resto igual', async () => {
  const body = await modelBody('BlockchainRecord');

  assert.match(body, /txHash\s+String\?/);
  assert.match(body, /issuerAddress\s+String\?/);
  assert.match(body, /registeredAt\s+DateTime\?/);

  // Lo que se sabe de la INTENCION sigue siendo obligatorio: si alguno de
  // estos se volviera nullable, un intent podria persistirse sin procedencia.
  assert.match(body, /credentialId\s+String\s/);
  assert.match(body, /credentialHash\s+String\s/);
  assert.match(body, /hashAlgorithm\s+String\s/);
  assert.match(body, /canonicalizationVersion\s+String\s/);
  assert.match(body, /network\s+BlockchainNetwork\s/);
  assert.match(body, /chainId\s+Int\s/);
  assert.match(body, /contractAddress\s+String\s/);
  assert.match(body, /status\s+BlockchainRecordStatus\s/);
});

test('`blockNumber` ya era nullable desde S8c1: esta migration no lo toca', async () => {
  const body = await modelBody('BlockchainRecord');
  const sql = executableSql(await migration());

  assert.match(body, /blockNumber\s+Int\?/);
  assert.ok(!sql.includes('blockNumber'));
});

test('`pending` ya existia en el enum desde S8c1', async () => {
  const raw = await schema();
  const match = /enum BlockchainRecordStatus \{([\s\S]*?)\n\}/.exec(raw);
  assert.ok(match);

  const values = match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  assert.deepEqual(values, ['registered', 'revoked', 'pending']);

  // Esta migration NO toca el enum: era alcanzable a nivel enum mientras
  // `txHash` seguia NOT NULL, lo que hacia el estado inexpresable.
  const sql = executableSql(await migration());
  assert.ok(!sql.includes('ALTER TYPE'));
  assert.ok(!sql.includes('BlockchainRecordStatus'));
});

// ---------------------------------------------------------------------------
// 3-6: NINGUN DEFAULT FALSO
// ---------------------------------------------------------------------------

test('3-6: la migration no introduce ningun DEFAULT de cadena', async () => {
  const sql = executableSql(await migration());

  // `registeredAt DEFAULT now()` le daria a una fila pendiente un timestamp de
  // cadena falso. Ningun default, de ningun tipo.
  assert.ok(!sql.includes('DEFAULT'));
  assert.ok(!sql.toLowerCase().includes('now()'));
  assert.ok(!sql.toLowerCase().includes('current_timestamp'));
});

test('el schema tampoco le pone default a los tres campos de cadena', async () => {
  const body = await modelBody('BlockchainRecord');

  for (const field of ['txHash', 'issuerAddress', 'registeredAt']) {
    const line = new RegExp(`${field}\\s+\\S+\\?[^\\n]*`).exec(body);
    assert.ok(line, field);
    assert.ok(!line[0].includes('@default'), `${field} no debe tener default`);
  }
});

// ---------------------------------------------------------------------------
// SIN COLUMNAS ESPECULATIVAS
// ---------------------------------------------------------------------------

test('no se agrega ninguna columna de ciclo de vida especulativa', async () => {
  const sql = executableSql(await migration());
  const body = await modelBody('BlockchainRecord');

  assert.ok(!sql.includes('ADD COLUMN'));

  for (const speculative of [
    'lastError',
    'retryCount',
    'nextRetry',
    'nonce',
    'providerMessage',
    'attempts',
    'broadcastAt',
    'finalizedAt'
  ]) {
    assert.ok(!sql.includes(speculative), `SQL: ${speculative}`);
    assert.ok(!body.includes(speculative), `schema: ${speculative}`);
  }
});

// ---------------------------------------------------------------------------
// SIN BACKFILL
// ---------------------------------------------------------------------------

test('no hay backfill ni reescritura de filas existentes', async () => {
  const sql = executableSql(await migration());

  for (const forbidden of [
    'UPDATE ',
    'INSERT ',
    'DELETE ',
    'TRUNCATE',
    'SET ',
    'COALESCE'
  ]) {
    assert.ok(!sql.includes(forbidden), forbidden);
  }

  // Aflojar NOT NULL no toca datos: las filas legacy y las mock siguen con sus
  // tres campos poblados y siguen siendo validas.
  assert.match(sql, /DROP NOT NULL/);
});

// ---------------------------------------------------------------------------
// UNICIDAD DE txHash
// ---------------------------------------------------------------------------

test('`txHash` no tiene restriccion de unicidad que preservar', async () => {
  const body = await modelBody('BlockchainRecord');

  // Verificado contra la migration inicial: hay `CREATE INDEX`, nunca
  // `CREATE UNIQUE INDEX`, sobre txHash. Asi que volverlo nullable no toca
  // ninguna unicidad y no hace falta razonar sobre NULL en un indice unico.
  const txHashLine = /txHash\s+String\?[^\n]*/.exec(body);
  assert.ok(txHashLine);
  assert.ok(!txHashLine[0].includes('@unique'));

  const initial = await readFile(
    join(PRISMA_DIR, 'migrations', '20260709135135_init', 'migration.sql'),
    'utf8'
  );
  assert.match(initial, /CREATE INDEX "BlockchainRecord_txHash_idx"/);
  assert.ok(!initial.includes('CREATE UNIQUE INDEX "BlockchainRecord_txHash'));

  // Y el indice sigue existiendo: no se lo quita por volverse nullable.
  assert.match(body, /@@index\(\[txHash\]\)/);
});

// ---------------------------------------------------------------------------
// LA MIGRATION ES LA ULTIMA Y NO REESCRIBE LAS ANTERIORES
// ---------------------------------------------------------------------------

test('la migration es nueva y las anteriores quedan intactas', async () => {
  const entries = (
    await readdir(join(PRISMA_DIR, 'migrations'), { withFileTypes: true })
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.equal(entries[entries.length - 1], MIGRATION_NAME);

  // La de S8c1 sigue siendo la que creo los campos de procedencia.
  const s8c1 = await readFile(
    join(
      PRISMA_DIR,
      'migrations',
      '20261006120000_add_issuer_technical_identity_and_evidence_provenance',
      'migration.sql'
    ),
    'utf8'
  );
  assert.match(s8c1, /"anchorSignerProfileId" TEXT/);
  assert.match(s8c1, /"blockNumber" INTEGER/);
});

/**
 * Migration de identidad tecnica del issuer + procedencia de evidencia -- S8c1.
 *
 * Congela la forma acordada: seis enums nuevos, UN valor agregado al final de
 * `BlockchainRecordStatus`, dos tablas nuevas y columnas NUEVAS Y NULLABLE
 * sobre `Issuer`, `Credential` y `BlockchainRecord`. Nada destructivo, ningun
 * backfill, ninguna columna existente endurecida.
 *
 * Mismo helper de "SQL sin comentarios" que el resto de los tests de migration
 * del repo: las aserciones negativas tienen que mirar DDL ejecutable, no prosa.
 * Esta migration explica en comentarios por que NO lleva backfill y por que usa
 * RESTRICT en vez de SET NULL, y menciona ahi esas palabras; assertar sobre el
 * archivo crudo confundiria la explicacion con DDL real.
 */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const MIGRATION =
  '20261006120000_add_issuer_technical_identity_and_evidence_provenance';
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

test('crea exactamente las dos tablas nuevas', async () => {
  const sql = await executableSql();

  const created = [...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(created, ['SignerProfile', 'IssuerTechnicalIdentity']);
});

test('crea exactamente los seis enums nuevos', async () => {
  const sql = await executableSql();

  const created = [...sql.matchAll(/CREATE TYPE "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(created, [
    'BlockchainEvidenceMode',
    'AnchorRegistrantScope',
    'SignerProfilePurpose',
    'SignerKeyCustody',
    'SignerProfileStatus',
    'IssuerTechnicalIdentityStatus'
  ]);
});

test('los valores de cada enum nuevo son los congelados', async () => {
  const sql = await executableSql();

  assert.match(
    sql,
    /CREATE TYPE "BlockchainEvidenceMode" AS ENUM \('mock', 'credential_registry'\);/
  );
  assert.match(
    sql,
    /CREATE TYPE "AnchorRegistrantScope" AS ENUM \('issuer_exclusive', 'shared_custodial'\);/
  );
  assert.match(
    sql,
    /CREATE TYPE "SignerProfilePurpose" AS ENUM \('assertion', 'anchor'\);/
  );
  assert.match(
    sql,
    /CREATE TYPE "SignerKeyCustody" AS ENUM \('scope_managed', 'institution_imported'\);/
  );
  assert.match(
    sql,
    /CREATE TYPE "SignerProfileStatus" AS ENUM \('active', 'retired', 'compromised'\);/
  );
  assert.match(
    sql,
    /CREATE TYPE "IssuerTechnicalIdentityStatus" AS ENUM \('unconfigured', 'active', 'rotation_required', 'disabled'\);/
  );
});

test('agrega UN solo valor a UN solo enum existente, y al final', async () => {
  const sql = await executableSql();

  const altered = [...sql.matchAll(/ALTER TYPE "(\w+)" ADD VALUE '(\w+)'/g)].map(
    (m) => ({ type: m[1], value: m[2] })
  );
  assert.deepEqual(altered, [
    { type: 'BlockchainRecordStatus', value: 'pending' }
  ]);

  // ADD VALUE plano: sin BEFORE/AFTER, que es la forma segura y la que permite
  // ejecutarlo dentro de la transaccion de la migration en PostgreSQL 12+.
  assert.doesNotMatch(sql, /ADD VALUE[^;]*\bBEFORE\b/i);
  assert.doesNotMatch(sql, /ADD VALUE[^;]*\bAFTER\b/i);

  // Ningun otro ALTER TYPE: en particular no se renombran ni se reordenan
  // valores existentes.
  assert.equal((sql.match(/ALTER TYPE/g) ?? []).length, 1);
  assert.doesNotMatch(sql, /RENAME VALUE/i);
});

test('el valor nuevo del enum NO se usa en esta misma migration', async () => {
  // PostgreSQL prohibe usar un valor de enum recien agregado en la misma
  // transaccion que lo agrego. Como la migration corre en una transaccion, el
  // unico uso seguro es ninguno: la sentencia ADD VALUE y nada mas.
  const withoutAddValue = (await executableSql())
    .split('\n')
    .filter((line) => !/^ALTER TYPE .* ADD VALUE /.test(line.trim()))
    .join('\n');

  assert.doesNotMatch(withoutAddValue, /pending/i);
});

test('no es destructiva', async () => {
  const sql = await executableSql();

  assert.doesNotMatch(sql, /\bDROP\b/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(sql, /\bRENAME\b/i);
  assert.doesNotMatch(sql, /ALTER COLUMN/i);
});

test('no tiene backfill: ninguna fila existente recibe procedencia inventada', async () => {
  const sql = await executableSql();

  assert.doesNotMatch(sql, /^\s*UPDATE\s+"/im);
  assert.doesNotMatch(sql, /^\s*INSERT\s+INTO/im);
});

test('las columnas nuevas de BlockchainRecord son las cinco congeladas, todas nullable', async () => {
  const sql = await executableSql();

  const alterBlock = /ALTER TABLE "BlockchainRecord" ([\s\S]*?);/.exec(sql);
  assert.ok(alterBlock, 'no se encontro el ALTER TABLE de BlockchainRecord');

  const added = [...alterBlock[1].matchAll(/ADD COLUMN\s+"(\w+)"/g)]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(added, [
    'anchorRegistrantScope',
    'anchorSignerProfileId',
    'blockNumber',
    'deploymentId',
    'evidenceMode'
  ]);

  // Ninguna de las cinco es NOT NULL y ninguna lleva DEFAULT: una fila legacy
  // queda en NULL, es decir "procedencia desconocida", nunca etiquetada.
  assert.doesNotMatch(alterBlock[1], /NOT NULL/i);
  assert.doesNotMatch(alterBlock[1], /DEFAULT/i);
});

test('Issuer solo gana allowedCredentialTypes, y did/walletAddress quedan intactos', async () => {
  const sql = await executableSql();

  const alterBlock = /ALTER TABLE "Issuer" ([\s\S]*?);/.exec(sql);
  assert.ok(alterBlock, 'no se encontro el ALTER TABLE de Issuer');

  const added = [...alterBlock[1].matchAll(/ADD COLUMN\s+"(\w+)"/g)].map(
    (m) => m[1]
  );
  assert.deepEqual(added, ['allowedCredentialTypes']);
  assert.match(alterBlock[1], /"CredentialType"\[\]/);

  // La estrategia legacy es NO tocar los campos viejos en esta slice.
  assert.doesNotMatch(sql, /"walletAddress"/);
  assert.doesNotMatch(sql, /ALTER TABLE "Issuer"[^;]*"did"/);
});

// ---------------------------------------------------------------------------
// allowedCredentialTypes -- SEMANTICA DE ARRAY VACIO (S8c1.1)
//
// El campo va a ser authority input, asi que la restriccion tiene que vivir en
// la BASE y no en una coercion del ORM. Lo que se congela aca es que el SQL
// generado exprese directamente la semantica de dominio:
//   []   -> ningun credential type habilitado;
//   NULL -> no es un estado persistible.
//
// Nada de esto se verifica contra una instancia real de PostgreSQL: es una
// afirmacion ESTRUCTURAL sobre el SQL que se va a aplicar.
// ---------------------------------------------------------------------------

test('allowedCredentialTypes: NOT NULL con DEFAULT de array vacio, en UNA sentencia', async () => {
  const sql = await executableSql();

  // Sintaxis derivada de `prisma migrate diff` para una lista escalar de enum,
  // no inventada: `ARRAY[]::"CredentialType"[]`.
  assert.match(
    sql,
    /ALTER TABLE "Issuer" ADD COLUMN\s+"allowedCredentialTypes" "CredentialType"\[\] NOT NULL DEFAULT ARRAY\[\]::"CredentialType"\[\];/
  );
});

test('allowedCredentialTypes: NULL no es persistible', async () => {
  const sql = await executableSql();

  const alterBlock = /ALTER TABLE "Issuer" ([\s\S]*?);/.exec(sql);
  assert.ok(alterBlock);

  // La columna es la unica de esta migration sobre una tabla existente que
  // lleva NOT NULL, y lo lleva porque el dominio no admite un cuarto estado.
  assert.match(alterBlock[1], /NOT NULL/);

  // Y no queda ningun NULL suelto: sacando los `NOT NULL`, la palabra no
  // aparece mas (no se declara nullable por otra via).
  assert.doesNotMatch(alterBlock[1].replace(/NOT NULL/g, ''), /\bNULL\b/i);
});

test('allowedCredentialTypes: el default es un array CONSTANTE y vacio', async () => {
  const sql = await executableSql();

  const alterBlock = /ALTER TABLE "Issuer" ([\s\S]*?);/.exec(sql);
  assert.ok(alterBlock);

  assert.match(alterBlock[1], /DEFAULT ARRAY\[\]::"CredentialType"\[\]/);
  // Vacio de verdad: ningun valor del enum se habilita por defecto.
  for (const type of [
    'academic_subject',
    'course',
    'certification',
    'degree'
  ]) {
    assert.doesNotMatch(
      alterBlock[1],
      new RegExp(type),
      `el default no debe habilitar ${type}`
    );
  }
});

test('allowedCredentialTypes: sin UPDATE ni backfill separado', async () => {
  const sql = await executableSql();

  // Un ADD COLUMN con default constante ya le da [] a las filas existentes; en
  // PostgreSQL 11+ es metadata-only y no reescribe la tabla.
  assert.doesNotMatch(sql, /allowedCredentialTypes[^;]*UPDATE/i);
  assert.doesNotMatch(sql, /^\s*UPDATE\s+"Issuer"/im);
  assert.doesNotMatch(sql, /SET\s+"allowedCredentialTypes"/i);

  // Una sola sentencia menciona la columna, y es el ADD COLUMN.
  const mentions = (await statements()).filter((statement) =>
    statement.includes('allowedCredentialTypes')
  );
  assert.equal(mentions.length, 1);
  assert.match(mentions[0], /^ALTER TABLE "Issuer" ADD COLUMN/);
});

test('allowedCredentialTypes: es la UNICA columna nueva con NOT NULL sobre una tabla existente', async () => {
  const sql = await executableSql();

  // Las cinco de BlockchainRecord y el `proof` de Credential siguen siendo
  // nullable: ahi NULL si significa "legacy/desconocido".
  for (const table of ['Credential', 'BlockchainRecord']) {
    const block = new RegExp(`ALTER TABLE "${table}" ([\\s\\S]*?);`).exec(sql);
    assert.ok(block, `no se encontro el ALTER TABLE de ${table}`);
    assert.doesNotMatch(block[1], /NOT NULL/i, `${table} no debe endurecerse`);
    assert.doesNotMatch(block[1], /DEFAULT/i, `${table} no debe recibir default`);
  }
});

test('Credential solo gana proof, como JSONB nullable', async () => {
  const sql = await executableSql();

  const alterBlock = /ALTER TABLE "Credential" ([\s\S]*?);/.exec(sql);
  assert.ok(alterBlock, 'no se encontro el ALTER TABLE de Credential');

  const added = [...alterBlock[1].matchAll(/ADD COLUMN\s+"(\w+)"/g)].map(
    (m) => m[1]
  );
  assert.deepEqual(added, ['proof']);
  assert.match(alterBlock[1], /"proof" JSONB/);
  assert.doesNotMatch(alterBlock[1], /NOT NULL/i);

  // canonicalHash y canonicalizationVersion NO se tocan: los hashes historicos
  // quedan exactamente como estan.
  assert.doesNotMatch(sql, /"canonicalHash"/);
  assert.doesNotMatch(sql, /"canonicalizationVersion"/);
});

test('solo toca esas tres tablas existentes, mas las dos que crea', async () => {
  const sql = await executableSql();

  const altered = [...sql.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(altered)].sort(), [
    'BlockchainRecord',
    'Credential',
    'Issuer',
    'IssuerTechnicalIdentity'
  ]);

  // `IssuerTechnicalIdentity` aparece solo como destino de sus propias FKs.
  const addColumnTables = [
    ...sql.matchAll(/ALTER TABLE "(\w+)" ADD COLUMN/g)
  ].map((m) => m[1]);
  assert.deepEqual([...new Set(addColumnTables)].sort(), [
    'BlockchainRecord',
    'Credential',
    'Issuer'
  ]);
});

test('SignerProfile declara exactamente las columnas congeladas', async () => {
  const sql = await executableSql();

  const table = /CREATE TABLE "SignerProfile" \(([\s\S]*?)\n\);/.exec(sql);
  assert.ok(table, 'no se encontro el CREATE TABLE de SignerProfile');

  const columns = [...table[1].matchAll(/^\s{4}"(\w+)"/gm)].map((m) => m[1]);
  assert.deepEqual(columns, [
    'id',
    'label',
    'purpose',
    'custody',
    'secretRef',
    'address',
    'publicKeyX',
    'publicKeyY',
    'publicKeyCompressed',
    'keyVersion',
    'addressVerifiedAt',
    'status',
    'createdAt',
    'retiredAt'
  ]);

  assert.match(table[1], /"keyVersion" INTEGER NOT NULL/);
  assert.match(table[1], /"status" "SignerProfileStatus" NOT NULL DEFAULT 'active'/);
  // El material publico es opcional: un anchor profile no necesita coordenadas.
  assert.match(table[1], /"publicKeyX" TEXT,/);
  assert.match(table[1], /"publicKeyY" TEXT,/);
  assert.match(table[1], /"publicKeyCompressed" TEXT,/);
  assert.match(table[1], /"addressVerifiedAt" TIMESTAMP\(3\),/);
});

test('NINGUNA columna puede contener key material', async () => {
  const sql = await executableSql();

  for (const forbidden of [
    'privateKey',
    'private_key',
    'privkey',
    'mnemonic',
    'seedPhrase',
    'seed_phrase',
    'secretValue',
    'secret_value',
    'keyMaterial',
    'passphrase'
  ]) {
    assert.doesNotMatch(
      sql,
      new RegExp(forbidden, 'i'),
      `la migration no debe declarar ${forbidden}`
    );
  }

  // `secretRef` SI es legitimo: es el NOMBRE de un parametro en el secret
  // store, nunca su valor.
  assert.match(sql, /"secretRef" TEXT NOT NULL/);
});

test('IssuerTechnicalIdentity declara exactamente las columnas congeladas', async () => {
  const sql = await executableSql();

  const table = /CREATE TABLE "IssuerTechnicalIdentity" \(([\s\S]*?)\n\);/.exec(
    sql
  );
  assert.ok(table, 'no se encontro el CREATE TABLE de IssuerTechnicalIdentity');

  const columns = [...table[1].matchAll(/^\s{4}"(\w+)"/gm)].map((m) => m[1]);
  assert.deepEqual(columns, [
    'id',
    'issuerId',
    'did',
    'assertionSignerProfileId',
    'anchorSignerProfileId',
    'status',
    'createdAt',
    'updatedAt'
  ]);

  assert.match(table[1], /"did" TEXT NOT NULL/);
  assert.match(
    table[1],
    /"status" "IssuerTechnicalIdentityStatus" NOT NULL DEFAULT 'unconfigured'/
  );
});

test('CARDINALIDAD: assertion profile UNIQUE, anchor profile NO unique', async () => {
  const sql = await executableSql();

  // Una assertion key no puede identificar a dos issuers. Constraint
  // relacional, no validacion de servicio.
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "IssuerTechnicalIdentity_assertionSignerProfileId_key" ON "IssuerTechnicalIdentity"\("assertionSignerProfileId"\)/
  );

  // El anchor SI se comparte: indice no-unique. Si alguien lo volviera unique,
  // la configuracion de demo (tres issuers, un anchor) dejaria de ser
  // representable.
  assert.match(
    sql,
    /CREATE INDEX "IssuerTechnicalIdentity_anchorSignerProfileId_idx" ON "IssuerTechnicalIdentity"\("anchorSignerProfileId"\)/
  );
  assert.doesNotMatch(
    sql,
    /CREATE UNIQUE INDEX[^;]*\("anchorSignerProfileId"\)/
  );

  // Una identidad tecnica por issuer, y un DID no identifica a dos issuers.
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "IssuerTechnicalIdentity_issuerId_key" ON "IssuerTechnicalIdentity"\("issuerId"\)/
  );
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "IssuerTechnicalIdentity_did_key" ON "IssuerTechnicalIdentity"\("did"\)/
  );
});

test('CARDINALIDAD: address, secretRef y label son unicos en SignerProfile', async () => {
  const sql = await executableSql();

  assert.match(
    sql,
    /CREATE UNIQUE INDEX "SignerProfile_address_key" ON "SignerProfile"\("address"\)/
  );
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "SignerProfile_secretRef_key" ON "SignerProfile"\("secretRef"\)/
  );
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "SignerProfile_label_key" ON "SignerProfile"\("label"\)/
  );
});

test('las referencias historicas al signer NO desaparecen por cascade', async () => {
  const sql = await executableSql();

  // La procedencia del BlockchainRecord es el caso critico: el default de
  // Prisma para una relacion opcional seria SET NULL, que destruiria el dato
  // que la revocacion necesita despues de una rotacion de anchor.
  assert.match(
    sql,
    /ADD CONSTRAINT "BlockchainRecord_anchorSignerProfileId_fkey" FOREIGN KEY \("anchorSignerProfileId"\) REFERENCES "SignerProfile"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/
  );
  assert.match(
    sql,
    /ADD CONSTRAINT "IssuerTechnicalIdentity_assertionSignerProfileId_fkey" FOREIGN KEY \("assertionSignerProfileId"\) REFERENCES "SignerProfile"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/
  );
  assert.match(
    sql,
    /ADD CONSTRAINT "IssuerTechnicalIdentity_anchorSignerProfileId_fkey" FOREIGN KEY \("anchorSignerProfileId"\) REFERENCES "SignerProfile"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/
  );

  // Ninguna FK hacia SignerProfile puede ser SET NULL ni CASCADE on delete.
  const signerProfileFks = [
    ...sql.matchAll(
      /FOREIGN KEY \("(\w+)"\) REFERENCES "SignerProfile"\("id"\) ON DELETE (\w+)/g
    )
  ].map((m) => ({ column: m[1], onDelete: m[2] }));
  assert.equal(signerProfileFks.length, 3);
  for (const fk of signerProfileFks) {
    assert.equal(fk.onDelete, 'RESTRICT', `${fk.column} debe ser RESTRICT`);
  }
});

test('declara exactamente las cuatro FKs esperadas', async () => {
  const sql = await executableSql();

  const foreignKeys = [...sql.matchAll(/FOREIGN KEY \("(\w+)"\)/g)].map(
    (m) => m[1]
  );
  assert.deepEqual(foreignKeys.sort(), [
    'anchorSignerProfileId',
    'anchorSignerProfileId',
    'assertionSignerProfileId',
    'issuerId'
  ]);
});

test('no toca ninguna tabla ajena al alcance de S8c1', async () => {
  const sql = await executableSql();

  for (const table of [
    'User',
    'PlatformAdmin',
    'IssuerMembership',
    'AuthCredential',
    'AcademicCourse',
    'Program',
    'SharingGrant',
    'VerificationEvent',
    'SemanticAnalysis',
    'FormativeProfile'
  ]) {
    assert.doesNotMatch(
      sql,
      new RegExp(`ALTER TABLE "${table}"`),
      `no debe alterar ${table}`
    );
  }
});

test('ninguna migration aplicada fue modificada -- la cadena solo crece', async () => {
  const all = (
    await readdir(join(__dirname, 'migrations'), { withFileTypes: true })
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  // Posicion historica, no "es la ultima": agregar una migration posterior es
  // legitimo y no debe romper este test. Sigue fallando si se la borra, se la
  // renombra o se inserta una migration cronologicamente anterior.
  assert.equal(all.indexOf(MIGRATION), 20, 'posicion historica en la cadena');
  assert.equal(
    new Set(all).size,
    all.length,
    'sin timestamps duplicados en la cadena'
  );

  // Las posiciones que otros tests de migration ya congelaron no se corrieron.
  assert.equal(all.indexOf('20261003120000_add_platform_admin'), 18);
  assert.equal(all.indexOf('20261004120000_add_user_onboarding_intent'), 19);
});

test('es una sola migration y el batch tiene el tamaño esperado', async () => {
  const all = await statements();

  // 6 enums + 1 ADD VALUE + 2 CREATE TABLE + 3 ALTER TABLE ADD COLUMN
  // + 12 indices + 4 FKs = 28.
  assert.equal(all.length, 28);
});

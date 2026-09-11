/**
 * Migration de la tabla Objective — F2.1.
 *
 * Congela la forma acordada en F2.0: UNA tabla, OCHO columnas fisicas, dos
 * enums, y ninguno de los campos que el diseño elimino explicitamente.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const PATH = 'prisma/migrations/20260904120000_add_objective/migration.sql';

/**
 * SQL sin comentarios.
 *
 * Las aserciones negativas tienen que mirar DDL ejecutable, no prosa: esta
 * migracion explica en un comentario por que NO lleva un indice UNIQUE sobre
 * `supersedesObjectiveId`, y menciona ahi las palabras `UNIQUE` y `CONSTRAINT`.
 * Assertar sobre el archivo crudo confundiria esa explicacion con DDL real.
 * Mismo helper que el test de la migration de F1.1.
 */
async function executableSql(): Promise<string> {
  const raw = await readFile(PATH, 'utf8');
  return raw
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

test('creates exactly one new table', async () => {
  const sql = await executableSql();

  const created = [...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((match) => match[1]);
  assert.deepEqual(created, ['Objective']);
});

test('is purely additive — it does not touch any existing table', async () => {
  const sql = await executableSql();

  // El unico ALTER TABLE permitido es sobre la tabla que esta migration crea.
  const altered = [...sql.matchAll(/ALTER TABLE "(\w+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(altered)], ['Objective']);

  assert.doesNotMatch(sql, /\bDROP\b/i);

  // Backfill = sentencias DML al principio de una linea. La palabra suelta no
  // sirve: `ON UPDATE CASCADE` es una accion referencial de las FK, no un
  // UPDATE de datos, y buscar /\bUPDATE\b/ la confundia con un backfill.
  assert.doesNotMatch(sql, /^\s*UPDATE\s+"/im, 'sin backfill');
  assert.doesNotMatch(sql, /^\s*INSERT\s+INTO/im, 'sin backfill');
});

test('declares exactly the eight frozen columns', async () => {
  const sql = await executableSql();

  const table = /CREATE TABLE "Objective" \(([\s\S]*?)\n\);/.exec(sql);
  assert.ok(table, 'no se encontro el CREATE TABLE');

  const columns = [...table[1].matchAll(/^\s{4}"(\w+)"/gm)].map((match) => match[1]);
  assert.deepEqual(columns, [
    'id',
    'ownerUserId',
    'objectiveType',
    'title',
    'definition',
    'supersedesObjectiveId',
    'status',
    'createdAt'
  ]);
  assert.equal(columns.length, 8);
});

test('definition is a required JSONB column', async () => {
  const sql = await executableSql();

  assert.match(sql, /"definition" JSONB NOT NULL/);
  // Sin columna de schemaVersion: el artifact la lleva dentro y es requerida.
  assert.doesNotMatch(sql, /definitionSchemaVersion/);
});

test('nullability and defaults match the design', async () => {
  const sql = await executableSql();

  assert.match(sql, /"id" TEXT NOT NULL/);
  assert.match(sql, /"ownerUserId" TEXT NOT NULL/);
  assert.match(sql, /"objectiveType" "ObjectiveType" NOT NULL/);
  assert.match(sql, /"title" TEXT NOT NULL/);
  assert.match(sql, /"status" "ObjectiveStatus" NOT NULL DEFAULT 'active'/);
  assert.match(sql, /"createdAt" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);

  // La auto-referencia es la unica columna nullable: un Objective base no
  // reemplaza a ninguno.
  assert.match(sql, /"supersedesObjectiveId" TEXT,/);
  assert.doesNotMatch(sql, /"supersedesObjectiveId" TEXT NOT NULL/);
});

test('declares both enums with the frozen tokens', async () => {
  const sql = await executableSql();

  assert.match(
    sql,
    /CREATE TYPE "ObjectiveType" AS ENUM \('EMPLOYMENT', 'SCHOLARSHIP', 'ADMISSION', 'EQUIVALENCE', 'OTHER'\);/
  );
  // Los tokens de tipo van en MAYUSCULA porque son los MISMOS que el artifact
  // guarda: el contrato exige igualdad, no traduccion de casing.
  assert.match(sql, /CREATE TYPE "ObjectiveStatus" AS ENUM \('active', 'superseded'\);/);
});

test('declares the owner FK and the self-referencing revision FK', async () => {
  const sql = await executableSql();

  assert.match(
    sql,
    /ADD CONSTRAINT "Objective_ownerUserId_fkey" FOREIGN KEY \("ownerUserId"\) REFERENCES "User"\("id"\) ON DELETE CASCADE/
  );
  // RESTRICT: un Objective historico no debe desaparecer por debajo de su
  // sucesor. F2.1 no implementa delete.
  assert.match(
    sql,
    /ADD CONSTRAINT "Objective_supersedesObjectiveId_fkey" FOREIGN KEY \("supersedesObjectiveId"\) REFERENCES "Objective"\("id"\) ON DELETE RESTRICT/
  );
});

test('declares exactly the three frozen indexes', async () => {
  const sql = await executableSql();

  const indexes = [...sql.matchAll(/CREATE (?:UNIQUE )?INDEX "(\w+)" ON "Objective"\(([^)]*)\)/g)];
  assert.deepEqual(
    indexes.map((match) => match[2]),
    ['"ownerUserId", "status"', '"ownerUserId", "createdAt"', '"supersedesObjectiveId"']
  );

  // Sin indice por objectiveType: la columna esta duplicada para poder filtrar
  // en SQL, y eso no obliga a indexarla en V1.
  assert.ok(!indexes.some((match) => match[2].includes('objectiveType')));
  // Sin GIN sobre el JSON, sin hash de contenido, sin dedup global.
  assert.doesNotMatch(sql, /USING GIN/i);
});

test('does NOT add a UNIQUE constraint on supersedesObjectiveId', async () => {
  const sql = await executableSql();

  // F2.0 deliberadamente no congelo esa constraint. Anadirla prohibiria para
  // siempre cualquier branching futuro sin que nadie lo haya decidido. El unico
  // ganador de una revision concurrente lo garantiza el compare-and-set del
  // camino de escritura, no la base.
  assert.doesNotMatch(sql, /CREATE UNIQUE INDEX/i);
  assert.doesNotMatch(sql, /UNIQUE.*supersedesObjectiveId/i);
});

test('carries none of the fields the design removed', async () => {
  const sql = await executableSql();

  for (const forbidden of [
    'updatedAt',
    'finalizedAt',
    'definitionSchemaVersion',
    'fingerprint',
    'contentHash',
    'objectiveFamilyId',
    'version',
    'isDraft',
    'draftState',
    'publishedAt'
  ]) {
    assert.doesNotMatch(
      sql,
      new RegExp(`"${forbidden}"`, 'i'),
      `${forbidden} no debe existir`
    );
  }
});

test('carries no holder, credential, evidence or reasoning coupling', async () => {
  const sql = await executableSql();

  // El Objective es holder-independent: describe contra que se evalua, nunca
  // como le fue a una persona. Eso no puede entrar por una FK.
  for (const forbidden of [
    'holderId',
    'credentialId',
    'evidenceId',
    'analysisRunId',
    'semanticAnalysisId',
    'reasoningRunId',
    'epistemicTarget',
    'atomicity',
    'evaluability'
  ]) {
    assert.doesNotMatch(sql, new RegExp(forbidden, 'i'), `${forbidden} no debe existir`);
  }

  // Las unicas dos FK son owner y la auto-referencia.
  const references = [...sql.matchAll(/REFERENCES "(\w+)"/g)].map((match) => match[1]);
  assert.deepEqual(references.sort(), ['Objective', 'User']);
});

test('the schema and the migration agree on the model', async () => {
  // Guard barato contra que alguien edite uno y olvide el otro.
  const schema = await readFile('prisma/schema.prisma', 'utf8');
  const model = /model Objective \{([\s\S]*?)\n\}/.exec(schema);
  assert.ok(model, 'no se encontro el model Objective');

  const scalarLines = model[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('//') && !line.startsWith('@@'));

  for (const column of [
    'id',
    'ownerUserId',
    'objectiveType',
    'title',
    'definition',
    'supersedesObjectiveId',
    'status',
    'createdAt'
  ]) {
    assert.ok(
      scalarLines.some((line) => line.startsWith(`${column} `)),
      `el schema debe declarar ${column}`
    );
  }

  assert.match(schema, /enum ObjectiveType \{/);
  assert.match(schema, /enum ObjectiveStatus \{/);
  assert.doesNotMatch(model[1], /updatedAt/);
  assert.doesNotMatch(model[1], /@updatedAt/);
});

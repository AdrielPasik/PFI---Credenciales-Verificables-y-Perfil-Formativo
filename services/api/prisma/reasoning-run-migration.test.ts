/**
 * Migracion F3.1 — regresion estructural sobre el SQL.
 *
 * Se lee el archivo, no la base: F3.1 no aplica ninguna migracion y no abre
 * conexion contra ningun `DATABASE_URL`.
 *
 * Las assertions son sobre SQL EJECUTABLE, nunca sobre comentarios. Los
 * comentarios se borran antes de mirar nada, asi que un test no puede pasar
 * porque la palabra aparezca en una explicacion.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const MIGRATION_DIR = '20260906120000_add_reasoning_run';
const RAW = readFileSync(
  join(__dirname, 'migrations', MIGRATION_DIR, 'migration.sql'),
  'utf8'
);

/** SQL sin comentarios: todo lo que se afirma abajo es codigo, no prosa. */
const SQL = RAW.split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

function statements(): string[] {
  return SQL.split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

// ---------------------------------------------------------------------------
// Tablas y columnas
// ---------------------------------------------------------------------------

test('crea EXACTAMENTE dos tablas', () => {
  const created = statements()
    .filter((statement) => statement.startsWith('CREATE TABLE'))
    .map((statement) => /CREATE TABLE "([A-Za-z]+)"/.exec(statement)?.[1]);
  assert.deepEqual(created, ['ReasoningRun', 'ReasoningRunInventoryItem']);
});

test('NO crea tablas por Requirement, EvidenceUnit, Facet ni artifact', () => {
  // Los tres artifacts de etapa son columnas JSONB dentro de ReasoningRun.
  for (const forbidden of [
    'RequirementResult',
    'EvidenceUnit',
    'RequirementFacet',
    'ObjectiveAnalysis',
    'ReasoningRunArtifact',
    'ReasoningRunSource'
  ]) {
    assert.ok(
      !new RegExp(`CREATE TABLE "${forbidden}"`).test(SQL),
      `no debe crear ${forbidden}`
    );
  }
});

function columnsOf(table: string): string[] {
  const match = new RegExp(`CREATE TABLE "${table}" \\(([\\s\\S]*?)\\n\\);`).exec(
    SQL
  );
  assert.ok(match, `falta CREATE TABLE ${table}`);
  return [...match[1].matchAll(/^\s{4}"([A-Za-z0-9]+)"/gm)].map(
    (column) => column[1]
  );
}

test('ReasoningRun tiene exactamente sus quince columnas fisicas', () => {
  assert.deepEqual(columnsOf('ReasoningRun'), [
    'id',
    'ownerUserId',
    'objectiveId',
    'objectiveDefinitionSnapshot',
    'objectiveTitleSnapshot',
    'status',
    'objectiveAnalysisArtifact',
    'evidenceUnitsArtifact',
    'resultArtifact',
    'executionMetadata',
    'failureCode',
    'createdAt',
    'startedAt',
    'completedAt',
    'failedAt'
  ]);
});

test('ReasoningRunInventoryItem tiene exactamente sus once columnas fisicas', () => {
  assert.deepEqual(columnsOf('ReasoningRunInventoryItem'), [
    'id',
    'reasoningRunId',
    'credentialId',
    'documentEvidenceId',
    'textEvidenceId',
    'sourceSha256',
    'disposition',
    'selectedAnalysisRunSourceId',
    'artifactBlobSha256',
    'runLocalSourceId',
    'createdAt'
  ]);
});

test('los tres slots de etapa son JSONB nullable', () => {
  for (const slot of [
    'objectiveAnalysisArtifact',
    'evidenceUnitsArtifact',
    'resultArtifact',
    'executionMetadata'
  ]) {
    assert.match(SQL, new RegExp(`"${slot}" JSONB(?!\\s+NOT NULL)`));
  }
});

test('el snapshot del Objective es JSONB NOT NULL', () => {
  assert.match(SQL, /"objectiveDefinitionSnapshot" JSONB NOT NULL/);
});

test('credentialId del inventario es NOT NULL y la identidad de fuente no', () => {
  // Es lo que hace representable una credencial emitida sin ninguna evidencia.
  assert.match(SQL, /"credentialId" TEXT NOT NULL/);
  assert.match(SQL, /"documentEvidenceId" TEXT,/);
  assert.match(SQL, /"textEvidenceId" TEXT,/);
  assert.match(SQL, /"sourceSha256" TEXT,/);
});

test('el binding de extraccion se llama selectedAnalysisRunSourceId', () => {
  assert.match(SQL, /"selectedAnalysisRunSourceId" TEXT,/);
  assert.ok(
    !/"analysisRunSourceId"\s+TEXT/.test(SQL),
    'el nombre corto perderia la semantica de "la que este run eligio"'
  );
});

// ---------------------------------------------------------------------------
// Columnas que NO deben existir
// ---------------------------------------------------------------------------

test('no hay columnas que F3.0 excluyo explicitamente', () => {
  for (const forbidden of [
    'updatedAt',
    'objectiveSnapshotSha256',
    'objectiveSnapshotFingerprint',
    'globalScore',
    'fitPercentage',
    'stale',
    'providerResponse',
    'rawPrompt',
    'chainOfThought',
    'exclusionReason',
    'lineageId',
    'technicallyVerified',
    'runArtifact',
    'failureMessage',
    'rawError'
  ]) {
    assert.ok(
      !new RegExp(`"${forbidden}"`).test(SQL),
      `la columna ${forbidden} no pertenece a F3.1`
    );
  }
});

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

test('ReasoningRunStatus es lifecycle operacional, sin estados epistemologicos', () => {
  assert.match(
    SQL,
    /CREATE TYPE "ReasoningRunStatus" AS ENUM \('pending', 'running', 'completed', 'failed'\);/
  );
  for (const epistemic of [
    'ABSTAIN',
    'SUPPORTED',
    'PARTIALLY_SUPPORTED',
    'INSUFFICIENT_EVIDENCE',
    'NOT_ASSESSABLE'
  ]) {
    assert.ok(
      !new RegExp(`"ReasoningRunStatus" AS ENUM[^;]*${epistemic}`).test(SQL),
      `${epistemic} es por Requirement, no lifecycle del run`
    );
  }
});

test('la disposicion persiste las nueve alcanzables y ninguna mas', () => {
  const match = /CREATE TYPE "ReasoningRunInventoryDisposition" AS ENUM \(([^)]+)\);/.exec(
    SQL
  );
  assert.ok(match, 'falta el enum de disposicion');
  const tokens = [...match[1].matchAll(/'([A-Z_]+)'/g)].map((token) => token[1]);
  assert.deepEqual(tokens, [
    'INCLUDED',
    'EXCLUDED_CREDENTIAL_STATE_DRAFT',
    'EXCLUDED_CREDENTIAL_STATE_REVOKED',
    'EXCLUDED_NO_GROUNDING_SOURCE',
    'EXCLUDED_SOURCE_SUPERSEDED',
    'EXCLUDED_UNSUPPORTED_TYPE',
    'EXCLUDED_ALTERNATE_REPRESENTATION',
    'BLOCKED_EXTRACTION_UNAVAILABLE',
    'BLOCKED_EXTRACTION_INTEGRITY_FAILURE'
  ]);
});

test('los dos BLOCKED_* son tokens DISTINTOS del enum', () => {
  // Uno dice "no hay nada persistido", el otro "hay algo y no es confiable".
  // Colapsarlos haria irreportable una violacion de integridad en reposo.
  assert.match(SQL, /'BLOCKED_EXTRACTION_UNAVAILABLE'/);
  assert.match(SQL, /'BLOCKED_EXTRACTION_INTEGRITY_FAILURE'/);
});

test('el nuevo BLOCKED_* es source-level en familia y tiene rama propia en binding', () => {
  // El CHECK de familia enumera SOLO la familia credential-level y manda todo lo
  // demas al ELSE, asi que el token nuevo queda cubierto sin tocarlo. El de
  // binding SI necesito una rama propia, porque su forma de fila no es ni la de
  // INCLUDED ni la de "no se selecciono nada".
  const family = /"ReasoningRunInventoryItem_row_family_shape" CHECK \(([\s\S]*?)\n\);/.exec(
    SQL
  );
  const binding = /"ReasoningRunInventoryItem_selected_extraction_binding" CHECK \(([\s\S]*?)\n\);/.exec(
    SQL
  );
  // El de familia sigue sin mencionarlo: cae en el ELSE source-level.
  assert.ok(!family![1].includes('BLOCKED_EXTRACTION_INTEGRITY_FAILURE'));
  // El de binding SI lo nombra ahora, y debe hacerlo: es su propia rama.
  assert.ok(binding![1].includes('BLOCKED_EXTRACTION_INTEGRITY_FAILURE'));
});

test('EXCLUDED_DUPLICATE_SOURCE no se persiste', () => {
  // Inalcanzable en V1: no se anticipan estados persistidos sin productor.
  assert.ok(!/'EXCLUDED_DUPLICATE_SOURCE'/.test(SQL));
});

test('la disposicion no tiene catch-all', () => {
  const match = /CREATE TYPE "ReasoningRunInventoryDisposition" AS ENUM \(([^)]+)\);/.exec(
    SQL
  );
  for (const catchAll of ["'OTHER'", "'UNKNOWN'", "'ERROR'"]) {
    assert.ok(!match![1].includes(catchAll));
  }
});

// ---------------------------------------------------------------------------
// CHECK de forma de fila
// ---------------------------------------------------------------------------

test('existen los dos CHECK row-local y ningun trigger', () => {
  assert.match(SQL, /CONSTRAINT "ReasoningRunInventoryItem_row_family_shape" CHECK/);
  assert.match(
    SQL,
    /CONSTRAINT "ReasoningRunInventoryItem_selected_extraction_binding" CHECK/
  );
  assert.ok(!/CREATE (OR REPLACE )?TRIGGER/i.test(SQL));
  assert.ok(!/CREATE (OR REPLACE )?FUNCTION/i.test(SQL));
});

test('el CHECK de familia exige fila sin fuente para las tres credential-level', () => {
  const check = /"ReasoningRunInventoryItem_row_family_shape" CHECK \(([\s\S]*?)\n\);/.exec(
    SQL
  );
  assert.ok(check, 'falta el CHECK de familia');
  const body = check[1];
  for (const disposition of [
    'EXCLUDED_CREDENTIAL_STATE_DRAFT',
    'EXCLUDED_CREDENTIAL_STATE_REVOKED',
    'EXCLUDED_NO_GROUNDING_SOURCE'
  ]) {
    assert.ok(body.includes(`'${disposition}'`), `falta ${disposition}`);
  }
  assert.match(body, /"documentEvidenceId" IS NULL AND "textEvidenceId" IS NULL/);
  // XOR sobre las columnas nullable, igual que AnalysisRunSource_exactly_one_source.
  assert.match(
    body,
    /\("documentEvidenceId" IS NOT NULL\) <> \("textEvidenceId" IS NOT NULL\)/
  );
  assert.match(body, /"sourceSha256" IS NOT NULL/);
});

test('el CHECK de binding tiene TRES ramas, no dos', () => {
  const check = /"ReasoningRunInventoryItem_selected_extraction_binding" CHECK \(([\s\S]*?)\n\);/.exec(
    SQL
  );
  assert.ok(check, 'falta el CHECK de binding');
  const body = check[1];

  // INCLUDED: seleccionado, verificado, confiable, entro al grounding.
  assert.match(
    body,
    /WHEN "disposition" = 'INCLUDED'\s*\n\s*THEN "selectedAnalysisRunSourceId" IS NOT NULL\s*\n\s*AND "artifactBlobSha256" IS NOT NULL\s*\n\s*AND "runLocalSourceId" IS NOT NULL/
  );

  // Fallo de integridad: se conserva el candidato que fallo, y SOLO eso.
  assert.match(
    body,
    /WHEN "disposition" = 'BLOCKED_EXTRACTION_INTEGRITY_FAILURE'\s*\n\s*THEN "selectedAnalysisRunSourceId" IS NOT NULL\s*\n\s*AND "artifactBlobSha256" IS NULL\s*\n\s*AND "runLocalSourceId" IS NULL/
  );

  // El resto no selecciono ninguna representacion.
  assert.match(body, /ELSE "selectedAnalysisRunSourceId" IS NULL/);
});

test('BLOCKED_EXTRACTION_UNAVAILABLE cae en el ELSE, no en la rama de integridad', () => {
  // No hubo candidato estructuralmente presente que seleccionar: por eso las tres
  // columnas quedan en NULL, y por eso son dos tokens y no uno.
  const check = /"ReasoningRunInventoryItem_selected_extraction_binding" CHECK \(([\s\S]*?)\n\);/.exec(
    SQL
  );
  assert.ok(!check![1].includes("'BLOCKED_EXTRACTION_UNAVAILABLE'"));
});

// ---------------------------------------------------------------------------
// Indices y FKs
// ---------------------------------------------------------------------------

test('estan los indices que sostienen las queries congeladas', () => {
  for (const index of [
    'CREATE INDEX "ReasoningRun_ownerUserId_createdAt_idx"',
    'CREATE INDEX "ReasoningRun_ownerUserId_objectiveId_idx"',
    'CREATE INDEX "ReasoningRunInventoryItem_reasoningRunId_idx"',
    'CREATE INDEX "ReasoningRunInventoryItem_reasoningRunId_credentialId_idx"',
    'CREATE INDEX "ReasoningRunInventoryItem_selectedAnalysisRunSourceId_idx"'
  ]) {
    assert.ok(SQL.includes(index), `falta ${index}`);
  }
});

test('los tres UNIQUE del inventario son sobre el par (run, columna nullable)', () => {
  // En Postgres los NULL no colisionan, asi que esto dice "a lo sumo una fila por
  // documento/texto/sourceId local dentro de un run" y deja libres las filas
  // credential-level.
  for (const [name, columns] of [
    ['ReasoningRunInventoryItem_reasoningRunId_documentEvidenceId_key', '"reasoningRunId", "documentEvidenceId"'],
    ['ReasoningRunInventoryItem_reasoningRunId_textEvidenceId_key', '"reasoningRunId", "textEvidenceId"'],
    ['ReasoningRunInventoryItem_reasoningRunId_runLocalSourceId_key', '"reasoningRunId", "runLocalSourceId"']
  ]) {
    assert.ok(
      SQL.includes(
        `CREATE UNIQUE INDEX "${name}" ON "ReasoningRunInventoryItem"(${columns});`
      ),
      `falta el unique ${name}`
    );
  }
});

test('ningun identificador supera el limite de 63 caracteres de Postgres', () => {
  for (const [, identifier] of SQL.matchAll(
    /"(ReasoningRun[A-Za-z0-9_]*)"/g
  )) {
    assert.ok(
      identifier.length <= 63,
      `${identifier} mide ${identifier.length}`
    );
  }
});

test('no hay indices sin query que los justifique', () => {
  assert.ok(!/CREATE INDEX[^;]*ON "ReasoningRunInventoryItem"\("sourceSha256"\)/.test(SQL));
  assert.ok(!/CREATE INDEX[^;]*ON "ReasoningRunInventoryItem"\("disposition"\)/.test(SQL));
  assert.ok(!/USING GIN/i.test(SQL));
});

test('las FK apuntan a las tablas correctas con la politica correcta', () => {
  const expected: Array<[string, string, string]> = [
    ['ReasoningRun_ownerUserId_fkey', '"User"("id")', 'CASCADE'],
    ['ReasoningRun_objectiveId_fkey', '"Objective"("id")', 'RESTRICT'],
    ['ReasoningRunInventoryItem_reasoningRunId_fkey', '"ReasoningRun"("id")', 'CASCADE'],
    ['ReasoningRunInventoryItem_credentialId_fkey', '"Credential"("id")', 'RESTRICT'],
    ['ReasoningRunInventoryItem_documentEvidenceId_fkey', '"DocumentEvidence"("id")', 'RESTRICT'],
    ['ReasoningRunInventoryItem_textEvidenceId_fkey', '"TextEvidence"("id")', 'RESTRICT'],
    ['ReasoningRunInventoryItem_selectedAnalysisRunSourceId_fkey', '"AnalysisRunSource"("id")', 'RESTRICT']
  ];
  for (const [name, target, onDelete] of expected) {
    const statement = statements().find((item) => item.includes(`"${name}"`));
    assert.ok(statement, `falta la FK ${name}`);
    assert.ok(statement.includes(`REFERENCES ${target}`), `${name} apunta mal`);
    assert.ok(
      statement.includes(`ON DELETE ${onDelete}`),
      `${name} deberia ser ON DELETE ${onDelete}`
    );
  }
});

// ---------------------------------------------------------------------------
// Aditividad
// ---------------------------------------------------------------------------

test('la migracion es puramente aditiva', () => {
  for (const statement of statements()) {
    assert.ok(
      !/^(DROP|TRUNCATE)\b/i.test(statement),
      `sentencia destructiva: ${statement.slice(0, 60)}`
    );
    assert.ok(
      !/^(INSERT|UPDATE|DELETE)\b/i.test(statement),
      `DML en una migracion de esquema: ${statement.slice(0, 60)}`
    );
    // Solo se permite ALTER TABLE sobre las dos tablas nuevas.
    const alter = /^ALTER TABLE "([A-Za-z]+)"/.exec(statement);
    if (alter) {
      assert.ok(
        ['ReasoningRun', 'ReasoningRunInventoryItem'].includes(alter[1]),
        `no debe alterar ${alter[1]}`
      );
    }
  }
});

test('la migracion de Objective sigue existiendo y es anterior', () => {
  // Dependencia de deploy: "ReasoningRun"."objectiveId" referencia "Objective".
  const { readdirSync } = require('node:fs') as typeof import('node:fs');
  const migrations = readdirSync(join(__dirname, 'migrations')).filter((name) =>
    /^\d{14}_/.test(name)
  );
  const objective = migrations.find((name) => name.endsWith('_add_objective'));
  assert.ok(objective, 'falta la migracion de Objective de F2.1');
  assert.ok(
    objective < MIGRATION_DIR,
    'la migracion de ReasoningRun debe ser posterior a la de Objective'
  );
});

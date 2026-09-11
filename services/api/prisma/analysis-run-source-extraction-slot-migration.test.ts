import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const PATH =
  'prisma/migrations/20260901120000_add_analysis_run_source_extraction_slot/migration.sql';

/**
 * SQL sin comentarios.
 *
 * Las aserciones negativas tienen que mirar el SQL ejecutable, no la prosa: esta
 * migracion cita en un comentario el constraint `AnalysisRunSource_exactly_one_source`
 * como precedente, y explica que no lleva DEFAULT. Assertar sobre el archivo crudo
 * confundiria esas menciones con DDL real.
 */
async function executableSql(): Promise<string> {
  const raw = await readFile(PATH, 'utf8');
  return raw
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

test('extraction slot migration adds exactly the three columns, nullable and without defaults', async () => {
  const sql = await executableSql();

  assert.match(sql, /ALTER TABLE "AnalysisRunSource" ADD COLUMN\s+"extractionArtifactCanonicalJson" TEXT,/);
  assert.match(sql, /ADD COLUMN\s+"artifactBlobSha256" TEXT,/);
  assert.match(sql, /ADD COLUMN\s+"extractionDerivationTrust" "ExtractionDerivationTrust";/);

  // Nullable: ninguna de las tres puede llevar NOT NULL ni DEFAULT, o el ALTER
  // reescribiria filas existentes y el slot dejaria de ser ABSENT para ellas.
  assert.doesNotMatch(sql, /extractionArtifactCanonicalJson" TEXT NOT NULL/);
  assert.doesNotMatch(sql, /artifactBlobSha256" TEXT NOT NULL/);
  assert.doesNotMatch(sql, /extractionDerivationTrust" "ExtractionDerivationTrust" NOT NULL/);
  assert.doesNotMatch(sql, /DEFAULT/i);
});

test('extraction slot migration declares the ExtractionDerivationTrust enum', async () => {
  const sql = await executableSql();

  assert.match(
    sql,
    /CREATE TYPE "ExtractionDerivationTrust" AS ENUM \('AUTHORITATIVE_CONTENT_MATCHED', 'PRODUCER_ASSUMED'\);/
  );
});

test('extraction slot migration enforces the all-or-nothing bundle', async () => {
  const sql = await executableSql();

  assert.match(sql, /AnalysisRunSource_extraction_slot_all_or_nothing/);
  assert.match(sql, /CHECK \(/);
  assert.match(
    sql,
    /"extractionArtifactCanonicalJson" IS NULL AND "artifactBlobSha256" IS NULL AND "extractionDerivationTrust" IS NULL/
  );
  assert.match(
    sql,
    /"extractionArtifactCanonicalJson" IS NOT NULL AND "artifactBlobSha256" IS NOT NULL AND "extractionDerivationTrust" IS NOT NULL/
  );
});

test('extraction slot migration creates no table and touches no existing constraint', async () => {
  const sql = await executableSql();

  assert.doesNotMatch(sql, /CREATE TABLE/i);
  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX)/i);
  assert.doesNotMatch(sql, /ALTER COLUMN/i);

  // Los dos unique de AnalysisRunSource son lo que hace ESTRUCTURAL el binding
  // de una extraction identity por fuente por run. No se tocan.
  assert.doesNotMatch(sql, /AnalysisRunSource_analysisRunId_documentEvidenceId_key/);
  assert.doesNotMatch(sql, /AnalysisRunSource_analysisRunId_textEvidenceId_key/);
  assert.doesNotMatch(sql, /AnalysisRunSource_exactly_one_source/);

  // Sin indices nuevos: REUSE_SCOPE = NONE_IN_V1, no hay lookup que indexar.
  assert.doesNotMatch(sql, /CREATE\s+(UNIQUE\s+)?INDEX/i);
});

test('extraction slot migration performs no backfill', async () => {
  const sql = await executableSql();

  assert.doesNotMatch(sql, /UPDATE "AnalysisRunSource"/i);
  assert.doesNotMatch(sql, /INSERT INTO/i);
  assert.doesNotMatch(sql, /DELETE FROM/i);
});

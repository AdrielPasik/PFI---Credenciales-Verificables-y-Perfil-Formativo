import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const PATH =
  'prisma/migrations/20260805120000_add_analysis_run_foundation/migration.sql';

test('analysis run migration is additive and enforces exactly one source', async () => {
  const sql = await readFile(PATH, 'utf8');

  assert.match(sql, /CREATE TABLE "AnalysisRun"/);
  assert.match(sql, /CREATE TABLE "AnalysisRunSource"/);
  assert.match(sql, /AnalysisRunSource_exactly_one_source/);
  assert.match(sql, /documentEvidenceId" IS NOT NULL AND "textEvidenceId" IS NULL/);
  assert.match(sql, /textEvidenceId" IS NOT NULL AND "documentEvidenceId" IS NULL/);
  assert.match(sql, /ALTER TABLE "SemanticAnalysis" ADD COLUMN "analysisRunId" TEXT/);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|UPDATE "Credential"/i);
});

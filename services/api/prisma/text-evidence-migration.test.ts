import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const MIGRATION_PATH =
  'prisma/migrations/20260803183000_add_text_evidence/migration.sql';

test('text evidence migration is additive and enforces one current row per credential', async () => {
  const sql = await readFile(MIGRATION_PATH, 'utf8');

  assert.match(sql, /CREATE TYPE "TextEvidenceStatus"/);
  assert.match(sql, /CREATE TABLE "TextEvidence"/);
  assert.match(sql, /"content" TEXT NOT NULL/);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "TextEvidence_one_current_per_credential"\s+ON "TextEvidence" \("credentialId"\)\s+WHERE "status" = 'current';/m
  );
  assert.match(sql, /TextEvidence_credentialId_idx/);
  assert.match(sql, /TextEvidence_submittedByUserId_idx/);
  assert.match(sql, /TextEvidence_sha256_idx/);
  assert.match(sql, /TextEvidence_credentialId_fkey/);
  assert.match(sql, /TextEvidence_submittedByUserId_fkey/);
  assert.match(sql, /ON DELETE CASCADE/);
  assert.match(sql, /ON DELETE RESTRICT/);
  assert.doesNotMatch(
    sql,
    /DROP TABLE|DELETE FROM|UPDATE "Credential"|ALTER TABLE "DocumentEvidence"/i
  );
});

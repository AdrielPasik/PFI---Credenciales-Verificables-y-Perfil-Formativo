import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const MIGRATION_PATH =
  'prisma/migrations/20260803150000_add_document_evidence/migration.sql';

test('document evidence migration is additive and enforces one current row per credential', async () => {
  const sql = await readFile(MIGRATION_PATH, 'utf8');

  assert.match(sql, /CREATE TABLE "DocumentEvidence"/);
  assert.match(sql, /CREATE TYPE "DocumentEvidenceKind"/);
  assert.match(sql, /CREATE TYPE "DocumentEvidenceStatus"/);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "DocumentEvidence_one_current_per_credential"\s+ON "DocumentEvidence" \("credentialId"\)\s+WHERE "status" = 'current';/m
  );
  assert.match(sql, /DocumentEvidence_credentialId_idx/);
  assert.match(sql, /DocumentEvidence_uploadedByUserId_idx/);
  assert.match(sql, /DocumentEvidence_sha256_idx/);
  assert.match(sql, /ON DELETE CASCADE/);
  assert.match(sql, /ON DELETE RESTRICT/);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|UPDATE "Credential"/i);
});

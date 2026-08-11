import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const PATH =
  'prisma/migrations/20260811193253_add_approved_semantic_snapshot_to_issuer_course_template/migration.sql';

test('C4a.1 migration is an additive ALTER TABLE that adds the 7 approvedSemantic* columns to IssuerCourseTemplate', async () => {
  const sql = await readFile(PATH, 'utf8');

  assert.match(sql, /ALTER TABLE "IssuerCourseTemplate"/);
  assert.match(sql, /ADD COLUMN\s+"approvedSemanticAnalysisId" TEXT/);
  assert.match(sql, /ADD COLUMN\s+"approvedSemanticApprovedAt" TIMESTAMP\(3\)/);
  assert.match(sql, /ADD COLUMN\s+"approvedSemanticApprovedByUserId" TEXT/);
  assert.match(sql, /ADD COLUMN\s+"approvedSemanticPipelineVersion" TEXT/);
  assert.match(sql, /ADD COLUMN\s+"approvedSemanticSnapshot" JSONB/);
  assert.match(sql, /ADD COLUMN\s+"approvedSemanticSourceCredentialId" TEXT/);
  assert.match(sql, /ADD COLUMN\s+"approvedSemanticTaxonomyVersion" TEXT/);
});

test('C4a.1 migration is purely additive: no DROP/DELETE/UPDATE, and does not touch ExternalCourse, Credential, SemanticAnalysis or BlockchainRecord', async () => {
  const sql = await readFile(PATH, 'utf8');

  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|UPDATE "/i);
  assert.doesNotMatch(sql, /ALTER TABLE "Credential"/);
  assert.doesNotMatch(sql, /ALTER TABLE "SemanticAnalysis"/);
  assert.doesNotMatch(sql, /ALTER TABLE "BlockchainRecord"/);
  assert.doesNotMatch(sql, /ExternalCourse/);
});

test('C4a.1 migration does not add a NOT NULL column without a default (no backfill required)', async () => {
  const sql = await readFile(PATH, 'utf8');

  assert.doesNotMatch(sql, /ADD COLUMN\s+"approvedSemantic\w+"[^,;]*NOT NULL(?!\s+DEFAULT)/);
});

test('C4a.1 schema.prisma declares the 7 approvedSemantic* fields as nullable on IssuerCourseTemplate, without renaming the model or table', async () => {
  const schema = await readFile('prisma/schema.prisma', 'utf8');

  assert.match(schema, /model IssuerCourseTemplate \{/);
  assert.match(schema, /approvedSemanticAnalysisId\s+String\?/);
  assert.match(schema, /approvedSemanticSnapshot\s+Json\?/);
  assert.match(schema, /approvedSemanticApprovedByUserId\s+String\?/);
  assert.match(schema, /approvedSemanticApprovedAt\s+DateTime\?/);
  assert.match(schema, /approvedSemanticPipelineVersion\s+String\?/);
  assert.match(schema, /approvedSemanticTaxonomyVersion\s+String\?/);
  assert.match(schema, /approvedSemanticSourceCredentialId\s+String\?/);
  // C4a.1 no agrega approvedSemanticProfileId -- decision explicita del
  // prompt para no acoplar la aprobacion a un perfil todavia.
  assert.doesNotMatch(schema, /approvedSemanticProfileId/);
});

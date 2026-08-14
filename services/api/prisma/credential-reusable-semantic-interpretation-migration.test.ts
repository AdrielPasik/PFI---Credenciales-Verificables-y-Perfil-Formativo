import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const MIGRATION_PATH =
  'prisma/migrations/20260814150000_add_credential_reusable_semantic_interpretation/migration.sql';

test('C4b.1a migration creates the two enums and the CredentialReusableSemanticInterpretation table', async () => {
  const sql = await readFile(MIGRATION_PATH, 'utf8');

  assert.match(
    sql,
    /CREATE TYPE "CredentialSemanticInterpretationStatus" AS ENUM \('active', 'superseded'\);/
  );
  assert.match(
    sql,
    /CREATE TYPE "CredentialSemanticInterpretationSource" AS ENUM \('issuer_reviewed_template_snapshot'\);/
  );
  assert.match(sql, /CREATE TABLE "CredentialReusableSemanticInterpretation"/);
});

test('C4b.1a migration declares every column from the approved v0.2 design, with the correct nullability/defaults', async () => {
  const sql = await readFile(MIGRATION_PATH, 'utf8');

  // Required scalars (no NULL allowed).
  for (const column of [
    '"id" TEXT NOT NULL',
    '"credentialId" TEXT NOT NULL',
    '"templateId" TEXT NOT NULL',
    '"sourceSemanticAnalysisId" TEXT NOT NULL',
    '"sourceCredentialId" TEXT NOT NULL',
    '"sourceApprovedByUserId" TEXT NOT NULL',
    '"sourceApprovedAt" TIMESTAMP\\(3\\) NOT NULL',
    '"sourcePipelineVersion" TEXT NOT NULL',
    '"sourceTaxonomyVersion" TEXT NOT NULL',
    '"approvedSnapshot" JSONB NOT NULL',
    '"snapshotVersion" TEXT NOT NULL',
    '"appliedByUserId" TEXT NOT NULL'
  ]) {
    assert.match(sql, new RegExp(column));
  }

  // Enum columns with the approved defaults.
  assert.match(
    sql,
    /"provenance" "CredentialSemanticInterpretationSource" NOT NULL DEFAULT 'issuer_reviewed_template_snapshot'/
  );
  assert.match(
    sql,
    /"status" "CredentialSemanticInterpretationStatus" NOT NULL DEFAULT 'active'/
  );

  // appliedAt materializes when the row is created; nullable supersede fields.
  assert.match(sql, /"appliedAt" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  assert.match(sql, /"supersededAt" TIMESTAMP\(3\),/);
  assert.match(sql, /"supersededByUserId" TEXT,/);

  // v0.2 explicitly has no createdAt/updatedAt on this model -- appliedAt is
  // the material creation timestamp.
  assert.doesNotMatch(sql, /"createdAt"/);
  assert.doesNotMatch(sql, /"updatedAt"/);
});

test('C4b.1a migration enforces at most one active row per credential via a partial unique index, with a short, non-truncatable name', async () => {
  const sql = await readFile(MIGRATION_PATH, 'utf8');

  assert.match(
    sql,
    /CREATE UNIQUE INDEX "crsi_one_active_per_credential_uq"\s+ON "CredentialReusableSemanticInterpretation" \("credentialId"\)\s+WHERE "status" = 'active';/m
  );

  const indexNameMatch = sql.match(
    /CREATE UNIQUE INDEX "([^"]+)"\s+ON "CredentialReusableSemanticInterpretation" \("credentialId"\)\s+WHERE/m
  );
  assert.ok(indexNameMatch, 'partial unique index must exist');
  assert.ok(
    indexNameMatch![1].length <= 63,
    `partial unique index name must fit PostgreSQL's 63-byte identifier limit, got ${indexNameMatch![1].length}`
  );

  // Every other identifier declared by this migration must also fit, since
  // the natural Prisma-style name for the (credentialId, status) index
  // exceeds 63 bytes and was given an explicit short name instead.
  const identifiers = [...sql.matchAll(/(?:CREATE (?:UNIQUE )?INDEX|CONSTRAINT) "([^"]+)"/g)].map(
    (match) => match[1]
  );
  assert.ok(identifiers.length > 0);
  for (const identifier of identifiers) {
    assert.ok(
      identifier.length <= 63,
      `identifier "${identifier}" (${identifier.length} bytes) exceeds PostgreSQL's 63-byte limit`
    );
  }
});

test('C4b.1a migration declares the normal (non-unique) indexes from the schema', async () => {
  const sql = await readFile(MIGRATION_PATH, 'utf8');

  assert.match(
    sql,
    /CREATE INDEX "CredentialReusableSemanticInterpretation_credentialId_idx" ON "CredentialReusableSemanticInterpretation"\("credentialId"\);/
  );
  assert.match(
    sql,
    /CREATE INDEX "crsi_credentialId_status_idx" ON "CredentialReusableSemanticInterpretation"\("credentialId", "status"\);/
  );
  assert.match(
    sql,
    /CREATE INDEX "CredentialReusableSemanticInterpretation_templateId_idx" ON "CredentialReusableSemanticInterpretation"\("templateId"\);/
  );
  assert.match(
    sql,
    /CREATE INDEX "CredentialReusableSemanticInterpretation_appliedAt_idx" ON "CredentialReusableSemanticInterpretation"\("appliedAt"\);/
  );
});

test('C4b.1a migration wires the three foreign keys with the approved onDelete behavior', async () => {
  const sql = await readFile(MIGRATION_PATH, 'utf8');

  assert.match(
    sql,
    /ALTER TABLE "CredentialReusableSemanticInterpretation" ADD CONSTRAINT "CredentialReusableSemanticInterpretation_credentialId_fkey" FOREIGN KEY \("credentialId"\) REFERENCES "Credential"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE;/
  );
  assert.match(
    sql,
    /ALTER TABLE "CredentialReusableSemanticInterpretation" ADD CONSTRAINT "CredentialReusableSemanticInterpretation_templateId_fkey" FOREIGN KEY \("templateId"\) REFERENCES "IssuerCourseTemplate"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE;/
  );
  assert.match(
    sql,
    /ALTER TABLE "CredentialReusableSemanticInterpretation" ADD CONSTRAINT "CredentialReusableSemanticInterpretation_appliedByUserId_fkey" FOREIGN KEY \("appliedByUserId"\) REFERENCES "User"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE;/
  );

  // sourceSemanticAnalysisId / sourceCredentialId / sourceApprovedByUserId /
  // supersededByUserId are informative references, never FKs (v0.2 section
  // 16.2) -- no foreign key constraint should reference them.
  assert.doesNotMatch(sql, /"sourceSemanticAnalysisId"\)\s*\)?\s*REFERENCES/);
  assert.doesNotMatch(sql, /FOREIGN KEY \("sourceCredentialId"\)/);
  assert.doesNotMatch(sql, /FOREIGN KEY \("sourceApprovedByUserId"\)/);
  assert.doesNotMatch(sql, /FOREIGN KEY \("supersededByUserId"\)/);
});

test('C4b.1a migration is purely additive: no destructive statements, and it never touches Credential/IssuerCourseTemplate/SemanticAnalysis as tables (relation-only additions live in schema.prisma, not as ALTER TABLE here)', async () => {
  const sql = await readFile(MIGRATION_PATH, 'utf8');

  assert.doesNotMatch(sql, /DROP TABLE|DROP TYPE|DELETE FROM|UPDATE "/i);
  assert.doesNotMatch(sql, /ALTER TABLE "Credential"/);
  assert.doesNotMatch(sql, /ALTER TABLE "IssuerCourseTemplate"/);
  assert.doesNotMatch(sql, /ALTER TABLE "SemanticAnalysis"/);
  assert.doesNotMatch(sql, /ALTER TABLE "User"/);
});

test('C4b.1a schema.prisma declares CredentialReusableSemanticInterpretation with the approved v0.2 fields, without renaming or adding scalar columns to Credential/IssuerCourseTemplate/SemanticAnalysis', async () => {
  const schema = await readFile('prisma/schema.prisma', 'utf8');

  assert.match(schema, /model CredentialReusableSemanticInterpretation \{/);
  assert.match(schema, /enum CredentialSemanticInterpretationStatus \{\s*active\s*superseded\s*\}/);
  assert.match(
    schema,
    /enum CredentialSemanticInterpretationSource \{\s*issuer_reviewed_template_snapshot\s*\}/
  );

  assert.match(schema, /sourceSemanticAnalysisId\s+String\s*$/m);
  assert.match(schema, /sourceCredentialId\s+String\s*$/m);
  assert.match(schema, /sourceApprovedByUserId\s+String\s*$/m);
  assert.match(schema, /sourceApprovedAt\s+DateTime\s*$/m);
  assert.match(schema, /sourcePipelineVersion\s+String\s*$/m);
  assert.match(schema, /sourceTaxonomyVersion\s+String\s*$/m);
  assert.match(schema, /approvedSnapshot\s+Json\s*$/m);
  assert.match(schema, /snapshotVersion\s+String\s*$/m);
  assert.match(
    schema,
    /provenance\s+CredentialSemanticInterpretationSource\s+@default\(issuer_reviewed_template_snapshot\)/
  );
  assert.match(schema, /status\s+CredentialSemanticInterpretationStatus\s+@default\(active\)/);
  assert.match(schema, /appliedByUserId\s+String\s*$/m);
  assert.match(schema, /appliedAt\s+DateTime\s+@default\(now\(\)\)/);
  assert.match(schema, /supersededAt\s+DateTime\?/);
  assert.match(schema, /supersededByUserId\s+String\?/);

  // Relations: FK to Credential/IssuerCourseTemplate/User, never to
  // SemanticAnalysis (sourceSemanticAnalysisId stays a plain informative
  // reference -- v0.2 section 16.2).
  assert.match(
    schema,
    /credential\s+Credential\s+@relation\(fields: \[credentialId\], references: \[id\], onDelete: Cascade\)/
  );
  assert.match(
    schema,
    /template\s+IssuerCourseTemplate\s+@relation\(fields: \[templateId\], references: \[id\], onDelete: Restrict\)/
  );
  assert.match(
    schema,
    /appliedBy\s+User\s+@relation\("CredentialSemanticInterpretationApplier", fields: \[appliedByUserId\], references: \[id\], onDelete: Restrict\)/
  );

  // Existing models keep their real scalar columns unchanged; only relation
  // (array) fields were added to point at the new table.
  const credentialModel = schema.match(/model Credential \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(credentialModel, /reusableSemanticInterpretations\s+CredentialReusableSemanticInterpretation\[\]/);
  assert.doesNotMatch(credentialModel, /sourceTemplateId/);

  const templateModel = schema.match(/model IssuerCourseTemplate \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(
    templateModel,
    /reusableSemanticInterpretations\s+CredentialReusableSemanticInterpretation\[\]/
  );

  const semanticAnalysisModel = schema.match(/model SemanticAnalysis \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.doesNotMatch(semanticAnalysisModel, /CredentialReusableSemanticInterpretation/);
});

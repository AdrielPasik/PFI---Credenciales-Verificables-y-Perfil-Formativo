import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const PATH =
  'prisma/migrations/20260811133024_add_credential_type_and_certification_fields_to_issuer_course_template/migration.sql';

test('C3a.2 migration is an additive ALTER TABLE that adds credentialType and certification fields, without touching ExternalCourse or other tables', async () => {
  const sql = await readFile(PATH, 'utf8');

  assert.match(sql, /ALTER TABLE "IssuerCourseTemplate"/);
  assert.match(sql, /ADD COLUMN\s+"certificationCode" TEXT/);
  assert.match(
    sql,
    /ADD COLUMN\s+"credentialType" "CredentialType" NOT NULL DEFAULT 'course'/
  );
  assert.match(sql, /ADD COLUMN\s+"expirationDate" TEXT/);
  assert.match(sql, /ADD COLUMN\s+"level" TEXT/);
  assert.match(sql, /ADD COLUMN\s+"providerName" TEXT/);
  assert.match(sql, /ADD COLUMN\s+"skills" TEXT\[\]/);
  assert.match(
    sql,
    /CREATE INDEX "IssuerCourseTemplate_issuerId_credentialType_idx"/
  );
  // Aditivo: DEFAULT 'course' hace que filas existentes (si hubiera)
  // sigan siendo validas sin backfill manual.
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|UPDATE "|ALTER TABLE "Credential"/i);
  assert.doesNotMatch(sql, /ExternalCourse/);
});

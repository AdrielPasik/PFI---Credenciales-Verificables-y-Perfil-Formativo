import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const PATH =
  'prisma/migrations/20260811123634_add_issuer_course_templates/migration.sql';

test('issuer course template migration is additive and does not touch ExternalCourse', async () => {
  const sql = await readFile(PATH, 'utf8');

  assert.match(sql, /CREATE TYPE "CourseTemplateStatus" AS ENUM \('active', 'archived'\)/);
  assert.match(sql, /CREATE TABLE "IssuerCourseTemplate"/);
  assert.match(sql, /"issuerId" TEXT NOT NULL/);
  assert.match(sql, /"createdByUserId" TEXT NOT NULL/);
  assert.match(sql, /"createdFromCredentialId" TEXT,/);
  assert.match(sql, /"lastSemanticAnalysisId" TEXT,/);
  assert.match(sql, /"competencies" TEXT\[\]/);
  assert.match(sql, /"learningOutcomes" TEXT\[\]/);
  assert.match(
    sql,
    /FOREIGN KEY \("issuerId"\) REFERENCES "Issuer"\("id"\) ON DELETE RESTRICT/
  );
  assert.match(
    sql,
    /FOREIGN KEY \("createdByUserId"\) REFERENCES "User"\("id"\) ON DELETE RESTRICT/
  );
  assert.doesNotMatch(sql, /ExternalCourse/);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|UPDATE "/i);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const migration = readFileSync(
  join(
    __dirname,
    'migrations',
    '20261012110000_add_profile_embedding_v1_persistence',
    'migration.sql'
  ),
  'utf8'
);

test('Profile Embedding persistence migration is additive and keeps PostgreSQL arrays', () => {
  for (const fragment of [
    'CREATE TYPE "ProfileEmbeddingCoverageStatus"',
    'CREATE TYPE "ProfileEmbeddingComponentStatus"',
    'CREATE TABLE "SourceEmbedding"',
    'CREATE TABLE "FormativeProfileEmbedding"',
    'CREATE TABLE "FormativeProfileEmbeddingComponent"',
    '"vector" DOUBLE PRECISION[] NOT NULL',
    '"FormativeProfileEmbedding_vector_coverage_check"',
    '"SourceEmbedding_vector_dimension_check"',
    '"FormativeProfileEmbeddingComponent_sourceEmbeddingId_fkey"'
  ]) {
    assert.equal(migration.includes(fragment), true, `missing ${fragment}`);
  }

  assert.equal(
    /\bDROP\s+(?:TABLE|TYPE|INDEX|CONSTRAINT|COLUMN)\b|\bDELETE\s+FROM\b|\bUPDATE\s+\S+\s+SET\b|\bTRUNCATE\b/i.test(
      migration
    ),
    false
  );
  assert.equal(/CREATE EXTENSION|pgvector|vector\s*\(/i.test(migration), false);
  assert.match(migration, /"embeddingDimension" = 384 AND cardinality\("vector"\) = 384/);
  assert.match(
    migration,
    /"coverageStatus" = 'UNAVAILABLE' AND cardinality\("vector"\) = 0 AND "includedSourceCount" = 0/
  );
  assert.match(
    migration,
    /"coverageStatus" IN \('COMPLETE', 'PARTIAL'\) AND cardinality\("vector"\) = 384 AND "includedSourceCount" >= 1/
  );
});

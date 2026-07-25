import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException } from '@nestjs/common';

import { createFormativeProfileResultArtifact } from './__fixtures__/formative-profile-result-artifact.fixture';
import { mapFormativeProfileResultArtifact } from './formative-profile-result-artifact.mapper';
import { validateFormativeProfileResultArtifact } from './formative-profile-result-artifact.validator';

test('validator accepts a valid formative_profile_result_v0 artifact', () => {
  const artifact = validateFormativeProfileResultArtifact(
    createFormativeProfileResultArtifact()
  );

  assert.equal(artifact.profileVersion, 'formative_profile_result_v0');
  assert.equal(artifact.generatedFrom.artifactCount, 2);
  assert.equal(artifact.confidence.score, null);
});

test('validator rejects the backend fallback profile version', () => {
  const artifact = {
    ...createFormativeProfileResultArtifact(),
    profileVersion: 'backend_formative_profile_snapshot_v0'
  };

  assert.throws(
    () => validateFormativeProfileResultArtifact(artifact),
    BadRequestException
  );
});

test('validator rejects missing required top-level fields', () => {
  const artifact = createFormativeProfileResultArtifact() as unknown as Record<
    string,
    unknown
  >;
  delete artifact.evidence;

  assert.throws(
    () => validateFormativeProfileResultArtifact(artifact),
    /artifact\.evidence is required/
  );
});

test('validator rejects a numeric portfolio confidence score', () => {
  const artifact = createFormativeProfileResultArtifact();
  const invalid = {
    ...artifact,
    confidence: {
      ...artifact.confidence,
      score: 0.9
    }
  };

  assert.throws(
    () => validateFormativeProfileResultArtifact(invalid),
    /confidence\.score must be null/
  );
});

test('validator rejects unknown top-level identity fields', () => {
  const artifact = {
    ...createFormativeProfileResultArtifact(),
    userId: 'untrusted-user-id'
  };

  assert.throws(
    () => validateFormativeProfileResultArtifact(artifact),
    /artifact\.userId is not allowed/
  );
});

test('mapper preserves the complete artifact and creates relational projections', () => {
  const artifact = createFormativeProfileResultArtifact();
  const mapped = mapFormativeProfileResultArtifact(artifact);

  assert.deepEqual(mapped.profileJson, artifact);
  assert.notEqual(mapped.profileJson, artifact);
  assert.equal(mapped.profileVersion, 'formative_profile_result_v0');
  assert.equal(mapped.generationMethod, 'ai_artifact_ingest_v0');
  assert.equal(mapped.credentialsCount, 2);
  assert.equal(mapped.totalHours, 40);
  assert.deepEqual(mapped.areasSummary, artifact.areas);
  assert.deepEqual(mapped.skillsSummary, artifact.skills);
  assert.deepEqual(mapped.qualityFlags, {
    warnings: artifact.warnings,
    limitations: artifact.limitations,
    audit: artifact.audit
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(mapped.profileJson, 'userId'),
    false
  );
});

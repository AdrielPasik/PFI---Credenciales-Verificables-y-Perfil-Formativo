import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException } from '@nestjs/common';

import {
  createAcademicPdfCompletedArtifact,
  createAcademicPdfPartialArtifact,
  createOnlineCourseArtifact
} from './__fixtures__/semantic-analysis-artifact.fixtures';
import { mapSemanticAnalysisArtifact } from './semantic-analysis-artifact.mapper';
import { validateSemanticAnalysisArtifact } from './semantic-analysis-artifact.validator';

test('valid academic PDF completed artifact passes validation', () => {
  const artifact = validateSemanticAnalysisArtifact(
    createAcademicPdfCompletedArtifact()
  );

  assert.equal(artifact.schemaVersion, 'semantic_analysis_v1');
  assert.equal(artifact.status, 'completed');
  assert.equal(artifact.sourceType, 'academic_pdf');
});

test('valid academic PDF partial artifact passes validation', () => {
  const artifact = validateSemanticAnalysisArtifact(
    createAcademicPdfPartialArtifact()
  );

  assert.equal(artifact.status, 'partial');
  assert.equal(artifact.partialReasons.length, 1);
});

test('valid online artifact with unavailable confidence passes validation', () => {
  const artifact = validateSemanticAnalysisArtifact(
    createOnlineCourseArtifact()
  );

  assert.equal(artifact.sourceType, 'online_course_catalog');
  assert.equal(artifact.confidence.global, null);
  assert.equal(artifact.confidence.globalMethod, 'unavailable');
});

test('incorrect schemaVersion fails validation', () => {
  const artifact = {
    ...createAcademicPdfCompletedArtifact(),
    schemaVersion: 'semantic_analysis_v2'
  };

  assert.throws(
    () => validateSemanticAnalysisArtifact(artifact),
    BadRequestException
  );
});

test('credential_candidate_v1 fails validation', () => {
  const artifact = {
    ...createAcademicPdfCompletedArtifact(),
    schemaVersion: 'credential_candidate_v1'
  };

  assert.throws(
    () => validateSemanticAnalysisArtifact(artifact),
    BadRequestException
  );
});

test('invalid status fails validation', () => {
  const artifact = {
    ...createAcademicPdfCompletedArtifact(),
    status: 'pending'
  };

  assert.throws(
    () => validateSemanticAnalysisArtifact(artifact),
    BadRequestException
  );
});

test('missing pipelineVersion fails validation', () => {
  const artifact = {
    ...createAcademicPdfCompletedArtifact(),
    pipelineVersion: ''
  };

  assert.throws(
    () => validateSemanticAnalysisArtifact(artifact),
    BadRequestException
  );
});

test('missing taxonomyVersion fails validation', () => {
  const artifact = {
    ...createAcademicPdfCompletedArtifact(),
    taxonomyVersion: '   '
  };

  assert.throws(
    () => validateSemanticAnalysisArtifact(artifact),
    BadRequestException
  );
});

test('areas must be arrays', () => {
  const artifact = {
    ...createAcademicPdfCompletedArtifact(),
    areas: {}
  };

  assert.throws(
    () => validateSemanticAnalysisArtifact(artifact),
    BadRequestException
  );
});

test('mapper preserves metadata contract fields', () => {
  const mapped = mapSemanticAnalysisArtifact(
    createAcademicPdfCompletedArtifact()
  );

  assert.equal(mapped.metadata.schemaVersion, 'semantic_analysis_v1');
  assert.equal(mapped.metadata.pipelineVersion, 'unversioned_current');
  assert.equal(mapped.metadata.taxonomyVersion, 'unversioned_current');
  assert.equal(mapped.metadata.sourceType, 'academic_pdf');
  assert.deepEqual(mapped.metadata.sourceRefs, {
    documentId: '3.4.080',
    fileName: '3.4.080_BASE_DE_DATOS_I.pdf'
  });
});

test('mapper does not generate canonicalHash', () => {
  const mapped = mapSemanticAnalysisArtifact(
    createAcademicPdfCompletedArtifact()
  );

  assert.equal(hasOwn(mapped, 'canonicalHash'), false);
  assert.equal(hasOwn(mapped, 'canonicalizationVersion'), false);
});

test('mapper does not add issuer, subject, blockchain or emission fields', () => {
  const mapped = mapSemanticAnalysisArtifact(createOnlineCourseArtifact());

  assert.equal(hasOwn(mapped, 'issuerId'), false);
  assert.equal(hasOwn(mapped, 'subjectUserId'), false);
  assert.equal(hasOwn(mapped, 'issuedAt'), false);
  assert.equal(hasOwn(mapped, 'blockchainRecord'), false);
  assert.equal(hasOwn(mapped, 'credentialStatus'), false);
});

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

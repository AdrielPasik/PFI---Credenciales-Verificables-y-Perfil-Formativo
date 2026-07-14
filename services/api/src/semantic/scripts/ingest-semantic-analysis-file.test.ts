import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatPersistedSemanticAnalysisSummary,
  parseSemanticIngestFileArgs
} from './ingest-semantic-analysis-file.utils';

test('parseSemanticIngestFileArgs returns credentialId and file path', () => {
  const parsed = parseSemanticIngestFileArgs([
    '--credentialId',
    'cred-123',
    '--file',
    './artifact.json'
  ]);

  assert.deepEqual(parsed, {
    credentialId: 'cred-123',
    filePath: './artifact.json'
  });
});

test('parseSemanticIngestFileArgs fails when credentialId is missing', () => {
  assert.throws(
    () => parseSemanticIngestFileArgs(['--file', './artifact.json']),
    /credentialId/
  );
});

test('parseSemanticIngestFileArgs fails when file is missing', () => {
  assert.throws(
    () => parseSemanticIngestFileArgs(['--credentialId', 'cred-123']),
    /--file/
  );
});

test('parseSemanticIngestFileArgs fails when an argument value is missing', () => {
  assert.throws(
    () => parseSemanticIngestFileArgs(['--credentialId', 'cred-123', '--file']),
    /Falta valor/
  );
});

test('formatPersistedSemanticAnalysisSummary returns a printable summary', () => {
  const summary = formatPersistedSemanticAnalysisSummary({
    id: 'semantic-123',
    credentialId: 'cred-123',
    schemaVersion: 'semantic_analysis_v1',
    status: 'completed',
    pipelineVersion: 'unversioned_current',
    taxonomyVersion: 'unversioned_current',
    confidence: {
      toString: () => '0.9800'
    } as never,
    analyzedAt: new Date('2026-07-12T12:00:00.000Z')
  });

  assert.equal(
    summary,
    JSON.stringify(
      {
        id: 'semantic-123',
        credentialId: 'cred-123',
        schemaVersion: 'semantic_analysis_v1',
        status: 'completed',
        pipelineVersion: 'unversioned_current',
        taxonomyVersion: 'unversioned_current',
        confidence: '0.9800',
        analyzedAt: '2026-07-12T12:00:00.000Z'
      },
      null,
      2
    )
  );
});

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createFormativeProfileResultArtifact } from '../__fixtures__/formative-profile-result-artifact.fixture';
import {
  formatPersistedFormativeProfileSummary,
  parseProfileIngestFileArgs,
  readProfileArtifactJson
} from './ingest-formative-profile-file.utils';

test('parseProfileIngestFileArgs returns external userId and file path', () => {
  assert.deepEqual(
    parseProfileIngestFileArgs([
      '--userId',
      'holder-1',
      '--file',
      './profile.json'
    ]),
    {
      userId: 'holder-1',
      filePath: './profile.json'
    }
  );
});

test('parseProfileIngestFileArgs rejects missing arguments', () => {
  assert.throws(
    () => parseProfileIngestFileArgs(['--file', './profile.json']),
    /--userId/
  );
  assert.throws(
    () => parseProfileIngestFileArgs(['--userId', 'holder-1']),
    /--file/
  );
});

test('readProfileArtifactJson rejects a missing file', async () => {
  await assert.rejects(
    () => readProfileArtifactJson(join(tmpdir(), 'missing-profile.json')),
    /No existe o no puede leerse/
  );
});

test('readProfileArtifactJson rejects invalid JSON', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'profile-ingest-'));
  const filePath = join(directory, 'invalid.json');

  try {
    await writeFile(filePath, '{ invalid', 'utf8');
    await assert.rejects(
      () => readProfileArtifactJson(filePath),
      /no contiene un JSON valido/
    );
  } finally {
    await rm(directory, {
      recursive: true,
      force: true
    });
  }
});

test('readProfileArtifactJson accepts UTF-8 JSON with a BOM', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'profile-ingest-'));
  const filePath = join(directory, 'profile-with-bom.json');

  try {
    await writeFile(filePath, '\uFEFF{"profileVersion":"test"}', 'utf8');
    assert.deepEqual(await readProfileArtifactJson(filePath), {
      profileVersion: 'test'
    });
  } finally {
    await rm(directory, {
      recursive: true,
      force: true
    });
  }
});

test('formatPersistedFormativeProfileSummary prints a concise result', () => {
  const artifact = createFormativeProfileResultArtifact();
  const summary = formatPersistedFormativeProfileSummary(
    {
      userId: 'holder-1',
      currentProfile: {
        id: 'profile-ai-1',
        profileVersion: 'formative_profile_result_v0',
        isCurrent: true,
        credentialsCount: 2,
        totalHours: 40,
        areasSummary: artifact.areas,
        skillsSummary: artifact.skills,
        qualityFlags: {},
        generatedAt: '2026-07-24T12:00:00.000Z',
        profileJson: artifact
      }
    },
    artifact
  );

  const parsed = JSON.parse(summary) as Record<string, unknown>;
  assert.equal(parsed.id, 'profile-ai-1');
  assert.equal(parsed.userId, 'holder-1');
  assert.equal(parsed.generationMethod, 'ai_artifact_ingest_v0');
  assert.equal(parsed.artifactCount, 2);
  assert.equal(parsed.areasCount, 1);
  assert.equal(parsed.skillsCount, 1);
  assert.equal(parsed.conceptsCount, 1);
  assert.equal(parsed.isCurrent, true);
  assert.equal(
    parsed.sourceOwnershipValidation,
    'not_available_in_formative_profile_result_v0'
  );
});

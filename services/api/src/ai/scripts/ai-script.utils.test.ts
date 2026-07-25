import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseAnalyzePdfScriptArgs,
  parseBuildProfileScriptArgs
} from './ai-script.utils';

test('parseAnalyzePdfScriptArgs supports persistence and version fields', () => {
  assert.deepEqual(
    parseAnalyzePdfScriptArgs([
      '--credentialId',
      'credential-1',
      '--file',
      './program.pdf',
      '--documentId',
      'backend-doc-1',
      '--fileName',
      'program.pdf',
      '--pipelineVersion',
      'unversioned_current',
      '--taxonomyVersion',
      'unversioned_current'
    ]),
    {
      credentialId: 'credential-1',
      filePath: './program.pdf',
      documentId: 'backend-doc-1',
      fileName: 'program.pdf',
      pipelineVersion: 'unversioned_current',
      taxonomyVersion: 'unversioned_current'
    }
  );
});

test('parseAnalyzePdfScriptArgs allows validation without persistence', () => {
  assert.deepEqual(
    parseAnalyzePdfScriptArgs(['--file', './program.pdf']),
    {
      filePath: './program.pdf',
      credentialId: undefined,
      documentId: undefined,
      fileName: undefined,
      pipelineVersion: undefined,
      taxonomyVersion: undefined
    }
  );
});

test('parseBuildProfileScriptArgs normalizes credential IDs', () => {
  assert.deepEqual(
    parseBuildProfileScriptArgs([
      '--userId',
      'holder-1',
      '--fromCredentialIds',
      ' credential-1,credential-2,credential-1 '
    ]),
    {
      userId: 'holder-1',
      credentialIds: ['credential-1', 'credential-2']
    }
  );
});

test('script parsers reject required arguments that are missing', () => {
  assert.throws(() => parseAnalyzePdfScriptArgs([]), /--file/);
  assert.throws(
    () =>
      parseBuildProfileScriptArgs([
        '--fromCredentialIds',
        'credential-1'
      ]),
    /--userId/
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseReprocessDocumentsArgs } from './reprocess-documents.utils';

test('parses --holderEmail with boolean flags', () => {
  const args = parseReprocessDocumentsArgs([
    '--holderEmail', 'holder.demo@example.com',
    '--force', '--rebuildProfile', '--execute'
  ]);

  assert.deepEqual(args, {
    help: false,
    holderEmail: 'holder.demo@example.com',
    credentialId: null,
    force: true,
    execute: true,
    rebuildProfile: true,
    limit: 25
  });
});

test('parses --credentialId in dry-run mode (no --execute)', () => {
  const args = parseReprocessDocumentsArgs(['--credentialId', 'credential-1']);

  assert.equal(args.credentialId, 'credential-1');
  assert.equal(args.holderEmail, null);
  assert.equal(args.execute, false);
  assert.equal(args.force, false);
  assert.equal(args.rebuildProfile, false);
});

test('parses --limit within bounds', () => {
  const args = parseReprocessDocumentsArgs([
    '--holderEmail', 'holder.demo@example.com',
    '--limit', '5'
  ]);
  assert.equal(args.limit, 5);
});

test('--help short-circuits without requiring a selector', () => {
  const args = parseReprocessDocumentsArgs(['--help']);
  assert.equal(args.help, true);
});

test('rejects missing selector', () => {
  assert.throws(() => parseReprocessDocumentsArgs([]));
});

test('rejects both selectors at once', () => {
  assert.throws(() =>
    parseReprocessDocumentsArgs([
      '--holderEmail', 'holder.demo@example.com',
      '--credentialId', 'credential-1'
    ])
  );
});

test('rejects an out-of-range --limit', () => {
  assert.throws(() =>
    parseReprocessDocumentsArgs([
      '--holderEmail', 'holder.demo@example.com',
      '--limit', '0'
    ])
  );
  assert.throws(() =>
    parseReprocessDocumentsArgs([
      '--holderEmail', 'holder.demo@example.com',
      '--limit', '1000'
    ])
  );
});

test('rejects a flag missing its value', () => {
  assert.throws(() => parseReprocessDocumentsArgs(['--holderEmail']));
});

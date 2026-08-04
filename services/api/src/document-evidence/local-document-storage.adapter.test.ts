import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { LocalDocumentStorageAdapter } from './local-document-storage.adapter';
import './s3-document-storage.adapter.test';

const FIXED_UUID = '11111111-1111-4111-8111-111111111111';

test('local storage writes exact bytes under a random-style key and deletes only that file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'traza-document-storage-'));
  const bytes = Buffer.from('%PDF-1.4\nstorage test');
  const adapter = new LocalDocumentStorageAdapter(root, () => FIXED_UUID);

  try {
    const saved = await adapter.saveDocument({
      buffer: bytes,
      detectedExtension: '.pdf',
      detectedMimeType: 'application/pdf',
      sha256: 'a'.repeat(64)
    });

    assert.deepEqual(saved, {
      storageProvider: 'local',
      storageKey: `${FIXED_UUID}.pdf`
    });
    assert.deepEqual(await readFile(join(root, saved.storageKey)), bytes);
    assert.deepEqual(await adapter.readDocument(saved.storageKey), bytes);
    assert.equal(saved.storageKey.includes('programa'), false);

    await adapter.deleteDocument(saved.storageKey);
    await assert.rejects(readFile(join(root, saved.storageKey)));
    await assert.rejects(
      adapter.readDocument(saved.storageKey),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'not_found'
    );
    await adapter.deleteDocument(saved.storageKey);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('local storage uses canonical extensions and never allows a key to escape root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'traza-document-storage-'));
  const ids = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
  ];
  const adapter = new LocalDocumentStorageAdapter(root, () => ids.shift()!);

  try {
    assert.equal(
      (
        await adapter.saveDocument({
          buffer: Buffer.from([0x89]),
          detectedExtension: '.png',
          detectedMimeType: 'image/png',
          sha256: 'b'.repeat(64)
        })
      ).storageKey.endsWith('.png'),
      true
    );
    assert.equal(
      (
        await adapter.saveDocument({
          buffer: Buffer.from([0xff]),
          detectedExtension: '.jpg',
          detectedMimeType: 'image/jpeg',
          sha256: 'c'.repeat(64)
        })
      ).storageKey.endsWith('.jpg'),
      true
    );

    await assert.rejects(adapter.deleteDocument('../outside.pdf'));
    await assert.rejects(adapter.deleteDocument('C:\\outside.pdf'));
    await assert.rejects(adapter.readDocument('../outside.pdf'));
    await assert.rejects(adapter.readDocument('C:\\outside.pdf'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('local storage rejects inconsistent detected extension and MIME', async () => {
  const adapter = new LocalDocumentStorageAdapter('unused', () => FIXED_UUID);

  await assert.rejects(
    adapter.saveDocument({
      buffer: Buffer.from('x'),
      detectedExtension: '.pdf',
      detectedMimeType: 'image/png',
      sha256: 'd'.repeat(64)
    })
  );
});

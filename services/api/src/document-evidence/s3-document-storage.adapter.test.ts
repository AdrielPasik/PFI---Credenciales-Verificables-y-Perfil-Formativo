import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand
} from '@aws-sdk/client-s3';

import { MAX_DOCUMENT_SIZE_BYTES } from './document-file.validator';
import { DocumentStorageError } from './document-storage.error';
import { S3DocumentStorageAdapter } from './s3-document-storage.adapter';

const BUCKET = 'traza-demo-bucket';
const PREFIX = 'document-evidence';
const UUID = '11111111-1111-4111-8111-111111111111';
const STORAGE_KEY = `${PREFIX}/${UUID}.pdf`;
const SHA256 = 'a'.repeat(64);

test('S3 storage writes private encrypted bytes with safe metadata and an opaque key', async () => {
  const calls: unknown[] = [];
  const adapter = createAdapter(async (command) => {
    calls.push(command);
    return {};
  });
  const bytes = Buffer.from('%PDF-1.4\nS3 test');

  const saved = await adapter.saveDocument({
    buffer: bytes,
    detectedExtension: '.pdf',
    detectedMimeType: 'application/pdf',
    sha256: SHA256
  });

  assert.deepEqual(saved, {
    storageProvider: 's3',
    storageKey: STORAGE_KEY
  });
  assert.equal(calls.length, 1);
  assert.ok(calls[0] instanceof PutObjectCommand);
  assert.deepEqual((calls[0] as PutObjectCommand).input, {
    Bucket: BUCKET,
    Key: STORAGE_KEY,
    Body: bytes,
    ContentType: 'application/pdf',
    Metadata: { sha256: SHA256 },
    ServerSideEncryption: 'AES256'
  });
  assert.equal('ACL' in (calls[0] as PutObjectCommand).input, false);
  assert.equal(STORAGE_KEY.includes('original'), false);
});

test('S3 storage reads SDK, buffer, blob and stream bodies as exact bytes', async () => {
  const expected = Buffer.from('document bytes');
  const bodies: unknown[] = [
    { async transformToByteArray() { return Uint8Array.from(expected); } },
    expected,
    new Blob([expected]),
    Readable.from([expected.subarray(0, 4), expected.subarray(4)])
  ];

  for (const body of bodies) {
    const adapter = createAdapter(async (command) => {
      assert.ok(command instanceof GetObjectCommand);
      assert.deepEqual(command.input, { Bucket: BUCKET, Key: STORAGE_KEY });
      return { Body: body };
    });

    assert.deepEqual(await adapter.readDocument(STORAGE_KEY), expected);
  }
});

test('S3 storage rejects missing, empty, unsupported and oversized bodies safely', async () => {
  const cases: Array<{ body: unknown; code: string }> = [
    { body: undefined, code: 'invalid_body' },
    { body: Buffer.alloc(0), code: 'invalid_body' },
    { body: { unsupported: true }, code: 'invalid_body' },
    { body: Buffer.alloc(MAX_DOCUMENT_SIZE_BYTES + 1), code: 'too_large' }
  ];

  for (const current of cases) {
    const adapter = createAdapter(async () => ({ Body: current.body }));
    await assert.rejects(
      adapter.readDocument(STORAGE_KEY),
      (error: unknown) =>
        error instanceof DocumentStorageError && error.code === current.code
    );
  }
});

test('S3 storage maps missing objects and makes compensating delete idempotent', async () => {
  const missingObject = Object.assign(new Error('missing'), {
    name: 'NoSuchKey',
    $metadata: { httpStatusCode: 404 }
  });
  const readAdapter = createAdapter(async () => {
    throw missingObject;
  });

  await assert.rejects(
    readAdapter.readDocument(STORAGE_KEY),
    (error: unknown) =>
      error instanceof DocumentStorageError && error.code === 'not_found'
  );
  await readAdapter.deleteDocument(STORAGE_KEY);
});

test('S3 storage deletes the selected safe key and propagates real upstream failures safely', async () => {
  const calls: unknown[] = [];
  const adapter = createAdapter(async (command) => {
    calls.push(command);
    return {};
  });

  await adapter.deleteDocument(STORAGE_KEY);
  assert.ok(calls[0] instanceof DeleteObjectCommand);
  assert.deepEqual((calls[0] as DeleteObjectCommand).input, {
    Bucket: BUCKET,
    Key: STORAGE_KEY
  });

  const failingAdapter = createAdapter(async () => {
    throw new Error('upstream unavailable');
  });
  await assert.rejects(
    failingAdapter.deleteDocument(STORAGE_KEY),
    (error: unknown) =>
      error instanceof DocumentStorageError &&
      error.code === 'upstream' &&
      !error.message.includes(BUCKET) &&
      !error.message.includes(STORAGE_KEY)
  );
});

test('S3 storage rejects unsafe keys and invalid document metadata before a request', async () => {
  let requests = 0;
  const adapter = createAdapter(async () => {
    requests += 1;
    return {};
  });

  for (const unsafeKey of [
    '../outside.pdf',
    'C:\\outside.pdf',
    `${PREFIX}/../outside.pdf`,
    `${PREFIX}/nested/outside.pdf`,
    `${PREFIX}/not-a-document.txt`
  ]) {
    await assert.rejects(
      adapter.readDocument(unsafeKey),
      (error: unknown) =>
        error instanceof DocumentStorageError && error.code === 'invalid_key'
    );
  }

  await assert.rejects(
    adapter.saveDocument({
      buffer: Buffer.from('x'),
      detectedExtension: '.pdf',
      detectedMimeType: 'image/png',
      sha256: SHA256
    })
  );
  await assert.rejects(
    adapter.saveDocument({
      buffer: Buffer.from('x'),
      detectedExtension: '.pdf',
      detectedMimeType: 'application/pdf',
      sha256: 'invalid'
    })
  );
  assert.equal(requests, 0);
});

function createAdapter(
  send: (command: unknown) => Promise<unknown>
): S3DocumentStorageAdapter {
  return new S3DocumentStorageAdapter(
    { send } as never,
    { bucket: BUCKET, prefix: PREFIX },
    () => UUID
  );
}

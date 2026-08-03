import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DocumentEvidenceKind,
  DocumentEvidenceStatus
} from '@prisma/client';

import { mapDocumentEvidenceResponse } from './document-evidence.mapper';

test('document evidence mapper returns only the public allowlist', () => {
  const record = {
    id: 'evidence-1',
    kind: DocumentEvidenceKind.image,
    status: DocumentEvidenceStatus.current,
    originalFileName: 'constancia.png',
    mimeType: 'image/png',
    sizeBytes: 123,
    sha256: 'ABCDEF0123456789'.repeat(4),
    uploadedAt: new Date('2026-08-03T12:00:00.000Z'),
    credentialId: 'credential-1',
    uploadedByUserId: 'user-1',
    storageProvider: 'local',
    storageKey: 'secret-key.png',
    path: 'secret-path',
    replacedAt: null
  };

  assert.deepEqual(mapDocumentEvidenceResponse(record), {
    evidenceReference: 'evidence-1',
    kind: DocumentEvidenceKind.image,
    status: DocumentEvidenceStatus.current,
    originalFileName: 'constancia.png',
    mimeType: 'image/png',
    sizeBytes: 123,
    sha256: 'abcdef0123456789'.repeat(4),
    uploadedAt: '2026-08-03T12:00:00.000Z'
  });

  const serialized = JSON.stringify(mapDocumentEvidenceResponse(record));
  for (const field of [
    'credentialId',
    'uploadedByUserId',
    'storageProvider',
    'storageKey',
    'path',
    'replacedAt'
  ]) {
    assert.equal(serialized.includes(field), false);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BadRequestException,
  PayloadTooLargeException,
  RequestMethod
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  INTERCEPTORS_METADATA,
  METHOD_METADATA,
  PATH_METADATA
} from '@nestjs/common/constants';
import {
  DocumentEvidenceKind,
  DocumentEvidenceStatus,
  UserStatus
} from '@prisma/client';

import { AuthGuard } from '../auth/auth.guard';
import { DocumentEvidenceController } from './document-evidence.controller';
import {
  DOCUMENT_MULTIPART_FIELD,
  DOCUMENT_UPLOAD_LIMITS,
  DocumentUploadInterceptor,
  mapDocumentMultipartError
} from './document-upload.interceptor';
import { MAX_DOCUMENT_SIZE_BYTES } from './document-file.validator';

test('document upload route is protected POST multipart with one file and 20 MB limit', () => {
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, DocumentEvidenceController),
    'issuers/:issuerId/credentials/:credentialId/evidence/documents'
  );
  assert.deepEqual(
    Reflect.getMetadata(GUARDS_METADATA, DocumentEvidenceController),
    [AuthGuard]
  );
  assert.equal(
    Reflect.getMetadata(
      METHOD_METADATA,
      DocumentEvidenceController.prototype.uploadDocument
    ),
    RequestMethod.POST
  );
  assert.equal(
    Reflect.getMetadata(
      PATH_METADATA,
      DocumentEvidenceController.prototype.uploadDocument
    ),
    '/'
  );
  assert.deepEqual(
    Reflect.getMetadata(
      INTERCEPTORS_METADATA,
      DocumentEvidenceController.prototype.uploadDocument
    ),
    [DocumentUploadInterceptor]
  );
  assert.equal(DOCUMENT_MULTIPART_FIELD, 'file');
  assert.deepEqual(DOCUMENT_UPLOAD_LIMITS, {
    files: 1,
    fields: 0,
    fileSize: MAX_DOCUMENT_SIZE_BYTES
  });
});

test('multipart file-size errors map to 413 without changing unrelated errors', () => {
  const oversized = mapDocumentMultipartError({ code: 'LIMIT_FILE_SIZE' });
  const tooManyFiles = mapDocumentMultipartError({ code: 'LIMIT_FILE_COUNT' });
  const unrelated = new Error('database unavailable');

  assert.ok(oversized instanceof PayloadTooLargeException);
  assert.equal(oversized.getStatus(), 413);
  assert.ok(tooManyFiles instanceof BadRequestException);
  assert.equal(tooManyFiles.getStatus(), 400);
  assert.equal(mapDocumentMultipartError(unrelated), unrelated);
});

test('controller delegates path references, current user and file and preserves safe response', async () => {
  const calls: unknown[] = [];
  const currentUser = {
    id: 'user-1',
    email: 'issuer@example.com',
    did: null,
    status: UserStatus.active
  };
  const bytes = Buffer.from('%PDF-1.4\ncontroller');
  const uploaded = {
    originalname: 'programa.pdf',
    mimetype: 'application/pdf',
    size: bytes.byteLength,
    buffer: bytes
  };
  const expected = {
    evidenceReference: 'evidence-1',
    kind: DocumentEvidenceKind.pdf,
    status: DocumentEvidenceStatus.current,
    originalFileName: 'programa.pdf',
    mimeType: 'application/pdf',
    sizeBytes: bytes.byteLength,
    sha256: 'a'.repeat(64),
    uploadedAt: '2026-08-03T12:00:00.000Z'
  };
  const controller = new DocumentEvidenceController({
    async uploadCurrentDocument(...args: unknown[]) {
      calls.push(args);
      return expected;
    }
  } as never);

  const response = await controller.uploadDocument(
    'issuer-1',
    'credential-1',
    uploaded,
    {},
    currentUser
  );

  assert.deepEqual(calls, [
    ['issuer-1', 'credential-1', currentUser, uploaded]
  ]);
  assert.deepEqual(response, expected);
  assert.equal(JSON.stringify(response).includes('storageKey'), false);
  assert.equal(JSON.stringify(response).includes('path'), false);
});

test('controller rejects arbitrary multipart fields before service delegation', () => {
  let called = false;
  const controller = new DocumentEvidenceController({
    async uploadCurrentDocument() {
      called = true;
    }
  } as never);

  assert.throws(
    () =>
      controller.uploadDocument(
        'issuer-1',
        'credential-1',
        undefined,
        { metadata: 'not-allowed' },
        {
          id: 'user-1',
          email: 'issuer@example.com',
          did: null,
          status: UserStatus.active
        }
      ),
    BadRequestException
  );
  assert.equal(called, false);
});

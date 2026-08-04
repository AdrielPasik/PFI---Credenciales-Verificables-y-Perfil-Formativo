import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ConflictException,
  ForbiddenException,
  NotFoundException
} from '@nestjs/common';
import {
  CredentialStatus,
  DocumentEvidenceKind,
  DocumentEvidenceStatus,
  Prisma,
  UserStatus
} from '@prisma/client';

import { DocumentEvidenceService } from './document-evidence.service';

const CURRENT_USER = {
  id: 'issuer-user-1',
  email: 'issuer@example.com',
  did: null,
  status: UserStatus.active
};
const PDF = Buffer.from('%PDF-1.4\nservice test');
const FILE = {
  originalname: '  programa   oficial.pdf ',
  mimetype: 'application/pdf',
  size: PDF.byteLength,
  buffer: PDF
};
const CREATED_AT = new Date('2026-08-03T12:00:00.000Z');

interface SetupOptions {
  status?: CredentialStatus;
  credentialExists?: boolean;
  permissionError?: Error;
  storageError?: Error;
  transactionError?: Error;
  cleanupError?: Error;
}

function setup(options: SetupOptions = {}) {
  const calls = {
    permissions: [] as unknown[],
    credentialReads: [] as unknown[],
    storageSaves: [] as unknown[],
    storageReads: [] as unknown[],
    storageDeletes: [] as unknown[],
    transactions: [] as unknown[],
    updateMany: [] as unknown[],
    creates: [] as unknown[]
  };
  const transaction = {
    documentEvidence: {
      async updateMany(args: unknown) {
        calls.updateMany.push(args);
        return { count: 1 };
      },
      async create(args: unknown) {
        calls.creates.push(args);
        return {
          id: 'evidence-new',
          kind: DocumentEvidenceKind.pdf,
          status: DocumentEvidenceStatus.current,
          originalFileName: 'programa oficial.pdf',
          mimeType: 'application/pdf',
          sizeBytes: PDF.byteLength,
          sha256: 'a'.repeat(64),
          uploadedAt: CREATED_AT
        };
      }
    }
  };
  const prisma = {
    credential: {
      async findFirst(args: unknown) {
        calls.credentialReads.push(args);
        if (options.credentialExists === false) {
          return null;
        }
        return {
          id: 'credential-1',
          status: options.status ?? CredentialStatus.draft
        };
      }
    },
    async $transaction(
      callback: (value: typeof transaction) => Promise<unknown>,
      transactionOptions: unknown
    ) {
      calls.transactions.push(transactionOptions);
      if (options.transactionError) {
        throw options.transactionError;
      }
      return callback(transaction);
    }
  };
  const storage = {
    async saveDocument(input: unknown) {
      calls.storageSaves.push(input);
      if (options.storageError) {
        throw options.storageError;
      }
      return {
        storageProvider: 'local',
        storageKey: '11111111-1111-4111-8111-111111111111.pdf'
      };
    },
    async readDocument(storageKey: string) {
      calls.storageReads.push(storageKey);
      return PDF;
    },
    async deleteDocument(storageKey: string) {
      calls.storageDeletes.push(storageKey);
      if (options.cleanupError) {
        throw options.cleanupError;
      }
    }
  };
  const issuersService = {
    async assertUserCanAttachDocumentEvidenceForIssuer(...args: unknown[]) {
      calls.permissions.push(args);
      if (options.permissionError) {
        throw options.permissionError;
      }
    }
  };

  return {
    calls,
    service: new DocumentEvidenceService(
      prisma as never,
      issuersService as never,
      storage
    )
  };
}

test('service scopes permission and credential before validating and storing a current document', async () => {
  const { service, calls } = setup();
  const response = await service.uploadCurrentDocument(
    'issuer-1',
    'credential-1',
    CURRENT_USER,
    FILE
  );

  assert.deepEqual(calls.permissions, [['issuer-user-1', 'issuer-1']]);
  assert.deepEqual(calls.credentialReads, [
    {
      where: { id: 'credential-1', issuerId: 'issuer-1' },
      select: { id: true, status: true }
    }
  ]);
  assert.equal(calls.storageSaves.length, 1);
  assert.deepEqual(calls.storageSaves[0], {
    buffer: PDF,
    detectedExtension: '.pdf',
    detectedMimeType: 'application/pdf',
    sha256: 'fc0c91a66993964ca4ced19d7f34a9927a061d9290d43d646acb8e01a1535312'
  });
  assert.deepEqual(calls.transactions, [
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  ]);
  assert.deepEqual(calls.updateMany, [
    {
      where: {
        credentialId: 'credential-1',
        status: DocumentEvidenceStatus.current
      },
      data: {
        status: DocumentEvidenceStatus.replaced,
        replacedAt: (calls.updateMany[0] as { data: { replacedAt: Date } }).data
          .replacedAt
      }
    }
  ]);
  assert.ok(
    (calls.updateMany[0] as { data: { replacedAt: unknown } }).data.replacedAt instanceof
      Date
  );

  const create = calls.creates[0] as {
    data: Record<string, unknown>;
    select: Record<string, boolean>;
  };
  assert.deepEqual(create.data, {
    credentialId: 'credential-1',
    uploadedByUserId: 'issuer-user-1',
    kind: DocumentEvidenceKind.pdf,
    originalFileName: 'programa oficial.pdf',
    mimeType: 'application/pdf',
    sizeBytes: PDF.byteLength,
    sha256: create.data.sha256,
    storageProvider: 'local',
    storageKey: '11111111-1111-4111-8111-111111111111.pdf',
    status: DocumentEvidenceStatus.current
  });
  assert.match(String(create.data.sha256), /^[0-9a-f]{64}$/);
  assert.deepEqual(response, {
    evidenceReference: 'evidence-new',
    kind: DocumentEvidenceKind.pdf,
    status: DocumentEvidenceStatus.current,
    originalFileName: 'programa oficial.pdf',
    mimeType: 'application/pdf',
    sizeBytes: PDF.byteLength,
    sha256: 'a'.repeat(64),
    uploadedAt: '2026-08-03T12:00:00.000Z'
  });
  assert.equal(calls.storageDeletes.length, 0);
  assert.equal('credential' in transactionWrites(calls), false);
});

test('service rejects unauthorized users before credential lookup and file validation', async () => {
  const { service, calls } = setup({
    permissionError: new ForbiddenException('forbidden')
  });

  await assert.rejects(
    service.uploadCurrentDocument(
      'issuer-arbitrary',
      'credential-1',
      CURRENT_USER,
      undefined
    ),
    ForbiddenException
  );
  assert.equal(calls.credentialReads.length, 0);
  assert.equal(calls.storageSaves.length, 0);
});

test('service uses the same safe not-found result for missing or cross-issuer credentials', async () => {
  const { service, calls } = setup({ credentialExists: false });

  await assert.rejects(
    service.uploadCurrentDocument(
      'issuer-1',
      'credential-other',
      CURRENT_USER,
      FILE
    ),
    (error: unknown) =>
      error instanceof NotFoundException &&
      error.message === 'No se encontro la credencial solicitada.'
  );
  assert.equal(calls.storageSaves.length, 0);
});

test('service returns 409 for issued and revoked credentials without storing bytes', async () => {
  for (const status of [CredentialStatus.issued, CredentialStatus.revoked]) {
    const { service, calls } = setup({ status });

    await assert.rejects(
      service.uploadCurrentDocument(
        'issuer-1',
        'credential-1',
        CURRENT_USER,
        FILE
      ),
      (error: unknown) =>
        error instanceof ConflictException && error.getStatus() === 409
    );
    assert.equal(calls.storageSaves.length, 0);
    assert.equal(calls.transactions.length, 0);
  }
});

test('service cleans up the newly stored file when the database transaction fails', async () => {
  const databaseError = new Error('database failed');
  const { service, calls } = setup({ transactionError: databaseError });

  await assert.rejects(
    service.uploadCurrentDocument(
      'issuer-1',
      'credential-1',
      CURRENT_USER,
      FILE
    ),
    (error: unknown) => error === databaseError
  );
  assert.deepEqual(calls.storageDeletes, [
    '11111111-1111-4111-8111-111111111111.pdf'
  ]);
});

test('cleanup failure never hides the primary database error', async () => {
  const databaseError = new Error('primary database error');
  const { service, calls } = setup({
    transactionError: databaseError,
    cleanupError: new Error('cleanup failed')
  });

  await assert.rejects(
    service.uploadCurrentDocument(
      'issuer-1',
      'credential-1',
      CURRENT_USER,
      FILE
    ),
    (error: unknown) => error === databaseError
  );
  assert.equal(calls.storageDeletes.length, 1);
});

test('storage failure prevents any database transaction', async () => {
  const { service, calls } = setup({ storageError: new Error('storage failed') });

  await assert.rejects(
    service.uploadCurrentDocument(
      'issuer-1',
      'credential-1',
      CURRENT_USER,
      FILE
    )
  );
  assert.equal(calls.transactions.length, 0);
});

function transactionWrites(calls: ReturnType<typeof setup>['calls']) {
  return {
    documentEvidence: {
      updateMany: calls.updateMany,
      create: calls.creates
    }
  };
}

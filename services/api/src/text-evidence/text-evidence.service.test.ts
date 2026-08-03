import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ConflictException,
  ForbiddenException,
  NotFoundException
} from '@nestjs/common';
import {
  CredentialStatus,
  Prisma,
  TextEvidenceStatus,
  UserStatus
} from '@prisma/client';

import { textEvidenceResponseSelect } from './text-evidence.mapper';
import { TextEvidenceService } from './text-evidence.service';

const CURRENT_USER = {
  id: 'issuer-user-1',
  email: 'issuer@example.com',
  did: null,
  status: UserStatus.active
};
const SUBMITTED_AT = new Date('2026-08-03T12:00:00.000Z');

interface SetupOptions {
  status?: CredentialStatus;
  credentialExists?: boolean;
  transactionalStatus?: CredentialStatus;
  transactionalCredentialExists?: boolean;
  permissionError?: Error;
}

function setup(options: SetupOptions = {}) {
  const calls = {
    permissions: [] as unknown[],
    preliminaryCredentialReads: [] as unknown[],
    transactionalCredentialReads: [] as unknown[],
    transactions: [] as unknown[],
    updateMany: [] as unknown[],
    creates: [] as unknown[],
    forbiddenWrites: [] as string[],
    operationOrder: [] as string[]
  };
  let createSequence = 0;
  const transaction = {
    textEvidence: {
      async updateMany(args: unknown) {
        calls.operationOrder.push('text-evidence-update-many');
        calls.updateMany.push(args);
        return { count: createSequence > 0 ? 1 : 0 };
      },
      async create(args: unknown) {
        calls.operationOrder.push('text-evidence-create');
        calls.creates.push(args);
        createSequence += 1;
        const data = (args as { data: Record<string, unknown> }).data;
        return {
          id: `text-evidence-${createSequence}`,
          status: TextEvidenceStatus.current,
          label: data.label as string | null,
          content: data.content as string,
          sha256: data.sha256 as string,
          submittedAt: SUBMITTED_AT
        };
      }
    },
    credential: {
      async findFirst(args: unknown) {
        calls.operationOrder.push('transactional-credential-read');
        calls.transactionalCredentialReads.push(args);
        if (options.transactionalCredentialExists === false) {
          return null;
        }
        return {
          id: 'credential-1',
          status:
            options.transactionalStatus ??
            options.status ??
            CredentialStatus.draft
        };
      },
      ...forbiddenWriter('Credential', calls.forbiddenWrites)
    },
    documentEvidence: forbiddenWriter(
      'DocumentEvidence',
      calls.forbiddenWrites
    ),
    semanticAnalysis: forbiddenWriter(
      'SemanticAnalysis',
      calls.forbiddenWrites
    ),
    blockchainRecord: forbiddenWriter(
      'BlockchainRecord',
      calls.forbiddenWrites
    )
  };
  const prisma = {
    credential: {
      async findFirst(args: unknown) {
        calls.operationOrder.push('preliminary-credential-read');
        calls.preliminaryCredentialReads.push(args);
        if (options.credentialExists === false) {
          return null;
        }
        return {
          id: 'credential-1',
          status: options.status ?? CredentialStatus.draft
        };
      },
      ...forbiddenWriter('Credential', calls.forbiddenWrites)
    },
    async $transaction(
      callback: (value: typeof transaction) => Promise<unknown>,
      transactionOptions: unknown
    ) {
      calls.operationOrder.push('transaction');
      calls.transactions.push(transactionOptions);
      return callback(transaction);
    }
  };
  const issuersService = {
    async assertUserCanSubmitTextEvidenceForIssuer(...args: unknown[]) {
      calls.operationOrder.push('permission');
      calls.permissions.push(args);
      if (options.permissionError) {
        throw options.permissionError;
      }
    }
  };

  return {
    calls,
    service: new TextEvidenceService(prisma as never, issuersService as never)
  };
}

test('service authorizes, scopes and validates before replacing text in a Serializable transaction', async () => {
  const { service, calls } = setup();
  const response = await service.submitCurrentText(
    'issuer-1',
    'credential-1',
    CURRENT_USER,
    {
      label: '  Temario\u00a0 institucional  ',
      content: '  Linea uno\r\nLinea dos  '
    }
  );

  assert.deepEqual(calls.permissions, [['issuer-user-1', 'issuer-1']]);
  const expectedCredentialLookup = {
    where: { id: 'credential-1', issuerId: 'issuer-1' },
    select: { id: true, status: true }
  };
  assert.deepEqual(calls.preliminaryCredentialReads, [
    expectedCredentialLookup
  ]);
  assert.deepEqual(calls.transactionalCredentialReads, [
    expectedCredentialLookup
  ]);
  assert.deepEqual(calls.operationOrder, [
    'permission',
    'preliminary-credential-read',
    'transaction',
    'transactional-credential-read',
    'text-evidence-update-many',
    'text-evidence-create'
  ]);
  assert.deepEqual(calls.transactions, [
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  ]);
  assert.deepEqual(calls.updateMany, [
    {
      where: {
        credentialId: 'credential-1',
        status: TextEvidenceStatus.current
      },
      data: {
        status: TextEvidenceStatus.replaced,
        replacedAt: (calls.updateMany[0] as { data: { replacedAt: Date } }).data
          .replacedAt
      }
    }
  ]);
  assert.ok(
    (calls.updateMany[0] as { data: { replacedAt: unknown } }).data
      .replacedAt instanceof Date
  );

  const create = calls.creates[0] as {
    data: Record<string, unknown>;
    select: Record<string, boolean>;
  };
  assert.deepEqual(create.data, {
    credentialId: 'credential-1',
    submittedByUserId: 'issuer-user-1',
    label: 'Temario institucional',
    content: 'Linea uno\nLinea dos',
    sha256:
      '3e7b242d32c2b31ab9a8d2006a1c13b61dc3840f23b9e39dee963d98e928da2d',
    status: TextEvidenceStatus.current
  });
  assert.deepEqual(create.select, textEvidenceResponseSelect);
  assert.deepEqual(response, {
    textEvidenceReference: 'text-evidence-1',
    status: TextEvidenceStatus.current,
    label: 'Temario institucional',
    content: 'Linea uno\nLinea dos',
    characterCount: 19,
    sha256:
      '3e7b242d32c2b31ab9a8d2006a1c13b61dc3840f23b9e39dee963d98e928da2d',
    submittedAt: '2026-08-03T12:00:00.000Z'
  });
  assert.deepEqual(calls.forbiddenWrites, []);
});

test('service rejects unauthorized users before credential lookup and body validation', async () => {
  const { service, calls } = setup({
    permissionError: new ForbiddenException('forbidden')
  });

  await assert.rejects(
    service.submitCurrentText(
      'issuer-arbitrary',
      'credential-1',
      CURRENT_USER,
      { content: '' }
    ),
    ForbiddenException
  );
  assert.deepEqual(calls.preliminaryCredentialReads, []);
  assert.deepEqual(calls.transactionalCredentialReads, []);
  assert.deepEqual(calls.transactions, []);
});

test('service uses the same safe 404 for missing and cross-issuer credentials', async () => {
  const { service, calls } = setup({ credentialExists: false });

  await assert.rejects(
    service.submitCurrentText(
      'issuer-1',
      'credential-other',
      CURRENT_USER,
      { content: 'Texto' }
    ),
    (error: unknown) =>
      error instanceof NotFoundException &&
      error.message === 'No se encontro la credencial solicitada.'
  );
  assert.deepEqual(calls.transactions, []);
});

test('service returns 409 for issued and revoked before body validation', async () => {
  for (const status of [CredentialStatus.issued, CredentialStatus.revoked]) {
    const { service, calls } = setup({ status });

    await assert.rejects(
      service.submitCurrentText(
        'issuer-1',
        'credential-1',
        CURRENT_USER,
        { content: '' }
      ),
      (error: unknown) =>
        error instanceof ConflictException && error.getStatus() === 409
    );
    assert.deepEqual(calls.transactions, []);
  }
});

test('service rejects a concurrent transition from draft to issued or revoked before writes', async () => {
  for (const status of [CredentialStatus.issued, CredentialStatus.revoked]) {
    const { service, calls } = setup({ transactionalStatus: status });

    await assert.rejects(
      service.submitCurrentText(
        'issuer-1',
        'credential-1',
        CURRENT_USER,
        { content: 'Texto valido' }
      ),
      (error: unknown) =>
        error instanceof ConflictException && error.getStatus() === 409
    );

    assert.equal(calls.preliminaryCredentialReads.length, 1);
    assert.equal(calls.transactionalCredentialReads.length, 1);
    assert.deepEqual(calls.updateMany, []);
    assert.deepEqual(calls.creates, []);
    assert.deepEqual(calls.forbiddenWrites, []);
  }
});

test('service returns the safe 404 when the scoped credential disappears inside the transaction', async () => {
  const { service, calls } = setup({
    transactionalCredentialExists: false
  });

  await assert.rejects(
    service.submitCurrentText(
      'issuer-1',
      'credential-1',
      CURRENT_USER,
      { content: 'Texto valido' }
    ),
    (error: unknown) =>
      error instanceof NotFoundException &&
      error.message === 'No se encontro la credencial solicitada.'
  );

  assert.equal(calls.preliminaryCredentialReads.length, 1);
  assert.equal(calls.transactionalCredentialReads.length, 1);
  assert.deepEqual(calls.updateMany, []);
  assert.deepEqual(calls.creates, []);
  assert.deepEqual(calls.forbiddenWrites, []);
});

test('service validates the closed body only after draft scope checks', async () => {
  const { service, calls } = setup();

  await assert.rejects(
    service.submitCurrentText(
      'issuer-1',
      'credential-1',
      CURRENT_USER,
      { content: 'Texto', skills: [] }
    )
  );
  assert.equal(calls.preliminaryCredentialReads.length, 1);
  assert.deepEqual(calls.transactionalCredentialReads, []);
  assert.deepEqual(calls.transactions, []);
});

test('service always creates a new row even when normalized content and hash are equal', async () => {
  const { service, calls } = setup();

  await service.submitCurrentText(
    'issuer-1',
    'credential-1',
    CURRENT_USER,
    { content: 'Mismo texto' }
  );
  await service.submitCurrentText(
    'issuer-1',
    'credential-1',
    CURRENT_USER,
    { content: 'Mismo texto' }
  );

  assert.equal(calls.creates.length, 2);
  assert.equal(calls.updateMany.length, 2);
  assert.equal(
    (calls.creates[0] as { data: { sha256: string } }).data.sha256,
    (calls.creates[1] as { data: { sha256: string } }).data.sha256
  );
  assert.deepEqual(calls.forbiddenWrites, []);
});

function forbiddenWriter(name: string, calls: string[]) {
  return {
    async create() {
      calls.push(`${name}.create`);
      throw new Error(`${name} must not be created`);
    },
    async update() {
      calls.push(`${name}.update`);
      throw new Error(`${name} must not be updated`);
    },
    async updateMany() {
      calls.push(`${name}.updateMany`);
      throw new Error(`${name} must not be updated`);
    },
    async delete() {
      calls.push(`${name}.delete`);
      throw new Error(`${name} must not be deleted`);
    }
  };
}

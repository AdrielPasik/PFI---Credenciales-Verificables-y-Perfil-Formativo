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

// ─── C2b.3: ensureSystemGeneratedCurrentTextEvidenceForCredential ──────────

function setupEnsure(options: {
  existing?: { id: string; sha256: string; status: TextEvidenceStatus } | null;
} = {}) {
  const calls = {
    finds: [] as unknown[],
    creates: [] as unknown[],
    transactions: [] as unknown[]
  };
  const transaction = {
    textEvidence: {
      async findFirst(args: unknown) {
        calls.finds.push(args);
        return options.existing === undefined ? null : options.existing;
      },
      async create(args: unknown) {
        calls.creates.push(args);
        const data = (args as { data: Record<string, unknown> }).data;
        return {
          id: 'text-evidence-system-1',
          sha256: data.sha256 as string,
          status: TextEvidenceStatus.current
        };
      }
    }
  };
  const prisma = {
    async $transaction(
      callback: (value: typeof transaction) => Promise<unknown>,
      transactionOptions: unknown
    ) {
      calls.transactions.push(transactionOptions);
      return callback(transaction);
    }
  };
  return {
    calls,
    service: new TextEvidenceService(prisma as never, {} as never)
  };
}

test('ensureSystemGeneratedCurrentTextEvidenceForCredential creates a current row when none exists', async () => {
  const { service, calls } = setupEnsure({ existing: null });

  const result = await service.ensureSystemGeneratedCurrentTextEvidenceForCredential(
    'credential-1',
    'Nombre del curso:\nPython Bootcamp',
    'issuer-user-1'
  );

  assert.deepEqual(calls.transactions, [
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  ]);
  assert.deepEqual(calls.finds, [
    {
      where: { credentialId: 'credential-1', status: TextEvidenceStatus.current },
      select: { id: true, sha256: true, status: true }
    }
  ]);
  const create = calls.creates[0] as { data: Record<string, unknown> };
  assert.equal(create.data.credentialId, 'credential-1');
  assert.equal(create.data.submittedByUserId, 'issuer-user-1');
  assert.equal(
    create.data.label,
    'Texto generado para análisis desde datos declarados del curso'
  );
  assert.equal(create.data.content, 'Nombre del curso:\nPython Bootcamp');
  assert.equal(create.data.status, TextEvidenceStatus.current);
  assert.match(create.data.sha256 as string, /^[0-9a-f]{64}$/);
  assert.deepEqual(result, {
    id: 'text-evidence-system-1',
    sha256: create.data.sha256,
    status: TextEvidenceStatus.current,
    reused: false
  });
});

test('ensureSystemGeneratedCurrentTextEvidenceForCredential reuses an existing current row without writing', async () => {
  const existing = {
    id: 'text-evidence-manual-1',
    sha256: 'a'.repeat(64),
    status: TextEvidenceStatus.current
  };
  const { service, calls } = setupEnsure({ existing });

  const result = await service.ensureSystemGeneratedCurrentTextEvidenceForCredential(
    'credential-1',
    'Nombre del curso:\nPython Bootcamp',
    'issuer-user-1'
  );

  assert.deepEqual(result, { ...existing, reused: true });
  assert.equal(calls.creates.length, 0);
});

test('ensureSystemGeneratedCurrentTextEvidenceForCredential never replaces an existing current row even with different content', async () => {
  // C2b.3 "Prioridad de fuentes textuales": el schema no distingue manual
  // vs generado por sistema, asi que la regla conservadora es no pisar
  // NUNCA una TextEvidence current existente, sea cual sea su origen.
  const existing = {
    id: 'text-evidence-manual-1',
    sha256: 'b'.repeat(64),
    status: TextEvidenceStatus.current
  };
  const { service, calls } = setupEnsure({ existing });

  const result = await service.ensureSystemGeneratedCurrentTextEvidenceForCredential(
    'credential-1',
    'Contenido totalmente distinto generado por el sistema para este curso.',
    'issuer-user-1'
  );

  assert.equal(result.id, existing.id);
  assert.equal(result.sha256, existing.sha256);
  assert.equal(result.reused, true);
  assert.equal(calls.creates.length, 0);
});

test('ensureSystemGeneratedCurrentTextEvidenceForCredential computes a stable real sha256 over the normalized content', async () => {
  const { service: first } = setupEnsure({ existing: null });
  const { service: second } = setupEnsure({ existing: null });

  const resultA = await first.ensureSystemGeneratedCurrentTextEvidenceForCredential(
    'credential-1',
    'Contenido identico',
    'issuer-user-1'
  );
  const resultB = await second.ensureSystemGeneratedCurrentTextEvidenceForCredential(
    'credential-2',
    'Contenido identico',
    'issuer-user-2'
  );

  assert.equal(resultA.sha256, resultB.sha256);
  assert.match(resultA.sha256, /^[0-9a-f]{64}$/);
});

test('ensureSystemGeneratedCurrentTextEvidenceForCredential does not delete or alter history', async () => {
  const { service, calls } = setupEnsure({ existing: null });
  await service.ensureSystemGeneratedCurrentTextEvidenceForCredential(
    'credential-1',
    'Nombre del curso:\nPython Bootcamp',
    'issuer-user-1'
  );

  // No updateMany/delete calls exist on the fake transaction's textEvidence
  // model at all -- if the implementation tried to call them, this test
  // setup would throw a "not a function" error instead of passing quietly.
  assert.equal(calls.creates.length, 1);
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

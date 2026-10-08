import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BlockchainNetwork,
  BlockchainRecordStatus,
  CredentialStatus
} from '@prisma/client';

import {
  type BlockchainRecordReconciliationResult
} from '../blockchain/blockchain-record-reconciliation.service';
import { type CredentialRegistryDeployment } from '../blockchain/credential-registry-deployment';
import {
  IssuerCredentialRevocationError
} from './issuer-credential-revocation.error';
import {
  IssuerCredentialRevocationService,
  normalizeRevocationReason
} from './issuer-credential-revocation.service';

// Identificador de deployment SINTETICO y solo de test. No existe ningun
// deployment real todavia: el manifest commiteado es S8c10.
const TEST_DEPLOYMENT_ID = 'test-anvil-local';

const HASH = `0x${'a'.repeat(64)}`;
const CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const ISSUER_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const DEPLOYMENT: CredentialRegistryDeployment = {
  evidenceMode: 'credential_registry',
  network: BlockchainNetwork.anvil,
  chainId: 31337,
  rpcUrl: 'http://127.0.0.1:8545',
  contractAddress: CONTRACT_ADDRESS,
  deploymentId: TEST_DEPLOYMENT_ID
};

function reconciliation(
  state: BlockchainRecordReconciliationResult['state'],
  overrides: Partial<BlockchainRecordReconciliationResult> = {}
): BlockchainRecordReconciliationResult {
  const chainRevoked = state.includes('CHAIN_REVOKED');
  return {
    state,
    chainRevoked,
    resolvedDeployment: state.startsWith('DB_') ? DEPLOYMENT : null,
    chainRevokedAt: chainRevoked ? '1760000000' : null,
    ...overrides
  };
}

function createCredential(status: CredentialStatus = CredentialStatus.issued) {
  return {
    id: 'credential-1',
    issuerId: 'issuer-1',
    subjectUserId: 'holder-1',
    status,
    canonicalHash: HASH,
    canonicalizationVersion: 'canon_v1',
    blockchainRecords: [
      {
        id: 'record-1',
        credentialId: 'credential-1',
        credentialHash: HASH,
        hashAlgorithm: 'sha256',
        canonicalizationVersion: 'canon_v1',
        network: BlockchainNetwork.anvil,
        chainId: 31337,
        contractAddress: CONTRACT_ADDRESS,
        txHash: `0x${'b'.repeat(64)}`,
        issuerAddress: ISSUER_ADDRESS,
        registeredAt: new Date('2026-01-01T00:00:00.000Z'),
        status: BlockchainRecordStatus.registered,
        revokedAt: null,
        revocationReason: null
      }
    ]
  };
}

function setup(options: {
  initialCredential?: ReturnType<typeof createCredential> | null;
  classifications?: BlockchainRecordReconciliationResult[];
  writerError?: Error;
  writerStatus?: 'success' | 'failed' | 'unknown';
  profileFailure?: boolean;
  transactionFailure?: boolean;
  signerAddress?: string;
} = {}) {
  const credential = options.initialCredential ?? createCredential();
  const calls = {
    authorizations: [] as unknown[],
    classifications: 0,
    writes: [] as string[],
    transactionUpdates: [] as unknown[],
    profileRebuilds: [] as unknown[],
    reasonWrites: [] as unknown[]
  };
  let persistedRevokedAt: Date | null =
    credential.status === CredentialStatus.revoked
      ? new Date('2025-10-09T08:53:20.000Z')
      : null;
  let classificationIndex = 0;
  const classifications =
    options.classifications ?? [reconciliation('DB_ISSUED_CHAIN_REVOKED')];

  const prisma = {
    credential: {
      async findFirst(input: { select: { revokedAt?: boolean } }) {
        if (input.select.revokedAt) {
          return persistedRevokedAt ? { revokedAt: persistedRevokedAt } : null;
        }
        return credential;
      }
    },
    async $transaction(callback: (transaction: {
      credential: { updateMany(input: unknown): Promise<{ count: number }> };
      blockchainRecord: { updateMany(input: unknown): Promise<{ count: number }> };
    }) => Promise<void>) {
      if (options.transactionFailure) throw new Error('database failure');
      await callback({
        credential: {
          async updateMany(input: {
            data: { revokedAt: Date; revocationReason: string | null };
          }) {
            calls.transactionUpdates.push(input);
            calls.reasonWrites.push(input.data.revocationReason);
            persistedRevokedAt = input.data.revokedAt;
            return { count: 1 };
          }
        },
        blockchainRecord: {
          async updateMany(input: unknown) {
            calls.transactionUpdates.push(input);
            return { count: 1 };
          }
        }
      });
    }
  };

  const service = new IssuerCredentialRevocationService(
    prisma as never,
    {
      async assertUserCanIssueCredentialForIssuer(...args: unknown[]) {
        calls.authorizations.push(args);
      }
    } as never,
    {
      async classify() {
        calls.classifications += 1;
        return classifications[Math.min(classificationIndex++, classifications.length - 1)];
      }
    } as never,
    {
      async rebuildAfterRevocation(input: unknown) {
        calls.profileRebuilds.push(input);
        return options.profileFailure
          ? { status: 'failed' as const, errorCode: 'formative_profile_rebuild_failed' as const }
          : { status: 'rebuilt' as const };
      }
    } as never,
    () => ({
      async revokeCredential(hash: string) {
        calls.writes.push(hash);
        if (options.writerError) throw options.writerError;
        return {
          credentialHash: hash,
          transactionHash: `0x${'c'.repeat(64)}`,
          from: ISSUER_ADDRESS,
          to: CONTRACT_ADDRESS,
          status: options.writerStatus ?? 'success',
          blockNumber: '42'
        };
      }
    }),
    () => options.signerAddress ?? ISSUER_ADDRESS
  );

  return { service, calls };
}

const actor = { id: 'issuer-user-1' };

test('issued + chain active writes exactly once, re-reads, persists the chain timestamp, then rebuilds the holder', async () => {
  const context = setup({
    classifications: [
      reconciliation('DB_ISSUED_CHAIN_ACTIVE', { chainRevoked: false, chainRevokedAt: null }),
      reconciliation('DB_ISSUED_CHAIN_REVOKED')
    ]
  });

  const response = await context.service.revokeForIssuer(
    'issuer-1',
    'credential-1',
    actor,
    { reason: '  Dato institucional corregido  ' }
  );

  assert.deepEqual(context.calls.writes, [HASH]);
  assert.equal(context.calls.classifications, 2);
  assert.deepEqual(context.calls.reasonWrites, ['Dato institucional corregido']);
  assert.deepEqual(context.calls.profileRebuilds, [
    { credentialId: 'credential-1', holderUserId: 'holder-1' }
  ]);
  assert.deepEqual(response, {
    credentialReference: 'credential-1',
    status: 'revoked',
    revokedAt: '2025-10-09T08:53:20.000Z',
    profileReconciliation: 'rebuilt'
  });
});

test('chain already revoked recovers database state without sending a second write or attributing the retry reason', async () => {
  const context = setup({
    classifications: [reconciliation('DB_ISSUED_CHAIN_REVOKED')]
  });

  await context.service.revokeForIssuer('issuer-1', 'credential-1', actor, {
    reason: 'No debe atribuirse a un reintento'
  });

  assert.deepEqual(context.calls.writes, []);
  assert.deepEqual(context.calls.reasonWrites, [null]);
  assert.equal(context.calls.profileRebuilds.length, 1);
});

test('a transport error after the write recovers only when the record-bound re-read confirms revocation', async () => {
  const context = setup({
    classifications: [
      reconciliation('DB_ISSUED_CHAIN_ACTIVE', { chainRevoked: false, chainRevokedAt: null }),
      reconciliation('DB_ISSUED_CHAIN_REVOKED')
    ],
    writerError: new Error('transport details must not escape')
  });

  const response = await context.service.revokeForIssuer('issuer-1', 'credential-1', actor, {
    reason: 'Correccion administrativa'
  });

  assert.deepEqual(context.calls.writes, [HASH]);
  assert.deepEqual(context.calls.reasonWrites, ['Correccion administrativa']);
  assert.equal(response.status, 'revoked');
});

test('already reconciled revocation sends no chain or database write but retries profile reconciliation', async () => {
  const credential = createCredential(CredentialStatus.revoked);
  const context = setup({
    initialCredential: credential,
    classifications: [reconciliation('DB_REVOKED_CHAIN_REVOKED')]
  });
  const response = await context.service.revokeForIssuer('issuer-1', 'credential-1', actor, undefined);

  assert.deepEqual(context.calls.writes, []);
  assert.deepEqual(context.calls.transactionUpdates, []);
  assert.equal(context.calls.profileRebuilds.length, 1);
  assert.equal(response.status, 'revoked');
});

test('fails closed without writes when database says revoked but the chain remains active', async () => {
  const context = setup({
    initialCredential: createCredential(CredentialStatus.revoked),
    classifications: [reconciliation('DB_REVOKED_CHAIN_ACTIVE', { chainRevoked: false, chainRevokedAt: null })]
  });

  await assert.rejects(
    () => context.service.revokeForIssuer('issuer-1', 'credential-1', actor, undefined),
    (error: unknown) => hasRevocationCode(error, 'BLOCKCHAIN_STATE_INCONSISTENT')
  );
  assert.deepEqual(context.calls.writes, []);
  assert.deepEqual(context.calls.transactionUpdates, []);
});

test('draft credentials are rejected before any writer or database reconciliation mutation', async () => {
  const context = setup({
    initialCredential: createCredential(CredentialStatus.draft),
    classifications: [reconciliation('DB_STATE_UNSUPPORTED', { chainRevoked: false, chainRevokedAt: null })]
  });

  await assert.rejects(
    () => context.service.revokeForIssuer('issuer-1', 'credential-1', actor, undefined),
    (error: unknown) => hasRevocationCode(error, 'CREDENTIAL_NOT_ISSUED')
  );
  assert.deepEqual(context.calls.writes, []);
  assert.deepEqual(context.calls.transactionUpdates, []);
});

test('fails before a write when the configured signer is not the chain registrant', async () => {
  const context = setup({
    classifications: [reconciliation('DB_ISSUED_CHAIN_ACTIVE', { chainRevoked: false, chainRevokedAt: null })],
    signerAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  });

  await assert.rejects(
    () => context.service.revokeForIssuer('issuer-1', 'credential-1', actor, undefined),
    (error: unknown) => hasRevocationCode(error, 'BLOCKCHAIN_SIGNER_UNAUTHORIZED')
  );
  assert.deepEqual(context.calls.writes, []);
});

test('a profile reconciliation failure is retryable after the authoritative revocation remains persisted', async () => {
  const context = setup({
    classifications: [reconciliation('DB_ISSUED_CHAIN_REVOKED')],
    profileFailure: true
  });

  await assert.rejects(
    () => context.service.revokeForIssuer('issuer-1', 'credential-1', actor, undefined),
    (error: unknown) => hasRevocationCode(error, 'PROFILE_RECONCILIATION_FAILED')
  );
  assert.equal(context.calls.transactionUpdates.length, 2);
  assert.equal(context.calls.profileRebuilds.length, 1);
});

test('reason parser accepts only an optional normalized reason and rejects malformed or ambiguous input', () => {
  assert.equal(normalizeRevocationReason(undefined), null);
  assert.equal(normalizeRevocationReason({ reason: '  Motivo\n institucional ' }), 'Motivo institucional');
  for (const body of [
    { reason: 'x'.repeat(501) },
    { reason: ['not text'] },
    { reason: 'bad\u0001control' },
    { reason: 'ok', issuerId: 'other' },
    ['not an object']
  ]) {
    assert.throws(
      () => normalizeRevocationReason(body),
      (error: unknown) => hasRevocationCode(error, 'INVALID_REVOCATION_REASON')
    );
  }
});

function hasRevocationCode(error: unknown, code: string): boolean {
  if (!(error instanceof IssuerCredentialRevocationError)) {
    return false;
  }

  const response = error.getResponse();
  return typeof response === 'object' && response !== null && 'code' in response && response.code === code;
}

// ---------------------------------------------------------------------------
// S8c6, matriz 84: PENDING NO ES REVOCABLE
// ---------------------------------------------------------------------------

/** Fila de registro real que todavia NO fue confirmada en la cadena. */
function createPendingCredential() {
  const credential = createCredential();

  return {
    ...credential,
    canonicalizationVersion: 'canon_v2',
    blockchainRecords: [
      {
        ...credential.blockchainRecords[0],
        canonicalizationVersion: 'canon_v2',
        network: BlockchainNetwork.base_sepolia,
        chainId: 84532,
        status: BlockchainRecordStatus.pending,
        // Los tres hechos de la cadena todavia no se observaron.
        txHash: null,
        issuerAddress: null,
        registeredAt: null
      }
    ]
  };
}

test('84: una registracion PENDING no se revoca on-chain', async () => {
  const context = setup({
    initialCredential: createPendingCredential() as never
  });

  await assert.rejects(
    context.service.revokeForIssuer(
      'issuer-1',
      'credential-1',
      actor,
      undefined
    ),
    (error: unknown) => {
      // `pending` NO es `registered`: no hay transaccion que revocar y no hay
      // registrante observado contra el que autorizar. Falla cerrado por el
      // mismo camino que una evidencia ausente, en vez de intentar revocar
      // algo que nunca se finalizo.
      assert.ok(error instanceof IssuerCredentialRevocationError);
      // El code viaja en el cuerpo de la HttpException.
      const body = (error as IssuerCredentialRevocationError).getResponse() as {
        code: string;
      };
      assert.equal(body.code, 'BLOCKCHAIN_RECORD_UNRESOLVABLE');
      return true;
    }
  );

  // CERO transacciones de revocacion.
  assert.deepEqual(context.calls.writes, []);
  assert.deepEqual(context.calls.transactionUpdates, []);
});

test('84b: una fila sin alguno de los hechos de cadena tampoco se revoca', async () => {
  const incomplete = [
    { txHash: null },
    { issuerAddress: null },
    { registeredAt: null }
  ];

  for (const missing of incomplete) {
    const credential = createCredential();
    const context = setup({
      initialCredential: {
        ...credential,
        blockchainRecords: [{ ...credential.blockchainRecords[0], ...missing }]
      } as never
    });

    await assert.rejects(
      context.service.revokeForIssuer(
        'issuer-1',
        'credential-1',
        actor,
        undefined
      ),
      IssuerCredentialRevocationError,
      JSON.stringify(missing)
    );

    assert.deepEqual(context.calls.writes, [], JSON.stringify(missing));
  }
});

test('S8c6: la revocacion sigue usando el mecanismo TRANSITORIO, no el perfil historico', async () => {
  // S8c6 NO hace el cutover del signer de revocacion: una fila registrada se
  // sigue revocando con el signer global configurado. El cutover al
  // `anchorSignerProfileId` historico es S8c8.
  const context = setup({
    classifications: [
      reconciliation('DB_ISSUED_CHAIN_ACTIVE'),
      reconciliation('DB_ISSUED_CHAIN_REVOKED')
    ]
  });

  await context.service.revokeForIssuer(
    'issuer-1',
    'credential-1',
    actor,
    undefined
  );

  // Se escribio en la cadena por el camino legacy.
  assert.equal(context.calls.writes.length, 1);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BlockchainNetwork,
  BlockchainRecordStatus,
  CredentialStatus,
  SignerProfilePurpose,
  SignerProfileStatus
} from '@prisma/client';

import { PUBLIC_TEST_KEY_ONE } from '../signing/__fixtures__/signer-test-keys';

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
/**
 * S8c8: el registrante historico es la direccion del ANCHOR que registro, y la
 * clave es el escalar publico 1 (PUBLIC TEST KEY / DO NOT FUND). Antes este
 * valor era la cuenta de dev de Anvil, que no tenia clave asociada en el test
 * porque la firma la hacia un doble del cliente legacy.
 */
const ISSUER_ADDRESS = PUBLIC_TEST_KEY_ONE.address;
const ANCHOR_PROFILE_ID = 'anchor-profile-historical';
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
        revocationReason: null,
        deploymentId: TEST_DEPLOYMENT_ID,
        // S8c8: el ANCHOR HISTORICO congelado por S8c6.
        anchorSignerProfileId: ANCHOR_PROFILE_ID,
        anchorSignerProfile: {
          id: ANCHOR_PROFILE_ID,
          purpose: SignerProfilePurpose.anchor as SignerProfilePurpose,
          status: SignerProfileStatus.active as SignerProfileStatus,
          address: ISSUER_ADDRESS.toLowerCase()
        }
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
  // S8c8: estado del perfil historico tal como lo relee la compuerta del carril.
  gateProfile?: {
    purpose?: SignerProfilePurpose;
    status?: SignerProfileStatus;
    address?: string;
  } | null;
  /** El estado de cadena que la compuerta observa DENTRO del carril. */
  inLaneChainRevoked?: boolean;
  /** La compuerta del carril no obtiene un estado confiable. */
  inLaneChainUnreadable?: boolean;
  /** Error de resolucion del signer historico. */
  signerResolutionError?: Error;
  /** El actor no tiene membership para ese issuer. */
  unauthorized?: boolean;
} = {}) {
  const credential = options.initialCredential ?? createCredential();
  const calls = {
    authorizations: [] as unknown[],
    classifications: 0,
    writes: [] as string[],
    historicalResolutions: [] as string[],
    gateReads: [] as string[],
    inLaneChainReads: [] as string[],
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
    // S8c8: relectura PUBLICA del perfil historico dentro del carril.
    signerProfile: {
      async findUnique(input: { where: { id: string } }) {
        calls.gateReads.push(input.where.id);

        if (options.gateProfile === null) {
          return null;
        }

        return {
          purpose: options.gateProfile?.purpose ?? SignerProfilePurpose.anchor,
          status: options.gateProfile?.status ?? SignerProfileStatus.active,
          address: options.gateProfile?.address ?? ISSUER_ADDRESS.toLowerCase()
        };
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

        if (options.unauthorized) {
          throw new Error('sin membership para ese issuer');
        }
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
    // S8c8: el MISMO coordinador que la registracion. El doble ejecuta las dos
    // compuertas en el orden real -- clave, despues cadena -- para que los
    // tests puedan probar que ninguna se saltea.
    {
      async revokeCredentialHash(input: {
        credentialHash: string;
        assertSignerUsable?: () => Promise<void>;
        assertChainRevocable?: (provider: unknown) => Promise<string>;
      }) {
        if (input.assertSignerUsable) {
          await input.assertSignerUsable();
        }

        if (input.assertChainRevocable) {
          const decision = await input.assertChainRevocable({});

          if (decision === 'already_revoked') {
            return { kind: 'already_revoked' as const };
          }
        }

        calls.writes.push(input.credentialHash);

        if (options.writerError) {
          throw options.writerError;
        }

        return {
          kind: 'revoked' as const,
          evidence: {
            txHash: `0x${'c'.repeat(64)}`,
            blockNumber: 42,
            registrant: ISSUER_ADDRESS,
            registeredAt: new Date('2026-01-01T00:00:00.000Z')
          }
        };
      }
    } as never,
    // S8c8: resolucion del signer HISTORICO por id exacto de perfil.
    {
      async resolveHistoricalAnchorSigner(profileId: string) {
        calls.historicalResolutions.push(profileId);

        if (options.signerResolutionError) {
          throw options.signerResolutionError;
        }

        return {
          profileId,
          purpose: SignerProfilePurpose.anchor,
          keyVersion: 1,
          address: ISSUER_ADDRESS,
          wallet: { address: ISSUER_ADDRESS }
        };
      }
    } as never,
    // Lectura del contrato DENTRO del carril, sobre el provider ya validado.
    {
      async readCredentialStateOnProvider(input: { credentialHash: string }) {
        calls.inLaneChainReads.push(input.credentialHash);

        if (options.inLaneChainUnreadable) {
          return { kind: 'registry_read_failed' as const };
        }

        return {
          kind: 'credential_state' as const,
          status: {
            credentialHash: input.credentialHash,
            exists: true,
            revoked: options.inLaneChainRevoked === true,
            issuer: ISSUER_ADDRESS,
            registeredAt: '1760000000',
            revokedAt: options.inLaneChainRevoked === true ? '1760000000' : null
          }
        };
      }
    } as never
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

test('S8c8: falla antes de escribir si el anchor historico no es el registrante', async () => {
  // Antes de S8c8 este test comparaba la clave GLOBAL de entorno contra el
  // registrante observado. Ahora la expectativa sale del perfil que el record
  // congelo: si su direccion publica no es la que la cadena observo, la
  // procedencia del record es incoherente y no se escribe nada.
  const credential = createCredential();
  credential.blockchainRecords[0].anchorSignerProfile.address =
    '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';

  const context = setup({
    initialCredential: credential,
    classifications: [reconciliation('DB_ISSUED_CHAIN_ACTIVE', { chainRevoked: false, chainRevokedAt: null })]
  });

  await assert.rejects(
    () => context.service.revokeForIssuer('issuer-1', 'credential-1', actor, undefined),
    (error: unknown) => hasRevocationCode(error, 'HISTORICAL_ANCHOR_UNRESOLVED')
  );

  assert.deepEqual(context.calls.writes, []);
  // Y CERO resoluciones del secreto: la incoherencia se detecta con metadata
  // publica, antes de tocar el almacen.
  assert.deepEqual(context.calls.historicalResolutions, []);
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

// ---------------------------------------------------------------------------
// S8c8: REVOCACION CON EL ANCHOR HISTORICO -- items 44-65
// ---------------------------------------------------------------------------

test('44-45: sin autorizacion no hay resolucion de signer, ni SSM, ni escritura', async () => {
  const context = setup({ unauthorized: true });

  await assert.rejects(() =>
    context.service.revokeForIssuer('issuer-1', 'credential-1', actor, undefined)
  );

  // La autorizacion es lo PRIMERO: un actor sin membership no llega ni a la
  // clasificacion de cadena, ni al almacen de secretos, ni a la red.
  assert.equal(context.calls.classifications, 0);
  assert.deepEqual(context.calls.historicalResolutions, []);
  assert.deepEqual(context.calls.gateReads, []);
  assert.deepEqual(context.calls.inLaneChainReads, []);
  assert.deepEqual(context.calls.writes, []);
  assert.deepEqual(context.calls.transactionUpdates, []);
});

test('47: mas de una fila de evidencia falla cerrado sin signer ni cadena', async () => {
  const credential = createCredential();
  credential.blockchainRecords.push({
    ...credential.blockchainRecords[0],
    id: 'record-2'
  });

  const context = setup({ initialCredential: credential });

  await assert.rejects(
    () => context.service.revokeForIssuer('issuer-1', 'credential-1', actor, undefined),
    (error: unknown) => hasRevocationCode(error, 'BLOCKCHAIN_RECORD_AMBIGUOUS')
  );

  // Ni clasificacion de cadena, ni resolucion de secreto, ni escritura.
  assert.equal(context.calls.classifications, 0);
  assert.deepEqual(context.calls.historicalResolutions, []);
  assert.deepEqual(context.calls.writes, []);
});

test('50-51, 55: el signer sale del anchor HISTORICO del record', async () => {
  const context = setup({
    classifications: [
      reconciliation('DB_ISSUED_CHAIN_ACTIVE', { chainRevoked: false, chainRevokedAt: null }),
      reconciliation('DB_ISSUED_CHAIN_REVOKED')
    ]
  });

  await context.service.revokeForIssuer('issuer-1', 'credential-1', actor, undefined);

  // 50: se resolvio EXACTAMENTE el perfil que el record congelo.
  assert.deepEqual(context.calls.historicalResolutions, [ANCHOR_PROFILE_ID]);
  // 51: el anchor vigente del issuer no se consulta en ningun momento.
  assert.deepEqual(context.calls.writes, [HASH]);
});

test('84-85: una fila legacy sin anchor historico falla cerrado', async () => {
  // Sin fallback: ni el anchor vigente, ni `Issuer.walletAddress`, ni la clave
  // de asercion, ni la clave global de entorno.
  const credential = createCredential();
  credential.blockchainRecords[0].anchorSignerProfileId = null as never;
  credential.blockchainRecords[0].anchorSignerProfile = null as never;

  const context = setup({
    initialCredential: credential,
    classifications: [
      reconciliation('DB_ISSUED_CHAIN_ACTIVE', { chainRevoked: false, chainRevokedAt: null })
    ]
  });

  await assert.rejects(
    () => context.service.revokeForIssuer('issuer-1', 'credential-1', actor, undefined),
    (error: unknown) => hasRevocationCode(error, 'HISTORICAL_ANCHOR_UNRESOLVED')
  );

  assert.deepEqual(context.calls.historicalResolutions, []);
  assert.deepEqual(context.calls.writes, []);
  assert.deepEqual(context.calls.transactionUpdates, []);
});

test('58: un anchor historico COMPROMETIDO se rechaza ANTES de resolver el secreto', async () => {
  const credential = createCredential();
  credential.blockchainRecords[0].anchorSignerProfile.status =
    SignerProfileStatus.compromised;

  const context = setup({
    initialCredential: credential,
    classifications: [
      reconciliation('DB_ISSUED_CHAIN_ACTIVE', { chainRevoked: false, chainRevokedAt: null })
    ]
  });

  await assert.rejects(
    () => context.service.revokeForIssuer('issuer-1', 'credential-1', actor, undefined),
    (error: unknown) => hasRevocationCode(error, 'HISTORICAL_ANCHOR_COMPROMISED')
  );

  // CERO lecturas del almacen de secretos, y cero escrituras. No hay sustituto.
  assert.deepEqual(context.calls.historicalResolutions, []);
  assert.deepEqual(context.calls.writes, []);
});

test('57: un anchor historico RETIRADO si puede revocar', async () => {
  const credential = createCredential();
  credential.blockchainRecords[0].anchorSignerProfile.status =
    SignerProfileStatus.retired;

  const context = setup({
    initialCredential: credential,
    classifications: [
      reconciliation('DB_ISSUED_CHAIN_ACTIVE', { chainRevoked: false, chainRevokedAt: null }),
      reconciliation('DB_ISSUED_CHAIN_REVOKED')
    ]
  });

  await context.service.revokeForIssuer('issuer-1', 'credential-1', actor, undefined);

  assert.deepEqual(context.calls.historicalResolutions, [ANCHOR_PROFILE_ID]);
  assert.deepEqual(context.calls.writes, [HASH]);
});

test('33: un perfil historico con proposito de ASERCION falla cerrado', async () => {
  const credential = createCredential();
  credential.blockchainRecords[0].anchorSignerProfile.purpose =
    SignerProfilePurpose.assertion;

  const context = setup({
    initialCredential: credential,
    classifications: [
      reconciliation('DB_ISSUED_CHAIN_ACTIVE', { chainRevoked: false, chainRevokedAt: null })
    ]
  });

  await assert.rejects(
    () => context.service.revokeForIssuer('issuer-1', 'credential-1', actor, undefined),
    (error: unknown) => hasRevocationCode(error, 'HISTORICAL_ANCHOR_UNRESOLVED')
  );
  assert.deepEqual(context.calls.historicalResolutions, []);
});

test('54, 65: si la cadena YA dice revocada, no se resuelve ningun secreto', async () => {
  // La lectura previa alcanza: se sincroniza el estado local con CERO lecturas
  // del almacen de secretos y CERO transacciones.
  const context = setup({
    classifications: [reconciliation('DB_ISSUED_CHAIN_REVOKED')]
  });

  await context.service.revokeForIssuer('issuer-1', 'credential-1', actor, undefined);

  assert.deepEqual(context.calls.historicalResolutions, []);
  assert.deepEqual(context.calls.writes, []);
  // Pero si se sincroniza el estado local.
  assert.equal(context.calls.transactionUpdates.length, 2);
});

test('addendum C: tras adquirir el carril se RELEE el estado de cadena', async () => {
  const context = setup({
    classifications: [
      reconciliation('DB_ISSUED_CHAIN_ACTIVE', { chainRevoked: false, chainRevokedAt: null }),
      reconciliation('DB_ISSUED_CHAIN_REVOKED')
    ]
  });

  await context.service.revokeForIssuer('issuer-1', 'credential-1', actor, undefined);

  // La compuerta de clave y la de cadena corrieron las dos, dentro del carril.
  assert.deepEqual(context.calls.gateReads, [ANCHOR_PROFILE_ID]);
  assert.deepEqual(context.calls.inLaneChainReads, [HASH]);
  assert.deepEqual(context.calls.writes, [HASH]);
});

test('addendum C: si dentro del carril la cadena ya esta revocada, CERO envios', async () => {
  // Es la carrera que la serializacion sola no resuelve: dos requests leyeron
  // `revoked=false`, la primera revoco, y la segunda tiene que DARSE CUENTA en
  // vez de limitarse a ir detras.
  const context = setup({
    classifications: [
      reconciliation('DB_ISSUED_CHAIN_ACTIVE', { chainRevoked: false, chainRevokedAt: null }),
      reconciliation('DB_ISSUED_CHAIN_REVOKED')
    ],
    inLaneChainRevoked: true
  });

  await context.service.revokeForIssuer('issuer-1', 'credential-1', actor, undefined);

  // La compuerta observo la revocacion ajena: ninguna transaccion propia.
  assert.deepEqual(context.calls.inLaneChainReads, [HASH]);
  assert.deepEqual(context.calls.writes, []);
  // Y el estado local se sincronizo igual, idempotentemente.
  assert.equal(context.calls.transactionUpdates.length, 2);
});

test('addendum C: si la compuerta no obtiene estado confiable, no se escribe', async () => {
  const context = setup({
    classifications: [
      reconciliation('DB_ISSUED_CHAIN_ACTIVE', { chainRevoked: false, chainRevokedAt: null })
    ],
    inLaneChainUnreadable: true
  });

  await assert.rejects(
    () => context.service.revokeForIssuer('issuer-1', 'credential-1', actor, undefined),
    // La compuerta no pudo observar un estado confiable, asi que no se escribe.
    // Es el mismo codigo que una evidencia de cadena no resoluble: la causa es
    // exactamente esa.
    (error: unknown) => hasRevocationCode(error, 'BLOCKCHAIN_RECORD_UNRESOLVABLE')
  );

  assert.deepEqual(context.calls.writes, []);
});

test('77-80: la compuerta del carril relee el perfil y falla cerrado si cambio', async () => {
  const cases: Array<[string, Record<string, unknown> | null, string]> = [
    [
      'comprometido mientras esperaba',
      { status: SignerProfileStatus.compromised },
      'HISTORICAL_ANCHOR_COMPROMISED'
    ],
    [
      'proposito cambiado',
      { purpose: SignerProfilePurpose.assertion },
      'HISTORICAL_ANCHOR_UNRESOLVED'
    ],
    [
      'direccion cambiada',
      { address: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8' },
      'HISTORICAL_ANCHOR_UNRESOLVED'
    ],
    ['perfil desaparecido', null, 'HISTORICAL_ANCHOR_UNRESOLVED']
  ];

  for (const [label, gateProfile, code] of cases) {
    const context = setup({
      classifications: [
        reconciliation('DB_ISSUED_CHAIN_ACTIVE', { chainRevoked: false, chainRevokedAt: null })
      ],
      gateProfile: gateProfile as never
    });

    await assert.rejects(
      () => context.service.revokeForIssuer('issuer-1', 'credential-1', actor, undefined),
      (error: unknown) => hasRevocationCode(error, code),
      label
    );

    // Se leyo el perfil dentro del carril y NO se envio nada.
    assert.deepEqual(context.calls.gateReads, [ANCHOR_PROFILE_ID], label);
    assert.deepEqual(context.calls.writes, [], label);
  }
});

test('78: un perfil RETIRADO mientras esperaba el carril si puede continuar', async () => {
  const context = setup({
    classifications: [
      reconciliation('DB_ISSUED_CHAIN_ACTIVE', { chainRevoked: false, chainRevokedAt: null }),
      reconciliation('DB_ISSUED_CHAIN_REVOKED')
    ],
    gateProfile: { status: SignerProfileStatus.retired }
  });

  await context.service.revokeForIssuer('issuer-1', 'credential-1', actor, undefined);

  assert.deepEqual(context.calls.writes, [HASH]);
});

test('59, 62-63: un solo envio, y el estado local solo tras releer la cadena', async () => {
  const context = setup({
    classifications: [
      reconciliation('DB_ISSUED_CHAIN_ACTIVE', { chainRevoked: false, chainRevokedAt: null }),
      reconciliation('DB_ISSUED_CHAIN_REVOKED')
    ]
  });

  await context.service.revokeForIssuer('issuer-1', 'credential-1', actor, undefined);

  // 59: exactamente UN envio.
  assert.deepEqual(context.calls.writes, [HASH]);
  // 62-63: la relectura posterior tuvo que confirmar la revocacion antes de
  // persistir. Son dos clasificaciones: la previa y la posterior.
  assert.equal(context.calls.classifications, 2);
  assert.equal(context.calls.transactionUpdates.length, 2);
});

test('62: si la relectura NO confirma la revocacion, no se persiste nada', async () => {
  const context = setup({
    classifications: [
      reconciliation('DB_ISSUED_CHAIN_ACTIVE', { chainRevoked: false, chainRevokedAt: null }),
      reconciliation('DB_ISSUED_CHAIN_ACTIVE', { chainRevoked: false, chainRevokedAt: null })
    ]
  });

  await assert.rejects(
    () => context.service.revokeForIssuer('issuer-1', 'credential-1', actor, undefined),
    (error: unknown) => hasRevocationCode(error, 'BLOCKCHAIN_WRITE_FAILED')
  );

  assert.deepEqual(context.calls.writes, [HASH]);
  assert.deepEqual(context.calls.transactionUpdates, []);
});

test('64: un fallo de persistencia tras confirmar la cadena NO reenvia', async () => {
  const context = setup({
    classifications: [
      reconciliation('DB_ISSUED_CHAIN_ACTIVE', { chainRevoked: false, chainRevokedAt: null }),
      reconciliation('DB_ISSUED_CHAIN_REVOKED')
    ],
    transactionFailure: true
  });

  await assert.rejects(
    () => context.service.revokeForIssuer('issuer-1', 'credential-1', actor, undefined),
    (error: unknown) => hasRevocationCode(error, 'DATABASE_RECONCILIATION_FAILED')
  );

  // UN solo envio: la revocacion ya esta en la cadena y una lectura posterior
  // la va a poder reconciliar.
  assert.deepEqual(context.calls.writes, [HASH]);
});

// ---------------------------------------------------------------------------
// ADDENDUM D: AUTORIDAD DEL TIMESTAMP Y DEL MOTIVO
// ---------------------------------------------------------------------------

test('addendum D: `revokedAt` sale del contrato, nunca del reloj del servidor', async () => {
  const context = setup({
    classifications: [
      reconciliation('DB_ISSUED_CHAIN_ACTIVE', { chainRevoked: false, chainRevokedAt: null }),
      reconciliation('DB_ISSUED_CHAIN_REVOKED', { chainRevokedAt: '1760000000' })
    ]
  });

  await context.service.revokeForIssuer('issuer-1', 'credential-1', actor, undefined);

  const update = context.calls.transactionUpdates[0] as {
    data: { revokedAt: Date };
  };
  assert.equal(update.data.revokedAt.getTime(), 1_760_000_000 * 1000);
});

test('addendum D: sin timestamp confiable de la cadena no se fabrica ninguno', async () => {
  const context = setup({
    classifications: [
      reconciliation('DB_ISSUED_CHAIN_ACTIVE', { chainRevoked: false, chainRevokedAt: null }),
      reconciliation('DB_ISSUED_CHAIN_REVOKED', { chainRevokedAt: null })
    ]
  });

  await assert.rejects(
    () => context.service.revokeForIssuer('issuer-1', 'credential-1', actor, undefined),
    (error: unknown) => hasRevocationCode(error, 'BLOCKCHAIN_RECORD_UNRESOLVABLE')
  );

  assert.deepEqual(context.calls.transactionUpdates, []);
});

test('addendum D: una revocacion ya en cadena no sobreescribe el motivo historico', async () => {
  // El motivo del solicitante NO es procedencia de cadena: cuando la cadena ya
  // estaba revocada, se sincroniza con `null` en vez de inventar que el
  // contrato conocia ese texto.
  const context = setup({
    classifications: [reconciliation('DB_ISSUED_CHAIN_REVOKED')]
  });

  await context.service.revokeForIssuer('issuer-1', 'credential-1', actor, {
    reason: 'motivo del segundo solicitante'
  });

  assert.deepEqual(context.calls.reasonWrites, [null]);
});

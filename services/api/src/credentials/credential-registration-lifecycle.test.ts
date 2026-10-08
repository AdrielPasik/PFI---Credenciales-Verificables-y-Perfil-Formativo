/**
 * Emision en modo credential_registry -- S8c6, matrices 14-30 y 59-84.
 *
 * Es el test central de la slice: prueba que la transaccion de PostgreSQL
 * NUNCA esta abierta durante una operacion de red, y que despues del commit de
 * TX #1 la credencial queda EMITIDA aunque todo lo que viene despues falle.
 *
 * El limite se prueba con una bandera `inTransaction`: cada doble de red LANZA
 * si lo invocan mientras la bandera esta en alto. No es un comentario, es una
 * falla de test.
 *
 * Dos claves sinteticas DISTINTAS: la 1 firma el proof (asercion) y la 2 firma
 * la transaccion (anclaje). PUBLIC TEST KEY / DO NOT FUND.
 *
 * Sin AWS, sin SSM, sin RPC, sin Anvil, sin Base Sepolia, sin transaccion real.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AnchorRegistrantScope,
  BlockchainEvidenceMode,
  BlockchainNetwork,
  BlockchainRecordStatus,
  CredentialStatus,
  SignerProfilePurpose,
  SignerProfileStatus
} from '@prisma/client';
import { Wallet, toUtf8Bytes, verifyMessage } from 'ethers';

import { AnchorWriteError } from '../blockchain/anchor-write-coordinator';
import { BlockchainEvidenceService } from '../blockchain/blockchain-evidence.service';
import { BlockchainRegistrationService } from '../blockchain/blockchain-registration.service';
import { BlockchainTargetError } from '../blockchain/blockchain-target';
import { PUBLIC_TEST_KEY_ONE, PUBLIC_TEST_KEY_TWO } from '../signing/__fixtures__/signer-test-keys';
import { SignerResolutionError } from '../signing/signer-resolution.error';
import { CredentialHashingService } from './credential-hashing.service';
import { CredentialProofService } from './credential-proof.service';
import { CredentialsService } from './credentials.service';
import { buildScopeProofV1Envelope } from './scope-proof-v1';

const ISSUER_ID = 'issuer-1';
const CREDENTIAL_ID = 'cred-123';
const ANCHOR_PROFILE_ID = 'anchor-profile-1';
const CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const DEPLOYMENT_ID = 'test-base-sepolia-pending-deploy';
const TECHNICAL_DID = `did:web:api.scopeedu.technology:did:issuers:${ISSUER_ID}`;
const TX_HASH = `0x${'1'.repeat(64)}`;
const BLOCK_NUMBER = 4242;
const CHAIN_REGISTERED_AT = new Date('2026-03-31T23:33:20.000Z');

const currentUser = {
  id: 'issuer-user-1',
  email: 'issuer.admin@example.com',
  did: 'did:example:issuer-admin-demo',
  status: 'active'
} as never;

const REAL_MODE_ENVIRONMENT = {
  BLOCKCHAIN_EVIDENCE_MODE: 'credential_registry',
  CREDENTIAL_REGISTRY_NETWORK: BlockchainNetwork.base_sepolia,
  CREDENTIAL_REGISTRY_CHAIN_ID: '84532',
  CREDENTIAL_REGISTRY_RPC_URL: 'https://provider.example/v2/SECRET_API_KEY',
  CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: CONTRACT_ADDRESS,
  CREDENTIAL_REGISTRY_DEPLOYMENT_ID: DEPLOYMENT_ID
} as const;

async function withRealMode<T>(run: () => Promise<T>): Promise<T> {
  const saved = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(REAL_MODE_ENVIRONMENT)) {
    saved.set(key, process.env[key]);
    process.env[key] = value;
  }

  try {
    return await run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function draftRow() {
  return {
    id: CREDENTIAL_ID,
    schemaVersion: 'credential_v1',
    type: 'course',
    issuerId: ISSUER_ID,
    subjectUserId: 'holder-1',
    title: 'Programacion Avanzada',
    description: 'Curso de programacion orientada a objetos.',
    sourceType: 'manual_issuer',
    status: CredentialStatus.draft,
    hours: { toFixed: () => '60.00' },
    issuedAt: null,
    revokedAt: null,
    canonicalHash: null,
    canonicalizationVersion: null,
    proof: null,
    credentialSubject: {
      achievement_name: 'Programacion Avanzada',
      institution_name: 'Universidad Argentina de la Empresa (UADE)'
    },
    academicCourseId: null,
    externalCourseId: null,
    metadata: null,
    rawData: null,
    createdAt: new Date('2026-07-22T17:00:00Z'),
    updatedAt: new Date('2026-07-22T17:30:00Z'),
    issuer: {
      id: ISSUER_ID,
      did: 'did:example:issuer-demo',
      walletAddress: '0x00000000000000000000000000000000000000aa',
      authorizationStatus: 'authorized'
    },
    subjectUser: {
      id: 'holder-1',
      did: 'did:web:api.scopeedu.technology:did:users:holder-1'
    }
  };
}

interface WorldOptions {
  /** Fallo del coordinador despues de TX #1. */
  chainError?: unknown;
  /** Fallo de la finalizacion en base (TX #2). */
  finalizeError?: unknown;
  anchorResolverError?: unknown;
  anchorProfileStatus?: SignerProfileStatus;
  bindingProfileId?: string;
  bindingCount?: number;
  technicalIdentityDid?: string | null;
}

function createWorld(options: WorldOptions = {}) {
  const assertionWallet = new Wallet(PUBLIC_TEST_KEY_ONE.privateKey);
  const anchorWallet = new Wallet(PUBLIC_TEST_KEY_TWO.privateKey);

  const timeline: string[] = [];
  const networkInsideTransaction: string[] = [];
  const registrations: Array<Record<string, unknown>> = [];
  const credentialUpdates: Array<Record<string, unknown>> = [];
  const finalizeCalls: Array<Record<string, unknown>> = [];
  const anchorResolutions: string[] = [];
  const assertionResolutions: string[] = [];

  let inTransaction = false;
  let pendingRecord: Record<string, unknown> | null = null;

  /** Marca una operacion de RED. Lanza si corre dentro de una transaccion. */
  const network = (name: string) => {
    timeline.push(name);
    if (inTransaction) {
      networkInsideTransaction.push(name);
      throw new Error(
        `operacion de red ${name} dentro de una transaccion de Prisma`
      );
    }
  };

  const transactionClient = {
    credential: {
      async findUnique() {
        timeline.push('final_row_read');
        return draftRow();
      },
      async update(args: Record<string, unknown>) {
        timeline.push('credential_update');
        credentialUpdates.push(args);
        const data = args.data as Record<string, unknown>;
        return { ...draftRow(), ...data };
      }
    },
    issuerTechnicalIdentity: {
      async findUnique() {
        timeline.push('anchor_binding_revalidation');
        return {
          anchorSignerProfileId: options.bindingProfileId ?? ANCHOR_PROFILE_ID,
          anchorSignerProfile: {
            id: options.bindingProfileId ?? ANCHOR_PROFILE_ID,
            purpose: SignerProfilePurpose.anchor,
            status: SignerProfileStatus.active,
            addressVerifiedAt: new Date('2026-01-01T00:00:00Z'),
            address: PUBLIC_TEST_KEY_TWO.addressLowercase,
            keyVersion: 1
          }
        };
      },
      async count() {
        timeline.push('anchor_scope_count');
        return options.bindingCount ?? 1;
      }
    },
    blockchainRecord: {
      async create(input: { data: Record<string, unknown> }) {
        timeline.push('pending_record_create');
        pendingRecord = { id: 'blockchain-record-1', ...input.data };
        registrations.push(input.data);
        return pendingRecord;
      }
    }
  };

  const prisma = {
    credential: {
      async findUnique() {
        return draftRow();
      }
    },
    issuerTechnicalIdentity: {
      async findUnique() {
        timeline.push('technical_identity_lookup');
        return {
          did:
            options.technicalIdentityDid === undefined
              ? TECHNICAL_DID
              : options.technicalIdentityDid
        };
      }
    },
    signerProfile: {
      async findUnique() {
        timeline.push('anchor_profile_status_read');
        return {
          purpose: SignerProfilePurpose.anchor,
          status: options.anchorProfileStatus ?? SignerProfileStatus.active,
          address: anchorWallet.address
        };
      }
    },
    blockchainRecord: {
      async findUnique() {
        timeline.push('evidence_reread');
        return pendingRecord;
      },
      async updateMany(args: Record<string, unknown>) {
        timeline.push('record_finalize');
        finalizeCalls.push(args);

        if (options.finalizeError !== undefined) {
          throw options.finalizeError;
        }

        pendingRecord = {
          ...(pendingRecord ?? {}),
          ...(args.data as Record<string, unknown>)
        };
        return { count: 1 };
      }
    },
    user: {
      async findUnique() {
        return draftRow().subjectUser;
      }
    },
    async $transaction(
      callback: (client: typeof transactionClient) => Promise<unknown>,
      _options?: unknown
    ) {
      timeline.push('tx_start');
      inTransaction = true;
      try {
        return await callback(transactionClient);
      } finally {
        inTransaction = false;
        timeline.push('tx_commit');
      }
    }
  };

  const issuersService = {
    async assertUserCanIssueForIssuer() {
      timeline.push('authorization');
      return { id: 'membership-1' };
    },
    assertIssuerCanIssue() {
      timeline.push('issuer_eligibility');
    }
  };

  const assertionResolver = {
    async resolveAssertionSignerForIssuer(issuerId: string) {
      network('assertion_signer_resolution');
      assertionResolutions.push(issuerId);
      return {
        profileId: 'assertion-profile-1',
        purpose: SignerProfilePurpose.assertion,
        keyVersion: 1,
        address: assertionWallet.address,
        wallet: assertionWallet
      };
    }
  };

  const anchorResolver = {
    async resolveAnchorSignerForIssuer(issuerId: string) {
      network('anchor_signer_resolution');
      anchorResolutions.push(issuerId);

      if (options.anchorResolverError !== undefined) {
        throw options.anchorResolverError;
      }

      return {
        profileId: ANCHOR_PROFILE_ID,
        purpose: SignerProfilePurpose.anchor,
        keyVersion: 1,
        address: anchorWallet.address,
        wallet: anchorWallet
      };
    }
  };

  const coordinator = {
    async registerCredentialHash(
      input: Record<string, unknown> & {
        assertSignerUsable?: () => Promise<void>;
      }
    ) {
      network('queue_enter');

      // S8c6.1: la verificacion AUTORIZANTE del perfil historico corre dentro
      // del carril, no antes de esperarlo.
      if (input.assertSignerUsable) {
        await input.assertSignerUsable();
      }

      network('preflight_network');
      network('register_send');
      network('receipt');
      network('block_read');

      if (options.chainError !== undefined) {
        throw options.chainError;
      }

      return {
        txHash: TX_HASH,
        blockNumber: BLOCK_NUMBER,
        registrant: anchorWallet.address,
        registeredAt: CHAIN_REGISTERED_AT
      };
    }
  };

  const registrationService = new BlockchainRegistrationService(
    prisma as never,
    anchorResolver as never,
    coordinator as never
  );

  const service = new CredentialsService(
    prisma as never,
    issuersService as never,
    new BlockchainEvidenceService(),
    new CredentialHashingService(),
    new CredentialProofService(assertionResolver as never),
    registrationService
  );

  return {
    service,
    timeline,
    networkInsideTransaction,
    registrations,
    credentialUpdates,
    finalizeCalls,
    anchorResolutions,
    assertionResolutions,
    assertionAddress: assertionWallet.address,
    anchorAddress: anchorWallet.address,
    getPendingRecord: () => pendingRecord
  };
}

function issue(world: ReturnType<typeof createWorld>) {
  return world.service.issueCredential(
    CREDENTIAL_ID,
    { issuerId: ISSUER_ID, issuedAt: '2026-07-22T18:00:00Z' },
    currentUser
  );
}

// ---------------------------------------------------------------------------
// 14-22, 28-30: CAMINO FELIZ Y LIMITES DE TRANSACCION
// ---------------------------------------------------------------------------

test('14-22: ninguna operacion de red ocurre dentro de una transaccion', async () => {
  await withRealMode(async () => {
    const world = createWorld();

    const response = await issue(world);

    // La bandera habria lanzado; que este vacio es la prueba.
    assert.deepEqual(world.networkInsideTransaction, []);

    const index = (name: string) => world.timeline.indexOf(name);

    // 14: el ancla se resuelve ANTES de abrir la transaccion.
    assert.ok(index('anchor_signer_resolution') < index('tx_start'));
    assert.ok(index('assertion_signer_resolution') < index('tx_start'));

    // 15-18: preflight, envio, receipt y bloque, todos DESPUES del commit.
    for (const operation of [
      'queue_enter',
      'preflight_network',
      'register_send',
      'receipt',
      'block_read'
    ]) {
      assert.ok(index(operation) > index('tx_commit'), operation);
    }

    // 21-22: la finalizacion no tiene red por delante ni por dentro.
    assert.ok(index('record_finalize') > index('block_read'));
    assert.equal(response.status, 'issued');
  });
});

test('la linea de tiempo del camino feliz es la congelada por S8c6', async () => {
  await withRealMode(async () => {
    const world = createWorld();
    await issue(world);

    assert.deepEqual(world.timeline, [
      'authorization',
      'issuer_eligibility',
      'technical_identity_lookup',
      'assertion_signer_resolution',
      'anchor_signer_resolution',
      'tx_start',
      'final_row_read',
      'anchor_binding_revalidation',
      'anchor_scope_count',
      'credential_update',
      'pending_record_create',
      'tx_commit',
      // Fallo rapido antes de encolar...
      'anchor_profile_status_read',
      'queue_enter',
      // ...y la relectura AUTORIZANTE una vez adquirido el carril (S8c6.1).
      'anchor_profile_status_read',
      'preflight_network',
      'register_send',
      'receipt',
      'block_read',
      'record_finalize',
      'evidence_reread'
    ]);
  });
});

test('9-12: la autorizacion precede a toda resolucion de signer', async () => {
  await withRealMode(async () => {
    const world = createWorld();
    await issue(world);

    const index = (name: string) => world.timeline.indexOf(name);

    assert.ok(index('authorization') < index('assertion_signer_resolution'));
    assert.ok(index('issuer_eligibility') < index('assertion_signer_resolution'));
    assert.ok(index('technical_identity_lookup') < index('anchor_signer_resolution'));
    // Y el ancla se resuelve UNA sola vez.
    assert.deepEqual(world.anchorResolutions, [ISSUER_ID]);
    assert.deepEqual(world.assertionResolutions, [ISSUER_ID]);
  });
});

test('30, 33-35: el intent pendiente lleva procedencia exacta del target y del ancla', async () => {
  await withRealMode(async () => {
    const world = createWorld({ bindingCount: 3 });
    await issue(world);

    assert.equal(world.registrations.length, 1);
    const intent = world.registrations[0];

    assert.equal(intent.status, BlockchainRecordStatus.pending);
    assert.equal(intent.network, BlockchainNetwork.base_sepolia);
    assert.equal(intent.chainId, 84532);
    assert.equal(intent.contractAddress, CONTRACT_ADDRESS);
    assert.equal(intent.deploymentId, DEPLOYMENT_ID);
    assert.equal(intent.evidenceMode, BlockchainEvidenceMode.credential_registry);
    assert.equal(intent.anchorSignerProfileId, ANCHOR_PROFILE_ID);
    // Tres identidades tecnicas comparten el ancla => custodia compartida.
    assert.equal(
      intent.anchorRegistrantScope,
      AnchorRegistrantScope.shared_custodial
    );
  });
});

test('17, 58: el hash firmado, persistido, enviado y finalizado es EL MISMO', async () => {
  await withRealMode(async () => {
    const world = createWorld();
    const response = await issue(world);

    const credentialData = world.credentialUpdates[0].data as Record<
      string,
      unknown
    >;
    const intent = world.registrations[0];
    const finalizeWhere = world.finalizeCalls[0].where as Record<string, unknown>;

    assert.equal(credentialData.canonicalHash, response.canonicalHash);
    assert.equal(intent.credentialHash, response.canonicalHash);
    assert.equal(finalizeWhere.credentialHash, response.canonicalHash);

    // Y el proof firma EXACTAMENTE ese hash, con la clave de ASERCION.
    const proof = response.proof!;
    const envelope = buildScopeProofV1Envelope({
      verificationMethod: proof.verificationMethod,
      canonicalHash: response.canonicalHash!
    });
    assert.equal(
      verifyMessage(toUtf8Bytes(envelope), proof.proofValue),
      world.assertionAddress
    );
  });
});

test('32: la clave de ASERCION y la de ANCLAJE son distintas y no se cruzan', async () => {
  await withRealMode(async () => {
    const world = createWorld();
    const response = await issue(world);

    assert.notEqual(world.assertionAddress, world.anchorAddress);
    assert.equal(world.assertionAddress, PUBLIC_TEST_KEY_ONE.address);
    assert.equal(world.anchorAddress, PUBLIC_TEST_KEY_TWO.address);

    // El proof recupera A.
    const proof = response.proof!;
    const envelope = buildScopeProofV1Envelope({
      verificationMethod: proof.verificationMethod,
      canonicalHash: response.canonicalHash!
    });
    assert.equal(
      verifyMessage(toUtf8Bytes(envelope), proof.proofValue),
      PUBLIC_TEST_KEY_ONE.address
    );

    // Y el registrante finalizado es B.
    const finalizeData = world.finalizeCalls[0].data as Record<string, unknown>;
    assert.equal(finalizeData.issuerAddress, PUBLIC_TEST_KEY_TWO.address);
  });
});

test('7-9, 13: la finalizacion deja evidencia de cadena y la credencial emitida', async () => {
  await withRealMode(async () => {
    const world = createWorld();
    const response = await issue(world);

    const finalizeData = world.finalizeCalls[0].data as Record<string, unknown>;
    assert.equal(finalizeData.status, BlockchainRecordStatus.registered);
    assert.equal(finalizeData.txHash, TX_HASH);
    assert.equal(finalizeData.blockNumber, BLOCK_NUMBER);
    assert.equal(
      (finalizeData.registeredAt as Date).getTime(),
      CHAIN_REGISTERED_AT.getTime()
    );

    // 13: la credencial queda emitida y autenticada.
    assert.equal(response.status, 'issued');
    assert.equal(response.schemaVersion, 'credential_v2');
    assert.equal(response.canonicalizationVersion, 'canon_v2');
    assert.ok(response.proof);

    // Y la respuesta refleja el estado durable REAL.
    assert.equal(
      world.getPendingRecord()?.status,
      BlockchainRecordStatus.registered
    );
  });
});

// ---------------------------------------------------------------------------
// 59-66: FALLOS DE CADENA DESPUES DE TX #1
// ---------------------------------------------------------------------------

test('59-64: cualquier fallo tras TX #1 deja la credencial EMITIDA y la evidencia PENDING', async () => {
  const failures: Array<[string, WorldOptions]> = [
    [
      '59 preflight',
      { chainError: new BlockchainTargetError('BLOCKCHAIN_NETWORK_MISMATCH') }
    ],
    ['60 envio', { chainError: new AnchorWriteError('ANCHOR_SEND_FAILED') }],
    [
      '61 timeout de minado',
      { chainError: new AnchorWriteError('ANCHOR_RECEIPT_UNAVAILABLE') }
    ],
    [
      '62 receipt rechazado',
      { chainError: new AnchorWriteError('ANCHOR_RECEIPT_REJECTED') }
    ],
    [
      '63 bloque inobtenible',
      { chainError: new AnchorWriteError('ANCHOR_BLOCK_UNAVAILABLE') }
    ],
    ['64 fallo de TX #2', { finalizeError: new Error('db down') }]
  ];

  for (const [label, options] of failures) {
    await withRealMode(async () => {
      const world = createWorld(options);

      // NO lanza: la emision tuvo exito y responder un error haria creer que
      // no. El estado durable ES la respuesta.
      const response = await issue(world);

      // La credencial sigue emitida, con su proof y su hash intactos.
      assert.equal(response.status, 'issued', label);
      assert.equal(response.schemaVersion, 'credential_v2', label);
      assert.equal(response.canonicalizationVersion, 'canon_v2', label);
      assert.ok(response.proof, label);
      assert.match(response.canonicalHash ?? '', /^0x[0-9a-f]{64}$/, label);

      // 66: NO hay update compensatorio que la vuelva a draft.
      assert.equal(world.credentialUpdates.length, 1, label);
      const data = world.credentialUpdates[0].data as Record<string, unknown>;
      assert.equal(data.status, CredentialStatus.issued, label);

      // La evidencia queda PENDING y recuperable.
      assert.equal(
        world.getPendingRecord()?.status,
        BlockchainRecordStatus.pending,
        label
      );
      assert.equal(
        response.latestBlockchainRecord?.status,
        BlockchainRecordStatus.pending,
        label
      );
      // Y sin ningun hecho de cadena inventado. `== null` cubre las dos
      // formas de "no observado": la clave ausente en el intent y el `null`
      // que el DTO serializa.
      assert.ok(response.latestBlockchainRecord?.txHash == null, label);
      assert.ok(response.latestBlockchainRecord?.registeredAt == null, label);
      assert.ok(response.latestBlockchainRecord?.issuerAddress == null, label);
    });
  }
});

test('65: un fallo de cadena no produce un segundo intento de registracion', async () => {
  await withRealMode(async () => {
    const world = createWorld({
      chainError: new AnchorWriteError('ANCHOR_RECEIPT_UNAVAILABLE')
    });

    await issue(world);

    assert.equal(
      world.timeline.filter((step) => step === 'register_send').length,
      1
    );
    assert.equal(world.finalizeCalls.length, 0);
  });
});

test('addendum C: un ancla COMPROMETIDA tras TX #1 no transmite y deja PENDING', async () => {
  await withRealMode(async () => {
    const world = createWorld({
      anchorProfileStatus: SignerProfileStatus.compromised
    });

    const response = await issue(world);

    assert.equal(response.status, 'issued');
    assert.equal(
      world.getPendingRecord()?.status,
      BlockchainRecordStatus.pending
    );
    // Ni envio, ni ancla de reemplazo resuelta automaticamente.
    assert.ok(!world.timeline.includes('register_send'));
    assert.deepEqual(world.anchorResolutions, [ISSUER_ID]);
  });
});

// ---------------------------------------------------------------------------
// FALLOS ANTES DE TX #1
// ---------------------------------------------------------------------------

test('un ancla no utilizable falla ANTES de TX #1: no se emite nada', async () => {
  const codes = [
    'TECHNICAL_IDENTITY_NOT_CONFIGURED',
    'TECHNICAL_IDENTITY_INACTIVE',
    'SIGNER_PROFILE_NOT_CONFIGURED',
    'SIGNER_PROFILE_INACTIVE',
    'SIGNER_PURPOSE_MISMATCH',
    'SIGNER_ADDRESS_NOT_VERIFIED',
    'SIGNER_SECRET_UNAVAILABLE'
  ] as const;

  for (const code of codes) {
    await withRealMode(async () => {
      const world = createWorld({
        anchorResolverError: new SignerResolutionError(code, {
          issuerId: ISSUER_ID
        })
      });

      await assert.rejects(issue(world), code);

      // No se fabrica un intent pendiente sin procedencia de anclaje veraz.
      assert.ok(!world.timeline.includes('tx_start'), code);
      assert.deepEqual(world.credentialUpdates, [], code);
      assert.deepEqual(world.registrations, [], code);
    });
  }
});

test('36: un binding de ancla cambiado aborta TX #1 sin emitir', async () => {
  await withRealMode(async () => {
    const world = createWorld({ bindingProfileId: 'otro-perfil' });

    await assert.rejects(issue(world));

    // La transaccion se abrio pero no commiteo nada util: ni credencial
    // actualizada ni intent.
    assert.ok(world.timeline.includes('anchor_binding_revalidation'));
    assert.deepEqual(world.credentialUpdates, []);
    assert.deepEqual(world.registrations, []);
    assert.ok(!world.timeline.includes('register_send'));
  });
});

test('un DID tecnico invalido falla antes de resolver el ancla', async () => {
  await withRealMode(async () => {
    const world = createWorld({ technicalIdentityDid: 'did:example:issuer-demo' });

    await assert.rejects(issue(world));

    assert.deepEqual(world.anchorResolutions, []);
    assert.ok(!world.timeline.includes('tx_start'));
  });
});

// ---------------------------------------------------------------------------
// 23-27: MODO MOCK
// ---------------------------------------------------------------------------

test('23-27: una emision MOCK no toca nada del plano real', async () => {
  // Sin variables de modo real en el entorno: el target resuelve mock.
  const saved = new Map<string, string | undefined>();
  for (const key of Object.keys(REAL_MODE_ENVIRONMENT)) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }

  try {
    const world = createWorld();
    const response = await issue(world);

    // 23: cero resoluciones de ancla.
    assert.deepEqual(world.anchorResolutions, []);
    // 24-26: ni cola, ni NonceManager, ni provider, ni preflight.
    for (const step of [
      'queue_enter',
      'preflight_network',
      'register_send',
      'receipt',
      'block_read',
      'anchor_binding_revalidation',
      'anchor_scope_count',
      'anchor_profile_status_read'
    ]) {
      assert.ok(!world.timeline.includes(step), step);
    }
    // La fila creada es una fila MOCK, no un intent pendiente: mock no pasa
    // por PENDING solo por simetria, y su evidencia nace completa.
    assert.equal(world.registrations.length, 1);
    const mockRecord = world.registrations[0];
    assert.equal(mockRecord.evidenceMode, BlockchainEvidenceMode.mock);
    assert.equal(mockRecord.status, BlockchainRecordStatus.registered);
    assert.equal(typeof mockRecord.txHash, 'string');
    assert.ok(mockRecord.registeredAt instanceof Date);
    assert.equal(mockRecord.anchorSignerProfileId, undefined);
    assert.equal(mockRecord.deploymentId, undefined);

    // Y nada de finalizacion: no hay nada pendiente que finalizar.
    assert.equal(world.finalizeCalls.length, 0);

    // 27: la autenticidad sigue siendo REAL.
    assert.equal(response.schemaVersion, 'credential_v2');
    assert.equal(response.canonicalizationVersion, 'canon_v2');
    const proof = response.proof!;
    const envelope = buildScopeProofV1Envelope({
      verificationMethod: proof.verificationMethod,
      canonicalHash: response.canonicalHash!
    });
    assert.equal(
      verifyMessage(toUtf8Bytes(envelope), proof.proofValue),
      world.assertionAddress
    );
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

// ---------------------------------------------------------------------------
// 79: YA EMITIDA
// ---------------------------------------------------------------------------

test('79: una credencial ya emitida no crea un segundo intent ni reenvia', async () => {
  await withRealMode(async () => {
    const issued = { ...draftRow(), status: CredentialStatus.issued };
    const world = createWorld();

    // Se sobrescribe la lectura inicial para simular una fila ya emitida.
    const service = world.service as unknown as {
      prisma: { credential: { findUnique: () => Promise<unknown> } };
    };
    service.prisma.credential.findUnique = async () => issued;

    await assert.rejects(issue(world));

    assert.deepEqual(world.anchorResolutions, []);
    assert.deepEqual(world.registrations, []);
    assert.ok(!world.timeline.includes('register_send'));
  });
});

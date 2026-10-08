/**
 * Ciclo de vida de registracion -- S8c6, matrices 2-13, 31-38, 36-37.
 *
 * Prisma es un doble. No hay AWS, no hay SSM, no hay RPC, no hay Anvil, no hay
 * Base Sepolia, no hay transaccion y no hay secreto real: las claves son los
 * escalares publicos 1 y 2 (PUBLIC TEST KEY / DO NOT FUND).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AnchorRegistrantScope,
  BlockchainEvidenceMode,
  BlockchainNetwork,
  BlockchainRecordStatus,
  SignerProfilePurpose,
  SignerProfileStatus
} from '@prisma/client';
import { Wallet } from 'ethers';

import { PUBLIC_TEST_KEY_ONE, PUBLIC_TEST_KEY_TWO } from '../signing/__fixtures__/signer-test-keys';
import {
  type AnchorRegistrationEvidence,
  type AnchorSignerSnapshot,
  AnchorWriteCoordinator
} from './anchor-write-coordinator';
import { CREDENTIAL_REGISTERED_TOPIC } from './credential-registry-events';
import { CredentialRegistryPreflight } from './credential-registry-preflight';
import { type CredentialRegistryTarget } from './blockchain-target';
import {
  BlockchainRegistrationError,
  BlockchainRegistrationService
} from './blockchain-registration.service';

const CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const VALID_HASH =
  '0xaf032042c1bcfb72f9caac350eb3cb576f44ab07b1c1968f4b36264da44ff2ab';
const TX_HASH = `0x${'1'.repeat(64)}`;
const ISSUER_ID = 'issuer-1';
const ANCHOR_PROFILE_ID = 'anchor-profile-1';
const DEPLOYMENT_ID = 'test-base-sepolia-pending-deploy';

function target(): CredentialRegistryTarget {
  return {
    evidenceMode: 'credential_registry',
    network: BlockchainNetwork.base_sepolia,
    chainId: 84532,
    rpcUrl: 'https://provider.example/v2/SECRET_API_KEY',
    contractAddress: CONTRACT_ADDRESS,
    deploymentId: DEPLOYMENT_ID
  };
}

/**
 * Fila PUBLICA del `SignerProfile` de anclaje, como la lee la compuerta de
 * uso de clave: proposito, estado y direccion persistida. Nada privado.
 */
function anchorProfileRow(status: SignerProfileStatus) {
  return {
    purpose: SignerProfilePurpose.anchor,
    status,
    address: anchorSnapshot().address
  };
}

function anchorSnapshot(): AnchorSignerSnapshot {
  const wallet = new Wallet(PUBLIC_TEST_KEY_ONE.privateKey);
  return {
    profileId: ANCHOR_PROFILE_ID,
    keyVersion: 1,
    address: wallet.address,
    wallet
  };
}

function evidence(
  overrides: Partial<AnchorRegistrationEvidence> = {}
): AnchorRegistrationEvidence {
  return {
    txHash: TX_HASH,
    blockNumber: 4242,
    registrant: anchorSnapshot().address,
    registeredAt: new Date('2026-03-31T23:33:20.000Z'),
    ...overrides
  };
}

interface BindingOptions {
  anchorSignerProfileId?: string | null;
  purpose?: SignerProfilePurpose;
  status?: SignerProfileStatus;
  addressVerifiedAt?: Date | null;
  address?: string;
  keyVersion?: number;
  identityMissing?: boolean;
  profileMissing?: boolean;
  bindingCount?: number;
}

function createTransactionDouble(options: BindingOptions = {}) {
  const created: Array<Record<string, unknown>> = [];
  const counts: Array<Record<string, unknown>> = [];

  return {
    created,
    counts,
    client: {
      issuerTechnicalIdentity: {
        async findUnique() {
          if (options.identityMissing) {
            return null;
          }

          return {
            anchorSignerProfileId:
              options.anchorSignerProfileId === undefined
                ? ANCHOR_PROFILE_ID
                : options.anchorSignerProfileId,
            anchorSignerProfile: options.profileMissing
              ? null
              : {
                  id:
                    options.anchorSignerProfileId === undefined
                      ? ANCHOR_PROFILE_ID
                      : options.anchorSignerProfileId,
                  purpose: options.purpose ?? SignerProfilePurpose.anchor,
                  status: options.status ?? SignerProfileStatus.active,
                  addressVerifiedAt:
                    options.addressVerifiedAt === undefined
                      ? new Date('2026-01-01T00:00:00Z')
                      : options.addressVerifiedAt,
                  address: options.address ?? PUBLIC_TEST_KEY_ONE.addressLowercase,
                  keyVersion: options.keyVersion ?? 1
                }
          };
        },
        async count(args: Record<string, unknown>) {
          counts.push(args);
          return options.bindingCount ?? 1;
        }
      },
      blockchainRecord: {
        async create(input: { data: Record<string, unknown> }) {
          created.push(input.data);
          return { id: 'blockchain-record-1', ...input.data };
        }
      }
    }
  };
}

function expectRegistrationCode(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof BlockchainRegistrationError, String(error));
    assert.equal((error as BlockchainRegistrationError).code, code);
    return true;
  };
}

// ---------------------------------------------------------------------------
// 36: REVALIDACION DEL BINDING DENTRO DE TX #1 (addendum B)
// ---------------------------------------------------------------------------

test('36: el binding vigente se revalida y acepta cuando nada cambio', async () => {
  const service = new BlockchainRegistrationService(
    {} as never,
    {} as never,
    {} as never
  );
  const transaction = createTransactionDouble();

  await service.revalidateAnchorBinding(transaction.client as never, {
    issuerId: ISSUER_ID,
    signer: anchorSnapshot()
  });
});

test('36b: CUALQUIER cambio en la metadata de uso actual aborta TX #1', async () => {
  // Mas fuerte que comparar solo el id del perfil: se exige que toda la
  // metadata con la que se resolvio el signer siga vigente.
  const cases: Array<[string, BindingOptions]> = [
    ['sin identidad tecnica', { identityMissing: true }],
    ['sin perfil de ancla', { profileMissing: true }],
    ['binding apunta a otro perfil', { anchorSignerProfileId: 'otro-perfil' }],
    ['binding nulo', { anchorSignerProfileId: null }],
    ['proposito de asercion', { purpose: SignerProfilePurpose.assertion }],
    ['perfil retirado', { status: SignerProfileStatus.retired }],
    ['perfil comprometido', { status: SignerProfileStatus.compromised }],
    ['direccion sin verificar', { addressVerifiedAt: null }],
    ['otra direccion persistida', { address: PUBLIC_TEST_KEY_TWO.addressLowercase }],
    ['otra version de clave', { keyVersion: 2 }]
  ];

  for (const [label, options] of cases) {
    const service = new BlockchainRegistrationService(
      {} as never,
      {} as never,
      {} as never
    );
    const transaction = createTransactionDouble(options);

    await assert.rejects(
      service.revalidateAnchorBinding(transaction.client as never, {
        issuerId: ISSUER_ID,
        signer: anchorSnapshot()
      }),
      expectRegistrationCode('ANCHOR_BINDING_CHANGED'),
      label
    );
  }
});

// ---------------------------------------------------------------------------
// 34: anchorRegistrantScope (addendum E)
// ---------------------------------------------------------------------------

test('34: el alcance del registrante se deriva de la cardinalidad del binding', async () => {
  for (const [bindings, expected] of [
    [1, AnchorRegistrantScope.issuer_exclusive],
    [2, AnchorRegistrantScope.shared_custodial],
    [7, AnchorRegistrantScope.shared_custodial]
  ] as const) {
    const service = new BlockchainRegistrationService(
      {} as never,
      {} as never,
      {} as never
    );
    const transaction = createTransactionDouble({ bindingCount: bindings });

    const scope = await service.deriveAnchorRegistrantScope(
      transaction.client as never,
      ANCHOR_PROFILE_ID
    );

    assert.equal(scope, expected, String(bindings));

    // Se cuenta por PERFIL, no por issuer: dos issuers que comparten el ancla
    // tienen que contar como dos bindings del mismo perfil.
    assert.deepEqual(transaction.counts, [
      { where: { anchorSignerProfileId: ANCHOR_PROFILE_ID } }
    ]);
  }
});

test('34b: si no se puede derivar, NO se adivina el enum', async () => {
  const service = new BlockchainRegistrationService(
    {} as never,
    {} as never,
    {} as never
  );
  const transaction = createTransactionDouble({ bindingCount: 0 });

  await assert.rejects(
    service.deriveAnchorRegistrantScope(
      transaction.client as never,
      ANCHOR_PROFILE_ID
    ),
    expectRegistrationCode('ANCHOR_SCOPE_UNDERIVABLE')
  );
});

// ---------------------------------------------------------------------------
// 2-6, 33: EL INTENT PENDING
// ---------------------------------------------------------------------------

test('2-6, 33: el intent pendiente es veraz y no inventa hechos de la cadena', async () => {
  const service = new BlockchainRegistrationService(
    {} as never,
    {} as never,
    {} as never
  );
  const transaction = createTransactionDouble();

  await service.createPendingIntent(transaction.client as never, {
    credentialId: 'cred-123',
    credentialHash: VALID_HASH,
    canonicalizationVersion: 'canon_v2',
    target: target(),
    anchor: {
      anchorSignerProfileId: ANCHOR_PROFILE_ID,
      anchorRegistrantScope: AnchorRegistrantScope.shared_custodial
    }
  });

  const data = transaction.created[0];

  // 2: lo que SI se sabe de la intencion y de la configuracion.
  assert.equal(data.status, BlockchainRecordStatus.pending);
  assert.equal(data.credentialHash, VALID_HASH);
  assert.equal(data.canonicalizationVersion, 'canon_v2');
  assert.equal(data.hashAlgorithm, 'sha-256');
  assert.equal(data.network, BlockchainNetwork.base_sepolia);
  assert.equal(data.chainId, 84532);
  assert.equal(data.contractAddress, CONTRACT_ADDRESS);
  assert.equal(data.deploymentId, DEPLOYMENT_ID);
  assert.equal(data.evidenceMode, BlockchainEvidenceMode.credential_registry);
  // 33: la clave historica que S8c8 va a usar para la revocacion.
  assert.equal(data.anchorSignerProfileId, ANCHOR_PROFILE_ID);
  assert.equal(
    data.anchorRegistrantScope,
    AnchorRegistrantScope.shared_custodial
  );

  // 3-6: NINGUN hecho de la cadena. Ni placeholder, ni cero, ni ZeroAddress,
  // ni reloj del servidor.
  for (const chainField of [
    'txHash',
    'blockNumber',
    'issuerAddress',
    'registeredAt'
  ]) {
    assert.ok(
      !(chainField in data),
      `el intent no debe fijar ${chainField}`
    );
  }
});

// ---------------------------------------------------------------------------
// 7-12: FINALIZACION
// ---------------------------------------------------------------------------

interface FinalizeOptions {
  updatedCount?: number;
  current?: Record<string, unknown> | null;
}

function createFinalizeWorld(options: FinalizeOptions = {}) {
  const updates: Array<Record<string, unknown>> = [];

  const prisma = {
    blockchainRecord: {
      async updateMany(args: Record<string, unknown>) {
        updates.push(args);
        return { count: options.updatedCount ?? 1 };
      },
      async findUnique() {
        return options.current ?? null;
      }
    }
  };

  return {
    updates,
    service: new BlockchainRegistrationService(
      prisma as never,
      {} as never,
      {} as never
    )
  };
}

function finalizeInput() {
  return {
    recordId: 'blockchain-record-1',
    credentialHash: VALID_HASH,
    target: target(),
    anchorSignerProfileId: ANCHOR_PROFILE_ID,
    evidence: evidence()
  };
}

test('7-10: finalizar pasa PENDING a registered con evidencia observada', async () => {
  const world = createFinalizeWorld();

  await world.service.finalizeRegistration(finalizeInput());

  assert.equal(world.updates.length, 1);
  const call = world.updates[0];
  const where = call.where as Record<string, unknown>;
  const data = call.data as Record<string, unknown>;

  // 10: el predicado optimista es estrecho -- id, estado pendiente, hash
  // congelado, identidad del deployment congelada y perfil de ancla congelado.
  assert.deepEqual(Object.keys(where).sort(), [
    'anchorSignerProfileId',
    'chainId',
    'contractAddress',
    'credentialHash',
    'deploymentId',
    'id',
    'network',
    'status'
  ]);
  assert.equal(where.status, BlockchainRecordStatus.pending);

  // 7-9: los tres hechos de la cadena, mas el estado.
  assert.deepEqual(Object.keys(data).sort(), [
    'blockNumber',
    'issuerAddress',
    'registeredAt',
    'status',
    'txHash'
  ]);
  assert.equal(data.status, BlockchainRecordStatus.registered);
  assert.equal(data.txHash, TX_HASH);
  assert.equal(data.blockNumber, 4242);
  assert.equal(data.issuerAddress, anchorSnapshot().address);
  assert.equal(
    (data.registeredAt as Date).toISOString(),
    '2026-03-31T23:33:20.000Z'
  );

  // No se toca NADA de la credencial.
  assert.ok(!('proof' in data));
  assert.ok(!('canonicalHash' in data));
  assert.ok(!('anchorSignerProfileId' in data));
  assert.ok(!('anchorRegistrantScope' in data));
});

test('11: finalizar dos veces con la MISMA evidencia es idempotente', async () => {
  const world = createFinalizeWorld({
    updatedCount: 0,
    current: {
      status: BlockchainRecordStatus.registered,
      credentialHash: VALID_HASH,
      network: BlockchainNetwork.base_sepolia,
      chainId: 84532,
      contractAddress: CONTRACT_ADDRESS,
      deploymentId: DEPLOYMENT_ID,
      anchorSignerProfileId: ANCHOR_PROFILE_ID,
      txHash: TX_HASH,
      blockNumber: 4242,
      issuerAddress: anchorSnapshot().address,
      registeredAt: new Date('2026-03-31T23:33:20.000Z')
    }
  });

  // No lanza: ya estaba finalizada con exactamente esta evidencia.
  await world.service.finalizeRegistration(finalizeInput());
});

test('12: finalizar con evidencia en CONFLICTO falla cerrado', async () => {
  const base = {
    status: BlockchainRecordStatus.registered,
    credentialHash: VALID_HASH,
    network: BlockchainNetwork.base_sepolia,
    chainId: 84532,
    contractAddress: CONTRACT_ADDRESS,
    deploymentId: DEPLOYMENT_ID,
    anchorSignerProfileId: ANCHOR_PROFILE_ID,
    txHash: TX_HASH,
    blockNumber: 4242,
    issuerAddress: anchorSnapshot().address,
    registeredAt: new Date('2026-03-31T23:33:20.000Z')
  };

  const conflicts: Array<[string, Record<string, unknown> | null]> = [
    ['fila ausente', null],
    ['otra transaccion', { ...base, txHash: `0x${'9'.repeat(64)}` }],
    ['otro bloque', { ...base, blockNumber: 4243 }],
    ['otro registrante', { ...base, issuerAddress: PUBLIC_TEST_KEY_TWO.address }],
    [
      'otra fecha',
      { ...base, registeredAt: new Date('2026-04-01T00:00:00.000Z') }
    ],
    ['otro deployment', { ...base, deploymentId: 'otro-deployment' }],
    ['otro contrato', { ...base, contractAddress: PUBLIC_TEST_KEY_TWO.address }],
    ['otro perfil de ancla', { ...base, anchorSignerProfileId: 'otro-perfil' }],
    ['todavia pendiente pero cambiada', { ...base, status: BlockchainRecordStatus.pending }],
    ['revocada', { ...base, status: BlockchainRecordStatus.revoked }]
  ];

  for (const [label, current] of conflicts) {
    const world = createFinalizeWorld({ updatedCount: 0, current });

    await assert.rejects(
      world.service.finalizeRegistration(finalizeInput()),
      expectRegistrationCode('FINALIZATION_CONFLICT'),
      label
    );

    // Nunca se sobrescribe procedencia historica: hubo UN updateMany acotado y
    // ninguna escritura ciega despues.
    assert.equal(world.updates.length, 1, label);
  }
});

// ---------------------------------------------------------------------------
// ADDENDUM C: COMPROMISO POSTERIOR A TX #1
// ---------------------------------------------------------------------------

test('addendum C: un perfil COMPROMETIDO tras TX #1 no transmite nada', async () => {
  const registrations: unknown[] = [];

  const prisma = {
    signerProfile: {
      async findUnique() {
        return anchorProfileRow(SignerProfileStatus.compromised);
      }
    }
  };
  const coordinator = {
    async registerCredentialHash(input: unknown) {
      registrations.push(input);
      return evidence();
    }
  };

  const service = new BlockchainRegistrationService(
    prisma as never,
    {} as never,
    coordinator as never
  );

  await assert.rejects(
    service.executeRegistration({
      recordId: 'blockchain-record-1',
      credentialHash: VALID_HASH,
      target: target(),
      signer: anchorSnapshot()
    }),
    expectRegistrationCode('ANCHOR_PROFILE_COMPROMISED')
  );

  // No se transmitio la registracion, no se cambio el intent al ancla actual y
  // no se resolvio ningun reemplazo automatico.
  assert.deepEqual(registrations, []);
});

test('addendum C: un perfil RETIRADO tras TX #1 SI completa su intent', async () => {
  // Politica elegida y declarada: `retired` significa "no se elige para
  // intents NUEVOS", no "la clave es insegura". El intent ya estaba
  // commiteado con ese perfil, asi que se lo deja terminar -- reasignarlo al
  // ancla actual reescribiria procedencia historica, y abandonarlo dejaria una
  // credencial emitida sin anclar por una rotacion administrativa.
  const registrations: unknown[] = [];
  const finalized: unknown[] = [];

  const prisma = {
    signerProfile: {
      async findUnique() {
        return anchorProfileRow(SignerProfileStatus.retired);
      }
    },
    blockchainRecord: {
      async updateMany(args: unknown) {
        finalized.push(args);
        return { count: 1 };
      }
    }
  };
  const coordinator = {
    async registerCredentialHash(input: unknown) {
      registrations.push(input);
      return evidence();
    }
  };

  const service = new BlockchainRegistrationService(
    prisma as never,
    {} as never,
    coordinator as never
  );

  await service.executeRegistration({
    recordId: 'blockchain-record-1',
    credentialHash: VALID_HASH,
    target: target(),
    signer: anchorSnapshot()
  });

  assert.equal(registrations.length, 1);
  assert.equal(finalized.length, 1);
});

test('la ejecucion pasa el MISMO hash al coordinador y a la finalizacion', async () => {
  const sent: string[] = [];
  const finalized: Array<Record<string, unknown>> = [];

  const prisma = {
    signerProfile: {
      async findUnique() {
        return anchorProfileRow(SignerProfileStatus.active);
      }
    },
    blockchainRecord: {
      async updateMany(args: Record<string, unknown>) {
        finalized.push(args);
        return { count: 1 };
      }
    }
  };
  const coordinator = {
    async registerCredentialHash(input: { credentialHash: string }) {
      sent.push(input.credentialHash);
      return evidence();
    }
  };

  const service = new BlockchainRegistrationService(
    prisma as never,
    {} as never,
    coordinator as never
  );

  await service.executeRegistration({
    recordId: 'blockchain-record-1',
    credentialHash: VALID_HASH,
    target: target(),
    signer: anchorSnapshot()
  });

  // Freeze de la ecuacion: el hash que se firma, se persiste, se envia y se
  // busca es EL MISMO.
  assert.deepEqual(sent, [VALID_HASH]);
  assert.equal(
    (finalized[0].where as Record<string, unknown>).credentialHash,
    VALID_HASH
  );
});

test('32: la Wallet de ANCLAJE no es la de ASERCION', async () => {
  // Dos claves sinteticas distintas. El ancla es la clave 2 aqui, para que una
  // confusion con la clave 1 -- la que S8c4 usa para el proof -- se note.
  const anchorWallet = new Wallet(PUBLIC_TEST_KEY_TWO.privateKey);
  const received: string[] = [];

  const prisma = {
    signerProfile: {
      async findUnique() {
        // La direccion persistida es la del ancla 2: la compuerta exige que la
        // fila coincida con el snapshot congelado del intent.
        return {
          purpose: SignerProfilePurpose.anchor,
          status: SignerProfileStatus.active,
          address: anchorWallet.address
        };
      }
    },
    blockchainRecord: {
      async updateMany() {
        return { count: 1 };
      }
    }
  };
  const coordinator = {
    async registerCredentialHash(input: { signer: AnchorSignerSnapshot }) {
      received.push(input.signer.address);
      return evidence({ registrant: anchorWallet.address });
    }
  };

  const service = new BlockchainRegistrationService(
    prisma as never,
    {} as never,
    coordinator as never
  );

  await service.executeRegistration({
    recordId: 'blockchain-record-1',
    credentialHash: VALID_HASH,
    target: target(),
    signer: {
      profileId: 'anchor-profile-2',
      keyVersion: 1,
      address: anchorWallet.address,
      wallet: anchorWallet
    }
  });

  assert.deepEqual(received, [PUBLIC_TEST_KEY_TWO.address]);
  assert.notEqual(received[0], PUBLIC_TEST_KEY_ONE.address);
});

// ---------------------------------------------------------------------------
// S8c6.1 -- LA COMPUERTA DE USO DE CLAVE CORRE DENTRO DEL CARRIL
// ---------------------------------------------------------------------------

/**
 * Mundo con el coordinador REAL -- cola, cerrojo y preflight de verdad -- y
 * provider/contrato dobles. Dos Issuers comparten el perfil de ancla P.
 *
 * La barrera es una Promesa diferida: sin `sleep`, sin reloj y sin red.
 */
function createSharedAnchorWorld() {
  const profile: { status: SignerProfileStatus } = {
    status: SignerProfileStatus.active
  };
  const profileReads: string[] = [];
  const sends: string[] = [];
  const preflights: number[] = [];

  // Promesas que se resuelven en la N-esima lectura del perfil.
  const readWaiters = new Map<number, () => void>();
  function onProfileRead(count: number): Promise<void> {
    if (profileReads.length >= count) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => readWaiters.set(count, resolve));
  }

  let releaseFirstSend: () => void = () => undefined;
  const firstSendReleased = new Promise<void>((resolve) => {
    releaseFirstSend = resolve;
  });
  let announceFirstSend: () => void = () => undefined;
  const firstSendEntered = new Promise<void>((resolve) => {
    announceFirstSend = resolve;
  });

  const prisma = {
    signerProfile: {
      async findUnique(args: { where: { id: string } }) {
        profileReads.push(args.where.id);
        readWaiters.get(profileReads.length)?.();
        return {
          purpose: SignerProfilePurpose.anchor,
          status: profile.status,
          address: anchorSnapshot().address
        };
      }
    },
    blockchainRecord: {
      async updateMany() {
        return { count: 1 };
      }
    }
  };

  const coordinator = new AnchorWriteCoordinator(
    new (class extends CredentialRegistryPreflight {
      override async assertWritable(
        chainTarget: CredentialRegistryTarget,
        provider?: never
      ) {
        preflights.push(profileReads.length);
        return super.assertWritable(chainTarget, provider);
      }
    })(),
    {
      createProvider: () =>
        ({
          async getNetwork() {
            return { chainId: 84532n };
          },
          async getCode() {
            return `0x60806040${'ab'.repeat(32)}`;
          },
          async getBlock() {
            return { timestamp: BigInt(1_775_000_000) };
          }
        }) as never,
      createWriter: (input: { signer: { getAddress(): Promise<string> } }) => ({
        async registerCredential(credentialHash: string) {
          const from = await input.signer.getAddress();
          const first = sends.length === 0;
          sends.push(credentialHash);

          if (first) {
            announceFirstSend();
            await firstSendReleased;
          }

          return {
            hash: TX_HASH,
            async wait() {
              return {
                status: 1,
                hash: TX_HASH,
                blockNumber: 4242,
                from,
                to: CONTRACT_ADDRESS,
                logs: [
                  {
                    address: CONTRACT_ADDRESS,
                    topics: [
                      CREDENTIAL_REGISTERED_TOPIC,
                      VALID_HASH.toLowerCase(),
                      `0x${'0'.repeat(24)}${from.slice(2).toLowerCase()}`
                    ],
                    data: `0x${(1_775_000_000).toString(16).padStart(64, '0')}`,
                    transactionHash: TX_HASH,
                    blockNumber: 4242
                  }
                ]
              };
            }
          };
        }
      })
    }
  );

  const service = new BlockchainRegistrationService(
    prisma as never,
    {} as never,
    coordinator
  );

  function register(recordId: string) {
    return service.executeRegistration({
      recordId,
      credentialHash: VALID_HASH,
      target: target(),
      signer: anchorSnapshot()
    });
  }

  return {
    profile,
    profileReads,
    sends,
    preflights,
    onProfileRead,
    firstSendEntered,
    releaseFirstSend: () => releaseFirstSend(),
    register
  };
}

test('S8c6.1: un ancla COMPROMETIDA mientras B espera el carril no se usa', async () => {
  const world = createSharedAnchorWorld();

  // A toma el carril del perfil compartido y se queda enviando.
  const first = world.register('record-A');
  await world.firstSendEntered;

  // B pasa su chequeo PREVIO -- el perfil todavia esta activo -- y se encola.
  // Lecturas hasta aca: A previa (1), A dentro del carril (2), B previa (3).
  const second = world.register('record-B');
  await world.onProfileRead(3);

  // Mientras B espera, el perfil se marca comprometido.
  world.profile.status = SignerProfileStatus.compromised;

  world.releaseFirstSend();
  await first;

  // B adquiere el carril, RELEE el perfil y falla cerrado.
  await assert.rejects(second, expectRegistrationCode('ANCHOR_PROFILE_COMPROMISED'));

  // La relectura de B ocurrio DESPUES de adquirir el carril: es la CUARTA
  // lectura (A previa, A en carril, B previa, B en carril). El chequeo previo
  // de B vio el perfil activo, asi que solo con el no se habria detectado nada.
  assert.equal(world.profileReads.length, 4);
  assert.deepEqual(world.profileReads, new Array(4).fill(ANCHOR_PROFILE_ID));

  // CERO preflight y CERO envio para B: hubo UN solo preflight, el de A, y
  // ocurrio DESPUES de la relectura de A dentro del carril (lectura 2).
  assert.deepEqual(world.preflights, [2]);
  assert.deepEqual(world.sends, [VALID_HASH]);
});

test('S8c6.1: un ancla RETIRADA mientras B espera SI completa el intent', async () => {
  // Misma carrera, otro estado: `retired` no significa "clave insegura", y el
  // intent de B ya estaba commiteado con ese perfil.
  const world = createSharedAnchorWorld();

  const first = world.register('record-A');
  await world.firstSendEntered;

  const second = world.register('record-B');
  await world.onProfileRead(3);

  world.profile.status = SignerProfileStatus.retired;

  world.releaseFirstSend();
  await first;
  await second;

  // B releyo el perfil y continuo: preflight y envio propios.
  assert.equal(world.profileReads.length, 4);
  assert.equal(world.preflights.length, 2);
  assert.deepEqual(world.sends, [VALID_HASH, VALID_HASH]);
});

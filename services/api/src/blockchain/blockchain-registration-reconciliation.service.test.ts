/**
 * Reconciliacion de registraciones pendientes -- S8c6, matriz 67-76.
 *
 * Lo central: la reconciliacion LEE y ADOPTA. No llama a `registerCredential`
 * bajo NINGUN resultado -- ni cuando la cadena dice "no registrado" -- porque
 * un intento anterior pudo haberse transmitido y estar todavia sin minar.
 * "Ahora no aparece" no prueba "no se transmitio nada".
 *
 * Y no necesita ninguna clave: adoptar una registracion que ya ocurrio no
 * firma nada.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BlockchainEvidenceMode,
  BlockchainNetwork,
  BlockchainRecordStatus
} from '@prisma/client';

import { PUBLIC_TEST_KEY_ONE, PUBLIC_TEST_KEY_TWO } from '../signing/__fixtures__/signer-test-keys';
import { type BlockchainTargetEnvironment } from './blockchain-target';
import { BlockchainRegistrationReconciliationService } from './blockchain-registration-reconciliation.service';
import {
  CREDENTIAL_REGISTERED_TOPIC,
  type CredentialRegistryLog
} from './credential-registry-events';

const CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const VALID_HASH =
  '0xaf032042c1bcfb72f9caac350eb3cb576f44ab07b1c1968f4b36264da44ff2ab';
const TX_HASH = `0x${'1'.repeat(64)}`;
const BLOCK_NUMBER = 4242;
const BLOCK_TIMESTAMP_SECONDS = 1_775_000_000;
const DEPLOYMENT_ID = 'test-base-sepolia-pending-deploy';
const ANCHOR_PROFILE_ID = 'anchor-profile-1';
const RECORD_ID = 'blockchain-record-1';

/**
 * Rango de busqueda INYECTADO. S8c6 no lo adivina: el limite inferior
 * definitivo es el bloque de deploy del manifest de S8c10, y mientras no
 * exista, el descubrimiento acotado de huerfanos EN VIVO depende de el.
 */
const SEARCH_RANGE = { fromBlock: 4000, toBlock: 'latest' as const };

const ENVIRONMENT: BlockchainTargetEnvironment = {
  BLOCKCHAIN_EVIDENCE_MODE: 'credential_registry',
  CREDENTIAL_REGISTRY_NETWORK: BlockchainNetwork.base_sepolia,
  CREDENTIAL_REGISTRY_CHAIN_ID: '84532',
  CREDENTIAL_REGISTRY_RPC_URL: 'https://provider.example/v2/SECRET_API_KEY',
  CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: CONTRACT_ADDRESS,
  CREDENTIAL_REGISTRY_DEPLOYMENT_ID: DEPLOYMENT_ID
};

function registeredLog(input: {
  credentialHash?: string;
  registrant: string;
  txHash?: string;
  blockNumber?: number;
}): CredentialRegistryLog {
  return {
    address: CONTRACT_ADDRESS,
    topics: [
      CREDENTIAL_REGISTERED_TOPIC,
      (input.credentialHash ?? VALID_HASH).toLowerCase(),
      `0x${'0'.repeat(24)}${input.registrant.slice(2).toLowerCase()}`
    ],
    data: `0x${BLOCK_TIMESTAMP_SECONDS.toString(16).padStart(64, '0')}`,
    transactionHash: input.txHash ?? TX_HASH,
    blockNumber: input.blockNumber ?? BLOCK_NUMBER
  };
}

interface WorldOptions {
  record?: Record<string, unknown> | null;
  logs?: readonly CredentialRegistryLog[];
  logsError?: unknown;
  block?: { timestamp?: unknown } | null;
  blockError?: unknown;
  environment?: BlockchainTargetEnvironment;
}

function createWorld(options: WorldOptions = {}) {
  const finalizeCalls: Array<Record<string, unknown>> = [];
  const logFilters: Array<Record<string, unknown>> = [];
  const blockReads: number[] = [];

  const defaultRecord = {
    id: RECORD_ID,
    status: BlockchainRecordStatus.pending,
    evidenceMode: BlockchainEvidenceMode.credential_registry,
    credentialHash: VALID_HASH,
    network: BlockchainNetwork.base_sepolia,
    chainId: 84532,
    contractAddress: CONTRACT_ADDRESS,
    deploymentId: DEPLOYMENT_ID,
    txHash: null,
    anchorSignerProfileId: ANCHOR_PROFILE_ID,
    anchorSignerProfile: { address: PUBLIC_TEST_KEY_ONE.addressLowercase }
  };

  const prisma = {
    blockchainRecord: {
      async findUnique() {
        return 'record' in options ? options.record : defaultRecord;
      }
    }
  };

  const registrationService = {
    async finalizeRegistration(input: Record<string, unknown>) {
      finalizeCalls.push(input);
    }
  };

  const reader = {
    async getLogs(filter: Record<string, unknown>) {
      logFilters.push(filter);
      if (options.logsError !== undefined) {
        throw options.logsError;
      }
      return (
        options.logs ?? [
          registeredLog({ registrant: PUBLIC_TEST_KEY_ONE.address })
        ]
      );
    },
    async getBlock(blockNumber: number) {
      blockReads.push(blockNumber);
      if (options.blockError !== undefined) {
        throw options.blockError;
      }
      return 'block' in options
        ? (options.block ?? null)
        : { timestamp: BigInt(BLOCK_TIMESTAMP_SECONDS) };
    }
  };

  const service = new BlockchainRegistrationReconciliationService(
    prisma as never,
    registrationService as never,
    {
      createReader: () => reader,
      environment: options.environment ?? ENVIRONMENT
    }
  );

  return { service, finalizeCalls, logFilters, blockReads };
}

// ---------------------------------------------------------------------------
// 68, 72-74: ADOPCION
// ---------------------------------------------------------------------------

test('68, 72-74: una registracion huerfana con el registrante esperado se adopta', async () => {
  const world = createWorld();

  const result = await world.service.reconcilePendingRegistration({
    recordId: RECORD_ID,
    searchRange: SEARCH_RANGE
  });

  assert.equal(result.outcome, 'FINALIZED');
  assert.ok(result.evidence);

  // 73: la evidencia sale del LOG recuperado por hash -- esta es la ventana de
  // crash en la que el proceso murio antes de guardar el txHash.
  assert.equal(result.evidence?.txHash, TX_HASH);
  assert.equal(result.evidence?.blockNumber, BLOCK_NUMBER);
  assert.equal(result.evidence?.registrant, PUBLIC_TEST_KEY_ONE.address);

  // 74: la fecha viene del BLOQUE recuperado, no del reloj del servidor.
  assert.deepEqual(world.blockReads, [BLOCK_NUMBER]);
  assert.equal(
    result.evidence?.registeredAt.toISOString(),
    '2026-03-31T23:33:20.000Z'
  );

  // 72: y finaliza la fila pendiente.
  assert.equal(world.finalizeCalls.length, 1);
  assert.equal(world.finalizeCalls[0].recordId, RECORD_ID);
  assert.equal(world.finalizeCalls[0].credentialHash, VALID_HASH);
  assert.equal(world.finalizeCalls[0].anchorSignerProfileId, ANCHOR_PROFILE_ID);
});

test('el filtro de logs usa el hash indexado y el rango INYECTADO', async () => {
  const world = createWorld();

  await world.service.reconcilePendingRegistration({
    recordId: RECORD_ID,
    searchRange: SEARCH_RANGE
  });

  assert.equal(world.logFilters.length, 1);
  const filter = world.logFilters[0];

  assert.equal(filter.address, CONTRACT_ADDRESS);
  assert.deepEqual(filter.topics, [CREDENTIAL_REGISTERED_TOPIC, VALID_HASH]);
  // Rango acotado: nunca un escaneo desde el bloque 0.
  assert.equal(filter.fromBlock, 4000);
  assert.equal(filter.toBlock, 'latest');
  assert.notEqual(filter.fromBlock, 0);
});

// ---------------------------------------------------------------------------
// 67, 69-71: NO ADOPTAR
// ---------------------------------------------------------------------------

test('67: si la cadena no tiene la registracion, queda PENDING y no se escribe', async () => {
  const world = createWorld({ logs: [] });

  const result = await world.service.reconcilePendingRegistration({
    recordId: RECORD_ID,
    searchRange: SEARCH_RANGE
  });

  assert.equal(result.outcome, 'CHAIN_NOT_REGISTERED');
  assert.equal(result.evidence, null);
  assert.deepEqual(world.finalizeCalls, []);
  // Y NO se vuelve a enviar: "ahora no aparece" no prueba "no se transmitio".
  assert.deepEqual(world.blockReads, []);
});

test('69: una registracion con registrante INESPERADO no se adopta', async () => {
  const world = createWorld({
    logs: [registeredLog({ registrant: PUBLIC_TEST_KEY_TWO.address })]
  });

  const result = await world.service.reconcilePendingRegistration({
    recordId: RECORD_ID,
    searchRange: SEARCH_RANGE
  });

  assert.equal(result.outcome, 'UNEXPECTED_REGISTRANT');
  assert.deepEqual(world.finalizeCalls, []);
});

test('70: un bloque sin timestamp valido no se fabrica', async () => {
  const cases: Array<[string, WorldOptions]> = [
    ['bloque nulo', { block: null }],
    ['sin timestamp', { block: {} }],
    ['timestamp negativo', { block: { timestamp: -5 } }],
    ['timestamp no numerico', { block: { timestamp: 'ayer' } }]
  ];

  for (const [label, options] of cases) {
    const world = createWorld(options);

    const result = await world.service.reconcilePendingRegistration({
      recordId: RECORD_ID,
      searchRange: SEARCH_RANGE
    });

    assert.equal(result.outcome, 'EVIDENCE_INCOMPLETE', label);
    assert.deepEqual(world.finalizeCalls, [], label);
  }
});

test('71: varias registraciones en CONFLICTO fallan cerrado', async () => {
  const world = createWorld({
    logs: [
      registeredLog({ registrant: PUBLIC_TEST_KEY_ONE.address }),
      registeredLog({
        registrant: PUBLIC_TEST_KEY_ONE.address,
        txHash: `0x${'9'.repeat(64)}`,
        blockNumber: 5000
      })
    ]
  });

  const result = await world.service.reconcilePendingRegistration({
    recordId: RECORD_ID,
    searchRange: SEARCH_RANGE
  });

  // No se "elige una" en silencio.
  assert.equal(result.outcome, 'CONFLICTING_EVIDENCE');
  assert.deepEqual(world.finalizeCalls, []);
});

test('un log malformado no cuenta como evidencia', async () => {
  const malformed: Array<[string, CredentialRegistryLog]> = [
    [
      'sin transactionHash',
      { ...registeredLog({ registrant: PUBLIC_TEST_KEY_ONE.address }), transactionHash: null }
    ],
    [
      'sin blockNumber',
      { ...registeredLog({ registrant: PUBLIC_TEST_KEY_ONE.address }), blockNumber: null }
    ],
    [
      'otro topic',
      {
        ...registeredLog({ registrant: PUBLIC_TEST_KEY_ONE.address }),
        topics: [`0x${'e'.repeat(64)}`, VALID_HASH, `0x${'0'.repeat(64)}`]
      }
    ],
    [
      'sin topics suficientes',
      {
        ...registeredLog({ registrant: PUBLIC_TEST_KEY_ONE.address }),
        topics: [CREDENTIAL_REGISTERED_TOPIC]
      }
    ]
  ];

  for (const [label, log] of malformed) {
    const world = createWorld({ logs: [log] });

    const result = await world.service.reconcilePendingRegistration({
      recordId: RECORD_ID,
      searchRange: SEARCH_RANGE
    });

    assert.equal(result.outcome, 'CHAIN_NOT_REGISTERED', label);
    assert.deepEqual(world.finalizeCalls, [], label);
  }
});

// ---------------------------------------------------------------------------
// TARGET LIGADO AL RECORD
// ---------------------------------------------------------------------------

test('la identidad del deployment sale de la FILA, no de la config actual', async () => {
  // La configuracion de hoy apunta a OTRO contrato y OTRO deployment. La fila
  // es intencion historica: se la reconcilia contra SU deployment.
  const world = createWorld({
    environment: {
      ...ENVIRONMENT,
      CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: PUBLIC_TEST_KEY_TWO.address,
      CREDENTIAL_REGISTRY_DEPLOYMENT_ID: 'deployment-de-hoy'
    }
  });

  await world.service.reconcilePendingRegistration({
    recordId: RECORD_ID,
    searchRange: SEARCH_RANGE
  });

  // Se leyo el contrato DE LA FILA.
  assert.equal(world.logFilters[0].address, CONTRACT_ADDRESS);
  assert.notEqual(world.logFilters[0].address, PUBLIC_TEST_KEY_TWO.address);

  // Y se finalizo contra el deployment DE LA FILA.
  const target = world.finalizeCalls[0].target as Record<string, unknown>;
  assert.equal(target.contractAddress, CONTRACT_ADDRESS);
  assert.equal(target.deploymentId, DEPLOYMENT_ID);
});

test('una configuracion de OTRA red no sirve para leer esta fila', async () => {
  const world = createWorld({
    environment: {
      ...ENVIRONMENT,
      CREDENTIAL_REGISTRY_NETWORK: BlockchainNetwork.anvil,
      CREDENTIAL_REGISTRY_CHAIN_ID: '31337',
      CREDENTIAL_REGISTRY_RPC_URL: 'http://127.0.0.1:8545'
    }
  });

  const result = await world.service.reconcilePendingRegistration({
    recordId: RECORD_ID,
    searchRange: SEARCH_RANGE
  });

  assert.equal(result.outcome, 'TARGET_UNRESOLVED');
  assert.deepEqual(world.finalizeCalls, []);
});

// ---------------------------------------------------------------------------
// CHECKPOINT DE txHash
// ---------------------------------------------------------------------------

test('si la fila ya tenia txHash, la evidencia debe ser LA MISMA transaccion', async () => {
  const matching = createWorld({
    record: {
      id: RECORD_ID,
      status: BlockchainRecordStatus.pending,
      evidenceMode: BlockchainEvidenceMode.credential_registry,
      credentialHash: VALID_HASH,
      network: BlockchainNetwork.base_sepolia,
      chainId: 84532,
      contractAddress: CONTRACT_ADDRESS,
      deploymentId: DEPLOYMENT_ID,
      txHash: TX_HASH,
      anchorSignerProfileId: ANCHOR_PROFILE_ID,
      anchorSignerProfile: { address: PUBLIC_TEST_KEY_ONE.addressLowercase }
    }
  });

  const ok = await matching.service.reconcilePendingRegistration({
    recordId: RECORD_ID,
    searchRange: SEARCH_RANGE
  });
  assert.equal(ok.outcome, 'FINALIZED');

  const conflicting = createWorld({
    record: {
      id: RECORD_ID,
      status: BlockchainRecordStatus.pending,
      evidenceMode: BlockchainEvidenceMode.credential_registry,
      credentialHash: VALID_HASH,
      network: BlockchainNetwork.base_sepolia,
      chainId: 84532,
      contractAddress: CONTRACT_ADDRESS,
      deploymentId: DEPLOYMENT_ID,
      txHash: `0x${'7'.repeat(64)}`,
      anchorSignerProfileId: ANCHOR_PROFILE_ID,
      anchorSignerProfile: { address: PUBLIC_TEST_KEY_ONE.addressLowercase }
    }
  });

  const bad = await conflicting.service.reconcilePendingRegistration({
    recordId: RECORD_ID,
    searchRange: SEARCH_RANGE
  });
  assert.equal(bad.outcome, 'CONFLICTING_EVIDENCE');
  assert.deepEqual(conflicting.finalizeCalls, []);
});

// ---------------------------------------------------------------------------
// FILAS QUE NO SON CANDIDATAS
// ---------------------------------------------------------------------------

test('una fila ya registrada, mock, ausente o sin ancla no se reconcilia', async () => {
  const cases: Array<[string, WorldOptions, string]> = [
    ['fila ausente', { record: null }, 'NOT_RECONCILABLE'],
    [
      'ya finalizada',
      {
        record: {
          id: RECORD_ID,
          status: BlockchainRecordStatus.registered,
          evidenceMode: BlockchainEvidenceMode.credential_registry,
          credentialHash: VALID_HASH,
          network: BlockchainNetwork.base_sepolia,
          chainId: 84532,
          contractAddress: CONTRACT_ADDRESS,
          deploymentId: DEPLOYMENT_ID,
          txHash: TX_HASH,
          anchorSignerProfileId: ANCHOR_PROFILE_ID,
          anchorSignerProfile: { address: PUBLIC_TEST_KEY_ONE.addressLowercase }
        }
      },
      'ALREADY_FINALIZED'
    ],
    [
      'evidencia mock',
      {
        record: {
          id: RECORD_ID,
          status: BlockchainRecordStatus.pending,
          evidenceMode: BlockchainEvidenceMode.mock,
          credentialHash: VALID_HASH,
          network: BlockchainNetwork.anvil,
          chainId: 31337,
          contractAddress: CONTRACT_ADDRESS,
          deploymentId: null,
          txHash: null,
          anchorSignerProfileId: null,
          anchorSignerProfile: null
        }
      },
      'NOT_RECONCILABLE'
    ],
    [
      'sin perfil de ancla',
      {
        record: {
          id: RECORD_ID,
          status: BlockchainRecordStatus.pending,
          evidenceMode: BlockchainEvidenceMode.credential_registry,
          credentialHash: VALID_HASH,
          network: BlockchainNetwork.base_sepolia,
          chainId: 84532,
          contractAddress: CONTRACT_ADDRESS,
          deploymentId: DEPLOYMENT_ID,
          txHash: null,
          anchorSignerProfileId: null,
          anchorSignerProfile: null
        }
      },
      'NOT_RECONCILABLE'
    ]
  ];

  for (const [label, options, expected] of cases) {
    const world = createWorld(options);

    const result = await world.service.reconcilePendingRegistration({
      recordId: RECORD_ID,
      searchRange: SEARCH_RANGE
    });

    assert.equal(result.outcome, expected, label);
    assert.deepEqual(world.finalizeCalls, [], label);
  }
});

test('un error del provider no filtra el endpoint y deja la fila pendiente', async () => {
  const leaky = new Error(
    'getLogs failed https://provider.example/v2/SECRET_API_KEY'
  );

  for (const [label, options] of [
    ['getLogs', { logsError: leaky }],
    ['getBlock', { blockError: leaky }]
  ] as const) {
    const world = createWorld(options);

    const result = await world.service.reconcilePendingRegistration({
      recordId: RECORD_ID,
      searchRange: SEARCH_RANGE
    });

    assert.equal(result.outcome, 'CHAIN_UNAVAILABLE', label);
    assert.deepEqual(world.finalizeCalls, [], label);
    // El resultado es un enum, no un mensaje: no hay nada que filtrar.
    assert.ok(!JSON.stringify(result).includes('SECRET_API_KEY'), label);
  }
});

// ---------------------------------------------------------------------------
// 75-76: NI ESCRITURA EN CADENA NI CLAVES
// ---------------------------------------------------------------------------

test('75-76: la reconciliacion no escribe en la cadena y no usa ninguna clave', () => {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');

  const code = readFileSync(
    join(__dirname, 'blockchain-registration-reconciliation.service.ts'),
    'utf8'
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');

  // 75: CERO escrituras al contrato, bajo cualquier resultado.
  for (const forbidden of [
    'registerCredential',
    'revokeCredential',
    'sendTransaction',
    'signTransaction',
    'new Contract',
    'AnchorWriteCoordinator',
    'registerCredentialHash'
  ]) {
    assert.ok(!code.includes(forbidden), `no debe contener ${forbidden}`);
  }

  // 76: y ninguna clave. Adoptar algo que ya ocurrio no firma nada.
  for (const forbidden of [
    'IssuerSignerResolver',
    'resolveAnchorSignerForIssuer',
    'SignerSecretStore',
    'SIGNER_SECRET_STORE',
    'secretRef',
    'privateKey',
    'new Wallet',
    'NonceManager',
    'CREDENTIAL_REGISTRY_PRIVATE_KEY'
  ]) {
    assert.ok(!code.includes(forbidden), `no debe contener ${forbidden}`);
  }
});

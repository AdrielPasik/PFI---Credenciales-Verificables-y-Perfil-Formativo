/**
 * Procedencia del target en BlockchainRecord -- S8c5, items 35-37.
 *
 * Antes de S8c5 el servicio de evidencia escribia `network: anvil` y
 * `chainId: 31337` como literales, asi que un hash anclado en cualquier otra
 * cadena habria quedado registrado como Anvil. Ahora esos campos salen del
 * target VALIDADO.
 *
 * Lo que se congela:
 *
 *   * un target Anvil registra anvil/31337 + su deployment;
 *   * un target Base Sepolia registra base_sepolia/84532 -- SIN tocar Base
 *     Sepolia: el provider es un doble y el write client tambien;
 *   * un record mock sigue siendo semanticamente mock, y ahora lo dice.
 *
 * NO se toca el ciclo de vida: no hay pending, no hay finalize, `txHash` sigue
 * NOT NULL y no se reescribe ninguna fila historica. Eso es S8c6.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AnchorRegistrantScope,
  BlockchainEvidenceMode,
  BlockchainNetwork,
  BlockchainRecordStatus
} from '@prisma/client';

import { BlockchainEvidenceService } from './blockchain-evidence.service';
import { BlockchainRegistrationService } from './blockchain-registration.service';
import {
  type BlockchainTargetEnvironment,
  isCredentialRegistryTarget,
  resolveBlockchainTarget
} from './blockchain-target';
import {
  type CredentialRegistryPreflightProvider,
  CredentialRegistryPreflight
} from './credential-registry-preflight';
import { createCredentialRegistryWriteClientForTarget } from './credential-registry-write-client';

const VALID_HASH =
  '0xaf032042c1bcfb72f9caac350eb3cb576f44ab07b1c1968f4b36264da44ff2ab';
const CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const REGISTRANT_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const VALID_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const DEPLOYED_CODE = `0x60806040${'ab'.repeat(32)}`;

const ANVIL_ENV: BlockchainTargetEnvironment = {
  BLOCKCHAIN_EVIDENCE_MODE: 'credential_registry',
  CREDENTIAL_REGISTRY_NETWORK: BlockchainNetwork.anvil,
  CREDENTIAL_REGISTRY_CHAIN_ID: '31337',
  CREDENTIAL_REGISTRY_RPC_URL: 'http://127.0.0.1:8545',
  CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: CONTRACT_ADDRESS,
  CREDENTIAL_REGISTRY_DEPLOYMENT_ID: 'test-anvil-local'
};

/**
 * Fixture de configuracion Base Sepolia. La direccion del contrato y el
 * deploymentId son SINTETICOS: el deployment real no existe todavia y lo
 * produce S8c10. Nada de esto contacta Base Sepolia.
 */
const BASE_SEPOLIA_ENV: BlockchainTargetEnvironment = {
  BLOCKCHAIN_EVIDENCE_MODE: 'credential_registry',
  CREDENTIAL_REGISTRY_NETWORK: BlockchainNetwork.base_sepolia,
  CREDENTIAL_REGISTRY_CHAIN_ID: '84532',
  CREDENTIAL_REGISTRY_RPC_URL: 'https://provider.example/v2/TEST_KEY',
  CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: CONTRACT_ADDRESS,
  CREDENTIAL_REGISTRY_DEPLOYMENT_ID: 'test-base-sepolia-pending-deploy'
};

function createInput() {
  return {
    credentialId: 'cred-123',
    credentialHash: VALID_HASH,
    canonicalizationVersion: 'canon_v2',
    issuerAddress: REGISTRANT_ADDRESS
  };
}

function createTransactionDouble() {
  const calls: Array<{ data: Record<string, unknown> }> = [];

  return {
    calls,
    blockchainRecord: {
      async create(input: { data: Record<string, unknown> }) {
        calls.push(input);
        return { id: 'blockchain-record-1', ...input.data };
      }
    }
  };
}

function createProviderDouble(chainId: bigint) {
  const calls: string[] = [];

  const provider: CredentialRegistryPreflightProvider = {
    async getNetwork() {
      calls.push('getNetwork');
      return { chainId };
    },
    async getCode() {
      calls.push('getCode');
      return DEPLOYED_CODE;
    }
  };

  return { provider, calls };
}

/**
 * Servicio de evidencia con el entorno y el provider INYECTADOS. El write
 * client es el real -- para que el preflight corra de verdad -- pero su
 * escritura al contrato es un doble, asi que no hay transaccion ni red.
 */
function createService(
  environment: BlockchainTargetEnvironment,
  providerChainId: bigint
) {
  const { provider, calls: providerCalls } = createProviderDouble(providerChainId);
  const contractCalls: string[] = [];

  const service = new BlockchainEvidenceService();

  Object.assign(service, {
    overrides: () => ({
      environment: {
        ...environment,
        CREDENTIAL_REGISTRY_PRIVATE_KEY: VALID_PRIVATE_KEY
      },
      preflight: new CredentialRegistryPreflight(),
      preflightProvider: provider
    }),
    createWriteClient: (target: Parameters<
      typeof createCredentialRegistryWriteClientForTarget
    >[0]) =>
      createCredentialRegistryWriteClientForTarget(
        target,
        { CREDENTIAL_REGISTRY_PRIVATE_KEY: VALID_PRIVATE_KEY },
        {
          preflightProvider: provider,
          contractWriter: {
            async registerCredential(credentialHash: string) {
              contractCalls.push(`register:${credentialHash}`);
              return {
                hash: `0x${'a'.repeat(64)}`,
                from: REGISTRANT_ADDRESS,
                to: CONTRACT_ADDRESS,
                async wait() {
                  return { status: 1, blockNumber: 42 };
                }
              };
            },
            async revokeCredential(credentialHash: string) {
              contractCalls.push(`revoke:${credentialHash}`);
              throw new Error('la registracion no revoca');
            }
          }
        }
      )
  });

  return { service, providerCalls, contractCalls };
}

// ---------------------------------------------------------------------------
// 35-36: PROCEDENCIA DEL TARGET EN EL INTENT
//
// S8c6 movio la escritura real fuera del servicio de evidencia: la procedencia
// del target la escribe ahora el ciclo de vida, al crear el intent PENDING.
// Las aserciones son las mismas -- la red, el chainId, el contrato y el
// deployment salen del target VALIDADO, no de literales -- sobre el componente
// que hoy las produce.
// ---------------------------------------------------------------------------

function createIntentRecorder() {
  const created: Array<Record<string, unknown>> = [];

  const transaction = {
    blockchainRecord: {
      async create(input: { data: Record<string, unknown> }) {
        created.push(input.data);
        return { id: 'blockchain-record-1', ...input.data };
      }
    }
  };

  const service = new BlockchainRegistrationService(
    {} as never,
    {} as never,
    {} as never
  );

  return { service, transaction, created };
}

test('35: un target Anvil deja anvil/31337 y su deployment en el intent', async () => {
  const { service, transaction, created } = createIntentRecorder();
  const target = resolveBlockchainTarget(ANVIL_ENV);
  assert.ok(isCredentialRegistryTarget(target));
  if (!isCredentialRegistryTarget(target)) {
    return;
  }

  await service.createPendingIntent(transaction as never, {
    credentialId: 'cred-123',
    credentialHash: VALID_HASH,
    canonicalizationVersion: 'canon_v2',
    target,
    anchor: {
      anchorSignerProfileId: 'anchor-profile-1',
      anchorRegistrantScope: AnchorRegistrantScope.issuer_exclusive
    }
  });

  assert.equal(created.length, 1);
  const data = created[0];

  assert.equal(data.network, BlockchainNetwork.anvil);
  assert.equal(data.chainId, 31337);
  assert.equal(data.contractAddress, CONTRACT_ADDRESS);
  assert.equal(data.deploymentId, 'test-anvil-local');
  assert.equal(data.evidenceMode, BlockchainEvidenceMode.credential_registry);
  assert.equal(data.status, BlockchainRecordStatus.pending);
  assert.equal(data.canonicalizationVersion, 'canon_v2');
});

test('36: un target Base Sepolia deja base_sepolia/84532 -- sin tocar la red', async () => {
  const { service, transaction, created } = createIntentRecorder();
  const target = resolveBlockchainTarget(BASE_SEPOLIA_ENV);
  assert.ok(isCredentialRegistryTarget(target));
  if (!isCredentialRegistryTarget(target)) {
    return;
  }

  await service.createPendingIntent(transaction as never, {
    credentialId: 'cred-123',
    credentialHash: VALID_HASH,
    canonicalizationVersion: 'canon_v2',
    target,
    anchor: {
      anchorSignerProfileId: 'anchor-profile-1',
      anchorRegistrantScope: AnchorRegistrantScope.shared_custodial
    }
  });

  const data = created[0];

  // Esto es lo que S8c5+S8c6 hacen posible: la procedencia dice la cadena REAL
  // a la que se va a escribir, no "anvil" por omision.
  assert.equal(data.network, BlockchainNetwork.base_sepolia);
  assert.equal(data.chainId, 84532);
  assert.equal(data.deploymentId, 'test-base-sepolia-pending-deploy');
  assert.equal(data.evidenceMode, BlockchainEvidenceMode.credential_registry);
  assert.equal(
    data.anchorRegistrantScope,
    AnchorRegistrantScope.shared_custodial
  );

  // Y ningun hecho de la cadena: el intent no inventa nada.
  assert.equal(data.txHash, undefined);
  assert.equal(data.blockNumber, undefined);
  assert.equal(data.issuerAddress, undefined);
  assert.equal(data.registeredAt, undefined);
});

test('36b: el intent NO lleva ningun placeholder de cadena', async () => {
  const { service, transaction, created } = createIntentRecorder();
  const target = resolveBlockchainTarget(BASE_SEPOLIA_ENV);
  assert.ok(isCredentialRegistryTarget(target));
  if (!isCredentialRegistryTarget(target)) {
    return;
  }

  await service.createPendingIntent(transaction as never, {
    credentialId: 'cred-123',
    credentialHash: VALID_HASH,
    canonicalizationVersion: 'canon_v2',
    target,
    anchor: {
      anchorSignerProfileId: 'anchor-profile-1',
      anchorRegistrantScope: AnchorRegistrantScope.issuer_exclusive
    }
  });

  const data = created[0];

  // Se afirma sobre los CAMPOS, no con un grep: `status: "pending"` es el
  // valor legitimo del estado, y el deploymentId de prueba tambien contiene la
  // palabra. Lo prohibido es que un HECHO DE LA CADENA traiga un placeholder.
  for (const field of [
    'txHash',
    'blockNumber',
    'issuerAddress',
    'registeredAt'
  ]) {
    assert.ok(
      !(field in data),
      `el intent no debe fijar ${field}: es un hecho de la cadena`
    );
  }

  // Y el estado SI es pending -- eso es lo que hace durable al intent.
  assert.equal(data.status, BlockchainRecordStatus.pending);
});

// ---------------------------------------------------------------------------
// 37, 31: MOCK
// ---------------------------------------------------------------------------

test('37: un record mock sigue siendo semanticamente mock, y ahora lo declara', async () => {
  const service = new BlockchainEvidenceService();
  Object.assign(service, {
    overrides: () => ({ environment: { BLOCKCHAIN_EVIDENCE_MODE: 'mock' } }),
    createWriteClient: () => {
      throw new Error('mock no debe construir un write client');
    }
  });

  const transaction = createTransactionDouble();
  await service.createRecord(transaction as never, createInput());

  const data = transaction.calls[0].data;

  // El triple que identifica un record mock queda igual -- la reconciliacion y
  // la revocacion lo usan para NO intentar mutar una cadena que no existe.
  assert.equal(data.network, BlockchainNetwork.anvil);
  assert.equal(data.chainId, 31337);
  assert.equal(data.contractAddress, '0x0000000000000000000000000000000000000001');
  assert.equal(data.evidenceMode, BlockchainEvidenceMode.mock);
  assert.equal(data.deploymentId, undefined, 'mock no tiene deployment');
});

test('31: mock no construye provider, no valida rpcUrl y no preflightea', async () => {
  const service = new BlockchainEvidenceService();
  let writeClientRequested = 0;

  Object.assign(service, {
    overrides: () => ({
      environment: { BLOCKCHAIN_EVIDENCE_MODE: 'mock' },
      preflight: {
        assertWritable: () => {
          throw new Error('mock no debe preflightear');
        }
      }
    }),
    createWriteClient: () => {
      writeClientRequested += 1;
      throw new Error('mock no debe construir un write client');
    }
  });

  const transaction = createTransactionDouble();
  await service.createRecord(transaction as never, createInput());

  assert.equal(writeClientRequested, 0);
  assert.equal(transaction.calls.length, 1);

  // Y el target mock no tiene siquiera los campos que harian falta.
  const target = resolveBlockchainTarget({ BLOCKCHAIN_EVIDENCE_MODE: 'mock' });
  assert.ok(!isCredentialRegistryTarget(target));
});

test('mock se resuelve aunque no exista NINGUNA variable del registry', () => {
  const target = resolveBlockchainTarget({});

  assert.deepEqual(target, { evidenceMode: 'mock' });
});

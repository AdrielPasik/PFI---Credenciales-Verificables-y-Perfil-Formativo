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
  BlockchainEvidenceMode,
  BlockchainNetwork,
  BlockchainRecordStatus
} from '@prisma/client';

import { BlockchainEvidenceService } from './blockchain-evidence.service';
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
// 35: ANVIL
// ---------------------------------------------------------------------------

test('35: un target Anvil registra anvil/31337 y su deployment', async () => {
  const { service, providerCalls, contractCalls } = createService(
    ANVIL_ENV,
    31337n
  );
  const transaction = createTransactionDouble();

  await service.createRecord(transaction as never, createInput());

  assert.equal(transaction.calls.length, 1);
  const data = transaction.calls[0].data;

  assert.equal(data.network, BlockchainNetwork.anvil);
  assert.equal(data.chainId, 31337);
  assert.equal(data.contractAddress, CONTRACT_ADDRESS);
  assert.equal(data.deploymentId, 'test-anvil-local');
  assert.equal(data.evidenceMode, BlockchainEvidenceMode.credential_registry);
  assert.equal(data.status, BlockchainRecordStatus.registered);
  assert.equal(data.canonicalizationVersion, 'canon_v2');

  // El preflight corrio antes de la escritura.
  assert.deepEqual(providerCalls, ['getNetwork', 'getCode']);
  assert.deepEqual(contractCalls, [`register:${VALID_HASH}`]);
});

// ---------------------------------------------------------------------------
// 36: BASE SEPOLIA, SIN TOCAR BASE SEPOLIA
// ---------------------------------------------------------------------------

test('36: un target Base Sepolia registra base_sepolia/84532', async () => {
  const { service, providerCalls, contractCalls } = createService(
    BASE_SEPOLIA_ENV,
    84532n
  );
  const transaction = createTransactionDouble();

  await service.createRecord(transaction as never, createInput());

  const data = transaction.calls[0].data;

  // Esto es lo que S8c5 hace posible: la procedencia dice la cadena REAL en la
  // que se escribio, no "anvil" por omision.
  assert.equal(data.network, BlockchainNetwork.base_sepolia);
  assert.equal(data.chainId, 84532);
  assert.equal(data.deploymentId, 'test-base-sepolia-pending-deploy');
  assert.equal(data.evidenceMode, BlockchainEvidenceMode.credential_registry);

  // Y no se contacto Base Sepolia: el provider es un doble.
  assert.deepEqual(providerCalls, ['getNetwork', 'getCode']);
  assert.deepEqual(contractCalls, [`register:${VALID_HASH}`]);
});

test('36b: si el provider no esta en 84532, no se escribe ni se registra nada', async () => {
  const { service, contractCalls } = createService(BASE_SEPOLIA_ENV, 31337n);
  const transaction = createTransactionDouble();

  await assert.rejects(
    service.createRecord(transaction as never, createInput()),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as { code?: string }).code, 'BLOCKCHAIN_NETWORK_MISMATCH');
      return true;
    }
  );

  assert.deepEqual(contractCalls, []);
  assert.equal(transaction.calls.length, 0, 'ninguna fila de evidencia');
});

test('la procedencia NO incluye nada del ciclo de vida de S8c6', async () => {
  const { service } = createService(BASE_SEPOLIA_ENV, 84532n);
  const transaction = createTransactionDouble();

  await service.createRecord(transaction as never, createInput());

  const data = transaction.calls[0].data;

  // `txHash` sigue siendo NOT NULL y se escribe en la misma operacion: no hay
  // intent pendiente, no hay finalize y no hay nullabilidad nueva.
  assert.equal(typeof data.txHash, 'string');
  assert.notEqual(data.status, BlockchainRecordStatus.pending);

  // El anchor por issuer y su alcance son S8c6: se dejan sin poblar, no se
  // adivinan.
  assert.equal(data.anchorSignerProfileId, undefined);
  assert.equal(data.anchorRegistrantScope, undefined);

  // `blockNumber` existe en el schema desde S8c1 pero el write client todavia
  // lo descarta. No se finge lo contrario.
  assert.equal(data.blockNumber, undefined);
});

test('issuerAddress sigue siendo el REGISTRANTE, no la identidad del issuer', async () => {
  const { service } = createService(BASE_SEPOLIA_ENV, 84532n);
  const transaction = createTransactionDouble();

  await service.createRecord(transaction as never, createInput());

  // Es `transaction.from`: la cuenta que envio la transaccion. S8c5 no lo
  // reinterpreta como identidad criptografica del emisor, y en particular NO
  // es la direccion de la assertion key de S8c4.
  assert.equal(transaction.calls[0].data.issuerAddress, REGISTRANT_ADDRESS);
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

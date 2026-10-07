import assert from 'node:assert/strict';
import test from 'node:test';

import { BlockchainNetwork } from '@prisma/client';

import { CREDENTIAL_REGISTRY_NETWORK_CHAIN_IDS } from './blockchain-target';
import {
  ANVIL_CHAIN_ID,
  CredentialRegistryDeploymentResolver,
  MOCK_REGISTRY_CONTRACT_ADDRESS,
  deploymentMatchesBlockchainRecord,
  isMockBlockchainRecord
} from './credential-registry-deployment';

// Identificador de deployment SINTETICO y solo de test. No existe ningun
// deployment real todavia: el manifest commiteado es S8c10.
const TEST_DEPLOYMENT_ID = 'test-anvil-local';
const BASE_SEPOLIA_CHAIN_ID =
  CREDENTIAL_REGISTRY_NETWORK_CHAIN_IDS[BlockchainNetwork.base_sepolia];

const VALID_HASH =
  '0xaf032042c1bcfb72f9caac350eb3cb576f44ab07b1c1968f4b36264da44ff2ab';
const VALID_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const VALID_ISSUER_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

test('resuelve solo el deployment Anvil que coincide exactamente con el BlockchainRecord', () => {
  const result = new CredentialRegistryDeploymentResolver().resolve(
    createRecord(),
    createEnvironment()
  );

  assert.deepEqual(result, {
    kind: 'resolved',
    deployment: {
      evidenceMode: 'credential_registry',
      network: BlockchainNetwork.anvil,
      chainId: ANVIL_CHAIN_ID,
      rpcUrl: 'http://127.0.0.1:8545',
      contractAddress: VALID_ADDRESS,
      deploymentId: TEST_DEPLOYMENT_ID
    }
  });
});

test('rechaza una red distinta aunque exista configuracion global', () => {
  // S8c5: `base_sepolia` ES una red soportada ahora, asi que el record se
  // construye COHERENTE (red + su chainId). Lo que no resuelve es que el
  // record pertenezca a una red distinta de la que el target configura hoy.
  const result = new CredentialRegistryDeploymentResolver().resolve(
    createRecord({
      network: BlockchainNetwork.base_sepolia,
      chainId: BASE_SEPOLIA_CHAIN_ID
    }),
    createEnvironment()
  );

  assert.deepEqual(result, {
    kind: 'deployment_unresolved',
    reason: 'unsupported_network'
  });
});

test('un record incoherente consigo mismo no resuelve: red y chainId se cruzan', () => {
  // base_sepolia declarado con el chainId de Anvil describe dos cadenas a la
  // vez. Antes de S8c5 esto caia como "red no soportada" y tapaba el problema
  // real.
  const result = new CredentialRegistryDeploymentResolver().resolve(
    createRecord({ network: BlockchainNetwork.base_sepolia }),
    createEnvironment()
  );

  assert.deepEqual(result, {
    kind: 'deployment_unresolved',
    reason: 'unexpected_chain_id'
  });
});

test('rechaza un chainId distinto aunque la direccion del contrato coincida', () => {
  const result = new CredentialRegistryDeploymentResolver().resolve(
    createRecord({ chainId: 84532 }),
    createEnvironment()
  );

  assert.deepEqual(result, {
    kind: 'deployment_unresolved',
    reason: 'unexpected_chain_id'
  });
});

test('rechaza una direccion de contrato distinta sin fallback al registro configurado', () => {
  const result = new CredentialRegistryDeploymentResolver().resolve(
    createRecord({
      contractAddress: '0x1111111111111111111111111111111111111111'
    }),
    createEnvironment()
  );

  assert.deepEqual(result, {
    kind: 'deployment_unresolved',
    reason: 'contract_address_mismatch'
  });
});

test('rechaza un deployment sin RPC configurado', () => {
  const result = new CredentialRegistryDeploymentResolver().resolve(
    createRecord(),
    createEnvironment({ CREDENTIAL_REGISTRY_RPC_URL: undefined })
  );

  assert.deepEqual(result, {
    kind: 'deployment_unresolved',
    reason: 'missing_rpc_url'
  });
});

test('clasifica el record mock existente como no soportado para mutaciones coordinadas', () => {
  const record = createRecord({ contractAddress: MOCK_REGISTRY_CONTRACT_ADDRESS });
  const result = new CredentialRegistryDeploymentResolver().resolve(
    record,
    createEnvironment()
  );

  assert.equal(isMockBlockchainRecord(record), true);
  assert.deepEqual(result, { kind: 'mock_unsupported' });
});

test('deploymentMatchesBlockchainRecord exige red, chainId y contrato exactos', () => {
  const deployment = {
    evidenceMode: 'credential_registry' as const,
    network: BlockchainNetwork.anvil,
    chainId: ANVIL_CHAIN_ID,
    rpcUrl: 'http://127.0.0.1:8545',
    contractAddress: VALID_ADDRESS,
    deploymentId: TEST_DEPLOYMENT_ID
  };

  assert.equal(deploymentMatchesBlockchainRecord(deployment, createRecord()), true);
  assert.equal(
    deploymentMatchesBlockchainRecord(
      deployment,
      createRecord({ chainId: 84532 })
    ),
    false
  );
});

function createRecord(overrides: Partial<{
  network: BlockchainNetwork;
  chainId: number;
  contractAddress: string;
}> = {}) {
  return {
    network: BlockchainNetwork.anvil,
    chainId: ANVIL_CHAIN_ID,
    contractAddress: VALID_ADDRESS,
    credentialHash: VALID_HASH,
    issuerAddress: VALID_ISSUER_ADDRESS,
    ...overrides
  };
}

// S8c5: el modo ya no lleva la red adentro. `credential_registry_anvil` dejo de
// existir y fue reemplazado por el par (modo, red) + chainId explicito.
function createEnvironment(
  overrides: Partial<{
    BLOCKCHAIN_EVIDENCE_MODE: string | undefined;
    CREDENTIAL_REGISTRY_NETWORK: string | undefined;
    CREDENTIAL_REGISTRY_CHAIN_ID: string | undefined;
    CREDENTIAL_REGISTRY_RPC_URL: string | undefined;
    CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: string | undefined;
    CREDENTIAL_REGISTRY_DEPLOYMENT_ID: string | undefined;
  }> = {}
) {
  return {
    BLOCKCHAIN_EVIDENCE_MODE: 'credential_registry',
    CREDENTIAL_REGISTRY_NETWORK: BlockchainNetwork.anvil,
    CREDENTIAL_REGISTRY_CHAIN_ID: String(ANVIL_CHAIN_ID),
    CREDENTIAL_REGISTRY_RPC_URL: 'http://127.0.0.1:8545',
    CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: VALID_ADDRESS,
    CREDENTIAL_REGISTRY_DEPLOYMENT_ID: TEST_DEPLOYMENT_ID,
    ...overrides
  };
}

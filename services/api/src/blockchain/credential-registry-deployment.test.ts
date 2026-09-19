import assert from 'node:assert/strict';
import test from 'node:test';

import { BlockchainNetwork } from '@prisma/client';

import {
  ANVIL_CHAIN_ID,
  CredentialRegistryDeploymentResolver,
  MOCK_REGISTRY_CONTRACT_ADDRESS,
  deploymentMatchesBlockchainRecord,
  isMockBlockchainRecord
} from './credential-registry-deployment';

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
      network: BlockchainNetwork.anvil,
      chainId: ANVIL_CHAIN_ID,
      rpcUrl: 'http://127.0.0.1:8545',
      contractAddress: VALID_ADDRESS
    }
  });
});

test('rechaza una red distinta aunque exista configuracion global', () => {
  const result = new CredentialRegistryDeploymentResolver().resolve(
    createRecord({ network: BlockchainNetwork.base_sepolia }),
    createEnvironment()
  );

  assert.deepEqual(result, {
    kind: 'deployment_unresolved',
    reason: 'unsupported_network'
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
    network: BlockchainNetwork.anvil,
    chainId: ANVIL_CHAIN_ID,
    rpcUrl: 'http://127.0.0.1:8545',
    contractAddress: VALID_ADDRESS
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

function createEnvironment(
  overrides: Partial<{
    BLOCKCHAIN_EVIDENCE_MODE: string | undefined;
    CREDENTIAL_REGISTRY_RPC_URL: string | undefined;
    CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: string | undefined;
  }> = {}
) {
  return {
    BLOCKCHAIN_EVIDENCE_MODE: 'credential_registry_anvil',
    CREDENTIAL_REGISTRY_RPC_URL: 'http://127.0.0.1:8545',
    CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: VALID_ADDRESS,
    ...overrides
  };
}

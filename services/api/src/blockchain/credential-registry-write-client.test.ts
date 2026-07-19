import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CredentialRegistryWriteClient,
  normalizeCredentialRegistryWriteResult,
  resolveCredentialRegistryWriteConfig,
  validateCredentialRegistryPrivateKey
} from './credential-registry-write-client';

const VALID_HASH =
  '0xaf032042c1bcfb72f9caac350eb3cb576f44ab07b1c1968f4b36264da44ff2ab';
const VALID_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const VALID_FROM = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const VALID_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

test('validateCredentialRegistryPrivateKey accepts a valid private key', () => {
  assert.equal(
    validateCredentialRegistryPrivateKey(VALID_PRIVATE_KEY),
    VALID_PRIVATE_KEY
  );
});

test('validateCredentialRegistryPrivateKey rejects a missing private key', () => {
  assert.throws(
    () => validateCredentialRegistryPrivateKey(''),
    /CREDENTIAL_REGISTRY_PRIVATE_KEY/
  );
});

test('validateCredentialRegistryPrivateKey rejects an invalid private key', () => {
  assert.throws(
    () => validateCredentialRegistryPrivateKey('0x1234'),
    /64 caracteres hexadecimales/
  );
});

test('resolveCredentialRegistryWriteConfig rejects a missing private key', () => {
  assert.throws(
    () =>
      resolveCredentialRegistryWriteConfig({
        rpcUrl: 'http://127.0.0.1:8545',
        contractAddress: VALID_ADDRESS
      }),
    /CREDENTIAL_REGISTRY_PRIVATE_KEY/
  );
});

test('normalizeCredentialRegistryWriteResult maps a successful receipt', () => {
  const result = normalizeCredentialRegistryWriteResult(
    VALID_HASH,
    {
      hash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      from: VALID_FROM.toLowerCase(),
      to: VALID_ADDRESS.toLowerCase()
    },
    {
      status: 1,
      blockNumber: 12
    }
  );

  assert.deepEqual(result, {
    credentialHash: VALID_HASH,
    transactionHash:
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    from: VALID_FROM,
    to: VALID_ADDRESS,
    status: 'success',
    blockNumber: '12'
  });
});

test('normalizeCredentialRegistryWriteResult maps a failed receipt', () => {
  const result = normalizeCredentialRegistryWriteResult(
    VALID_HASH,
    {
      hash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      from: VALID_FROM,
      to: VALID_ADDRESS
    },
    {
      status: 0,
      blockNumber: 13
    }
  );

  assert.deepEqual(result, {
    credentialHash: VALID_HASH,
    transactionHash:
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    from: VALID_FROM,
    to: VALID_ADDRESS,
    status: 'failed',
    blockNumber: '13'
  });
});

test('CredentialRegistryWriteClient rejects an invalid credential hash before any network call', async () => {
  const client = new CredentialRegistryWriteClient({
    rpcUrl: 'http://127.0.0.1:8545',
    contractAddress: VALID_ADDRESS,
    privateKey: VALID_PRIVATE_KEY,
    contractWriter: {
      async registerCredential() {
        throw new Error('No deberia llegar a la red');
      },
      async revokeCredential() {
        throw new Error('No deberia llegar a la red');
      }
    }
  });

  await assert.rejects(
    () => client.registerCredential('0x1234'),
    /64 caracteres hexadecimales/
  );
});

test('CredentialRegistryWriteClient rejects a credential hash with non-hex characters before any network call', async () => {
  const client = new CredentialRegistryWriteClient({
    rpcUrl: 'http://127.0.0.1:8545',
    contractAddress: VALID_ADDRESS,
    privateKey: VALID_PRIVATE_KEY,
    contractWriter: {
      async registerCredential() {
        throw new Error('No deberia llegar a la red');
      },
      async revokeCredential() {
        throw new Error('No deberia llegar a la red');
      }
    }
  });

  await assert.rejects(
    () =>
      client.registerCredential(
        '0x11111111111111111111DcJHrrHSgvFpsYxqb6g97uaQTd2kE31rPUeDZTeDsjVq'
      ),
    /64 caracteres hexadecimales/
  );
});

test('CredentialRegistryWriteClient normalizes a successful register transaction', async () => {
  const client = new CredentialRegistryWriteClient({
    rpcUrl: 'http://127.0.0.1:8545',
    contractAddress: VALID_ADDRESS,
    privateKey: VALID_PRIVATE_KEY,
    contractWriter: {
      async registerCredential() {
        return {
          hash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
          from: VALID_FROM.toLowerCase(),
          to: VALID_ADDRESS.toLowerCase(),
          async wait() {
            return {
              status: 1,
              blockNumber: 99
            };
          }
        };
      },
      async revokeCredential() {
        throw new Error('No deberia usarse revoke en este test');
      }
    }
  });

  const result = await client.registerCredential(VALID_HASH);

  assert.deepEqual(result, {
    credentialHash: VALID_HASH,
    transactionHash:
      '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    from: VALID_FROM,
    to: VALID_ADDRESS,
    status: 'success',
    blockNumber: '99'
  });
});

test('CredentialRegistryWriteClient normalizes an unknown receipt result', async () => {
  const client = new CredentialRegistryWriteClient({
    rpcUrl: 'http://127.0.0.1:8545',
    contractAddress: VALID_ADDRESS,
    privateKey: VALID_PRIVATE_KEY,
    contractWriter: {
      async registerCredential() {
        throw new Error('No deberia usarse register en este test');
      },
      async revokeCredential() {
        return {
          hash: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
          from: VALID_FROM,
          to: VALID_ADDRESS,
          async wait() {
            return null;
          }
        };
      }
    }
  });

  const result = await client.revokeCredential(VALID_HASH);

  assert.deepEqual(result, {
    credentialHash: VALID_HASH,
    transactionHash:
      '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    from: VALID_FROM,
    to: VALID_ADDRESS,
    status: 'unknown',
    blockNumber: null
  });
});

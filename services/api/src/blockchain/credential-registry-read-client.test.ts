import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CredentialRegistryReadClient,
  normalizeCredentialRegistryStatus,
  resolveCredentialRegistryConfig,
  validateCredentialHash
} from './credential-registry-read-client';

const VALID_HASH =
  '0xaf032042c1bcfb72f9caac350eb3cb576f44ab07b1c1968f4b36264da44ff2ab';
const VALID_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

test('validateCredentialHash accepts a valid credential hash', () => {
  assert.equal(validateCredentialHash(VALID_HASH), VALID_HASH);
});

test('validateCredentialHash rejects an invalid credential hash', () => {
  assert.throws(
    () => validateCredentialHash('0x1234'),
    /64 caracteres hexadecimales/
  );
});

test('resolveCredentialRegistryConfig rejects missing rpc url', () => {
  assert.throws(
    () =>
      resolveCredentialRegistryConfig({
        contractAddress: VALID_ADDRESS
      }),
    /CREDENTIAL_REGISTRY_RPC_URL/
  );
});

test('resolveCredentialRegistryConfig rejects missing contract address', () => {
  assert.throws(
    () =>
      resolveCredentialRegistryConfig({
        rpcUrl: 'http://127.0.0.1:8545'
      }),
    /CREDENTIAL_REGISTRY_CONTRACT_ADDRESS/
  );
});

test('resolveCredentialRegistryConfig rejects an invalid contract address', () => {
  assert.throws(
    () =>
      resolveCredentialRegistryConfig({
        rpcUrl: 'http://127.0.0.1:8545',
        contractAddress: 'not-an-address'
      }),
    /direccion Ethereum valida/
  );
});

test('normalizeCredentialRegistryStatus serializes timestamps as strings', () => {
  const normalized = normalizeCredentialRegistryStatus(VALID_HASH, {
    exists: true,
    revoked: true,
    issuer: VALID_ADDRESS,
    registeredAt: 1784382395n,
    revokedAt: 1784382462n
  });

  assert.deepEqual(normalized, {
    credentialHash: VALID_HASH,
    exists: true,
    revoked: true,
    issuer: VALID_ADDRESS,
    registeredAt: '1784382395',
    revokedAt: '1784382462'
  });
});

test('normalizeCredentialRegistryStatus returns nulls for empty issuer and zero timestamps', () => {
  const normalized = normalizeCredentialRegistryStatus(VALID_HASH, [
    false,
    false,
    '0x0000000000000000000000000000000000000000',
    0n,
    0n
  ]);

  assert.deepEqual(normalized, {
    credentialHash: VALID_HASH,
    exists: false,
    revoked: false,
    issuer: null,
    registeredAt: null,
    revokedAt: null
  });
});

test('CredentialRegistryReadClient uses the normalized read-only contract output', async () => {
  const client = new CredentialRegistryReadClient({
    rpcUrl: 'http://127.0.0.1:8545',
    contractAddress: VALID_ADDRESS,
    contractReader: {
      async getCredentialStatus() {
        return {
          exists: true,
          revoked: false,
          issuer: VALID_ADDRESS.toLowerCase(),
          registeredAt: 123n,
          revokedAt: 0n
        };
      }
    }
  });

  const status = await client.getCredentialStatus(
    `0x${VALID_HASH.slice(2).toUpperCase()}`
  );

  assert.deepEqual(status, {
    credentialHash: VALID_HASH,
    exists: true,
    revoked: false,
    issuer: VALID_ADDRESS,
    registeredAt: '123',
    revokedAt: null
  });
});

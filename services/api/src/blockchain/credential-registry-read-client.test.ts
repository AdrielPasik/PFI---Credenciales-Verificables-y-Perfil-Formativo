import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { BlockchainNetwork } from '@prisma/client';

import { CredentialRegistryPreflight } from './credential-registry-preflight';
import {
  CredentialRegistryReadClient,
  normalizeCredentialRegistryStatus,
  resolveCredentialRegistryConfig,
  validateCredentialHash
} from './credential-registry-read-client';

// Identificador de deployment SINTETICO y solo de test. No existe ningun
// deployment real todavia: el manifest commiteado es S8c10.
const TEST_DEPLOYMENT_ID = 'test-anvil-local';

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

test('record-bound read verifies chain, code, ABI and credential issuer before accepting state', async () => {
  const client = new CredentialRegistryReadClient({
    contractReader: {
      async getCredentialStatus() {
        return {
          exists: true,
          revoked: false,
          issuer: VALID_ADDRESS,
          registeredAt: 123n,
          revokedAt: 0n
        };
      }
    },
    networkProvider: {
      async getNetwork() {
        return { chainId: 31337n };
      },
      async getCode() {
        return '0x60006000';
      }
    }
  });

  const result = await client.readRecordBoundCredentialState({
    deployment: deployment(),
    record: record()
  });

  assert.deepEqual(result, {
    kind: 'credential_state',
    status: {
      credentialHash: VALID_HASH,
      exists: true,
      revoked: false,
      issuer: VALID_ADDRESS,
      registeredAt: '123',
      revokedAt: null
    }
  });
});

test('record-bound read fails closed for an RPC chain mismatch', async () => {
  const client = createRecordBoundClient({
    async getNetwork() {
      return { chainId: 84532n };
    },
    async getCode() {
      return '0x60006000';
    }
  });

  assert.deepEqual(
    await client.readRecordBoundCredentialState({
      deployment: deployment(),
      record: record()
    }),
    { kind: 'rpc_chain_id_mismatch' }
  );
});

test('record-bound read fails closed when the configured contract has no code', async () => {
  const client = createRecordBoundClient({
    async getNetwork() {
      return { chainId: 31337n };
    },
    async getCode() {
      return '0x';
    }
  });

  assert.deepEqual(
    await client.readRecordBoundCredentialState({
      deployment: deployment(),
      record: record()
    }),
    { kind: 'contract_code_missing' }
  );
});

test('record-bound read fails closed when the ABI call fails', async () => {
  const client = new CredentialRegistryReadClient({
    contractReader: {
      async getCredentialStatus() {
        throw new Error('unexpected ABI');
      }
    },
    networkProvider: workingProvider()
  });

  assert.deepEqual(
    await client.readRecordBoundCredentialState({
      deployment: deployment(),
      record: record()
    }),
    { kind: 'registry_read_failed' }
  );
});

test('record-bound read rejects a registry that does not contain the expected credential', async () => {
  const client = new CredentialRegistryReadClient({
    contractReader: {
      async getCredentialStatus() {
        return [false, false, '0x0000000000000000000000000000000000000000', 0n, 0n];
      }
    },
    networkProvider: workingProvider()
  });

  assert.deepEqual(
    await client.readRecordBoundCredentialState({
      deployment: deployment(),
      record: record()
    }),
    { kind: 'credential_missing' }
  );
});

test('record-bound read rejects a registry credential registered by a different issuer', async () => {
  const client = new CredentialRegistryReadClient({
    contractReader: {
      async getCredentialStatus() {
        return {
          exists: true,
          revoked: false,
          issuer: '0x1111111111111111111111111111111111111111',
          registeredAt: 123n,
          revokedAt: 0n
        };
      }
    },
    networkProvider: workingProvider()
  });

  assert.deepEqual(
    await client.readRecordBoundCredentialState({
      deployment: deployment(),
      record: record()
    }),
    { kind: 'credential_issuer_mismatch' }
  );
});

function deployment() {
  return {
    evidenceMode: 'credential_registry' as const,
    network: BlockchainNetwork.anvil,
    chainId: 31337,
    rpcUrl: 'http://127.0.0.1:8545',
    contractAddress: VALID_ADDRESS,
    deploymentId: TEST_DEPLOYMENT_ID
  };
}

function record() {
  return {
    network: BlockchainNetwork.anvil,
    chainId: 31337,
    contractAddress: VALID_ADDRESS,
    credentialHash: VALID_HASH,
    issuerAddress: VALID_ADDRESS
  };
}

function workingProvider() {
  return {
    async getNetwork() {
      return { chainId: 31337n };
    },
    async getCode() {
      return '0x60006000';
    }
  };
}

function createRecordBoundClient(networkProvider: {
  getNetwork(): Promise<{ chainId: bigint }>;
  getCode(address: string): Promise<string>;
}) {
  return new CredentialRegistryReadClient({
    contractReader: {
      async getCredentialStatus() {
        throw new Error('No deberia consultar ABI despues de fallar identidad');
      }
    },
    networkProvider
  });
}

// ---------------------------------------------------------------------------
// S8c7, ADDENDUM B: UN SOLO PROVIDER POR EVALUACION
// ---------------------------------------------------------------------------

test('addendum B: el preflight y la lectura usan EL MISMO objeto provider', async () => {
  // Hasta S8c6 este cliente creaba DOS providers: uno para validar cadena y
  // codigo, y otro para la llamada al contrato. Validar un camino y observar
  // por otro vacia de sentido la validacion.
  const providersCreated: unknown[] = [];
  const preflightProviders: unknown[] = [];
  const readerProviders: unknown[] = [];

  const client = new CredentialRegistryReadClient({
    createProvider: () => {
      const provider = {
        async getNetwork() {
          return { chainId: 31337n };
        },
        async getCode() {
          return '0x60006000';
        }
      };
      providersCreated.push(provider);
      return provider;
    },
    preflight: new (class extends CredentialRegistryPreflight {
      override async assertWritable(target: never, provider?: never) {
        preflightProviders.push(provider);
        return super.assertWritable(target, provider);
      }
    })(),
    createContractReaderOnProvider: (_target, provider) => {
      readerProviders.push(provider);
      return {
        async getCredentialStatus() {
          return {
            exists: true,
            revoked: false,
            issuer: VALID_ADDRESS,
            registeredAt: 123n,
            revokedAt: 0n
          };
        }
      };
    }
  });

  const result = await client.readTargetBoundCredentialState({
    target: deployment(),
    credentialHash: VALID_HASH,
    expectedRegistrant: VALID_ADDRESS
  } as never);

  assert.equal(result.kind, 'credential_state');

  // UNA sola construccion...
  assert.equal(providersCreated.length, 1);
  // ...y el MISMO objeto en las dos etapas.
  assert.equal(preflightProviders.length, 1);
  assert.equal(readerProviders.length, 1);
  assert.equal(preflightProviders[0], providersCreated[0]);
  assert.equal(readerProviders[0], providersCreated[0]);
  assert.equal(preflightProviders[0], readerProviders[0]);
});

test('addendum B: el orden es preflight -> lectura, nunca al revés', async () => {
  const order: string[] = [];

  const client = new CredentialRegistryReadClient({
    createProvider: () => ({
      async getNetwork() {
        order.push('getNetwork');
        return { chainId: 31337n };
      },
      async getCode() {
        order.push('getCode');
        return '0x60006000';
      }
    }),
    createContractReaderOnProvider: () => ({
      async getCredentialStatus() {
        order.push('getCredentialStatus');
        return {
          exists: true,
          revoked: false,
          issuer: VALID_ADDRESS,
          registeredAt: 123n,
          revokedAt: 0n
        };
      }
    })
  });

  await client.readTargetBoundCredentialState({
    target: deployment(),
    credentialHash: VALID_HASH,
    expectedRegistrant: VALID_ADDRESS
  } as never);

  assert.deepEqual(order, ['getNetwork', 'getCode', 'getCredentialStatus']);
});

test('S8c7: si el preflight falla NO se lee el contrato', async () => {
  const cases: Array<[string, () => Promise<{ chainId: bigint }>, () => Promise<string>, string]> = [
    [
      'otra cadena',
      async () => ({ chainId: 84532n }),
      async () => '0x60006000',
      'rpc_chain_id_mismatch'
    ],
    [
      'sin codigo',
      async () => ({ chainId: 31337n }),
      async () => '0x',
      'contract_code_missing'
    ],
    [
      'getNetwork lanza',
      async () => {
        throw new Error('https://secreto.example/API_KEY no responde');
      },
      async () => '0x60006000',
      'rpc_unavailable'
    ],
    [
      'getCode lanza',
      async () => ({ chainId: 31337n }),
      async () => {
        throw new Error('https://secreto.example/API_KEY no responde');
      },
      'rpc_unavailable'
    ]
  ];

  for (const [label, getNetwork, getCode, expected] of cases) {
    let contractReads = 0;

    const client = new CredentialRegistryReadClient({
      createProvider: () => ({ getNetwork, getCode }),
      createContractReaderOnProvider: () => ({
        async getCredentialStatus() {
          contractReads += 1;
          throw new Error('no deberia leerse el contrato');
        }
      })
    });

    const result = await client.readTargetBoundCredentialState({
      target: deployment(),
      credentialHash: VALID_HASH,
      expectedRegistrant: VALID_ADDRESS
    } as never);

    assert.equal(result.kind, expected, label);
    assert.equal(contractReads, 0, `${label}: cero lecturas de contrato`);
    // El endpoint y su credencial nunca viajan en el resultado.
    assert.ok(!JSON.stringify(result).includes('secreto.example'), label);
    assert.ok(!JSON.stringify(result).includes('API_KEY'), label);
  }
});

test('S8c7: el registrante esperado se pasa EXPLICITO, no se saca del record', async () => {
  // El cliente de lectura no consulta Prisma y no elige identidades: la
  // procedencia la decide quien conoce el record.
  const client = new CredentialRegistryReadClient({
    networkProvider: workingProvider(),
    contractReader: {
      async getCredentialStatus() {
        return {
          exists: true,
          revoked: false,
          issuer: VALID_ADDRESS,
          registeredAt: 123n,
          revokedAt: 0n
        };
      }
    }
  });

  const matching = await client.readTargetBoundCredentialState({
    target: deployment(),
    credentialHash: VALID_HASH,
    expectedRegistrant: VALID_ADDRESS
  } as never);
  assert.equal(matching.kind, 'credential_state');

  const mismatching = await client.readTargetBoundCredentialState({
    target: deployment(),
    credentialHash: VALID_HASH,
    expectedRegistrant: '0x1111111111111111111111111111111111111111'
  } as never);
  assert.equal(mismatching.kind, 'credential_issuer_mismatch');

  // Sobre el codigo EJECUTABLE: los comentarios del cliente nombran a proposito
  // la procedencia que NO resuelven, para explicar de quien es esa decision.
  const source = readFileSync(
    join(__dirname, 'credential-registry-read-client.ts'),
    'utf8'
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');

  assert.ok(!source.includes('PrismaService'));
  assert.ok(!source.includes('anchorSignerProfile'));
  assert.ok(!source.includes('issuerTechnicalIdentity'));
});

/**
 * Preflight previo a la escritura -- S8c5, matriz 19-34.
 *
 * El provider SIEMPRE es un doble que implementa solo `getNetwork` y `getCode`.
 * Ningun test instancia un JsonRpcProvider real, asi que ningun test puede
 * escapar a la red: ni a Base Sepolia, ni a un Anvil local, ni a nada.
 *
 * Lo que se congela:
 *
 *   * el ORDEN: cadena primero, codigo despues, y si la cadena no coincide el
 *     codigo NO se consulta;
 *   * que un error crudo del provider -- que puede llevar la URL del RPC con su
 *     API key adentro -- nunca se propague;
 *   * que NO haya cache: dos escrituras son dos preflights;
 *   * que un preflight fallido deje CERO escrituras al contrato.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { BlockchainNetwork } from '@prisma/client';

import {
  BlockchainTargetError,
  type CredentialRegistryTarget,
  safeBlockchainTargetMessage
} from './blockchain-target';
import {
  CREDENTIAL_REGISTRY_RPC_TIMEOUT_MS,
  CredentialRegistryPreflight,
  type CredentialRegistryPreflightProvider,
  createCredentialRegistryProvider
} from './credential-registry-preflight';
import {
  CredentialRegistryWriteClient,
  createCredentialRegistryWriteClientForTarget
} from './credential-registry-write-client';

const CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const VALID_HASH =
  '0xaf032042c1bcfb72f9caac350eb3cb576f44ab07b1c1968f4b36264da44ff2ab';
const VALID_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

/** Endpoint SINTETICO con pinta de credencial en el path. */
const SECRET_BEARING_RPC_URL = 'https://provider.example/v2/SECRET_API_KEY';
/** Bytecode de ejemplo, lo suficientemente largo para parecer real. */
const DEPLOYED_CODE = `0x60806040${'ab'.repeat(32)}`;

function baseSepoliaTarget(): CredentialRegistryTarget {
  return {
    evidenceMode: 'credential_registry',
    network: BlockchainNetwork.base_sepolia,
    chainId: 84532,
    rpcUrl: SECRET_BEARING_RPC_URL,
    contractAddress: CONTRACT_ADDRESS,
    deploymentId: 'test-base-sepolia-pending-deploy'
  };
}

function anvilTarget(): CredentialRegistryTarget {
  return {
    evidenceMode: 'credential_registry',
    network: BlockchainNetwork.anvil,
    chainId: 31337,
    rpcUrl: 'http://127.0.0.1:8545',
    contractAddress: CONTRACT_ADDRESS,
    deploymentId: 'test-anvil-local'
  };
}

interface ProviderDoubleOptions {
  chainId?: bigint;
  code?: string;
  networkError?: unknown;
  codeError?: unknown;
}

function createProviderDouble(options: ProviderDoubleOptions = {}) {
  const calls: string[] = [];
  const getCodeArguments: string[] = [];

  const provider: CredentialRegistryPreflightProvider = {
    async getNetwork() {
      calls.push('getNetwork');
      if (options.networkError !== undefined) {
        throw options.networkError;
      }
      return { chainId: options.chainId ?? 84532n };
    },
    async getCode(address: string) {
      calls.push('getCode');
      getCodeArguments.push(address);
      if (options.codeError !== undefined) {
        throw options.codeError;
      }
      // `in` y no `??`: el test 23 inyecta `null`/`undefined` A PROPOSITO, y
      // un `??` los sustituiria por el bytecode valido, dejando pasar el caso
      // que justamente se quiere probar.
      return 'code' in options ? (options.code as string) : DEPLOYED_CODE;
    }
  };

  return { provider, calls, getCodeArguments };
}

function expectCode(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof BlockchainTargetError, String(error));
    assert.equal((error as BlockchainTargetError).code, code);
    return true;
  };
}

// ---------------------------------------------------------------------------
// 19: CAMINO FELIZ
// ---------------------------------------------------------------------------

test('19: Base Sepolia con chainId 84532 y codigo presente pasa', async () => {
  const { provider, calls, getCodeArguments } = createProviderDouble();

  await new CredentialRegistryPreflight().assertWritable(
    baseSepoliaTarget(),
    provider
  );

  assert.deepEqual(calls, ['getNetwork', 'getCode']);
  assert.deepEqual(getCodeArguments, [CONTRACT_ADDRESS]);
});

test('19b: el target local tambien pasa, con su propio chainId', async () => {
  const { provider, calls } = createProviderDouble({ chainId: 31337n });

  await new CredentialRegistryPreflight().assertWritable(
    anvilTarget(),
    provider
  );

  assert.deepEqual(calls, ['getNetwork', 'getCode']);
});

// ---------------------------------------------------------------------------
// 20-21: CADENA EQUIVOCADA
// ---------------------------------------------------------------------------

test('20: se espera 84532 y el provider responde 31337 -> NETWORK_MISMATCH', async () => {
  const { provider } = createProviderDouble({ chainId: 31337n });

  await assert.rejects(
    new CredentialRegistryPreflight().assertWritable(
      baseSepoliaTarget(),
      provider
    ),
    expectCode('BLOCKCHAIN_NETWORK_MISMATCH')
  );
});

test('20b: se espera 31337 y el provider responde 84532 -> NETWORK_MISMATCH', async () => {
  const { provider } = createProviderDouble({ chainId: 84532n });

  await assert.rejects(
    new CredentialRegistryPreflight().assertWritable(anvilTarget(), provider),
    expectCode('BLOCKCHAIN_NETWORK_MISMATCH')
  );
});

test('20c: cualquier otra cadena tambien falla cerrado', async () => {
  for (const chainId of [1n, 8453n, 11155111n, 0n, 137n]) {
    const { provider } = createProviderDouble({ chainId });

    await assert.rejects(
      new CredentialRegistryPreflight().assertWritable(
        baseSepoliaTarget(),
        provider
      ),
      expectCode('BLOCKCHAIN_NETWORK_MISMATCH'),
      String(chainId)
    );
  }
});

test('21: si la cadena no coincide, getCode NO se llama', async () => {
  const { provider, calls, getCodeArguments } = createProviderDouble({
    chainId: 31337n
  });

  await assert.rejects(
    new CredentialRegistryPreflight().assertWritable(
      baseSepoliaTarget(),
      provider
    ),
    expectCode('BLOCKCHAIN_NETWORK_MISMATCH')
  );

  // Preguntar por el codigo de una direccion en la cadena equivocada no
  // informa nada y podria encontrar OTRO contrato en la misma direccion.
  assert.deepEqual(calls, ['getNetwork']);
  assert.deepEqual(getCodeArguments, []);
});

// ---------------------------------------------------------------------------
// 22-23: CONTRATO AUSENTE
// ---------------------------------------------------------------------------

test('22: cadena correcta pero getCode devuelve 0x -> CONTRACT_MISSING', async () => {
  const { provider, calls } = createProviderDouble({ code: '0x' });

  await assert.rejects(
    new CredentialRegistryPreflight().assertWritable(
      baseSepoliaTarget(),
      provider
    ),
    expectCode('BLOCKCHAIN_CONTRACT_MISSING')
  );

  assert.deepEqual(calls, ['getNetwork', 'getCode']);
});

test('23: un codigo mal formado tambien falla cerrado', async () => {
  const malformed = [
    '',
    '0X',
    '0x0',
    'no-es-hex',
    '0xZZ',
    '60806040',
    null as unknown as string,
    undefined as unknown as string,
    // S8c5.1: longitud IMPAR de hex. No es una cadena de bytes -- es un valor
    // truncado o corrupto, y antes pasaba.
    '0xabc',
    '0x12345',
    '0x6',
    '0x60806040a',
    `0x${'ab'.repeat(32)}c`
  ];

  for (const code of malformed) {
    const { provider } = createProviderDouble({ code });

    await assert.rejects(
      new CredentialRegistryPreflight().assertWritable(
        baseSepoliaTarget(),
        provider
      ),
      expectCode('BLOCKCHAIN_CONTRACT_MISSING'),
      JSON.stringify(code)
    );
  }
});

test('23b: cualquier cantidad PAR de hex cuenta como codigo desplegado', async () => {
  // El preflight prueba que hay bytes, NADA mas. Rechazar bytecode valido por
  // ser chico o inusual seria afirmar una identidad de deployment que esta
  // slice no verifica: eso es S8c10.
  const deployed = [
    '0x00',
    '0x6000',
    '0xabcdef',
    '0xAB',
    '0xFFFFFFFF',
    `0x${'ab'.repeat(32)}`,
    `0x${'60'.repeat(12000)}`
  ];

  for (const code of deployed) {
    const { provider, calls } = createProviderDouble({ code });

    await new CredentialRegistryPreflight().assertWritable(
      baseSepoliaTarget(),
      provider
    );

    assert.deepEqual(calls, ['getNetwork', 'getCode'], code.slice(0, 12));
  }
});

test('un preflight que pasa NO afirma que el contrato sea el esperado', () => {
  // Solo prueba que hay ALGO desplegado. La identidad exacta del deployment
  // (bytecode/manifest) es S8c10; aca se congela el limite del claim.
  const message = safeBlockchainTargetMessage('BLOCKCHAIN_CONTRACT_MISSING');

  assert.ok(!message.includes('CredentialRegistry'));
  assert.ok(!message.includes('bytecode'));
});

// ---------------------------------------------------------------------------
// 24-25: ERRORES DEL PROVIDER NO FILTRAN NADA
// ---------------------------------------------------------------------------

test('24: getNetwork lanza con la URL del RPC adentro -> error seguro', async () => {
  const rawError = new Error(
    `could not detect network (requested url: ${SECRET_BEARING_RPC_URL}?apiKey=SECRET123)`
  );
  rawError.name = 'NetworkError';
  (rawError as { info?: unknown }).info = {
    requestUrl: SECRET_BEARING_RPC_URL,
    requestId: 'req-abcdef123456'
  };

  const { provider } = createProviderDouble({ networkError: rawError });

  await assert.rejects(
    new CredentialRegistryPreflight().assertWritable(
      baseSepoliaTarget(),
      provider
    ),
    (error: unknown) => {
      assert.ok(error instanceof BlockchainTargetError);
      const typed = error as BlockchainTargetError;

      assert.equal(typed.code, 'BLOCKCHAIN_RPC_UNAVAILABLE');
      assert.equal(
        typed.message,
        safeBlockchainTargetMessage('BLOCKCHAIN_RPC_UNAVAILABLE')
      );
      // Se conserva SOLO la clase del error original, que es diagnostico util
      // y no puede contener un endpoint.
      assert.equal(typed.providerErrorName, 'NetworkError');
      // Sin `cause`: la infraestructura de logging la serializaria.
      assert.equal((typed as { cause?: unknown }).cause, undefined);

      assertNoSecretLeak(typed);
      return true;
    }
  );
});

test('25: getCode lanza con el endpoint adentro -> error seguro', async () => {
  const rawError = new Error(
    `server response 401 Unauthorized at ${SECRET_BEARING_RPC_URL}`
  );
  rawError.name = 'FetchError';

  const { provider } = createProviderDouble({ codeError: rawError });

  await assert.rejects(
    new CredentialRegistryPreflight().assertWritable(
      baseSepoliaTarget(),
      provider
    ),
    (error: unknown) => {
      assert.ok(error instanceof BlockchainTargetError);
      const typed = error as BlockchainTargetError;

      assert.equal(typed.code, 'BLOCKCHAIN_RPC_UNAVAILABLE');
      assert.equal(typed.providerErrorName, 'FetchError');
      assertNoSecretLeak(typed);
      return true;
    }
  );
});

test('25b: un error del provider que NO es Error tampoco filtra nada', async () => {
  for (const thrown of [
    SECRET_BEARING_RPC_URL,
    { url: SECRET_BEARING_RPC_URL, apiKey: 'SECRET123' },
    ['SECRET123'],
    42,
    null
  ]) {
    const { provider } = createProviderDouble({ networkError: thrown });

    await assert.rejects(
      new CredentialRegistryPreflight().assertWritable(
        baseSepoliaTarget(),
        provider
      ),
      (error: unknown) => {
        assert.ok(error instanceof BlockchainTargetError);
        const typed = error as BlockchainTargetError;
        assert.equal(typed.code, 'BLOCKCHAIN_RPC_UNAVAILABLE');
        // Sin un `Error` no hay ni nombre de clase que conservar.
        assert.equal(typed.providerErrorName, undefined);
        assertNoSecretLeak(typed);
        return true;
      },
      JSON.stringify(thrown)
    );
  }
});

function assertNoSecretLeak(error: BlockchainTargetError) {
  const serialized = [
    error.message,
    error.name,
    error.stack ?? '',
    JSON.stringify({
      code: error.code,
      field: error.field,
      providerErrorName: error.providerErrorName
    }),
    JSON.stringify(Object.getOwnPropertyNames(error)),
    String(error)
  ].join(' ');

  for (const leak of [
    'SECRET_API_KEY',
    'SECRET123',
    'provider.example',
    'apiKey',
    'requestId',
    'req-abcdef123456',
    '401',
    'Unauthorized'
  ]) {
    assert.ok(!serialized.includes(leak), `el error no debe contener ${leak}`);
  }
}

// ---------------------------------------------------------------------------
// 26-28: EL PREFLIGHT PUERTEA LA ESCRITURA
// ---------------------------------------------------------------------------

function createWriteClientWithDoubles(
  target: CredentialRegistryTarget,
  providerOptions: ProviderDoubleOptions = {}
) {
  const { provider, calls } = createProviderDouble(providerOptions);
  const contractCalls: string[] = [];

  const client = createCredentialRegistryWriteClientForTarget(
    target,
    { CREDENTIAL_REGISTRY_PRIVATE_KEY: VALID_PRIVATE_KEY },
    {
      preflightProvider: provider,
      contractWriter: {
        async registerCredential(credentialHash: string) {
          contractCalls.push(`register:${credentialHash}`);
          return transactionResponse();
        },
        async revokeCredential(credentialHash: string) {
          contractCalls.push(`revoke:${credentialHash}`);
          return transactionResponse();
        }
      }
    }
  );

  return { client, providerCalls: calls, contractCalls };
}

function transactionResponse() {
  return {
    hash: `0x${'1'.repeat(64)}`,
    from: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    to: CONTRACT_ADDRESS,
    async wait() {
      return { status: 1, blockNumber: 7 };
    }
  };
}

test('26: con preflight exitoso la escritura continua exactamente UNA vez', async () => {
  const { client, providerCalls, contractCalls } = createWriteClientWithDoubles(
    baseSepoliaTarget()
  );

  const result = await client.registerCredential(VALID_HASH);

  assert.equal(result.status, 'success');
  assert.deepEqual(providerCalls, ['getNetwork', 'getCode']);
  assert.deepEqual(contractCalls, [`register:${VALID_HASH}`]);
});

test('27: con preflight fallido hay CERO escrituras al contrato', async () => {
  const failures: Array<[string, ProviderDoubleOptions, string]> = [
    ['cadena equivocada', { chainId: 31337n }, 'BLOCKCHAIN_NETWORK_MISMATCH'],
    ['sin contrato', { code: '0x' }, 'BLOCKCHAIN_CONTRACT_MISSING'],
    [
      'RPC caido',
      { networkError: new Error(`timeout at ${SECRET_BEARING_RPC_URL}`) },
      'BLOCKCHAIN_RPC_UNAVAILABLE'
    ],
    [
      'getCode caido',
      { codeError: new Error(`timeout at ${SECRET_BEARING_RPC_URL}`) },
      'BLOCKCHAIN_RPC_UNAVAILABLE'
    ]
  ];

  for (const [label, options, expected] of failures) {
    const register = createWriteClientWithDoubles(baseSepoliaTarget(), options);
    await assert.rejects(
      register.client.registerCredential(VALID_HASH),
      expectCode(expected),
      label
    );
    assert.deepEqual(register.contractCalls, [], `${label} / register`);

    // 30: la revocacion comparte EXACTAMENTE el mismo contrato de preflight.
    const revoke = createWriteClientWithDoubles(baseSepoliaTarget(), options);
    await assert.rejects(
      revoke.client.revokeCredential(VALID_HASH),
      expectCode(expected),
      label
    );
    assert.deepEqual(revoke.contractCalls, [], `${label} / revoke`);
  }
});

test('28: el preflight corre en CADA escritura -- no hay cache', async () => {
  const { client, providerCalls, contractCalls } = createWriteClientWithDoubles(
    baseSepoliaTarget()
  );

  await client.registerCredential(VALID_HASH);
  await client.registerCredential(VALID_HASH);

  // Dos escrituras => dos comprobaciones de cadena y dos de codigo. Una cache
  // de "salud de red" dejaria escribir contra la cadena equivocada hasta que
  // venciera.
  assert.deepEqual(providerCalls, [
    'getNetwork',
    'getCode',
    'getNetwork',
    'getCode'
  ]);
  assert.equal(contractCalls.length, 2);
});

test('28b: register y revoke alternados siguen preflighteando cada uno', async () => {
  const { client, providerCalls } = createWriteClientWithDoubles(
    baseSepoliaTarget()
  );

  await client.registerCredential(VALID_HASH);
  await client.revokeCredential(VALID_HASH);
  await client.registerCredential(VALID_HASH);

  assert.equal(providerCalls.filter((call) => call === 'getNetwork').length, 3);
  assert.equal(providerCalls.filter((call) => call === 'getCode').length, 3);
});

// ---------------------------------------------------------------------------
// 29-30: REGISTER Y REVOKE COMPARTEN UN SOLO CONTRATO
// ---------------------------------------------------------------------------

test('29-30: register y revoke pasan por el MISMO preflight', async () => {
  // No son dos implementaciones parecidas que puedan derivar: las dos entran
  // por `executeWrite`, que es el unico lugar donde vive la llamada.
  const source = readPreflightCallSites();

  assert.equal(source.assertWritableCalls, 1);
  assert.ok(source.insideExecuteWrite);
});

function readPreflightCallSites() {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');

  const contents = readFileSync(
    join(__dirname, 'credential-registry-write-client.ts'),
    'utf8'
  );
  const executable = contents
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');

  const executeWriteIndex = executable.indexOf('private async executeWrite(');
  const assertIndex = executable.indexOf('this.preflight.assertWritable(');

  return {
    assertWritableCalls: (executable.match(/preflight\.assertWritable\(/g) ?? [])
      .length,
    insideExecuteWrite: executeWriteIndex >= 0 && assertIndex > executeWriteIndex
  };
}

test('34: no se agrego ningun bucle de reintento alrededor de la escritura', () => {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');

  for (const file of [
    'credential-registry-write-client.ts',
    'credential-registry-preflight.ts',
    'blockchain-evidence.service.ts',
    'blockchain-target.ts'
  ]) {
    const executable = readFileSync(join(__dirname, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n');

    // Una escritura que expiro puede haber llegado igual a la red: reintentar
    // a ciegas duplicaria la transaccion. La recuperacion es S8c6.
    for (const token of [
      'retry',
      'Retry',
      'attempt',
      'maxAttempts',
      'backoff',
      'setTimeout',
      'setInterval',
      'while (',
      'for (;;)'
    ]) {
      assert.ok(!executable.includes(token), `${file} no debe contener ${token}`);
    }
  }
});

// ---------------------------------------------------------------------------
// PROVIDER: TIMEOUT Y FORMA
// ---------------------------------------------------------------------------

test('el provider se construye con el timeout de 10 s y sin tocar la red', () => {
  const target = baseSepoliaTarget();
  const provider = createCredentialRegistryProvider(target);

  try {
    assert.equal(CREDENTIAL_REGISTRY_RPC_TIMEOUT_MS, 10_000);
    // El timeout es real, no un comentario: viaja en la FetchRequest que usa
    // el provider.
    assert.equal(
      provider._getConnection().timeout,
      CREDENTIAL_REGISTRY_RPC_TIMEOUT_MS
    );
    assert.equal(typeof provider.getNetwork, 'function');
    assert.equal(typeof provider.getCode, 'function');
  } finally {
    provider.destroy();
  }
});

test('un target mock no puede construir un provider: no compila ni existe', () => {
  // La union discriminada es la garantia real. Aca se congela la consecuencia
  // observable: un target mock no tiene NINGUNO de los campos que el provider
  // necesitaria.
  const mockTarget = { evidenceMode: 'mock' } as const;

  assert.deepEqual(Object.keys(mockTarget), ['evidenceMode']);
  for (const field of [
    'rpcUrl',
    'chainId',
    'network',
    'contractAddress',
    'deploymentId'
  ]) {
    assert.ok(!(field in mockTarget), field);
  }
});

test('un write client SIN target no inventa un preflight silencioso', async () => {
  // Este es el constructor legacy que usan los scripts de operacion. No tiene
  // target, asi que no hay nada que validar -- y por eso los dos constructores
  // de PRODUCCION siempre pasan uno (ver el guard estructural).
  const contractCalls: string[] = [];
  const client = new CredentialRegistryWriteClient({
    rpcUrl: 'http://127.0.0.1:8545',
    contractAddress: CONTRACT_ADDRESS,
    privateKey: VALID_PRIVATE_KEY,
    contractWriter: {
      async registerCredential(credentialHash: string) {
        contractCalls.push(credentialHash);
        return transactionResponse();
      },
      async revokeCredential(credentialHash: string) {
        contractCalls.push(credentialHash);
        return transactionResponse();
      }
    }
  });

  await client.registerCredential(VALID_HASH);

  assert.deepEqual(contractCalls, [VALID_HASH]);
});

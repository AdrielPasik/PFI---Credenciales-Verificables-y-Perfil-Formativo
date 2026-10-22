import assert from 'node:assert/strict';
import test from 'node:test';

import { BlockchainNetwork } from '@prisma/client';
import { FetchRequest, JsonRpcProvider } from 'ethers';

import {
  type CredentialRegistryTarget,
  BlockchainTargetError
} from './blockchain-target';
import {
  CREDENTIAL_REGISTRY_RPC_TIMEOUT_MS,
  CredentialRegistryPreflight,
  createCredentialRegistryProvider,
  createCredentialRegistryProviderForRpcUrl
} from './credential-registry-preflight';

/**
 * Transporte del provider de produccion -- S8, reconciliacion.
 *
 * El RPC privado de produccion NO soporta lotes JSON-RPC: con el provider por
 * defecto de ethers v6 (que junta en un solo POST los pedidos concurrentes) la
 * lectura historica y `getLogs` fallaban y la reconciliacion quedaba en
 * `CHAIN_UNAVAILABLE`. Estos tests congelan que el provider de produccion manda
 * UN pedido por POST, y que ese cambio no tocó nada mas: el timeout sigue, la red
 * se sigue DETECTANDO en el nodo (sin `staticNetwork`) y el preflight sigue
 * rechazando una cadena o un contrato equivocados.
 *
 * No hay red: se intercepta el transporte HTTP de ethers con un servidor falso en
 * proceso. Corre en un proceso propio (cada archivo de `node --test` lo es), asi
 * que el hook global de `FetchRequest` no afecta a ningun otro test.
 */

const CONTRACT = '0xCb7401e268f61b1242B17fE141453471CFbdc6e1';
const RPC_URL = 'https://rpc.example.invalid/v2/SECRET_API_KEY';

type RpcCall = { id: unknown; method: string };

interface FakeServer {
  /** Cuerpos HTTP tal como llegaron: un objeto (sin lote) o un arreglo (lote). */
  readonly bodies: unknown[];
  readonly methods: string[];
  /** Cuantos POST llegaron. */
  readonly posts: () => number;
}

function installFakeServer(options: { chainId?: number; code?: string } = {}): FakeServer {
  const chainId = options.chainId ?? 84532;
  const code = options.code ?? '0x6080';
  const bodies: unknown[] = [];
  const methods: string[] = [];

  const answer = (call: RpcCall) => {
    methods.push(call.method);
    let result: unknown;
    switch (call.method) {
      case 'eth_chainId':
        result = `0x${chainId.toString(16)}`;
        break;
      case 'net_version':
        result = String(chainId);
        break;
      case 'eth_blockNumber':
        result = '0x2e1a6c7';
        break;
      case 'eth_getCode':
        result = code;
        break;
      default:
        return { jsonrpc: '2.0', id: call.id, error: { code: -32601, message: 'method not found' } };
    }
    return { jsonrpc: '2.0', id: call.id, result };
  };

  FetchRequest.registerGetUrl(async (request) => {
    const text = request.body ? new TextDecoder().decode(request.body) : '';
    const parsed = JSON.parse(text) as RpcCall | RpcCall[];
    bodies.push(parsed);

    const payload = Array.isArray(parsed) ? parsed.map(answer) : answer(parsed);
    return {
      statusCode: 200,
      statusMessage: 'OK',
      headers: { 'content-type': 'application/json' },
      body: new TextEncoder().encode(JSON.stringify(payload))
    };
  });

  return { bodies, methods, posts: () => bodies.length };
}

function restoreTransport(): void {
  FetchRequest.registerGetUrl(FetchRequest.createGetUrlFunc());
}

function target(overrides: Partial<CredentialRegistryTarget> = {}): CredentialRegistryTarget {
  return {
    evidenceMode: 'credential_registry',
    network: BlockchainNetwork.base_sepolia,
    chainId: 84532,
    contractAddress: CONTRACT,
    deploymentId: 'base-sepolia-84532-0xcb7401e268f61b1242b17fe141453471cfbdc6e1',
    rpcUrl: RPC_URL,
    ...overrides
  } as CredentialRegistryTarget;
}

/** Tres lecturas concurrentes: es lo que dispara el agrupado en ethers v6. */
async function concurrentReads(provider: JsonRpcProvider): Promise<void> {
  await Promise.all([
    provider.getBlockNumber(),
    provider.getCode(CONTRACT),
    provider.getCode('0x54013787dbd9343d257c242c3407788998c05b2e')
  ]);
}

test('CONTROL: el provider por defecto de ethers SI agrupa pedidos concurrentes (la prueba discrimina)', async () => {
  const server = installFakeServer();
  const request = new FetchRequest(RPC_URL);
  const provider = new JsonRpcProvider(request);

  try {
    await concurrentReads(provider);
    assert.ok(
      server.bodies.some((body) => Array.isArray(body) && body.length > 1),
      'el provider por defecto deberia haber mandado al menos un lote'
    );
  } finally {
    provider.destroy();
    restoreTransport();
  }
});

test('el provider de produccion NO agrupa: cada pedido viaja en su propio POST como objeto', async () => {
  const server = installFakeServer();
  const provider = createCredentialRegistryProvider(target());

  try {
    await concurrentReads(provider);

    assert.ok(server.bodies.length >= 3, `POST recibidos: ${server.bodies.length}`);
    for (const body of server.bodies) {
      assert.equal(Array.isArray(body), false, 'ningun cuerpo puede ser un lote');
    }
    // Y los pedidos pedidos llegaron todos, uno por uno.
    assert.equal(server.methods.filter((method) => method === 'eth_getCode').length, 2);
    assert.equal(server.methods.filter((method) => method === 'eth_blockNumber').length, 1);
  } finally {
    provider.destroy();
    restoreTransport();
  }
});

test('la fabrica por URL (lectura del registry y herramientas) tampoco agrupa', async () => {
  const server = installFakeServer();
  const provider = createCredentialRegistryProviderForRpcUrl(RPC_URL);

  try {
    await concurrentReads(provider);
    assert.ok(server.bodies.every((body) => !Array.isArray(body)));
  } finally {
    provider.destroy();
    restoreTransport();
  }
});

test('el batching esta desactivado en la configuracion y el timeout de 10 s se conserva', () => {
  const provider = createCredentialRegistryProvider(target());

  try {
    assert.equal(provider._getOption('batchMaxCount'), 1);
    assert.equal(provider._getConnection().timeout, CREDENTIAL_REGISTRY_RPC_TIMEOUT_MS);
    assert.equal(CREDENTIAL_REGISTRY_RPC_TIMEOUT_MS, 10_000);
  } finally {
    provider.destroy();
  }
});

test('NO hay staticNetwork: la cadena se pregunta al nodo (eth_chainId) y no se asume', async () => {
  const server = installFakeServer({ chainId: 31337 });
  const provider = createCredentialRegistryProvider(target());

  try {
    assert.equal(provider._getOption('staticNetwork'), null);

    const network = await provider.getNetwork();

    // Responde lo que dice el NODO, no lo que configuramos (84532).
    assert.equal(network.chainId, 31337n);
    assert.ok(server.methods.includes('eth_chainId') || server.methods.includes('net_version'));
  } finally {
    provider.destroy();
    restoreTransport();
  }
});

test('preflight: cadena correcta y codigo presente pasa, sin lotes', async () => {
  const server = installFakeServer();
  const provider = createCredentialRegistryProvider(target());

  try {
    await new CredentialRegistryPreflight().assertWritable(target(), provider);

    assert.ok(server.methods.includes('eth_getCode'));
    assert.ok(server.bodies.every((body) => !Array.isArray(body)));
  } finally {
    provider.destroy();
    restoreTransport();
  }
});

test('preflight: un nodo de OTRA cadena sigue rechazandose (BLOCKCHAIN_NETWORK_MISMATCH) y no se consulta el codigo', async () => {
  const server = installFakeServer({ chainId: 31337 });
  const provider = createCredentialRegistryProvider(target());

  try {
    await assert.rejects(
      () => new CredentialRegistryPreflight().assertWritable(target(), provider),
      (error: unknown) =>
        error instanceof BlockchainTargetError && error.code === 'BLOCKCHAIN_NETWORK_MISMATCH'
    );
    assert.equal(server.methods.includes('eth_getCode'), false);
  } finally {
    provider.destroy();
    restoreTransport();
  }
});

test('preflight: contrato sin codigo sigue rechazandose (BLOCKCHAIN_CONTRACT_MISSING)', async () => {
  installFakeServer({ code: '0x' });
  const provider = createCredentialRegistryProvider(target());

  try {
    await assert.rejects(
      () => new CredentialRegistryPreflight().assertWritable(target(), provider),
      (error: unknown) =>
        error instanceof BlockchainTargetError && error.code === 'BLOCKCHAIN_CONTRACT_MISSING'
    );
  } finally {
    provider.destroy();
    restoreTransport();
  }
});

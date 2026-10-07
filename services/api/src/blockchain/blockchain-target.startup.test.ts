/**
 * Arranque y procedencia del target -- S8c5, items 35-42.
 *
 * Dos cosas distintas que S8b separo a proposito:
 *
 *   ARRANQUE   validacion de FORMA, puramente LOCAL. No llama a getNetwork, no
 *              llama a getCode, no abre un socket y no lee SSM.
 *   PREFLIGHT  validacion de RED, inmediatamente antes de cada escritura.
 *
 * Este archivo congela el primero: el AppModule arranca en modo mock sin
 * ninguna variable del registry, y no se construye ningun provider.
 *
 * Para probarlo de verdad se intercepta la construccion de sockets del proceso
 * (`net.Socket.prototype.connect`) y la `fetch` global: si el arranque abriera
 * una conexion, el test lo registra. No alcanza con un comentario.
 */

import assert from 'node:assert/strict';
import { connect as tlsConnect } from 'node:tls';
import { Socket } from 'node:net';
import test from 'node:test';

import { BlockchainNetwork } from '@prisma/client';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { BlockchainEvidenceService } from './blockchain-evidence.service';
import { BlockchainModule } from './blockchain.module';
import {
  BlockchainTargetError,
  type BlockchainTargetEnvironment,
  isCredentialRegistryTarget,
  resolveBlockchainTarget,
  tryResolveBlockchainTarget
} from './blockchain-target';
import { CredentialRegistryDeploymentResolver } from './credential-registry-deployment';
import { CredentialRegistryPreflight } from './credential-registry-preflight';

const CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

/** Todas las variables del registry, para borrarlas del entorno. */
const REGISTRY_ENVIRONMENT_KEYS = [
  'BLOCKCHAIN_EVIDENCE_MODE',
  'CREDENTIAL_REGISTRY_NETWORK',
  'CREDENTIAL_REGISTRY_CHAIN_ID',
  'CREDENTIAL_REGISTRY_RPC_URL',
  'CREDENTIAL_REGISTRY_CONTRACT_ADDRESS',
  'CREDENTIAL_REGISTRY_DEPLOYMENT_ID',
  'CREDENTIAL_REGISTRY_PRIVATE_KEY'
] as const;

async function withoutRegistryEnvironment(run: () => Promise<void>) {
  const saved = new Map<string, string | undefined>();

  for (const key of REGISTRY_ENVIRONMENT_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }

  try {
    await run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

/**
 * Observa CUALQUIER intento de salida a red del proceso durante `run`.
 *
 * Es una red de seguridad real: cubre a ethers, a `fetch`, y a cualquier cosa
 * que termine en un socket TCP o TLS.
 */
async function recordingNetworkAttempts(
  run: () => Promise<void>
): Promise<string[]> {
  const attempts: string[] = [];

  const originalConnect = Socket.prototype.connect;
  const originalFetch = globalThis.fetch;

  Socket.prototype.connect = function patchedConnect(
    this: Socket,
    ...args: unknown[]
  ) {
    attempts.push(`socket:${JSON.stringify(args[0] ?? null)}`);
    return originalConnect.apply(this, args as never);
  } as typeof Socket.prototype.connect;

  globalThis.fetch = (async (...args: unknown[]) => {
    attempts.push(`fetch:${String(args[0])}`);
    throw new Error('el arranque no debe hacer requests HTTP');
  }) as typeof fetch;

  try {
    await run();
  } finally {
    Socket.prototype.connect = originalConnect;
    globalThis.fetch = originalFetch;
  }

  return attempts;
}

// ---------------------------------------------------------------------------
// 38-39: ARRANQUE EN MODO MOCK
// ---------------------------------------------------------------------------

test('38: el AppModule arranca en mock SIN ninguna variable del registry', async () => {
  await withoutRegistryEnvironment(async () => {
    const applicationContext = await NestFactory.createApplicationContext(
      AppModule,
      { abortOnError: false, logger: false }
    );

    try {
      // Los proveedores del plano de blockchain se resuelven igual: registrar
      // el modulo no exige configuracion real.
      const scope = applicationContext.select(BlockchainModule);
      assert.ok(scope.get(BlockchainEvidenceService));
      assert.ok(scope.get(CredentialRegistryPreflight));
      assert.ok(scope.get(CredentialRegistryDeploymentResolver));

      // Y el target que el proceso resolveria AHORA es mock.
      const target = resolveBlockchainTarget(process.env);
      assert.deepEqual(target, { evidenceMode: 'mock' });
    } finally {
      await applicationContext.close();
    }
  });
});

test('39: el arranque no abre ninguna conexion de red de blockchain', async () => {
  await withoutRegistryEnvironment(async () => {
    const attempts = await recordingNetworkAttempts(async () => {
      const applicationContext = await NestFactory.createApplicationContext(
        AppModule,
        { abortOnError: false, logger: false }
      );
      await applicationContext.close();
    });

    // La resolucion de configuracion es LOCAL: no hay getNetwork, no hay
    // getCode y no hay socket al endpoint del RPC.
    const blockchainAttempts = attempts.filter(
      (attempt) =>
        attempt.includes('8545') ||
        attempt.toLowerCase().includes('rpc') ||
        attempt.includes('84532')
    );
    assert.deepEqual(blockchainAttempts, []);
  });
});

// ---------------------------------------------------------------------------
// 40-42: VALIDACION DE FORMA, SIN RED
// ---------------------------------------------------------------------------

test('40: un target Base Sepolia valido se acepta sin ninguna llamada de red', async () => {
  const environment: BlockchainTargetEnvironment = {
    BLOCKCHAIN_EVIDENCE_MODE: 'credential_registry',
    CREDENTIAL_REGISTRY_NETWORK: BlockchainNetwork.base_sepolia,
    CREDENTIAL_REGISTRY_CHAIN_ID: '84532',
    CREDENTIAL_REGISTRY_RPC_URL: 'https://provider.example/v2/TEST_KEY',
    CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: CONTRACT_ADDRESS,
    CREDENTIAL_REGISTRY_DEPLOYMENT_ID: 'test-base-sepolia-pending-deploy'
  };

  const attempts = await recordingNetworkAttempts(async () => {
    const target = resolveBlockchainTarget(environment);

    assert.ok(isCredentialRegistryTarget(target));
    if (!isCredentialRegistryTarget(target)) {
      return;
    }
    assert.equal(target.network, BlockchainNetwork.base_sepolia);
    assert.equal(target.chainId, 84532);
  });

  assert.deepEqual(attempts, [], 'resolver el target no toca la red');
});

test('41: un modo real incompleto falla en la validacion LOCAL', async () => {
  const incomplete: Array<[string, BlockchainTargetEnvironment]> = [
    ['solo el modo', { BLOCKCHAIN_EVIDENCE_MODE: 'credential_registry' }],
    [
      'sin chainId',
      {
        BLOCKCHAIN_EVIDENCE_MODE: 'credential_registry',
        CREDENTIAL_REGISTRY_NETWORK: BlockchainNetwork.base_sepolia,
        CREDENTIAL_REGISTRY_RPC_URL: 'https://provider.example/v2/K',
        CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: CONTRACT_ADDRESS,
        CREDENTIAL_REGISTRY_DEPLOYMENT_ID: 'test-id'
      }
    ],
    [
      'sin deploymentId',
      {
        BLOCKCHAIN_EVIDENCE_MODE: 'credential_registry',
        CREDENTIAL_REGISTRY_NETWORK: BlockchainNetwork.base_sepolia,
        CREDENTIAL_REGISTRY_CHAIN_ID: '84532',
        CREDENTIAL_REGISTRY_RPC_URL: 'https://provider.example/v2/K',
        CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: CONTRACT_ADDRESS
      }
    ],
    [
      'sin contrato',
      {
        BLOCKCHAIN_EVIDENCE_MODE: 'credential_registry',
        CREDENTIAL_REGISTRY_NETWORK: BlockchainNetwork.base_sepolia,
        CREDENTIAL_REGISTRY_CHAIN_ID: '84532',
        CREDENTIAL_REGISTRY_RPC_URL: 'https://provider.example/v2/K',
        CREDENTIAL_REGISTRY_DEPLOYMENT_ID: 'test-id'
      }
    ]
  ];

  const attempts = await recordingNetworkAttempts(async () => {
    for (const [label, environment] of incomplete) {
      assert.throws(
        () => resolveBlockchainTarget(environment),
        (error: unknown) => {
          assert.ok(error instanceof BlockchainTargetError, label);
          assert.equal(
            (error as BlockchainTargetError).code,
            'BLOCKCHAIN_TARGET_CONFIG_INVALID',
            label
          );
          return true;
        },
        label
      );
    }
  });

  // 42: falla ANTES de cualquier actividad de red.
  assert.deepEqual(attempts, []);
});

test('42: un target mal formado nunca llega a construir un provider', async () => {
  const malformed: BlockchainTargetEnvironment = {
    BLOCKCHAIN_EVIDENCE_MODE: 'credential_registry',
    CREDENTIAL_REGISTRY_NETWORK: BlockchainNetwork.base_sepolia,
    CREDENTIAL_REGISTRY_CHAIN_ID: '31337',
    CREDENTIAL_REGISTRY_RPC_URL: 'https://provider.example/v2/TEST_KEY',
    CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: CONTRACT_ADDRESS,
    CREDENTIAL_REGISTRY_DEPLOYMENT_ID: 'test-id'
  };

  const resolution = tryResolveBlockchainTarget(malformed);

  assert.equal(resolution.ok, false);
  if (resolution.ok) {
    return;
  }

  // El preflight necesita un `CredentialRegistryTarget`, y aca no hay ninguno:
  // la contradiccion red/chainId se detecta en la capa de configuracion, asi
  // que el tipo del preflight nunca llega a existir.
  assert.equal(resolution.field, 'CREDENTIAL_REGISTRY_CHAIN_ID');
});

test('la resolucion de configuracion no importa ninguna utilidad de red', () => {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');

  const source = readFileSync(join(__dirname, 'blockchain-target.ts'), 'utf8');

  // De ethers solo se usan primitivas de direccion: ninguna de provider.
  const match = /import \{([^}]*)\} from 'ethers';/.exec(source);
  assert.ok(match, 'no se encontro el import de ethers');
  assert.deepEqual(
    match[1]
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
    ['ZeroAddress', 'getAddress', 'isAddress']
  );

  for (const token of [
    'JsonRpcProvider',
    'FetchRequest',
    'getNetwork',
    'getCode',
    'fetch(',
    'http.request'
  ]) {
    assert.ok(!source.includes(token), `blockchain-target.ts no debe usar ${token}`);
  }

  // `tls.connect` se importa SOLO aca, en el test, para no dejarlo sin usar.
  assert.equal(typeof tlsConnect, 'function');
});

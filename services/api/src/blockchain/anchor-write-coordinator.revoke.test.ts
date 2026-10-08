/**
 * REGISTRAR Y REVOCAR COMPARTEN CARRIL -- S8c8, items 66-76.
 *
 * La concurrencia se prueba con barreras de Promesas, sin `sleep` real. El
 * provider siempre es un doble: ningun test construye un JsonRpcProvider, no
 * hay Anvil, no hay Base Sepolia y no hay transaccion.
 *
 * Lo que se congela: una registracion y una revocacion firmadas por la MISMA
 * cuenta consumen el MISMO stream de nonces, asi que tienen que serializar
 * entre si -- y el cerrojo de ambiguedad de S8c6.1 cruza las dos operaciones.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { BlockchainNetwork } from '@prisma/client';
import { Wallet } from 'ethers';

import {
  type AnchorChainProvider,
  type AnchorSignerSnapshot,
  AnchorWriteCoordinator,
  AnchorWriteError
} from './anchor-write-coordinator';
import {
  BlockchainTargetError,
  type CredentialRegistryTarget
} from './blockchain-target';
import {
  CREDENTIAL_REGISTERED_TOPIC,
  CREDENTIAL_REVOKED_TOPIC,
  type CredentialRegistryLog
} from './credential-registry-events';
import { CredentialRegistryPreflight } from './credential-registry-preflight';
import {
  PUBLIC_TEST_KEY_ONE,
  PUBLIC_TEST_KEY_TWO
} from '../signing/__fixtures__/signer-test-keys';

const CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const VALID_HASH =
  '0xaf032042c1bcfb72f9caac350eb3cb576f44ab07b1c1968f4b36264da44ff2ab';
const TX_HASH = `0x${'1'.repeat(64)}`;
const BLOCK_NUMBER = 4242;
const BLOCK_TIMESTAMP_SECONDS = 1_775_000_000;
const DEPLOYED_CODE = `0x60806040${'ab'.repeat(32)}`;

function target(): CredentialRegistryTarget {
  return {
    evidenceMode: 'credential_registry',
    network: BlockchainNetwork.base_sepolia,
    chainId: 84532,
    rpcUrl: 'https://provider.example/v2/SECRET_API_KEY',
    contractAddress: CONTRACT_ADDRESS,
    deploymentId: 'test-base-sepolia-pending-deploy'
  };
}

function anchorSigner(key = PUBLIC_TEST_KEY_ONE, profileId = 'anchor-1') {
  const wallet = new Wallet(key.privateKey);

  return {
    profileId,
    keyVersion: 1,
    address: wallet.address,
    wallet
  } satisfies AnchorSignerSnapshot;
}

function eventLog(topic: string, registrant: string): CredentialRegistryLog {
  return {
    address: CONTRACT_ADDRESS,
    topics: [
      topic,
      VALID_HASH.toLowerCase(),
      `0x${'0'.repeat(24)}${registrant.slice(2).toLowerCase()}`
    ],
    data: `0x${BLOCK_TIMESTAMP_SECONDS.toString(16).padStart(64, '0')}`,
    transactionHash: TX_HASH,
    blockNumber: BLOCK_NUMBER
  };
}

interface WorldOptions {
  chainId?: bigint;
  sendError?: unknown;
  waitError?: unknown;
  /** Se ejecuta dentro del envio, para barreras. */
  beforeSend?: (operation: 'register' | 'revoke') => Promise<void>;
}

function createWorld(options: WorldOptions = {}) {
  const sends: Array<'register' | 'revoke'> = [];
  const calls: string[] = [];
  const providersCreated: AnchorChainProvider[] = [];
  const gateProviders: unknown[] = [];

  const createProvider = (chainTarget: CredentialRegistryTarget) => {
    const provider: AnchorChainProvider = {
      async getNetwork() {
        calls.push('getNetwork');
        return { chainId: options.chainId ?? BigInt(chainTarget.chainId) };
      },
      async getCode() {
        calls.push('getCode');
        return DEPLOYED_CODE;
      },
      async getBlock() {
        calls.push('getBlock');
        return { timestamp: BigInt(BLOCK_TIMESTAMP_SECONDS) };
      }
    };

    providersCreated.push(provider);
    return provider;
  };

  const createWriter = (input: {
    signer: { getAddress(): Promise<string> };
  }) => {
    const send = async (operation: 'register' | 'revoke') => {
      const from = await input.signer.getAddress();

      if (options.beforeSend) {
        await options.beforeSend(operation);
      }

      calls.push(`send:${operation}`);
      sends.push(operation);

      if (options.sendError !== undefined) {
        throw options.sendError;
      }

      return {
        hash: TX_HASH,
        async wait() {
          calls.push('wait');

          if (options.waitError !== undefined) {
            throw options.waitError;
          }

          return {
            status: 1,
            hash: TX_HASH,
            blockNumber: BLOCK_NUMBER,
            from,
            to: CONTRACT_ADDRESS,
            logs: [
              eventLog(
                operation === 'register'
                  ? CREDENTIAL_REGISTERED_TOPIC
                  : CREDENTIAL_REVOKED_TOPIC,
                from
              )
            ]
          };
        }
      };
    };

    return {
      registerCredential: () => send('register'),
      revokeCredential: () => send('revoke')
    };
  };

  const coordinator = new AnchorWriteCoordinator(
    new CredentialRegistryPreflight(),
    { createProvider, createWriter: createWriter as never }
  );

  return { coordinator, sends, calls, providersCreated, gateProviders };
}

function deferred() {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release: () => release() };
}

function expectAnchorCode(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof AnchorWriteError, String(error));
    assert.equal((error as AnchorWriteError).code, code);
    return true;
  };
}

// ---------------------------------------------------------------------------
// EL CAMINO FELIZ DE LA REVOCACION
// ---------------------------------------------------------------------------

test('una revocacion exitosa exige el evento CredentialRevoked', async () => {
  const world = createWorld();

  const outcome = await world.coordinator.revokeCredentialHash({
    target: target(),
    signer: anchorSigner(),
    credentialHash: VALID_HASH
  });

  assert.equal(outcome.kind, 'revoked');
  assert.deepEqual(world.sends, ['revoke']);

  // El preflight corre antes del envio, sobre el MISMO provider.
  assert.deepEqual(world.calls, [
    'getNetwork',
    'getCode',
    'send:revoke',
    'wait',
    'getBlock'
  ]);
  assert.equal(world.providersCreated.length, 1);
});

test('un receipt de revocacion con el evento de REGISTRACION se rechaza', async () => {
  // Aceptar cualquiera de los dos eventos dejaria pasar un receipt que no
  // describe la operacion que se pidio.
  const world = createWorld();
  const signer = anchorSigner();

  const coordinator = new AnchorWriteCoordinator(
    new CredentialRegistryPreflight(),
    {
      createProvider: () =>
        ({
          async getNetwork() {
            return { chainId: 84532n };
          },
          async getCode() {
            return DEPLOYED_CODE;
          },
          async getBlock() {
            return { timestamp: BigInt(BLOCK_TIMESTAMP_SECONDS) };
          }
        }) as never,
      createWriter: () =>
        ({
          async revokeCredential() {
            return {
              hash: TX_HASH,
              async wait() {
                return {
                  status: 1,
                  hash: TX_HASH,
                  blockNumber: BLOCK_NUMBER,
                  from: signer.address,
                  to: CONTRACT_ADDRESS,
                  // Evento EQUIVOCADO.
                  logs: [
                    eventLog(CREDENTIAL_REGISTERED_TOPIC, signer.address)
                  ]
                };
              }
            };
          },
          async registerCredential() {
            throw new Error('no');
          }
        }) as never
    }
  );

  await assert.rejects(
    coordinator.revokeCredentialHash({
      target: target(),
      signer,
      credentialHash: VALID_HASH
    }),
    expectAnchorCode('ANCHOR_EVIDENCE_INCONSISTENT')
  );

  void world;
});

// ---------------------------------------------------------------------------
// 66-68: EL CARRIL ES COMPARTIDO
// ---------------------------------------------------------------------------

test('66: una registracion en curso BLOQUEA una revocacion del mismo ancla', async () => {
  const first = deferred();
  const entered = deferred();
  let firstEntered = false;

  const order: string[] = [];
  const world = createWorld({
    beforeSend: async (operation) => {
      order.push(`enter:${operation}`);

      if (!firstEntered) {
        firstEntered = true;
        entered.release();
        await first.promise;
      }
    }
  });

  const signer = anchorSigner();

  const registration = world.coordinator.registerCredentialHash({
    target: target(),
    signer,
    credentialHash: VALID_HASH
  });

  await entered.promise;

  const revocation = world.coordinator.revokeCredentialHash({
    target: target(),
    signer,
    credentialHash: VALID_HASH
  });

  // La revocacion NO pudo entrar todavia.
  assert.deepEqual(order, ['enter:register']);

  first.release();
  await registration;
  await revocation;

  assert.deepEqual(order, ['enter:register', 'enter:revoke']);
  assert.deepEqual(world.sends, ['register', 'revoke']);
});

test('67: una revocacion en curso BLOQUEA una registracion del mismo ancla', async () => {
  const first = deferred();
  const entered = deferred();
  let firstEntered = false;

  const order: string[] = [];
  const world = createWorld({
    beforeSend: async (operation) => {
      order.push(`enter:${operation}`);

      if (!firstEntered) {
        firstEntered = true;
        entered.release();
        await first.promise;
      }
    }
  });

  const signer = anchorSigner();

  const revocation = world.coordinator.revokeCredentialHash({
    target: target(),
    signer,
    credentialHash: VALID_HASH
  });

  await entered.promise;

  const registration = world.coordinator.registerCredentialHash({
    target: target(),
    signer,
    credentialHash: VALID_HASH
  });

  assert.deepEqual(order, ['enter:revoke']);

  first.release();
  await revocation;
  await registration;

  assert.deepEqual(order, ['enter:revoke', 'enter:register']);
});

test('68: dos revocaciones del mismo ancla serializan', async () => {
  const first = deferred();
  const entered = deferred();
  let count = 0;
  const order: string[] = [];

  const world = createWorld({
    beforeSend: async () => {
      count += 1;
      order.push(`enter:${count}`);

      if (count === 1) {
        entered.release();
        await first.promise;
      }
    }
  });

  const signer = anchorSigner();

  const a = world.coordinator.revokeCredentialHash({
    target: target(),
    signer,
    credentialHash: VALID_HASH
  });
  await entered.promise;

  const b = world.coordinator.revokeCredentialHash({
    target: target(),
    signer,
    credentialHash: VALID_HASH
  });

  assert.deepEqual(order, ['enter:1']);
  first.release();
  await a;
  await b;
  assert.deepEqual(order, ['enter:1', 'enter:2']);
});

test('69: dos anclas DISTINTAS no se serializan entre si', async () => {
  const first = deferred();
  const entered = deferred();
  let firstEntered = false;
  const order: string[] = [];

  const world = createWorld({
    beforeSend: async (operation) => {
      order.push(`enter:${operation}`);

      if (!firstEntered) {
        firstEntered = true;
        entered.release();
        await first.promise;
      }
    }
  });

  const registration = world.coordinator.registerCredentialHash({
    target: target(),
    signer: anchorSigner(PUBLIC_TEST_KEY_ONE, 'anchor-1'),
    credentialHash: VALID_HASH
  });
  await entered.promise;

  // Otro perfil: no hay mutex global.
  await world.coordinator.revokeCredentialHash({
    target: target(),
    signer: anchorSigner(PUBLIC_TEST_KEY_TWO, 'anchor-2'),
    credentialHash: VALID_HASH
  });

  assert.deepEqual(order, ['enter:register', 'enter:revoke']);

  first.release();
  await registration;
});

// ---------------------------------------------------------------------------
// 70-73: EL CERROJO CRUZA LAS DOS OPERACIONES
// ---------------------------------------------------------------------------

test('70-72: un envio de revocacion ambiguo cierra el carril para AMBAS operaciones', async () => {
  const world = createWorld({ sendError: new Error('ambiguo') });
  const signer = anchorSigner();

  await assert.rejects(
    world.coordinator.revokeCredentialHash({
      target: target(),
      signer,
      credentialHash: VALID_HASH
    }),
    expectAnchorCode('ANCHOR_SEND_FAILED')
  );

  assert.ok(world.coordinator.isAnchorLaneUncertain('anchor-1', 84532));

  const callsAfter = [...world.calls];

  // 71: una registracion posterior del mismo carril falla cerrado...
  await assert.rejects(
    world.coordinator.registerCredentialHash({
      target: target(),
      signer,
      credentialHash: VALID_HASH
    }),
    expectAnchorCode('ANCHOR_LANE_UNCERTAIN')
  );

  // 72: ...y una revocacion posterior tambien.
  await assert.rejects(
    world.coordinator.revokeCredentialHash({
      target: target(),
      signer,
      credentialHash: VALID_HASH
    }),
    expectAnchorCode('ANCHOR_LANE_UNCERTAIN')
  );

  // Ni preflight ni envio: el rechazo es ANTES de tocar la red.
  assert.deepEqual(world.calls, callsAfter);
  assert.deepEqual(world.sends, ['revoke']);
});

test('70b: un envio de REGISTRACION ambiguo tambien bloquea la revocacion', async () => {
  const world = createWorld({ sendError: new Error('ambiguo') });
  const signer = anchorSigner();

  await assert.rejects(
    world.coordinator.registerCredentialHash({
      target: target(),
      signer,
      credentialHash: VALID_HASH
    }),
    expectAnchorCode('ANCHOR_SEND_FAILED')
  );

  await assert.rejects(
    world.coordinator.revokeCredentialHash({
      target: target(),
      signer,
      credentialHash: VALID_HASH
    }),
    expectAnchorCode('ANCHOR_LANE_UNCERTAIN')
  );

  assert.deepEqual(world.sends, ['register']);
});

test('73: otro ancla no se ve afectada por el cerrojo', async () => {
  const world = createWorld({ sendError: new Error('ambiguo') });

  await assert.rejects(
    world.coordinator.revokeCredentialHash({
      target: target(),
      signer: anchorSigner(PUBLIC_TEST_KEY_ONE, 'anchor-1'),
      credentialHash: VALID_HASH
    }),
    expectAnchorCode('ANCHOR_SEND_FAILED')
  );

  // La otra llega a enviar: falla por el mismo doble, no por el cerrojo.
  await assert.rejects(
    world.coordinator.revokeCredentialHash({
      target: target(),
      signer: anchorSigner(PUBLIC_TEST_KEY_TWO, 'anchor-2'),
      credentialHash: VALID_HASH
    }),
    expectAnchorCode('ANCHOR_SEND_FAILED')
  );

  assert.equal(world.sends.length, 2);
  assert.ok(!world.coordinator.isAnchorLaneUncertain('anchor-2', 31337));
});

// ---------------------------------------------------------------------------
// 74-76: LO QUE NO ES AMBIGUEDAD DE ENVIO
// ---------------------------------------------------------------------------

test('74: un preflight fallido no envenena el carril ni envia nada', async () => {
  const world = createWorld({ chainId: 31337n });

  await assert.rejects(
    world.coordinator.revokeCredentialHash({
      target: target(),
      signer: anchorSigner(),
      credentialHash: VALID_HASH
    }),
    (error: unknown) => {
      assert.ok(error instanceof BlockchainTargetError);
      return true;
    }
  );

  assert.deepEqual(world.sends, []);
  assert.ok(!world.coordinator.isAnchorLaneUncertain('anchor-1', 84532));
});

test('75: un timeout de minado no es ambiguedad de envio', async () => {
  const world = createWorld({ waitError: new Error('timeout') });

  await assert.rejects(
    world.coordinator.revokeCredentialHash({
      target: target(),
      signer: anchorSigner(),
      credentialHash: VALID_HASH
    }),
    expectAnchorCode('ANCHOR_RECEIPT_UNAVAILABLE')
  );

  // La transaccion se transmitio y el nonce se consumio: el carril sigue
  // utilizable y no se afirma nada sobre el resultado en la cadena.
  assert.deepEqual(world.sends, ['revoke']);
  assert.ok(!world.coordinator.isAnchorLaneUncertain('anchor-1', 84532));
});

test('76: no hay reset del NonceManager ni reintento en el camino de revocacion', () => {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  const source = readFileSync(
    join(__dirname, 'anchor-write-coordinator.ts'),
    'utf8'
  );

  const executable = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');

  assert.ok(!/\.reset\(/.test(source));
  for (const forbidden of ['retry', 'backoff', 'setTimeout', 'while (']) {
    assert.ok(!executable.includes(forbidden), forbidden);
  }

  // Y UN solo sitio de envio por operacion.
  assert.equal(
    (executable.match(/await writer\.revokeCredential\(credentialHash\)/g) ?? [])
      .length,
    1
  );
  assert.equal(
    (
      executable.match(/await writer\.registerCredential\(credentialHash\)/g) ??
      []
    ).length,
    1
  );
});

// ---------------------------------------------------------------------------
// ADDENDUM C: LA COMPUERTA DE CADENA CORRE DENTRO DEL CARRIL
// ---------------------------------------------------------------------------

test('addendum C: la compuerta de cadena corre tras el preflight y puede evitar el envio', async () => {
  const world = createWorld();
  const gateProviders: unknown[] = [];
  const gateCalls: string[] = [];

  const outcome = await world.coordinator.revokeCredentialHash({
    target: target(),
    signer: anchorSigner(),
    credentialHash: VALID_HASH,
    assertChainRevocable: async (provider) => {
      gateProviders.push(provider);
      gateCalls.push('gate');
      // Otra request ya revoco este hash mientras este intento esperaba.
      return 'already_revoked';
    }
  });

  assert.equal(outcome.kind, 'already_revoked');
  // CERO envios.
  assert.deepEqual(world.sends, []);
  // La compuerta corrio DESPUES del preflight...
  assert.deepEqual(world.calls, ['getNetwork', 'getCode']);
  // ...y recibio el MISMO provider que el preflight autorizo.
  assert.equal(gateProviders.length, 1);
  assert.equal(gateProviders[0], world.providersCreated[0]);
});

test('addendum C: si la compuerta dice que siga, se envia exactamente una vez', async () => {
  const world = createWorld();

  const outcome = await world.coordinator.revokeCredentialHash({
    target: target(),
    signer: anchorSigner(),
    credentialHash: VALID_HASH,
    assertChainRevocable: async () => 'send'
  });

  assert.equal(outcome.kind, 'revoked');
  assert.deepEqual(world.sends, ['revoke']);
});

test('addendum C: la compuerta de CLAVE corre antes del preflight y antes del envio', async () => {
  const world = createWorld();
  const order: string[] = [];

  await assert.rejects(
    world.coordinator.revokeCredentialHash({
      target: target(),
      signer: anchorSigner(),
      credentialHash: VALID_HASH,
      assertSignerUsable: async () => {
        order.push('key_gate');
        throw new Error('el perfil historico quedo comprometido');
      },
      assertChainRevocable: async () => {
        order.push('chain_gate');
        return 'send';
      }
    })
  );

  // La compuerta de clave corta antes de todo: ni preflight, ni lectura de
  // cadena, ni envio.
  assert.deepEqual(order, ['key_gate']);
  assert.deepEqual(world.calls, []);
  assert.deepEqual(world.sends, []);
});

test('una registracion no puede saltearse por una compuerta de cadena', async () => {
  // `registerCredentialHash` no acepta `assertChainRevocable`, asi que no hay
  // forma de que devuelva evidencia inexistente.
  const world = createWorld();

  const evidence = await world.coordinator.registerCredentialHash({
    target: target(),
    signer: anchorSigner(),
    credentialHash: VALID_HASH
  });

  assert.equal(evidence.txHash, TX_HASH);
  assert.equal(evidence.blockNumber, BLOCK_NUMBER);
  assert.deepEqual(world.sends, ['register']);
});

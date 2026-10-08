/**
 * Coordinacion de escrituras del ancla -- S8c6, matrices 39-58 y 65.
 *
 * El provider SIEMPRE es un doble. Ningun test construye un JsonRpcProvider
 * real, no hay proceso de Anvil, no hay Base Sepolia y no hay transaccion: no
 * existe camino por el que estos tests lleguen a una red.
 *
 * La concurrencia se prueba con barreras de Promesas, sin `sleep` real.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { BlockchainNetwork } from '@prisma/client';
import { Wallet } from 'ethers';

import { PUBLIC_TEST_KEY_ONE, PUBLIC_TEST_KEY_TWO } from '../signing/__fixtures__/signer-test-keys';
import {
  type AnchorChainProvider,
  type AnchorRegistryWriter,
  type AnchorSignerSnapshot,
  type AnchorTransactionReceipt,
  AnchorWriteCoordinator,
  AnchorWriteError,
  CREDENTIAL_REGISTRY_CONFIRMATIONS,
  CREDENTIAL_REGISTRY_MINING_TIMEOUT_MS
} from './anchor-write-coordinator';
import {
  BlockchainTargetError,
  type CredentialRegistryTarget
} from './blockchain-target';
import {
  CREDENTIAL_REGISTERED_TOPIC,
  type CredentialRegistryLog
} from './credential-registry-events';
import { CredentialRegistryPreflight } from './credential-registry-preflight';

const CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const VALID_HASH =
  '0xaf032042c1bcfb72f9caac350eb3cb576f44ab07b1c1968f4b36264da44ff2ab';
const TX_HASH = `0x${'1'.repeat(64)}`;
const BLOCK_NUMBER = 4242;
const BLOCK_TIMESTAMP_SECONDS = 1_775_000_000;
const DEPLOYED_CODE = `0x60806040${'ab'.repeat(32)}`;

function baseSepoliaTarget(): CredentialRegistryTarget {
  return {
    evidenceMode: 'credential_registry',
    network: BlockchainNetwork.base_sepolia,
    chainId: 84532,
    rpcUrl: 'https://provider.example/v2/SECRET_API_KEY',
    contractAddress: CONTRACT_ADDRESS,
    deploymentId: 'test-base-sepolia-pending-deploy'
  };
}

function anchorSigner(key = PUBLIC_TEST_KEY_ONE, profileId = 'anchor-profile-1') {
  const wallet = new Wallet(key.privateKey);

  return {
    profileId,
    keyVersion: 1,
    address: wallet.address,
    wallet
  } satisfies AnchorSignerSnapshot;
}

/** Log `CredentialRegistered` bien formado para un hash y un registrante. */
function registeredLog(input: {
  credentialHash?: string;
  registrant: string;
  txHash?: string;
  blockNumber?: number;
}): CredentialRegistryLog {
  const hash = (input.credentialHash ?? VALID_HASH).toLowerCase();
  const registrantTopic = `0x${'0'.repeat(24)}${input.registrant
    .slice(2)
    .toLowerCase()}`;

  return {
    address: CONTRACT_ADDRESS,
    topics: [CREDENTIAL_REGISTERED_TOPIC, hash, registrantTopic],
    // `registeredAt` (uint256) va en data.
    data: `0x${BLOCK_TIMESTAMP_SECONDS.toString(16).padStart(64, '0')}`,
    transactionHash: input.txHash ?? TX_HASH,
    blockNumber: input.blockNumber ?? BLOCK_NUMBER
  };
}

interface WorldOptions {
  chainId?: bigint;
  code?: string;
  receipt?: AnchorTransactionReceipt | null;
  sendError?: unknown;
  waitError?: unknown;
  blockError?: unknown;
  block?: { timestamp?: unknown } | null;
  beforeSend?: () => Promise<void>;
  signer?: AnchorSignerSnapshot;
}

function createWorld(options: WorldOptions = {}) {
  const signer = options.signer ?? anchorSigner();
  const calls: string[] = [];
  const providersCreated: AnchorChainProvider[] = [];
  const preflightProviders: unknown[] = [];
  const writerSigners: unknown[] = [];
  const sends: string[] = [];
  const waitArguments: Array<[number | undefined, number | undefined]> = [];

  const createProvider = (target: CredentialRegistryTarget): AnchorChainProvider => {
    const provider: AnchorChainProvider = {
      async getNetwork() {
        calls.push('getNetwork');
        // Por defecto el doble responde la cadena DEL TARGET, para que un
        // target de otra red no falle el preflight por accidente. Un override
        // explicito permite probar el desajuste.
        return { chainId: options.chainId ?? BigInt(target.chainId) };
      },
      async getCode() {
        calls.push('getCode');
        return options.code ?? DEPLOYED_CODE;
      },
      async getBlock(blockNumber: number) {
        calls.push(`getBlock:${blockNumber}`);
        if (options.blockError !== undefined) {
          throw options.blockError;
        }
        return 'block' in options
          ? (options.block ?? null)
          : { timestamp: BigInt(BLOCK_TIMESTAMP_SECONDS) };
      }
    };

    providersCreated.push(provider);
    return provider;
  };

  const preflight = new (class extends CredentialRegistryPreflight {
    override async assertWritable(
      target: CredentialRegistryTarget,
      provider?: never
    ) {
      preflightProviders.push(provider);
      calls.push('preflight');
      return super.assertWritable(target, provider);
    }
  })();

  const createWriter = (input: {
    target: CredentialRegistryTarget;
    signer: { getAddress(): Promise<string> };
  }): AnchorRegistryWriter => {
    writerSigners.push(input.signer);

    return {
      async registerCredential(credentialHash: string) {
        // La direccion sale del signer REALMENTE usado en esta escritura, para
        // que un test con dos anclas distintas no reciba el receipt del otro.
        const writerAddress = await input.signer.getAddress();
        if (options.beforeSend) {
          await options.beforeSend();
        }

        calls.push('send');
        sends.push(credentialHash);

        if (options.sendError !== undefined) {
          throw options.sendError;
        }

        return {
          hash: TX_HASH,
          async wait(confirmations?: number, timeoutMs?: number) {
            calls.push('wait');
            waitArguments.push([confirmations, timeoutMs]);

            if (options.waitError !== undefined) {
              throw options.waitError;
            }

            return 'receipt' in options
              ? (options.receipt ?? null)
              : {
                  status: 1,
                  hash: TX_HASH,
                  blockNumber: BLOCK_NUMBER,
                  from: writerAddress,
                  to: CONTRACT_ADDRESS,
                  logs: [registeredLog({ registrant: writerAddress })]
                };
          }
        };
      }
    };
  };

  const coordinator = new AnchorWriteCoordinator(preflight, {
    createProvider,
    createWriter
  });

  return {
    coordinator,
    signer,
    calls,
    providersCreated,
    preflightProviders,
    writerSigners,
    sends,
    waitArguments
  };
}

function coordinatorSource(): string {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');

  return readFileSync(join(__dirname, 'anchor-write-coordinator.ts'), 'utf8');
}

/** Codigo EJECUTABLE: los comentarios nombran legitimamente lo prohibido. */
function executableCoordinatorCode(): string {
  return coordinatorSource()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function expectAnchorCode(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof AnchorWriteError, String(error));
    assert.equal((error as AnchorWriteError).code, code);
    return true;
  };
}

// ---------------------------------------------------------------------------
// 48-58: CAMINO FELIZ
// ---------------------------------------------------------------------------

test('48-58: una registracion exitosa produce evidencia REAL de la cadena', async () => {
  const world = createWorld();

  const evidence = await world.coordinator.registerCredentialHash({
    target: baseSepoliaTarget(),
    signer: world.signer,
    credentialHash: VALID_HASH
  });

  // 48-49: preflight y DESPUES una sola escritura.
  assert.deepEqual(world.calls, [
    'preflight',
    'getNetwork',
    'getCode',
    'send',
    'wait',
    `getBlock:${BLOCK_NUMBER}`
  ]);
  assert.deepEqual(world.sends, [VALID_HASH]);

  // 51-52: una confirmacion y el timeout de MINADO nombrado.
  assert.deepEqual(world.waitArguments, [
    [CREDENTIAL_REGISTRY_CONFIRMATIONS, CREDENTIAL_REGISTRY_MINING_TIMEOUT_MS]
  ]);
  assert.equal(CREDENTIAL_REGISTRY_CONFIRMATIONS, 1);
  assert.equal(CREDENTIAL_REGISTRY_MINING_TIMEOUT_MS, 90_000);

  // 53-57: evidencia observada, nada del reloj del servidor.
  assert.equal(evidence.txHash, TX_HASH);
  assert.equal(evidence.blockNumber, BLOCK_NUMBER);
  assert.equal(evidence.registrant, world.signer.address);
  assert.equal(
    evidence.registeredAt.getTime(),
    BLOCK_TIMESTAMP_SECONDS * 1000
  );
  assert.equal(evidence.registeredAt.toISOString(), '2026-03-31T23:33:20.000Z');
});

test('58: se envia EXACTAMENTE el hash canonico recibido', async () => {
  const world = createWorld();

  await world.coordinator.registerCredentialHash({
    target: baseSepoliaTarget(),
    signer: world.signer,
    credentialHash: VALID_HASH
  });

  assert.deepEqual(world.sends, [VALID_HASH]);
});

test('addendum A: el preflight corre sobre el MISMO provider que la escritura', async () => {
  const world = createWorld();

  await world.coordinator.registerCredentialHash({
    target: baseSepoliaTarget(),
    signer: world.signer,
    credentialHash: VALID_HASH
  });

  // Un solo provider construido en todo el intento.
  assert.equal(world.providersCreated.length, 1);
  // Y es EXACTAMENTE la instancia que recibio el preflight: validar un camino
  // y escribir por otro haria que el preflight no probara nada.
  assert.equal(world.preflightProviders.length, 1);
  assert.equal(world.preflightProviders[0], world.providersCreated[0]);
});

test('42-43: se usa NonceManager y no hay aritmetica de nonce propia', async () => {
  const world = createWorld();

  await world.coordinator.registerCredentialHash({
    target: baseSepoliaTarget(),
    signer: world.signer,
    credentialHash: VALID_HASH
  });

  // El writer recibe el NonceManager, no la Wallet cruda.
  assert.equal(world.writerSigners.length, 1);
  const signerPassed = world.writerSigners[0] as { constructor: { name: string } };
  assert.equal(signerPassed.constructor.name, 'NonceManager');

  // Sobre CODIGO EJECUTABLE: el comentario del coordinador nombra
  // `getTransactionCount() + 1` justamente para explicar que NO se hace eso.
  // Esa prosa es correcta y no es una violacion.
  const code = coordinatorExecutableCode();

  for (const forbidden of [
    'getTransactionCount',
    'nonce + 1',
    'nonce++',
    '+ 1;'
  ]) {
    assert.ok(!code.includes(forbidden), forbidden);
  }
});

function coordinatorExecutableCode(): string {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');

  return readFileSync(join(__dirname, 'anchor-write-coordinator.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

test('el NonceManager sobrevive entre intentos del mismo ancla y cadena', async () => {
  const world = createWorld();

  await world.coordinator.registerCredentialHash({
    target: baseSepoliaTarget(),
    signer: world.signer,
    credentialHash: VALID_HASH
  });
  await world.coordinator.registerCredentialHash({
    target: baseSepoliaTarget(),
    signer: world.signer,
    credentialHash: VALID_HASH
  });

  // Si se recreara por intento, su estado de nonce se perderia y no serviria
  // para nada.
  assert.equal(world.providersCreated.length, 1);
  assert.equal(world.writerSigners[0], world.writerSigners[1]);
});

test('la identidad del nonce incluye el chainId', async () => {
  const world = createWorld();

  await world.coordinator.registerCredentialHash({
    target: baseSepoliaTarget(),
    signer: world.signer,
    credentialHash: VALID_HASH
  });
  await world.coordinator.registerCredentialHash({
    target: {
      ...baseSepoliaTarget(),
      network: BlockchainNetwork.anvil,
      chainId: 31337,
      rpcUrl: 'http://127.0.0.1:8545'
    },
    signer: world.signer,
    credentialHash: VALID_HASH
  });

  // Dos cadenas => dos providers y dos NonceManagers. Reusar el estado de
  // nonce de una cadena en otra daria nonces incorrectos.
  assert.equal(world.providersCreated.length, 2);
  assert.notEqual(world.writerSigners[0], world.writerSigners[1]);
});

// ---------------------------------------------------------------------------
// 59-65: FALLOS DE CADENA -- UN SOLO ENVIO, SIN REINTENTO
// ---------------------------------------------------------------------------

test('59: un preflight fallido no envia nada', async () => {
  for (const [label, options] of [
    ['cadena equivocada', { chainId: 31337n }],
    ['sin contrato', { code: '0x' }]
  ] as const) {
    const world = createWorld(options);

    await assert.rejects(
      world.coordinator.registerCredentialHash({
        target: baseSepoliaTarget(),
        signer: world.signer,
        credentialHash: VALID_HASH
      }),
      (error: unknown) => {
        assert.ok(error instanceof BlockchainTargetError, label);
        return true;
      },
      label
    );

    assert.deepEqual(world.sends, [], label);
  }
});

test('60: un fallo de envio no reintenta', async () => {
  const world = createWorld({
    sendError: new Error(
      'replacement fee too low at https://provider.example/v2/SECRET_API_KEY'
    )
  });

  await assert.rejects(
    world.coordinator.registerCredentialHash({
      target: baseSepoliaTarget(),
      signer: world.signer,
      credentialHash: VALID_HASH
    }),
    expectAnchorCode('ANCHOR_SEND_FAILED')
  );

  // 65: UN solo envio.
  assert.equal(world.sends.length, 1);
  assert.equal(world.calls.filter((call) => call === 'send').length, 1);
});

test('61: un timeout de minado no reenvia', async () => {
  const world = createWorld({
    waitError: new Error('timeout at https://provider.example/v2/SECRET_API_KEY')
  });

  await assert.rejects(
    world.coordinator.registerCredentialHash({
      target: baseSepoliaTarget(),
      signer: world.signer,
      credentialHash: VALID_HASH
    }),
    expectAnchorCode('ANCHOR_RECEIPT_UNAVAILABLE')
  );

  // Una escritura que expiro puede haber llegado igual a la red.
  assert.equal(world.sends.length, 1);
});

test('61b: un receipt nulo tampoco reenvia', async () => {
  const world = createWorld({ receipt: null });

  await assert.rejects(
    world.coordinator.registerCredentialHash({
      target: baseSepoliaTarget(),
      signer: world.signer,
      credentialHash: VALID_HASH
    }),
    expectAnchorCode('ANCHOR_RECEIPT_UNAVAILABLE')
  );
  assert.equal(world.sends.length, 1);
});

test('62: un receipt sin exito se rechaza', async () => {
  for (const status of [0, null, undefined, 2]) {
    const world = createWorld({
      receipt: {
        status: status as number,
        hash: TX_HASH,
        blockNumber: BLOCK_NUMBER,
        from: anchorSigner().address,
        to: CONTRACT_ADDRESS,
        logs: [registeredLog({ registrant: anchorSigner().address })]
      }
    });

    await assert.rejects(
      world.coordinator.registerCredentialHash({
        target: baseSepoliaTarget(),
        signer: world.signer,
        credentialHash: VALID_HASH
      }),
      expectAnchorCode('ANCHOR_RECEIPT_REJECTED'),
      String(status)
    );
  }
});

test('50: no alcanza con que el metodo devuelva un objeto', async () => {
  const signer = anchorSigner();
  const inconsistent: Array<[string, AnchorTransactionReceipt]> = [
    [
      'sin bloque',
      {
        status: 1,
        hash: TX_HASH,
        blockNumber: null,
        from: signer.address,
        to: CONTRACT_ADDRESS,
        logs: [registeredLog({ registrant: signer.address })]
      }
    ],
    [
      'otro contrato',
      {
        status: 1,
        hash: TX_HASH,
        blockNumber: BLOCK_NUMBER,
        from: signer.address,
        to: '0x000000000000000000000000000000000000dEaD',
        logs: [registeredLog({ registrant: signer.address })]
      }
    ],
    [
      'otro remitente',
      {
        status: 1,
        hash: TX_HASH,
        blockNumber: BLOCK_NUMBER,
        from: PUBLIC_TEST_KEY_TWO.address,
        to: CONTRACT_ADDRESS,
        logs: [registeredLog({ registrant: signer.address })]
      }
    ],
    [
      'sin log de registracion',
      {
        status: 1,
        hash: TX_HASH,
        blockNumber: BLOCK_NUMBER,
        from: signer.address,
        to: CONTRACT_ADDRESS,
        logs: []
      }
    ],
    [
      'log de OTRO hash',
      {
        status: 1,
        hash: TX_HASH,
        blockNumber: BLOCK_NUMBER,
        from: signer.address,
        to: CONTRACT_ADDRESS,
        logs: [
          registeredLog({
            credentialHash: `0x${'b'.repeat(64)}`,
            registrant: signer.address
          })
        ]
      }
    ],
    [
      'log con OTRO registrante',
      {
        status: 1,
        hash: TX_HASH,
        blockNumber: BLOCK_NUMBER,
        from: signer.address,
        to: CONTRACT_ADDRESS,
        logs: [registeredLog({ registrant: PUBLIC_TEST_KEY_TWO.address })]
      }
    ],
    [
      'log de OTRA transaccion',
      {
        status: 1,
        hash: TX_HASH,
        blockNumber: BLOCK_NUMBER,
        from: signer.address,
        to: CONTRACT_ADDRESS,
        logs: [
          registeredLog({
            registrant: signer.address,
            txHash: `0x${'9'.repeat(64)}`
          })
        ]
      }
    ]
  ];

  for (const [label, receipt] of inconsistent) {
    const world = createWorld({ receipt, signer });

    await assert.rejects(
      world.coordinator.registerCredentialHash({
        target: baseSepoliaTarget(),
        signer: world.signer,
        credentialHash: VALID_HASH
      }),
      expectAnchorCode('ANCHOR_EVIDENCE_INCONSISTENT'),
      label
    );
  }
});

test('63: un bloque inobtenible o con timestamp invalido no se fecha', async () => {
  const cases: Array<[string, WorldOptions]> = [
    ['getBlock lanza', { blockError: new Error('rpc down') }],
    ['bloque nulo', { block: null }],
    ['sin timestamp', { block: {} }],
    ['timestamp negativo', { block: { timestamp: -1 } }],
    ['timestamp no numerico', { block: { timestamp: 'ayer' } }],
    [
      'timestamp fuera de rango',
      { block: { timestamp: BigInt(Number.MAX_SAFE_INTEGER) + 1n } }
    ]
  ];

  for (const [label, options] of cases) {
    const world = createWorld(options);

    await assert.rejects(
      world.coordinator.registerCredentialHash({
        target: baseSepoliaTarget(),
        signer: world.signer,
        credentialHash: VALID_HASH
      }),
      expectAnchorCode('ANCHOR_BLOCK_UNAVAILABLE'),
      label
    );

    // La transaccion SI se envio y SI se mino: no se reenvia nada.
    assert.equal(world.sends.length, 1, label);
  }
});

test('ningun error de escritura filtra el endpoint del RPC', async () => {
  const leaky = new Error(
    'failed https://provider.example/v2/SECRET_API_KEY?apiKey=SECRET123'
  );
  leaky.name = 'FetchError';

  for (const options of [
    { sendError: leaky },
    { waitError: leaky },
    { blockError: leaky }
  ]) {
    const world = createWorld(options);

    await assert.rejects(
      world.coordinator.registerCredentialHash({
        target: baseSepoliaTarget(),
        signer: world.signer,
        credentialHash: VALID_HASH
      }),
      (error: unknown) => {
        assert.ok(error instanceof AnchorWriteError);
        const typed = error as AnchorWriteError;

        const serialized = [
          typed.message,
          typed.name,
          typed.stack ?? '',
          JSON.stringify({
            code: typed.code,
            providerErrorName: typed.providerErrorName
          })
        ].join(' ');

        for (const leak of [
          'SECRET_API_KEY',
          'SECRET123',
          'provider.example',
          'apiKey'
        ]) {
          assert.ok(!serialized.includes(leak), leak);
        }

        // Se conserva SOLO la clase del error original.
        assert.equal(typed.providerErrorName, 'FetchError');
        assert.equal((typed as { cause?: unknown }).cause, undefined);
        return true;
      }
    );
  }
});

// ---------------------------------------------------------------------------
// 39-41, 45-47: COLA POR ANCLA
// ---------------------------------------------------------------------------

/** Cede el event loop varias veces, sin `sleep` real. */
async function drainMicrotasks(rounds = 25) {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setImmediate(resolve));
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test('39-40: dos emisiones con el MISMO ancla serializan su envio', async () => {
  // Issuer A y Issuer B comparten el perfil de ancla P. Comparten cuenta, asi
  // que comparten nonce: sus envios NO pueden solaparse.
  const inSend: string[] = [];
  const gate = deferred();
  let first = true;

  const world = createWorld({
    async beforeSend() {
      if (first) {
        first = false;
        inSend.push('first:enter');
        await gate.promise;
        inSend.push('first:leave');
      } else {
        inSend.push('second:enter');
      }
    }
  });

  const target = baseSepoliaTarget();
  const sharedAnchor = world.signer;

  const a = world.coordinator.registerCredentialHash({
    target,
    signer: sharedAnchor,
    credentialHash: VALID_HASH
  });
  const b = world.coordinator.registerCredentialHash({
    target,
    signer: sharedAnchor,
    credentialHash: VALID_HASH
  });

  // Se cede el event loop lo suficiente para que el segundo intentara entrar
  // si nada se lo impidiera. La cola se lo impide.
  await drainMicrotasks();
  assert.deepEqual(inSend, ['first:enter']);

  gate.resolve();
  await Promise.all([a, b]);

  assert.deepEqual(inSend, ['first:enter', 'first:leave', 'second:enter']);
});

test('41: dos anclas DISTINTAS no se serializan entre si', async () => {
  const inSend: string[] = [];
  const gate = deferred();
  let first = true;

  const world = createWorld({
    async beforeSend() {
      if (first) {
        first = false;
        inSend.push('p1:enter');
        await gate.promise;
        inSend.push('p1:leave');
      } else {
        inSend.push('p2:enter');
      }
    }
  });

  const target = baseSepoliaTarget();
  const first_ = world.coordinator.registerCredentialHash({
    target,
    signer: anchorSigner(PUBLIC_TEST_KEY_ONE, 'anchor-profile-1'),
    credentialHash: VALID_HASH
  });
  const second = world.coordinator.registerCredentialHash({
    target,
    signer: anchorSigner(PUBLIC_TEST_KEY_TWO, 'anchor-profile-2'),
    credentialHash: VALID_HASH
  });

  await drainMicrotasks();

  // El segundo ancla entro SIN esperar al primero: no hay un mutex global de
  // blockchain.
  assert.ok(inSend.includes('p2:enter'), inSend.join(','));

  gate.resolve();
  await Promise.allSettled([first_, second]);
});

test('45-47: la cola se libera tras exito y tras fallo, sin deadlock', async () => {
  // Primero un fallo, despues otro intento con la MISMA clave de cola: si el
  // rechazo no liberara la cola, el segundo nunca correria.
  //
  // El fallo es de MINADO, no de envio: un fallo de envio es AMBIGUO y desde
  // S8c6.1 cierra el carril a proposito (ver los tests del cerrojo), asi que
  // no sirve para probar que la cola se libera.
  const failing = createWorld({ waitError: new Error('nope') });

  await assert.rejects(
    failing.coordinator.registerCredentialHash({
      target: baseSepoliaTarget(),
      signer: failing.signer,
      credentialHash: VALID_HASH
    })
  );

  const evidence = await failing.coordinator.registerCredentialHash({
    target: baseSepoliaTarget(),
    signer: failing.signer,
    credentialHash: VALID_HASH
  }).catch((error: unknown) => error);

  // El segundo intento CORRIO (volvio a fallar por el mismo doble), que es lo
  // que prueba que la cola no quedo bloqueada.
  assert.ok(evidence instanceof AnchorWriteError);
  assert.equal(failing.sends.length, 2);
});

// ---------------------------------------------------------------------------
// S8c6.1 -- CERROJO DE INCERTIDUMBRE DE ENVIO
// ---------------------------------------------------------------------------

test('A: un envio ambiguo no reintenta, no limpia el nonce y cierra el carril', async () => {
  const world = createWorld({ sendError: new Error('ambiguo') });

  await assert.rejects(
    world.coordinator.registerCredentialHash({
      target: baseSepoliaTarget(),
      signer: world.signer,
      credentialHash: VALID_HASH
    }),
    expectAnchorCode('ANCHOR_SEND_FAILED')
  );

  // UN solo envio y ningun reintento.
  assert.equal(world.sends.length, 1);

  // El carril perfil+cadena quedo INCIERTO.
  assert.ok(
    world.coordinator.isAnchorLaneUncertain(world.signer.profileId, 84532)
  );

  // Y no hay limpieza automatica del nonce local en ninguna parte del
  // coordinador: `reset()` haria que el proximo envio recargue el nonce
  // pendiente del provider y continue como si el estado fuera conocido.
  const source = coordinatorSource();
  assert.ok(!/\.reset\(/.test(source), 'no hay .reset( en el coordinador');
  assert.ok(!/retry|backoff/i.test(executableCoordinatorCode()));
});

test('B: un segundo envio del MISMO perfil y cadena falla cerrado antes de enviar', async () => {
  const world = createWorld({ sendError: new Error('ambiguo') });
  const target = baseSepoliaTarget();

  await assert.rejects(
    world.coordinator.registerCredentialHash({
      target,
      signer: world.signer,
      credentialHash: VALID_HASH
    }),
    expectAnchorCode('ANCHOR_SEND_FAILED')
  );

  const callsAfterFirst = [...world.calls];

  await assert.rejects(
    world.coordinator.registerCredentialHash({
      target,
      signer: world.signer,
      credentialHash: VALID_HASH
    }),
    expectAnchorCode('ANCHOR_LANE_UNCERTAIN')
  );

  // Ni preflight ni envio: el rechazo es ANTES de tocar la red.
  assert.deepEqual(world.calls, callsAfterFirst);
  assert.equal(world.sends.length, 1);

  // El cerrojo es por CADENA: el mismo perfil en otra cadena no esta cerrado.
  assert.ok(!world.coordinator.isAnchorLaneUncertain(world.signer.profileId, 31337));
});

test('C: otro perfil de ancla sigue siendo usable despues de una ambiguedad', async () => {
  const world = createWorld({ sendError: new Error('ambiguo') });
  const other = anchorSigner(PUBLIC_TEST_KEY_TWO, 'anchor-profile-2');
  const target = baseSepoliaTarget();

  await assert.rejects(
    world.coordinator.registerCredentialHash({
      target,
      signer: world.signer,
      credentialHash: VALID_HASH
    }),
    expectAnchorCode('ANCHOR_SEND_FAILED')
  );

  // El OTRO ancla llega a enviar: falla por el mismo doble, no por el cerrojo.
  await assert.rejects(
    world.coordinator.registerCredentialHash({
      target,
      signer: other,
      credentialHash: VALID_HASH
    }),
    expectAnchorCode('ANCHOR_SEND_FAILED')
  );

  assert.equal(world.sends.length, 2);
  assert.ok(world.coordinator.isAnchorLaneUncertain(world.signer.profileId, 84532));
});

test('D: un preflight fallido NO envenena el carril -- no hubo envio', async () => {
  // El provider responde otra cadena: el preflight corta antes del signer.
  const world = createWorld({ chainId: 31337n });

  await assert.rejects(
    world.coordinator.registerCredentialHash({
      target: baseSepoliaTarget(),
      signer: world.signer,
      credentialHash: VALID_HASH
    }),
    (error: unknown) => {
      assert.ok(error instanceof BlockchainTargetError);
      return true;
    }
  );

  assert.equal(world.sends.length, 0);
  assert.ok(
    !world.coordinator.isAnchorLaneUncertain(world.signer.profileId, 84532)
  );
});

test('E: un timeout de MINADO no es ambiguedad de envio y no cierra el carril', async () => {
  const world = createWorld({ waitError: new Error('timeout') });
  const target = baseSepoliaTarget();

  await assert.rejects(
    world.coordinator.registerCredentialHash({
      target,
      signer: world.signer,
      credentialHash: VALID_HASH
    }),
    expectAnchorCode('ANCHOR_RECEIPT_UNAVAILABLE')
  );

  // La transaccion SE TRANSMITIO: ya existia una respuesta de transaccion y el
  // nonce se consumio. No se reenvia y no se afirma nada sobre la cadena.
  assert.equal(world.sends.length, 1);
  assert.ok(
    !world.coordinator.isAnchorLaneUncertain(world.signer.profileId, 84532)
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type DeploymentOperatorErrorCode,
  DeploymentOperatorError
} from './deployment-errors';
import { runCredentialRegistryDeployment } from './deployment-operator';
import {
  PREFLIGHT_EVIDENCE_FIELDS,
  type PreflightBlocker,
  type PreflightEvidence,
  computeMaxCost
} from './deployment-preflight';
import {
  CREATION_HASH,
  DEPLOYER_ADDRESS,
  EXPECTED_CREATE_ADDRESS,
  NONCE,
  RUNTIME_HASH,
  SOURCE_COMMIT,
  makeHarness
} from './__fixtures__/deployment-fixtures';

/**
 * Preflight canonico de SOLO LECTURA -- S8c10.2.
 *
 * Provider y signer son dobles: sin RPC, sin keystore, sin AWS. Cada prueba
 * comprueba ademas que NO hubo ningun envio ni firma.
 */

const PREFLIGHT = { deploymentSourceCommit: SOURCE_COMMIT, mode: 'preflight' as const };
const EXECUTE = { deploymentSourceCommit: SOURCE_COMMIT, mode: 'execute' as const };

// Con estos defaults del doble: 600_000 gas x 2_000_000 wei = 1_200_000_000_000 wei.
const EXACT_COST = 1_200_000_000_000n;

async function preflight(options: Parameters<typeof makeHarness>[0] = {}) {
  const harness = makeHarness({ signerTrap: true, ...options });
  const result = await runCredentialRegistryDeployment(harness.dependencies, PREFLIGHT);
  assert.equal(result.kind, 'preflight');
  if (result.kind !== 'preflight') {
    throw new Error('unreachable');
  }
  return { evidence: result.evidence, ...harness };
}

function expectNoSignNoSend(harness: ReturnType<typeof makeHarness>) {
  assert.equal(harness.counters.send, 0, 'cero envios');
  assert.deepEqual(harness.counters.signerTouches, [], 'el signer no se toco (ni sign ni send)');
  assert.equal(harness.counters.manifestWrites.length, 0, 'ningun manifest');
  assert.deepEqual(harness.counters.waits, []);
}

// ---------------------------------------------------------------------------
// A. camino feliz
// ---------------------------------------------------------------------------

test('A. preflight limpio de Base Sepolia: listo para aprobacion humana y CERO envios', async () => {
  const { evidence, counters, dependencies } = await preflight();

  assert.equal(evidence.readyForExplicitBroadcastApproval, true);
  assert.deepEqual(evidence.blockers, []);
  assert.equal(evidence.chainId, 84532);
  assert.equal(evidence.deployerAddress, DEPLOYER_ADDRESS);
  assert.equal(evidence.latestNonce, NONCE);
  assert.equal(evidence.pendingNonce, NONCE);
  assert.equal(evidence.expectedCreateAddress, EXPECTED_CREATE_ADDRESS);
  assert.equal(evidence.expectedCreateAddressCodeEmpty, true);
  assert.equal(evidence.expectedCreateAddressNonce, 0);
  assert.equal(
    evidence.futureDeploymentId,
    `base-sepolia-84532-${EXPECTED_CREATE_ADDRESS.toLowerCase()}`
  );
  assert.equal(evidence.finalManifestCollision, false);
  assert.equal(evidence.creationBytecodeHash, CREATION_HASH);
  assert.equal(evidence.runtimeBytecodeHash, RUNTIME_HASH);
  assert.equal(evidence.estimatedGas, '600000');
  assert.equal(evidence.gasPriceWei, '1000000');
  assert.equal(evidence.maxFeePerGasWei, '2000000');
  assert.equal(evidence.maxPriorityFeePerGasWei, '1000');
  assert.equal(evidence.costBasis, 'maxFeePerGas');
  assert.equal(evidence.estimatedMaxCostWei, EXACT_COST.toString());
  assert.equal(evidence.estimatedMaxCostEth, '0.0000012');
  assert.equal(evidence.deployerBalanceWei, (10n ** 18n).toString());
  assert.equal(evidence.deployerBalanceEth, '1.0');
  assert.equal(evidence.balanceCoversEstimatedMaxCost, true);
  assert.equal(evidence.deploymentSourceCommit, SOURCE_COMMIT);

  expectNoSignNoSend({ dependencies, counters } as ReturnType<typeof makeHarness>);
});

test('secuencia: cadena primero, el keystore solo despues, y TODO por el mismo provider', async () => {
  const { counters } = await preflight();
  const calls = counters.providerCalls;

  assert.equal(calls[0], 'getNetwork');
  assert.equal(calls.indexOf('signerLoad'), 1, 'el signer se abre inmediatamente despues de validar la cadena');
  assert.equal(counters.getNetwork, 1, 'la cadena se valida UNA vez');
  assert.equal(counters.signerLoads, 1);

  // Orden de las lecturas: pending, latest, vacancia, gas, fee data, saldo.
  const order = [
    'getTransactionCount:pending',
    'getTransactionCount:latest',
    'getCode',
    'estimateGas',
    'getFeeData',
    'getBalance'
  ].map((name) => calls.indexOf(name));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(order.every((index) => index > 1));

  // Y nada que no sea de LECTURA: el preflight nunca pide recibo, tx ni bloque.
  for (const forbidden of ['getTransaction', 'getTransactionReceipt', 'getBlock', 'getBlockNumber']) {
    assert.equal(calls.includes(forbidden), false, forbidden);
  }
});

// ---------------------------------------------------------------------------
// B. cadena equivocada / no disponible
// ---------------------------------------------------------------------------

test('B. cadena equivocada: bloqueante, el keystore NO se abre y cero envios', async () => {
  for (const chainId of [1n, 8453n, 31337n, 84531n, 0n]) {
    const harness = await preflight({ chainId });

    assert.deepEqual(harness.evidence.blockers, ['CHAIN_MISMATCH'], String(chainId));
    assert.equal(harness.evidence.readyForExplicitBroadcastApproval, false);
    assert.equal(harness.evidence.chainId, null, 'el chainId observado no se refleja');
    assert.equal(harness.evidence.deployerAddress, null);
    assert.equal(harness.counters.signerLoads, 0, 'el keystore no se abre');
    assert.deepEqual(harness.counters.providerCalls, ['getNetwork']);
    expectNoSignNoSend(harness);
  }
});

test('B. provider caido en la validacion de cadena: CHAIN_UNAVAILABLE y el keystore no se abre', async () => {
  const harness = await preflight({ getNetworkError: true });

  assert.deepEqual(harness.evidence.blockers, ['CHAIN_UNAVAILABLE']);
  assert.equal(harness.evidence.readyForExplicitBroadcastApproval, false);
  assert.equal(harness.counters.signerLoads, 0);
  expectNoSignNoSend(harness);
});

// ---------------------------------------------------------------------------
// C. nonces
// ---------------------------------------------------------------------------

test('C. pending != latest: DEPLOYER_HAS_PENDING_TRANSACTIONS, nunca listo, sin sustituir nonce', async () => {
  for (const [latestNonce, pendingNonce] of [
    [7, 8],
    [7, 9],
    [6, 7]
  ] as const) {
    const harness = await preflight({ latestNonce, pendingNonce });

    assert.ok(harness.evidence.blockers.includes('DEPLOYER_HAS_PENDING_TRANSACTIONS'));
    assert.equal(harness.evidence.readyForExplicitBroadcastApproval, false);
    // `pending` sigue siendo la unica base del CREATE: no se elige otro nonce.
    assert.equal(harness.evidence.pendingNonce, pendingNonce);
    assert.equal(harness.evidence.latestNonce, latestNonce);
    expectNoSignNoSend(harness);
  }
});

test('C. un deployer con salidas confirmadas se INFORMA, no se asume wallet nueva, y no es bloqueante', async () => {
  const used = await preflight({ latestNonce: 7, pendingNonce: 7 });
  assert.equal(used.evidence.deployerHasConfirmedOutgoingTransactions, true);
  assert.equal(used.evidence.readyForExplicitBroadcastApproval, true);

  const fresh = await preflight({ latestNonce: 0, pendingNonce: 0 });
  assert.equal(fresh.evidence.deployerHasConfirmedOutgoingTransactions, false);
});

test('C. con `--execute` un deployer con pendientes NO envia', async () => {
  const { dependencies, counters } = makeHarness({ latestNonce: 7, pendingNonce: 8 });

  await assert.rejects(
    runCredentialRegistryDeployment(dependencies, EXECUTE),
    (error: unknown) =>
      error instanceof DeploymentOperatorError && error.code === 'DEPLOYER_HAS_PENDING_TRANSACTIONS'
  );
  assert.equal(counters.send, 0);
});

// ---------------------------------------------------------------------------
// D. direccion CREATE esperada
// ---------------------------------------------------------------------------

test('D. codigo en la direccion CREATE esperada: EXPECTED_CREATE_ADDRESS_OCCUPIED', async () => {
  const harness = await preflight({ occupied: true });

  assert.ok(harness.evidence.blockers.includes('EXPECTED_CREATE_ADDRESS_OCCUPIED'));
  assert.equal(harness.evidence.expectedCreateAddressCodeEmpty, false);
  assert.equal(harness.evidence.readyForExplicitBroadcastApproval, false);
  expectNoSignNoSend(harness);
});

test('D. sin codigo pero con nonce != 0 en la direccion CREATE: tambien ocupada (el codigo vacio no alcanza)', async () => {
  const harness = await preflight({ createAddressNonce: 1 });

  assert.ok(harness.evidence.blockers.includes('EXPECTED_CREATE_ADDRESS_OCCUPIED'));
  assert.equal(harness.evidence.expectedCreateAddressCodeEmpty, true);
  assert.equal(harness.evidence.expectedCreateAddressNonce, 1);
  assert.equal(harness.evidence.readyForExplicitBroadcastApproval, false);
  expectNoSignNoSend(harness);
});

test('D. no hay ajuste automatico: el nonce y la direccion siguen siendo los observados', async () => {
  const harness = await preflight({ occupied: true });

  assert.equal(harness.evidence.pendingNonce, NONCE);
  assert.equal(harness.evidence.expectedCreateAddress, EXPECTED_CREATE_ADDRESS);
});

// ---------------------------------------------------------------------------
// E. gas
// ---------------------------------------------------------------------------

test('E. fallo de estimacion de gas: GAS_ESTIMATION_FAILED y nada de costo', async () => {
  for (const options of [{ estimateError: true }, { estimatedGas: 0n }]) {
    const harness = await preflight(options);

    assert.ok(harness.evidence.blockers.includes('GAS_ESTIMATION_FAILED'));
    assert.equal(harness.evidence.estimatedGas, null);
    assert.equal(harness.evidence.estimatedMaxCostWei, null);
    assert.equal(harness.evidence.balanceCoversEstimatedMaxCost, null);
    assert.equal(harness.evidence.readyForExplicitBroadcastApproval, false);
    expectNoSignNoSend(harness);
  }
});

// ---------------------------------------------------------------------------
// F. fee data
// ---------------------------------------------------------------------------

test('F. sin fee data defendible: COST_ESTIMATE_UNAVAILABLE y NUNCA listo', async () => {
  for (const fee of [
    { gasPrice: null, maxFeePerGas: null, maxPriorityFeePerGas: null },
    { gasPrice: null, maxFeePerGas: null, maxPriorityFeePerGas: 1_000n },
    // Un precio CERO no es una estimacion defendible: haria que cualquier saldo "cubra".
    { gasPrice: 0n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n },
    { gasPrice: null, maxFeePerGas: 0n, maxPriorityFeePerGas: null }
  ]) {
    const harness = await preflight({ fee });

    assert.ok(harness.evidence.blockers.includes('COST_ESTIMATE_UNAVAILABLE'));
    assert.equal(harness.evidence.estimatedMaxCostWei, null);
    assert.equal(harness.evidence.estimatedMaxCostEth, null);
    assert.equal(harness.evidence.balanceCoversEstimatedMaxCost, null);
    assert.equal(harness.evidence.readyForExplicitBroadcastApproval, false);
    expectNoSignNoSend(harness);
  }
});

test('F. un campo ausente es null, DISTINTO de "0"', async () => {
  const absent = await preflight({ fee: { gasPrice: 5n, maxFeePerGas: null, maxPriorityFeePerGas: null } });
  assert.equal(absent.evidence.maxFeePerGasWei, null);
  assert.equal(absent.evidence.maxPriorityFeePerGasWei, null);

  const zero = await preflight({ fee: { gasPrice: 5n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n } });
  assert.equal(zero.evidence.maxFeePerGasWei, '0');
  assert.equal(zero.evidence.maxPriorityFeePerGasWei, '0');
});

test('F. sin maxFeePerGas se usa gasPrice (la cota del emisor legacy) y se declara la base', async () => {
  const harness = await preflight({
    fee: { gasPrice: 3_000_000n, maxFeePerGas: null, maxPriorityFeePerGas: null }
  });

  assert.equal(harness.evidence.costBasis, 'gasPrice');
  assert.equal(harness.evidence.estimatedMaxCostWei, (600_000n * 3_000_000n).toString());
  assert.equal(harness.evidence.readyForExplicitBroadcastApproval, true);
});

test('F. formula: estimatedGas x maxFeePerGas, sin multiplicadores inventados', () => {
  assert.deepEqual(
    computeMaxCost(21_000n, { gasPrice: 7n, maxFeePerGas: 11n }),
    { basis: 'maxFeePerGas', perGasWei: 11n, maxCostWei: 231_000n }
  );
  assert.deepEqual(
    computeMaxCost(21_000n, { gasPrice: 7n, maxFeePerGas: null }),
    { basis: 'gasPrice', perGasWei: 7n, maxCostWei: 147_000n }
  );
  assert.equal(computeMaxCost(21_000n, { gasPrice: null, maxFeePerGas: null }), null);
  assert.equal(computeMaxCost(21_000n, { gasPrice: 0n, maxFeePerGas: 0n }), null);
});

// ---------------------------------------------------------------------------
// G / H. saldo
// ---------------------------------------------------------------------------

test('G. saldo insuficiente: INSUFFICIENT_TESTNET_ETH y cero envios', async () => {
  for (const balance of [0n, 1n, EXACT_COST - 1n]) {
    const harness = await preflight({ balance });

    assert.ok(harness.evidence.blockers.includes('INSUFFICIENT_TESTNET_ETH'), String(balance));
    assert.equal(harness.evidence.balanceCoversEstimatedMaxCost, false);
    assert.equal(harness.evidence.readyForExplicitBroadcastApproval, false);
    expectNoSignNoSend(harness);
  }
});

test('H. el saldo que cubre EXACTAMENTE el costo estimado se acepta', async () => {
  const harness = await preflight({ balance: EXACT_COST });

  assert.equal(harness.evidence.balanceCoversEstimatedMaxCost, true);
  assert.deepEqual(harness.evidence.blockers, []);
  assert.equal(harness.evidence.readyForExplicitBroadcastApproval, true);
  assert.equal(harness.evidence.deployerBalanceWei, EXACT_COST.toString());
});

test('G. `--execute` con saldo insuficiente NO envia', async () => {
  const { dependencies, counters } = makeHarness({ balance: EXACT_COST - 1n });

  await assert.rejects(
    runCredentialRegistryDeployment(dependencies, EXECUTE),
    (error: unknown) =>
      error instanceof DeploymentOperatorError && error.code === 'INSUFFICIENT_TESTNET_ETH'
  );
  assert.equal(counters.send, 0);
});

// ---------------------------------------------------------------------------
// I. errores del provider
// ---------------------------------------------------------------------------

test('I. los errores del provider se sanean: ni URL ni token en la salida', async () => {
  const harness = await preflight({
    feeError: true,
    balanceError: true,
    poisonedProviderErrors: true
  });

  assert.ok(harness.evidence.blockers.includes('CHAIN_UNAVAILABLE'));
  assert.equal(harness.evidence.readyForExplicitBroadcastApproval, false);
  assert.equal(harness.evidence.estimatedMaxCostWei, null);
  const printed = JSON.stringify(harness.evidence);
  for (const leak of ['base-sepolia.example', 'SECRET-TOKEN', 'https://', 'fee fetch failed', 'balance failed']) {
    assert.equal(printed.includes(leak), false, leak);
  }
  expectNoSignNoSend(harness);
});

// ---------------------------------------------------------------------------
// J. contrato de la salida
// ---------------------------------------------------------------------------

test('J. la salida tiene EXACTAMENTE los campos aprobados y ningun secreto', async () => {
  const { evidence } = await preflight();

  assert.deepEqual(Object.keys(evidence).sort(), [...PREFLIGHT_EVIDENCE_FIELDS].sort());

  const printed = JSON.stringify(evidence);
  for (const forbidden of [
    'privateKey',
    'passphrase',
    'password',
    'keystore',
    'ciphertext',
    'mnemonic',
    'rpc',
    'http',
    'rawTransaction',
    'signedTransaction',
    'Bearer'
  ]) {
    assert.equal(printed.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  }
});

test('J. los bloqueantes son de un vocabulario cerrado', async () => {
  const allowed: PreflightBlocker[] = [
    'CHAIN_UNAVAILABLE',
    'CHAIN_MISMATCH',
    'DEPLOYER_HAS_PENDING_TRANSACTIONS',
    'EXPECTED_CREATE_ADDRESS_OCCUPIED',
    'FINAL_MANIFEST_COLLISION',
    'GAS_ESTIMATION_FAILED',
    'COST_ESTIMATE_UNAVAILABLE',
    'INSUFFICIENT_TESTNET_ETH'
  ];

  const everything: PreflightEvidence[] = [];
  for (const options of [
    { chainId: 1n },
    { getNetworkError: true },
    { latestNonce: 1, pendingNonce: 2 },
    { occupied: true },
    { manifestExists: true },
    { estimateError: true },
    { fee: { gasPrice: null, maxFeePerGas: null, maxPriorityFeePerGas: null } },
    { balance: 0n }
  ]) {
    everything.push((await preflight(options)).evidence);
  }

  for (const evidence of everything) {
    assert.ok(evidence.blockers.length > 0);
    for (const blocker of evidence.blockers) {
      assert.ok(allowed.includes(blocker), blocker);
    }
  }
});

// ---------------------------------------------------------------------------
// K. el preflight no firma ni envia
// ---------------------------------------------------------------------------

test('K. preflight: el signer solo expone su direccion publica (sendDeployment ni se toca)', async () => {
  const harness = await preflight();

  assert.deepEqual(harness.counters.signerTouches, []);
  assert.equal(harness.counters.send, 0);
  assert.deepEqual(harness.counters.sentRequests, []);
  assert.equal(harness.counters.waits.length, 0);
});

test('K. preflight: ninguna lectura de recibo/tx/bloque ni escritura de manifest', async () => {
  const harness = await preflight();

  assert.equal(harness.counters.receiptReads, 0);
  assert.equal(harness.counters.manifestWrites.length, 0);
});

// ---------------------------------------------------------------------------
// Manifest final
// ---------------------------------------------------------------------------

test('colision con un manifest final: FINAL_MANIFEST_COLLISION; si no se puede comprobar, falla cerrado', async () => {
  const exists = await preflight({ manifestExists: true });
  assert.ok(exists.evidence.blockers.includes('FINAL_MANIFEST_COLLISION'));
  assert.equal(exists.evidence.finalManifestCollision, true);
  assert.equal(exists.evidence.readyForExplicitBroadcastApproval, false);

  const harness = makeHarness({ signerTrap: true });
  harness.dependencies.manifestStore.exists = async () => {
    throw new Error('EACCES /home/operator/secret');
  };
  const result = await runCredentialRegistryDeployment(harness.dependencies, PREFLIGHT);
  assert.equal(result.kind === 'preflight' && result.evidence.finalManifestCollision, true);
  assert.equal(result.kind === 'preflight' && result.evidence.readyForExplicitBroadcastApproval, false);
});

// ---------------------------------------------------------------------------
// `--execute` revalida TODO antes de su unico envio
// ---------------------------------------------------------------------------

test('--execute vuelve a correr la MISMA compuerta (fee data y saldo incluidos) antes de su unico envio', async () => {
  const { dependencies, counters } = makeHarness();
  const result = await runCredentialRegistryDeployment(dependencies, EXECUTE);

  assert.equal(result.kind, 'finalized');
  assert.equal(counters.send, 1);

  const calls = counters.providerCalls;
  // Todo lo sensible al tiempo se leyo en ESTA ejecucion, antes del envio.
  assert.equal(counters.getNetwork, 1);
  for (const name of [
    'getTransactionCount:pending',
    'getTransactionCount:latest',
    'getCode',
    'estimateGas',
    'getFeeData',
    'getBalance'
  ]) {
    assert.ok(calls.includes(name), name);
  }
  assert.ok(
    calls.indexOf('getBalance') < calls.indexOf('getTransactionReceipt') ||
      !calls.includes('getTransactionReceipt'),
    'el saldo se lee antes de cualquier lectura post-envio'
  );
});

test('--execute con cualquier bloqueante NO firma ni envia, y el error es de dominio', async () => {
  const scenarios: Array<[Parameters<typeof makeHarness>[0], DeploymentOperatorErrorCode]> = [
    [{ chainId: 1n }, 'CHAIN_MISMATCH'],
    [{ getNetworkError: true }, 'CHAIN_UNAVAILABLE'],
    [{ latestNonce: 1, pendingNonce: 2 }, 'DEPLOYER_HAS_PENDING_TRANSACTIONS'],
    [{ occupied: true }, 'CREATE_ADDRESS_OCCUPIED'],
    [{ createAddressNonce: 1 }, 'CREATE_ADDRESS_OCCUPIED'],
    [{ manifestExists: true }, 'MANIFEST_ALREADY_EXISTS'],
    [{ estimateError: true }, 'PRE_SEND_ESTIMATE_FAILED'],
    [{ fee: { gasPrice: null, maxFeePerGas: null, maxPriorityFeePerGas: null } }, 'COST_ESTIMATE_UNAVAILABLE'],
    [{ balance: 0n }, 'INSUFFICIENT_TESTNET_ETH']
  ];

  for (const [options, code] of scenarios) {
    const { dependencies, counters } = makeHarness({ signerTrap: false, ...options });
    await assert.rejects(
      runCredentialRegistryDeployment(dependencies, EXECUTE),
      (error: unknown) => error instanceof DeploymentOperatorError && error.code === code,
      code
    );
    assert.equal(counters.send, 0, code);
    assert.equal(counters.manifestWrites.length, 0, code);
  }
});

test('el preflight de hard-failures sigue lanzando: firma/keystore invalido -> SIGNER_UNAVAILABLE', async () => {
  const harness = makeHarness({ signerLoadError: true });

  await assert.rejects(
    runCredentialRegistryDeployment(harness.dependencies, PREFLIGHT),
    (error: unknown) => error instanceof DeploymentOperatorError && error.code === 'SIGNER_UNAVAILABLE'
  );
  assert.equal(harness.counters.send, 0);
});

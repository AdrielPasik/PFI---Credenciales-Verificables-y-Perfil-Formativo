import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { keccak256 } from 'ethers';

import {
  type DeploymentOperatorErrorCode,
  DeploymentOperatorError,
  describeDeploymentError
} from './deployment-errors';
import { runCredentialRegistryDeployment } from './deployment-operator';
import { ProcessGitStateReader } from './deployment-source-gate';
import {
  BLOCK_HASH,
  BLOCK_NUMBER,
  CREATION_BYTECODE,
  CREATION_HASH,
  DEPLOYER_ADDRESS,
  EXPECTED_CREATE_ADDRESS,
  NONCE,
  OTHER_ADDRESS,
  RUNTIME_BYTECODE,
  RUNTIME_HASH,
  SOURCE_COMMIT,
  TX_HASH,
  goodBlock,
  goodReceipt,
  makeHarness,
  syntheticArtifact
} from './__fixtures__/deployment-fixtures';

/**
 * Operador de deployment -- S8c10.1.
 *
 * Todo con dobles: sin RPC real, sin keystore real, sin AWS, sin SSM, sin Base
 * Sepolia, sin Anvil.
 */

const EXECUTE = { deploymentSourceCommit: SOURCE_COMMIT, mode: 'execute' as const };
const PREFLIGHT = { deploymentSourceCommit: SOURCE_COMMIT, mode: 'preflight' as const };

async function expectOperatorError(
  action: Promise<unknown>,
  code: DeploymentOperatorErrorCode
): Promise<DeploymentOperatorError> {
  let thrown: unknown;
  try {
    await action;
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof DeploymentOperatorError, `se esperaba ${code}`);
  assert.equal(thrown.code, code);
  return thrown;
}

// ---------------------------------------------------------------------------
// Camino feliz
// ---------------------------------------------------------------------------

test('41/45/64 happy path: chain 84532, exactamente UN envio, 5 confirmaciones, manifest', async () => {
  const { dependencies, counters } = makeHarness();

  const result = await runCredentialRegistryDeployment(dependencies, EXECUTE);

  assert.equal(result.kind, 'finalized');
  assert.equal(counters.send, 1);
  assert.deepEqual(counters.waits, [{ confirmations: 5, timeoutMs: 180_000 }]);
  assert.equal(counters.manifestWrites.length, 1);

  if (result.kind !== 'finalized') {
    return;
  }
  const manifest = result.manifest;
  assert.equal(manifest.contractAddress, EXPECTED_CREATE_ADDRESS);
  assert.equal(manifest.deploymentId, `base-sepolia-84532-${EXPECTED_CREATE_ADDRESS.toLowerCase()}`);
  assert.equal(manifest.deploymentTransactionHash, TX_HASH);
  assert.equal(manifest.deploymentBlockNumber, BLOCK_NUMBER);
  assert.equal(manifest.deploymentBlockHash, BLOCK_HASH);
  assert.equal(manifest.deployerAddress, DEPLOYER_ADDRESS);
  assert.equal(manifest.deploymentSourceCommit, SOURCE_COMMIT);
  assert.equal(manifest.foundryVersion, '1.2.3-stable');
  assert.equal(manifest.creationBytecodeHash, CREATION_HASH);
  assert.equal(manifest.runtimeBytecodeHash, RUNTIME_HASH);
  assert.deepEqual(manifest.constructorArguments, []);
});

test('17/62 la tx lleva EXACTAMENTE el creation bytecode revisado, y el timestamp sale del bloque (UTC)', async () => {
  const { dependencies, counters } = makeHarness();
  const result = await runCredentialRegistryDeployment(dependencies, EXECUTE);

  assert.deepEqual(counters.sentRequests, [
    { data: CREATION_BYTECODE, nonce: NONCE, chainId: 84532 }
  ]);
  assert.equal(result.kind === 'finalized' && result.manifest.deploymentTimestamp, '2026-09-21T14:13:20Z');
});

test('18 la direccion CREATE esperada es la derivacion estandar deployer+nonce', async () => {
  const { dependencies } = makeHarness();
  const result = await runCredentialRegistryDeployment(dependencies, PREFLIGHT);

  assert.equal(result.kind, 'preflight');
  assert.equal(result.kind === 'preflight' && result.evidence.expectedCreateAddress, EXPECTED_CREATE_ADDRESS);
  assert.equal(result.kind === 'preflight' && result.evidence.pendingNonce, NONCE);
  assert.equal(result.kind === 'preflight' && result.evidence.deployerAddress, DEPLOYER_ADDRESS);
});

test('preflight: toda la compuerta previa y CERO envios', async () => {
  const { dependencies, counters } = makeHarness();
  const result = await runCredentialRegistryDeployment(dependencies, PREFLIGHT);

  assert.equal(result.kind, 'preflight');
  assert.equal(counters.send, 0);
  assert.equal(counters.signerLoads, 1);
  assert.equal(counters.manifestWrites.length, 0);
});

// ---------------------------------------------------------------------------
// Compuerta previa: cero envios
// ---------------------------------------------------------------------------

test('42 cadena equivocada -> CERO envios y el signer ni se abre', async () => {
  for (const chainId of [1n, 8453n, 31337n, 84531n]) {
    const { dependencies, counters } = makeHarness({ chainId });
    await expectOperatorError(runCredentialRegistryDeployment(dependencies, EXECUTE), 'CHAIN_MISMATCH');
    assert.equal(counters.send, 0);
    assert.equal(counters.signerLoads, 0);
  }
});

test('43 provider caido antes de enviar -> CERO envios, error sin URL', async () => {
  const { dependencies, counters } = makeHarness({ getNetworkError: true });
  const error = await expectOperatorError(
    runCredentialRegistryDeployment(dependencies, EXECUTE),
    'CHAIN_UNAVAILABLE'
  );

  assert.equal(counters.send, 0);
  const output = JSON.stringify(describeDeploymentError(error)) + error.message;
  assert.equal(output.includes('rpc.example'), false);
  assert.equal(output.includes('secret-token'), false);
});

test('44 artefacto invalido -> CERO envios, ni siquiera se consulta la cadena', async () => {
  const { dependencies, counters } = makeHarness({
    artifact: syntheticArtifact({ immutableReferences: { 1: [{ start: 1, length: 32 }] } })
  });

  await expectOperatorError(runCredentialRegistryDeployment(dependencies, EXECUTE), 'ARTIFACT_INVALID');
  assert.equal(counters.send, 0);
  assert.deepEqual(counters.providerCalls, []);
});

test('artefacto con hashes distintos de los revisados -> ARTIFACT_INVALID, cero envios', async () => {
  const { dependencies, counters } = makeHarness({
    artifact: syntheticArtifact({ runtime: `${RUNTIME_BYTECODE}00`, creation: `${CREATION_BYTECODE}00` })
  });

  const error = await expectOperatorError(
    runCredentialRegistryDeployment(dependencies, EXECUTE),
    'ARTIFACT_INVALID'
  );
  assert.deepEqual(error.reasons, ['ARTIFACT_HASH_DIFFERS_FROM_REVIEWED']);
  assert.equal(counters.send, 0);
});

test('78/79/77 fuente: commit malformado, HEAD distinto y arbol sucio impiden preparar', async () => {
  for (const bad of ['', 'abc', 'A'.repeat(40), 'g'.repeat(40), 'a'.repeat(39), 'a'.repeat(41)]) {
    const { dependencies, counters } = makeHarness();
    await expectOperatorError(
      runCredentialRegistryDeployment(dependencies, { deploymentSourceCommit: bad, mode: 'execute' }),
      'SOURCE_COMMIT_INVALID'
    );
    assert.equal(counters.send, 0);
  }

  const mismatch = makeHarness({ head: 'b'.repeat(40) });
  await expectOperatorError(runCredentialRegistryDeployment(mismatch.dependencies, EXECUTE), 'SOURCE_COMMIT_MISMATCH');
  assert.deepEqual(mismatch.counters.providerCalls, []);

  const dirty = makeHarness({ dirty: ['contracts/src/CredentialRegistry.sol'] });
  const error = await expectOperatorError(runCredentialRegistryDeployment(dirty.dependencies, EXECUTE), 'SOURCE_TREE_DIRTY');
  assert.equal(JSON.stringify(describeDeploymentError(error)).includes('CredentialRegistry.sol'), false);
  assert.deepEqual(dirty.counters.providerCalls, []);
});

test('toolchain: version distinta o salida irreconocible -> TOOLCHAIN_MISMATCH, cero envios', async () => {
  for (const forgeOutput of [
    'forge Version: 1.2.4-stable\nCommit SHA: a813a2cee7dd4926e7c56fd8a785b54f32e0d10f\n',
    'forge Version: 1.2.3-stable\nCommit SHA: ' + 'f'.repeat(40) + '\n',
    'forge 1.2.3',
    ''
  ]) {
    const { dependencies, counters } = makeHarness({ forgeOutput });
    await expectOperatorError(runCredentialRegistryDeployment(dependencies, EXECUTE), 'TOOLCHAIN_MISMATCH');
    assert.equal(counters.send, 0);
  }
});

test('signer: keystore/frase invalidos -> SIGNER_UNAVAILABLE sin ruta ni detalle', async () => {
  const { dependencies, counters } = makeHarness({ signerLoadError: true });
  const error = await expectOperatorError(
    runCredentialRegistryDeployment(dependencies, EXECUTE),
    'SIGNER_UNAVAILABLE'
  );

  assert.equal(counters.send, 0);
  const printed = JSON.stringify(describeDeploymentError(error));
  assert.equal(printed.includes('/home/operator'), false);
  assert.equal(printed.includes('invalid password'), false);
});

test('direccion CREATE ocupada / manifest preexistente / gas inestimable -> cero envios', async () => {
  const occupied = makeHarness({ occupied: true });
  await expectOperatorError(runCredentialRegistryDeployment(occupied.dependencies, EXECUTE), 'CREATE_ADDRESS_OCCUPIED');
  assert.equal(occupied.counters.send, 0);

  const existing = makeHarness({ manifestExists: true });
  await expectOperatorError(runCredentialRegistryDeployment(existing.dependencies, EXECUTE), 'MANIFEST_ALREADY_EXISTS');
  assert.equal(existing.counters.send, 0);

  const estimate = makeHarness({ estimateError: true });
  await expectOperatorError(runCredentialRegistryDeployment(estimate.dependencies, EXECUTE), 'PRE_SEND_ESTIMATE_FAILED');
  assert.equal(estimate.counters.send, 0);
});

// ---------------------------------------------------------------------------
// Envio ambiguo / timeout: sin reintento
// ---------------------------------------------------------------------------

test('46 envio ambiguo -> AMBIGUOUS_DEPLOYMENT_SEND, UN solo intento, contexto de reconciliacion', async () => {
  for (const options of [{ sendError: true }, { sendHash: null }, { sendHash: '0x12' }]) {
    const { dependencies, counters } = makeHarness(options);
    const error = await expectOperatorError(
      runCredentialRegistryDeployment(dependencies, EXECUTE),
      'AMBIGUOUS_DEPLOYMENT_SEND'
    );

    assert.equal(counters.send, 1, 'ningun reintento');
    assert.equal(error.context.deployerAddress, DEPLOYER_ADDRESS);
    assert.equal(error.context.nonce, NONCE);
    assert.equal(error.context.expectedCreateAddress, EXPECTED_CREATE_ADDRESS);
    assert.equal(error.context.chainId, 84532);
    assert.equal(error.context.creationBytecodeHash, CREATION_HASH);
    assert.equal(error.context.transactionHash, undefined);
    assert.equal(JSON.stringify(describeDeploymentError(error)).includes('underpriced'), false);
    assert.equal(counters.manifestWrites.length, 0);
  }
});

test('47 timeout de minado con tx conocida -> PENDING_RECONCILIATION, cero reintentos', async () => {
  for (const options of [{ waitError: true }, { waitReceipt: null }]) {
    const { dependencies, counters } = makeHarness(options);
    const error = await expectOperatorError(
      runCredentialRegistryDeployment(dependencies, EXECUTE),
      'DEPLOYMENT_PENDING_RECONCILIATION'
    );

    assert.equal(counters.send, 1);
    assert.equal(error.context.transactionHash, TX_HASH);
    assert.equal(counters.manifestWrites.length, 0);
  }
});

// ---------------------------------------------------------------------------
// Recibo
// ---------------------------------------------------------------------------

test('49-53 recibo invalido -> sin manifest', async () => {
  const cases: Array<[string, Parameters<typeof goodReceipt>[0], DeploymentOperatorErrorCode]> = [
    ['status failed', { status: 0 }, 'DEPLOYMENT_FAILED_RECEIPT'],
    ['status null', { status: null }, 'DEPLOYMENT_FAILED_RECEIPT'],
    ['to no nulo', { to: OTHER_ADDRESS }, 'DEPLOYMENT_RECEIPT_INVALID'],
    ['from distinto', { from: OTHER_ADDRESS }, 'DEPLOYMENT_RECEIPT_INVALID'],
    ['sin contractAddress', { contractAddress: null }, 'DEPLOYMENT_RECEIPT_INVALID'],
    ['contractAddress invalida', { contractAddress: '0x1234' }, 'DEPLOYMENT_RECEIPT_INVALID'],
    ['no es la CREATE esperada', { contractAddress: OTHER_ADDRESS }, 'DEPLOYMENT_RECEIPT_INVALID'],
    ['hash distinto', { hash: `0x${'e'.repeat(64)}` }, 'DEPLOYMENT_RECEIPT_INVALID'],
    ['bloque invalido', { blockNumber: 0 }, 'DEPLOYMENT_RECEIPT_INVALID'],
    ['blockHash malformado', { blockHash: '0x12' }, 'DEPLOYMENT_RECEIPT_INVALID']
  ];

  for (const [label, patch, code] of cases) {
    const { dependencies, counters } = makeHarness({ waitReceipt: goodReceipt(patch) });
    await expectOperatorError(runCredentialRegistryDeployment(dependencies, EXECUTE), code);
    assert.equal(counters.manifestWrites.length, 0, label);
    assert.equal(counters.send, 1, label);
  }
});

// ---------------------------------------------------------------------------
// Codigo runtime
// ---------------------------------------------------------------------------

test('54-58 codigo runtime: vacio, de un byte, distinto -> rechazado; exacto (cualquier caja) -> aceptado', async () => {
  const afterSend = (code: string) => (address: string, n: number) =>
    n === 1 ? '0x' : address === EXPECTED_CREATE_ADDRESS ? code : '0x';

  const empty = makeHarness({ codeAt: afterSend('0x') });
  await expectOperatorError(runCredentialRegistryDeployment(empty.dependencies, EXECUTE), 'DEPLOYMENT_CODE_EMPTY');
  assert.equal(empty.counters.manifestWrites.length, 0);

  for (const code of ['0x60', `${RUNTIME_BYTECODE}00`, RUNTIME_BYTECODE.slice(0, -2), `0x${'00'.repeat(60)}`]) {
    const mismatch = makeHarness({ codeAt: afterSend(code) });
    await expectOperatorError(runCredentialRegistryDeployment(mismatch.dependencies, EXECUTE), 'DEPLOYMENT_IDENTITY_MISMATCH');
    assert.equal(mismatch.counters.manifestWrites.length, 0);
  }

  const upper = makeHarness({ codeAt: afterSend(`0x${RUNTIME_BYTECODE.slice(2).toUpperCase()}`) });
  const result = await runCredentialRegistryDeployment(upper.dependencies, EXECUTE);
  assert.equal(result.kind, 'finalized');
  assert.equal(keccak256(RUNTIME_BYTECODE), RUNTIME_HASH);
});

test('59 la tx observada debe ser LA creacion revisada', async () => {
  const base = {
    hash: TX_HASH,
    to: null,
    from: DEPLOYER_ADDRESS,
    data: CREATION_BYTECODE,
    chainId: 84532n
  };
  for (const patch of [
    { data: `${CREATION_BYTECODE}00` },
    { data: '0x' },
    { to: OTHER_ADDRESS },
    { from: OTHER_ADDRESS },
    { chainId: 1n }
  ]) {
    const { dependencies, counters } = makeHarness({ transaction: { ...base, ...patch } });
    await expectOperatorError(runCredentialRegistryDeployment(dependencies, EXECUTE), 'DEPLOYMENT_TRANSACTION_MISMATCH');
    assert.equal(counters.manifestWrites.length, 0);
  }

  const missing = makeHarness({ transaction: null });
  await expectOperatorError(runCredentialRegistryDeployment(missing.dependencies, EXECUTE), 'DEPLOYMENT_TRANSACTION_MISMATCH');
});

test('60/61 bloque: ausente, numero distinto, hash malformado o distinto -> sin manifest', async () => {
  for (const block of [
    null,
    goodBlock({ number: BLOCK_NUMBER + 1 }),
    goodBlock({ hash: '0x12' }),
    goodBlock({ hash: null }),
    goodBlock({ hash: `0x${'e'.repeat(64)}` }),
    goodBlock({ timestamp: 0 })
  ]) {
    const { dependencies, counters } = makeHarness({ blockAt: () => block });
    await expectOperatorError(runCredentialRegistryDeployment(dependencies, EXECUTE), 'DEPLOYMENT_BLOCK_INVALID');
    assert.equal(counters.manifestWrites.length, 0);
  }
});

// ---------------------------------------------------------------------------
// Confirmaciones
// ---------------------------------------------------------------------------

test('63 sin las 5 confirmaciones NO se construye ningun manifest', async () => {
  for (const latestBlock of [BLOCK_NUMBER, BLOCK_NUMBER + 3]) {
    const { dependencies, counters } = makeHarness({ latestBlock });
    await expectOperatorError(runCredentialRegistryDeployment(dependencies, EXECUTE), 'DEPLOYMENT_NOT_YET_CONFIRMED');
    assert.equal(counters.manifestWrites.length, 0);
  }

  // Exactamente 5 (el bloque del deployment cuenta como la primera).
  const exact = makeHarness({ latestBlock: BLOCK_NUMBER + 4 });
  assert.equal((await runCredentialRegistryDeployment(exact.dependencies, EXECUTE)).kind, 'finalized');
});

test('65 la relectura tras las confirmaciones contradice la original -> no finaliza', async () => {
  const otherHash = `0x${'9'.repeat(64)}`;

  const reorg = makeHarness({
    receiptAt: () => goodReceipt({ blockHash: otherHash }),
    // Pasada A (aun no se leyo ningun recibo): original. Pasada B: el bloque reorganizado.
    blockAt: (reads) => (reads === 0 ? goodBlock() : goodBlock({ hash: otherHash }))
  });
  await expectOperatorError(runCredentialRegistryDeployment(reorg.dependencies, EXECUTE), 'DEPLOYMENT_EVIDENCE_CONTRADICTION');
  assert.equal(reorg.counters.manifestWrites.length, 0);

  const lost = makeHarness({ receiptAt: () => null });
  await expectOperatorError(runCredentialRegistryDeployment(lost.dependencies, EXECUTE), 'DEPLOYMENT_RECEIPT_INVALID');
  assert.equal(lost.counters.manifestWrites.length, 0);

  // El codigo cambia entre la pasada A y la B.
  const codeChanged = makeHarness({
    codeAt: (address, n) =>
      address !== EXPECTED_CREATE_ADDRESS ? '0x' : n === 1 ? '0x' : n === 2 ? RUNTIME_BYTECODE : '0x'
  });
  await expectOperatorError(runCredentialRegistryDeployment(codeChanged.dependencies, EXECUTE), 'DEPLOYMENT_CODE_EMPTY');
  assert.equal(codeChanged.counters.manifestWrites.length, 0);
});

test('un fallo de transporte tras tener el hash es PENDING_RECONCILIATION, no un fallo del deployment', async () => {
  const { dependencies, counters } = makeHarness();
  dependencies.provider.getBlock = async () => {
    throw new Error('ECONNRESET https://rpc.example/token');
  };

  const error = await expectOperatorError(
    runCredentialRegistryDeployment(dependencies, EXECUTE),
    'DEPLOYMENT_PENDING_RECONCILIATION'
  );
  assert.equal(counters.send, 1);
  assert.equal(JSON.stringify(describeDeploymentError(error)).includes('rpc.example'), false);
});

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

test('68/69 fallo al persistir el manifest: no redeploya y solo imprime evidencia de reconstruccion', async () => {
  const { dependencies, counters } = makeHarness({ writeError: true });
  const error = await expectOperatorError(
    runCredentialRegistryDeployment(dependencies, EXECUTE),
    'DEPLOYMENT_MANIFEST_PERSISTENCE_FAILED'
  );

  assert.equal(counters.send, 1, 'el contrato ya existe: ningun segundo envio');
  assert.deepEqual(Object.keys(error.context).sort(), [
    'blockNumber',
    'chainId',
    'contractAddress',
    'creationBytecodeHash',
    'deployerAddress',
    'deploymentId',
    'deploymentSourceCommit',
    'expectedCreateAddress',
    'nonce',
    'runtimeBytecodeHash',
    'transactionHash'
  ]);
  assert.equal(error.context.transactionHash, TX_HASH);
  assert.equal(error.context.contractAddress, EXPECTED_CREATE_ADDRESS);
  assert.equal(error.context.blockNumber, BLOCK_NUMBER);

  const printed = JSON.stringify(describeDeploymentError(error));
  for (const forbidden of ['EACCES', 'secret-path', '/home/', 'privateKey', 'passphrase', 'rpc']) {
    assert.equal(printed.includes(forbidden), false, forbidden);
  }
});

test('el error desconocido se reduce a un literal fijo', () => {
  assert.deepEqual(describeDeploymentError(new Error('0xabc secret https://rpc/x')), {
    ok: false,
    code: 'UNEXPECTED',
    message: 'La operacion fallo por un error no clasificado.'
  });
});

test('el contexto del error es una ALLOWLIST: un objeto ajeno no se serializa', () => {
  const error = new DeploymentOperatorError('CHAIN_UNAVAILABLE', {
    context: {
      deployerAddress: DEPLOYER_ADDRESS,
      privateKey: '0xdeadbeef',
      rpcUrl: 'https://rpc/secret'
    } as never
  });

  assert.deepEqual(error.context, { deployerAddress: DEPLOYER_ADDRESS });
});

// ---------------------------------------------------------------------------
// 80: un archivo ignorado/externo no cuenta como suciedad (git real, en tmp)
// ---------------------------------------------------------------------------

test('80 el keystore externo/ignorado no cuenta como fuente sucia; un cambio relevante si', () => {
  const directory = mkdtempSync(join(tmpdir(), 'scope-gate-'));
  try {
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: directory, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });

    git('init', '-q');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'test');
    mkdirSync(join(directory, 'contracts', 'out'), { recursive: true });
    writeFileSync(join(directory, '.gitignore'), 'contracts/out/\nkeystore.json\n');
    writeFileSync(join(directory, 'contracts', 'a.sol'), 'contract A {}\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'init');

    const reader = new ProcessGitStateReader(directory);
    const paths = ['contracts'];

    // Ignorados y externos: no ensucian.
    writeFileSync(join(directory, 'keystore.json'), '{}');
    writeFileSync(join(directory, 'contracts', 'out', 'artifact.json'), '{}');
    writeFileSync(join(directory, 'unrelated.txt'), 'parallel work');
    assert.equal(reader.headSha(), git('rev-parse', 'HEAD').trim());
    assert.deepEqual(reader.dirtyPaths(paths), []);

    // Un cambio rastreado relevante, si.
    writeFileSync(join(directory, 'contracts', 'a.sol'), 'contract B {}\n');
    assert.deepEqual(reader.dirtyPaths(paths), ['contracts/a.sol']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

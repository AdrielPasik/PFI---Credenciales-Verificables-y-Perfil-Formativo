import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { tryResolveBlockchainTarget } from '../blockchain-target';
import { FROZEN_COMPILER_SETTINGS } from './deployment-artifact';
import {
  DEPLOYMENT_MANIFEST_FIELDS,
  type DeploymentManifest,
  buildDeploymentManifest,
  serializeDeploymentManifest,
  validateDeploymentManifest
} from './deployment-manifest';
import {
  assertForgeMatchesToolchain,
  parseDeploymentToolchain,
  parseForgeVersionOutput
} from './deployment-toolchain';
import { FileManifestStore, ManifestStoreError } from './manifest-store';
import {
  checkTargetAgainstManifest,
  formatTargetManifestCheck
} from './target-manifest-consistency';
import { DeploymentOperatorError } from './deployment-errors';
import {
  CREATION_HASH,
  DEPLOYER_ADDRESS,
  EXPECTED_CREATE_ADDRESS,
  FORGE_OUTPUT,
  OTHER_ADDRESS,
  RUNTIME_HASH,
  SOURCE_COMMIT,
  fixtureToolchain
} from './__fixtures__/deployment-fixtures';

/** Matriz de manifest (9-20), almacen (66-67), consistencia (70-76) y toolchain. */

function manifest(): DeploymentManifest {
  return buildDeploymentManifest({
    contractAddress: EXPECTED_CREATE_ADDRESS,
    deploymentTransactionHash: `0x${'c'.repeat(64)}`,
    deploymentBlockNumber: 1000,
    deploymentBlockHash: `0x${'d'.repeat(64)}`,
    deploymentTimestamp: '2026-09-21T14:13:20Z',
    deployerAddress: DEPLOYER_ADDRESS,
    deploymentSourceCommit: SOURCE_COMMIT,
    foundryVersion: '1.2.3-stable',
    creationBytecodeHash: CREATION_HASH,
    runtimeBytecodeHash: RUNTIME_HASH
  });
}

function reasons(candidate: unknown): readonly string[] {
  const result = validateDeploymentManifest(candidate);
  return result.ok ? [] : result.reasons;
}

function patched(patch: Record<string, unknown>) {
  return { ...manifest(), ...patch };
}

// ---------------------------------------------------------------------------
// Validador
// ---------------------------------------------------------------------------

test('9 el manifest valido pasa y conserva el orden canonico de campos', () => {
  const built = manifest();

  assert.ok(validateDeploymentManifest(built).ok);
  assert.deepEqual(Object.keys(built), [...DEPLOYMENT_MANIFEST_FIELDS]);
  assert.deepEqual(JSON.parse(serializeDeploymentManifest(built)), JSON.parse(JSON.stringify(built)));
  assert.equal(built.solidityVersion, '0.8.26');
  assert.deepEqual(built.compilerSettings, FROZEN_COMPILER_SETTINGS);
});

test('10-18 campos invalidos se rechazan', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['10 schema', { schemaVersion: 'credential_registry_deployment_v2' }, 'SCHEMA_VERSION'],
    ['11 red', { network: 'anvil' }, 'NETWORK'],
    ['11 red mainnet', { network: 'base_mainnet' }, 'NETWORK'],
    ['12 chain', { chainId: 31337 }, 'CHAIN_ID'],
    ['12 chain string', { chainId: '84532' }, 'CHAIN_ID'],
    ['13 address malformada', { contractAddress: '0x1234' }, 'CONTRACT_ADDRESS'],
    ['13 address minuscula (no EIP-55)', { contractAddress: EXPECTED_CREATE_ADDRESS.toLowerCase() }, 'CONTRACT_ADDRESS'],
    ['13 deployer malformado', { deployerAddress: 'nope' }, 'DEPLOYER_ADDRESS'],
    ['14 tx hash corto', { deploymentTransactionHash: '0x12' }, 'TRANSACTION_HASH'],
    ['14 tx hash mayuscula', { deploymentTransactionHash: `0x${'C'.repeat(64)}` }, 'TRANSACTION_HASH'],
    ['15 block hash', { deploymentBlockHash: `0x${'z'.repeat(64)}` }, 'BLOCK_HASH'],
    ['16 bloque cero', { deploymentBlockNumber: 0 }, 'BLOCK_NUMBER'],
    ['16 bloque negativo', { deploymentBlockNumber: -1 }, 'BLOCK_NUMBER'],
    ['16 bloque fraccion', { deploymentBlockNumber: 1.5 }, 'BLOCK_NUMBER'],
    ['16 bloque inseguro', { deploymentBlockNumber: Number.MAX_SAFE_INTEGER + 1 }, 'BLOCK_NUMBER'],
    ['17 commit corto', { deploymentSourceCommit: 'abc123' }, 'SOURCE_COMMIT'],
    ['17 commit mayuscula', { deploymentSourceCommit: 'A'.repeat(40) }, 'SOURCE_COMMIT'],
    ['18 constructor args', { constructorArguments: ['0x01'] }, 'CONSTRUCTOR_ARGUMENTS'],
    ['timestamp con millis', { deploymentTimestamp: '2026-09-21T14:13:20.000Z' }, 'TIMESTAMP'],
    ['timestamp inexistente', { deploymentTimestamp: '2026-02-30T00:00:00Z' }, 'TIMESTAMP'],
    ['timestamp con offset', { deploymentTimestamp: '2026-09-21T14:13:20+00:00' }, 'TIMESTAMP'],
    ['solidity', { solidityVersion: '0.8.27' }, 'SOLIDITY_VERSION'],
    ['settings', { compilerSettings: { ...FROZEN_COMPILER_SETTINGS, optimizer: { enabled: true, runs: 200 } } }, 'COMPILER_SETTINGS'],
    ['creation hash', { creationBytecodeHash: '0x12' }, 'CREATION_BYTECODE_HASH'],
    ['runtime hash', { runtimeBytecodeHash: '0x12' }, 'RUNTIME_BYTECODE_HASH'],
    ['foundry', { foundryVersion: '' }, 'FOUNDRY_VERSION']
  ];

  for (const [label, patch, code] of cases) {
    assert.ok(reasons(patched(patch)).includes(code), label);
  }
});

test('19 un deploymentId que no es la derivacion canonica se rechaza', () => {
  for (const deploymentId of [
    `base-sepolia-84532-${OTHER_ADDRESS.toLowerCase()}`,
    `base-sepolia-84532-${EXPECTED_CREATE_ADDRESS}`,
    'unset',
    'base-sepolia-84532-0x' + 'a'.repeat(10),
    'anvil-31337-' + EXPECTED_CREATE_ADDRESS.toLowerCase()
  ]) {
    assert.ok(reasons(patched({ deploymentId })).includes('DEPLOYMENT_ID'), deploymentId);
  }
});

test('20 el validador es estricto: campos desconocidos o con aspecto de secreto se rechazan sin reflejarlos', () => {
  for (const extra of ['privateKey', 'rpcUrl', 'secretRef', 'keystorePath', 'mnemonic', 'currentReadiness', 'sourceVerification']) {
    const result = validateDeploymentManifest({ ...manifest(), [extra]: 'x' });
    assert.equal(result.ok, false, extra);
    assert.ok(!result.ok && result.reasons.includes('UNKNOWN_FIELD'));
    assert.equal(JSON.stringify(result).includes(extra), false, 'el nombre del campo no se refleja');
  }

  const missing = { ...manifest() } as Record<string, unknown>;
  delete missing.deploymentBlockHash;
  assert.ok(reasons(missing).includes('MISSING_FIELD'));

  for (const nonObject of [null, 'x', 1, [], undefined]) {
    assert.deepEqual(reasons(nonObject), ['MANIFEST_NOT_AN_OBJECT']);
  }
});

test('40 el manifest no tiene lugar para RPC, secretos ni estado mutable', () => {
  const printed = serializeDeploymentManifest(manifest());
  for (const forbidden of ['rpc', 'http', 'secret', 'keystore', 'privateKey', 'mnemonic', 'passphrase', 'funded', 'readiness']) {
    assert.equal(printed.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  }
});

// ---------------------------------------------------------------------------
// Almacen append-only (66-67)
// ---------------------------------------------------------------------------

test('66/67 el manifest es append-only: crear-exclusivo, jamas sobrescribe', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'scope-manifest-'));
  try {
    const store = new FileManifestStore(directory);
    const built = manifest();

    assert.equal(await store.exists(built.deploymentId), false);
    const path = await store.writeNew(built);
    assert.equal(path, join(directory, `${built.deploymentId}.json`));
    assert.equal(await store.exists(built.deploymentId), true);
    const original = readFileSync(path, 'utf8');
    assert.equal(original, serializeDeploymentManifest(built));

    await assert.rejects(
      store.writeNew(built),
      (e: unknown) => e instanceof ManifestStoreError && e.code === 'MANIFEST_ALREADY_EXISTS'
    );
    assert.equal(readFileSync(path, 'utf8'), original, 'el archivo existente no cambio');
    assert.deepEqual(readdirSync(directory), [`${built.deploymentId}.json`]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('un manifest invalido no toca el disco y el id nunca escapa del directorio', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'scope-manifest-'));
  try {
    const store = new FileManifestStore(directory);

    await assert.rejects(
      store.writeNew({ ...manifest(), contractAddress: '0x1234' } as DeploymentManifest),
      (e: unknown) => e instanceof ManifestStoreError && e.code === 'MANIFEST_INVALID'
    );
    assert.deepEqual(readdirSync(directory), []);

    for (const id of ['../escape', 'latest', 'unset', '', 'base-sepolia-84532-0xZZ']) {
      assert.throws(() => store.pathFor(id), ManifestStoreError, id);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('NO se crea ningun manifest real de Base Sepolia en el repositorio', () => {
  const deployments = join(__dirname, '..', '..', '..', '..', '..', 'contracts', 'deployments');
  assert.ok(existsSync(deployments));
  assert.deepEqual(
    readdirSync(deployments).filter((name) => name.startsWith('base-sepolia-')),
    []
  );
});

// ---------------------------------------------------------------------------
// Consistencia manifest <-> target (70-76)
// ---------------------------------------------------------------------------

function safeTarget(patch: Record<string, string | undefined> = {}) {
  const built = manifest();
  return {
    CREDENTIAL_REGISTRY_NETWORK: built.network,
    CREDENTIAL_REGISTRY_CHAIN_ID: String(built.chainId),
    CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: built.contractAddress,
    CREDENTIAL_REGISTRY_DEPLOYMENT_ID: built.deploymentId,
    ...patch
  };
}

test('75 el target exacto coincide', () => {
  const check = checkTargetAgainstManifest(manifest(), safeTarget());
  assert.equal(check.ok, true);
  assert.equal(formatTargetManifestCheck(check), 'TARGET_MATCH=true');

  // La direccion configurada en minuscula es la misma direccion.
  assert.equal(
    checkTargetAgainstManifest(manifest(), safeTarget({ CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: EXPECTED_CREATE_ADDRESS.toLowerCase() })).ok,
    true
  );
});

test('70-74 unset, red, chain, direccion y deploymentId distintos se rechazan', () => {
  const cases: Array<[string, Record<string, string | undefined>, string]> = [
    ['70 unset', { CREDENTIAL_REGISTRY_DEPLOYMENT_ID: 'unset' }, 'DEPLOYMENT_ID_UNSET'],
    ['70 UNSET', { CREDENTIAL_REGISTRY_DEPLOYMENT_ID: 'UNSET' }, 'DEPLOYMENT_ID_UNSET'],
    ['71 red', { CREDENTIAL_REGISTRY_NETWORK: 'anvil' }, 'NETWORK_MISMATCH'],
    ['72 chain', { CREDENTIAL_REGISTRY_CHAIN_ID: '31337' }, 'CHAIN_MISMATCH'],
    ['72 chain con espacios', { CREDENTIAL_REGISTRY_CHAIN_ID: ' 84532' }, 'CHAIN_MISMATCH'],
    ['72 chain cero a la izquierda', { CREDENTIAL_REGISTRY_CHAIN_ID: '084532' }, 'CHAIN_MISMATCH'],
    ['73 direccion', { CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: OTHER_ADDRESS }, 'ADDRESS_MISMATCH'],
    ['73 direccion sin 0x', { CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: EXPECTED_CREATE_ADDRESS.slice(2) }, 'ADDRESS_MISMATCH'],
    ['74 deploymentId', { CREDENTIAL_REGISTRY_DEPLOYMENT_ID: `base-sepolia-84532-${OTHER_ADDRESS.toLowerCase()}` }, 'DEPLOYMENT_ID_MISMATCH']
  ];

  for (const [label, patch, code] of cases) {
    const check = checkTargetAgainstManifest(manifest(), safeTarget(patch));
    assert.equal(check.ok, false, label);
    assert.ok(!check.ok && check.reasons.includes(code as never), label);
    assert.match(formatTargetManifestCheck(check), /^TARGET_MATCH=false REASONS=/);
  }
});

test('un target incompleto o un manifest invalido fallan cerrado, sin reflejar configuracion', () => {
  const incomplete = checkTargetAgainstManifest(manifest(), safeTarget({ CREDENTIAL_REGISTRY_NETWORK: undefined }));
  assert.deepEqual(!incomplete.ok && incomplete.reasons, ['TARGET_INCOMPLETE']);

  const invalid = checkTargetAgainstManifest({ ...manifest(), chainId: 1 }, safeTarget());
  assert.deepEqual(!invalid.ok && invalid.reasons, ['MANIFEST_INVALID']);

  const printed = formatTargetManifestCheck(
    checkTargetAgainstManifest(manifest(), safeTarget({ CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: OTHER_ADDRESS }))
  );
  assert.equal(printed.includes(OTHER_ADDRESS), false);
});

test('35/76 hardening de configuracion: unset rechazado y NUNCA degrada a mock', () => {
  const realTarget = {
    BLOCKCHAIN_EVIDENCE_MODE: 'credential_registry',
    CREDENTIAL_REGISTRY_NETWORK: 'base_sepolia',
    CREDENTIAL_REGISTRY_CHAIN_ID: '84532',
    CREDENTIAL_REGISTRY_RPC_URL: 'https://rpc.example.invalid/placeholder',
    CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: EXPECTED_CREATE_ADDRESS,
    CREDENTIAL_REGISTRY_DEPLOYMENT_ID: manifest().deploymentId
  };

  // El target canonico se resuelve como credential_registry real.
  const ok = tryResolveBlockchainTarget(realTarget);
  assert.ok(ok.ok && ok.target.evidenceMode === 'credential_registry');

  for (const unset of ['unset', 'UNSET', 'Unset']) {
    const result = tryResolveBlockchainTarget({ ...realTarget, CREDENTIAL_REGISTRY_DEPLOYMENT_ID: unset });
    assert.equal(result.ok, false, unset);
    assert.ok(!result.ok && result.field === 'CREDENTIAL_REGISTRY_DEPLOYMENT_ID');
  }

  // base_sepolia con un chainId que no es 84532: rechazado, sin mock.
  for (const chainId of ['31337', '8453', '1']) {
    const result = tryResolveBlockchainTarget({ ...realTarget, CREDENTIAL_REGISTRY_CHAIN_ID: chainId });
    assert.equal(result.ok, false, chainId);
    assert.ok(!result.ok && result.field === 'CREDENTIAL_REGISTRY_CHAIN_ID');
  }

  // Target real malformado: jamas {ok: true, mock}.
  for (const patch of [
    { CREDENTIAL_REGISTRY_NETWORK: undefined },
    { CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: undefined },
    { CREDENTIAL_REGISTRY_RPC_URL: 'http://rpc.example.invalid' },
    { CREDENTIAL_REGISTRY_DEPLOYMENT_ID: undefined }
  ]) {
    const result = tryResolveBlockchainTarget({ ...realTarget, ...patch });
    assert.equal(result.ok, false);
  }

  // La semantica mock se preserva: modo ausente o `mock` sigue siendo mock.
  for (const env of [{}, { BLOCKCHAIN_EVIDENCE_MODE: 'mock' }]) {
    const result = tryResolveBlockchainTarget(env);
    assert.ok(result.ok && result.target.evidenceMode === 'mock');
  }
});

// ---------------------------------------------------------------------------
// Toolchain
// ---------------------------------------------------------------------------

test('la salida de forge --version se normaliza (CRLF incluido) y exige version Y commit', () => {
  assert.deepEqual(parseForgeVersionOutput(FORGE_OUTPUT), {
    version: '1.2.3-stable',
    commitSha: 'a813a2cee7dd4926e7c56fd8a785b54f32e0d10f'
  });
  assert.deepEqual(parseForgeVersionOutput(FORGE_OUTPUT.replace(/\r\n/g, '\n')), parseForgeVersionOutput(FORGE_OUTPUT));
  assert.equal(parseForgeVersionOutput('forge 1.2.3'), null);
  assert.equal(parseForgeVersionOutput('forge Version: 1.2.3-stable\n'), null);

  assert.equal(assertForgeMatchesToolchain(FORGE_OUTPUT, fixtureToolchain()).version, '1.2.3-stable');
  assert.throws(
    () => assertForgeMatchesToolchain(FORGE_OUTPUT.replace('1.2.3', '1.3.0'), fixtureToolchain()),
    (e: unknown) => e instanceof DeploymentOperatorError && e.code === 'TOOLCHAIN_MISMATCH'
  );
});

test('el archivo de toolchain es estricto', () => {
  assert.doesNotThrow(() => parseDeploymentToolchain(fixtureToolchain()));
  for (const patch of [
    { network: 'anvil' },
    { chainId: 31337 },
    { solcVersion: '0.8.27' },
    { requiredForgeVersion: 'latest' },
    { requiredForgeCommitSha: 'abc' },
    { extra: 'x' },
    { compilerSettings: { optimizer: { enabled: true, runs: 200 }, viaIR: false, evmVersion: 'cancun', bytecodeHash: 'ipfs' } },
    { reviewedArtifact: { creationBytecodeHash: '0x12', runtimeBytecodeHash: RUNTIME_HASH } }
  ]) {
    assert.throws(() => parseDeploymentToolchain({ ...fixtureToolchain(), ...patch }));
  }
});

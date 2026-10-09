import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { getAddress } from 'ethers';

import {
  DeploymentArtifactError,
  readArtifactFile,
  validateCredentialRegistryArtifact
} from './deployment-artifact';
import {
  CANONICAL_DEPLOYMENT_ID_PREFIX,
  DeploymentIdError,
  deriveCanonicalDeploymentId,
  normalizeContractAddress
} from './deployment-id';
import {
  CREATION_BYTECODE,
  CREATION_HASH,
  EXPECTED_CREATE_ADDRESS,
  OTHER_ADDRESS,
  REAL_ABI,
  RUNTIME_BYTECODE,
  RUNTIME_HASH,
  fixtureToolchain,
  syntheticArtifact
} from './__fixtures__/deployment-fixtures';
import { readDeploymentToolchainFile } from './deployment-toolchain';

/** Matriz de artefacto (1-8) e identidad de deployment (21-29). */

function reasonsOf(artifact: unknown): readonly string[] {
  try {
    validateCredentialRegistryArtifact(artifact);
  } catch (error) {
    assert.ok(error instanceof DeploymentArtifactError);
    return error.reasons;
  }
  return [];
}

// ---------------------------------------------------------------------------
// Artefacto
// ---------------------------------------------------------------------------

test('1 el artefacto exacto se acepta', () => {
  const artifact = validateCredentialRegistryArtifact(syntheticArtifact());

  assert.equal(artifact.contractName, 'CredentialRegistry');
  assert.equal(artifact.creationBytecode, CREATION_BYTECODE);
  assert.equal(artifact.runtimeBytecode, RUNTIME_BYTECODE);
  assert.equal(artifact.solidityVersion, '0.8.26');
});

test('2/3 bytecode vacio o malformado se rechaza', () => {
  for (const bad of ['', '0x', '0x1', '0xzz', '1234']) {
    assert.ok(reasonsOf(syntheticArtifact({ creation: bad })).includes('ARTIFACT_EMPTY_CREATION_BYTECODE'), bad);
    assert.ok(reasonsOf(syntheticArtifact({ runtime: bad })).includes('ARTIFACT_EMPTY_RUNTIME_BYTECODE'), bad);
  }
});

test('4 linkReferences no vacio se rechaza (creation y runtime)', () => {
  const links = { 'src/Lib.sol': { Lib: [{ start: 1, length: 20 }] } };
  assert.ok(reasonsOf(syntheticArtifact({ bytecodeLinkReferences: links })).includes('ARTIFACT_LINK_REFERENCES'));
  assert.ok(reasonsOf(syntheticArtifact({ deployedLinkReferences: links })).includes('ARTIFACT_LINK_REFERENCES'));
});

test('5 immutableReferences no vacio se rechaza; ausente o {} se acepta', () => {
  assert.ok(reasonsOf(syntheticArtifact({ immutableReferences: { 7: [{ start: 1, length: 32 }] } })).includes('ARTIFACT_IMMUTABLES'));
  assert.deepEqual(reasonsOf(syntheticArtifact({ immutableReferences: {} })), []);
  assert.deepEqual(reasonsOf(syntheticArtifact()), []);
});

test('6 nombre de contrato distinto se rechaza', () => {
  for (const compilationTarget of [
    { 'src/CredentialRegistry.sol': 'Other' },
    { 'src/Other.sol': 'CredentialRegistry' },
    {},
    { 'src/CredentialRegistry.sol': 'CredentialRegistry', 'src/X.sol': 'X' }
  ]) {
    assert.ok(reasonsOf(syntheticArtifact({ compilationTarget })).includes('ARTIFACT_CONTRACT_NAME'));
  }
});

test('7/8 los hashes son deterministas, COMPLETOS y del bytecode completo', () => {
  const first = validateCredentialRegistryArtifact(syntheticArtifact());
  const second = validateCredentialRegistryArtifact(syntheticArtifact());

  assert.equal(first.creationBytecodeHash, second.creationBytecodeHash);
  assert.equal(first.runtimeBytecodeHash, second.runtimeBytecodeHash);
  assert.equal(first.creationBytecodeHash, CREATION_HASH);
  assert.equal(first.runtimeBytecodeHash, RUNTIME_HASH);
  assert.match(first.creationBytecodeHash, /^0x[0-9a-f]{64}$/);
  assert.notEqual(first.creationBytecodeHash, first.runtimeBytecodeHash);
});

test('el runtime tiene que estar tal cual dentro del creation code', () => {
  assert.ok(
    reasonsOf(syntheticArtifact({ creation: '0x5f5f60806040' + 'cd'.repeat(70) })).includes('ARTIFACT_RUNTIME_NOT_IN_CREATION')
  );
});

test('ABI distinto del congelado, o con constructor, se rechaza', () => {
  assert.ok(reasonsOf(syntheticArtifact({ abi: [] })).includes('ARTIFACT_ABI_MISMATCH'));
  assert.ok(
    reasonsOf(
      syntheticArtifact({
        abi: [...REAL_ABI, { type: 'function', name: 'owner', inputs: [], outputs: [], stateMutability: 'view' }]
      })
    ).includes('ARTIFACT_ABI_MISMATCH')
  );
  assert.ok(
    reasonsOf(
      syntheticArtifact({
        abi: [...REAL_ABI, { type: 'constructor', inputs: [{ name: 'a', type: 'address' }], stateMutability: 'nonpayable' }]
      })
    ).includes('ARTIFACT_CONSTRUCTOR_ARGS')
  );
});

test('compilador o settings distintos de los congelados se rechazan', () => {
  assert.ok(reasonsOf(syntheticArtifact({ compilerVersion: '0.8.27+commit.40a35a09' })).includes('ARTIFACT_COMPILER_VERSION'));
  assert.ok(reasonsOf(syntheticArtifact({ optimizerEnabled: true })).includes('ARTIFACT_COMPILER_SETTINGS'));
});

test('un artefacto malformado falla con un error de mensaje fijo', () => {
  for (const bad of [null, 'x', [], {}, { abi: [] }]) {
    assert.deepEqual(reasonsOf(bad), ['ARTIFACT_MALFORMED']);
  }
  assert.throws(() => readArtifactFile(join(__dirname, 'does-not-exist.json')), DeploymentArtifactError);
});

/**
 * Artefacto LOCAL real de `forge build`. `out/` esta ignorado: en un checkout
 * limpio no existe, asi que esta prueba solo corre cuando alguien compilo antes.
 */
const LOCAL_ARTIFACT = join(
  __dirname, '..', '..', '..', '..', '..', 'contracts', 'out', 'CredentialRegistry.sol', 'CredentialRegistry.json'
);
const TOOLCHAIN_FILE = join(
  __dirname, '..', '..', '..', '..', '..', 'contracts', 'deployments', 'deployment-toolchain.json'
);

test('artefacto LOCAL real: cumple el contrato y coincide con los hashes revisados', { skip: !existsSync(LOCAL_ARTIFACT) }, () => {
  const artifact = validateCredentialRegistryArtifact(readArtifactFile(LOCAL_ARTIFACT));
  const toolchain = readDeploymentToolchainFile(TOOLCHAIN_FILE);

  assert.equal(artifact.creationBytecodeHash, toolchain.reviewedArtifact.creationBytecodeHash);
  assert.equal(artifact.runtimeBytecodeHash, toolchain.reviewedArtifact.runtimeBytecodeHash);
});

test('el toolchain commiteado es valido y fixtureToolchain es coherente', () => {
  const toolchain = readDeploymentToolchainFile(TOOLCHAIN_FILE);
  assert.equal(toolchain.requiredForgeVersion, '1.2.3-stable');
  assert.equal(fixtureToolchain().network, toolchain.network);
});

// ---------------------------------------------------------------------------
// deploymentId
// ---------------------------------------------------------------------------

const BASE = { network: 'base_sepolia', chainId: 84532 };

test('21/23/24/25 usa la direccion COMPLETA en minuscula, el manifest queda en EIP-55 y mide <= 64', () => {
  const id = deriveCanonicalDeploymentId({ ...BASE, contractAddress: EXPECTED_CREATE_ADDRESS });

  assert.equal(id, `base-sepolia-84532-${EXPECTED_CREATE_ADDRESS.toLowerCase()}`);
  assert.equal(id.length, 61);
  assert.ok(id.length <= 64);
  assert.match(id, /^base-sepolia-84532-0x[0-9a-f]{40}$/);
  // Compatible con el patron actual del backend.
  assert.match(id, /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/);
  assert.equal(CANONICAL_DEPLOYMENT_ID_PREFIX, 'base-sepolia-84532-');
  assert.equal(normalizeContractAddress(EXPECTED_CREATE_ADDRESS), EXPECTED_CREATE_ADDRESS);
});

test('22 la direccion se normaliza de forma determinista', () => {
  const lower = EXPECTED_CREATE_ADDRESS.toLowerCase();
  const upperBody = `0x${EXPECTED_CREATE_ADDRESS.slice(2).toUpperCase()}`;

  assert.equal(normalizeContractAddress(lower), EXPECTED_CREATE_ADDRESS);
  assert.equal(
    deriveCanonicalDeploymentId({ ...BASE, contractAddress: lower }),
    deriveCanonicalDeploymentId({ ...BASE, contractAddress: EXPECTED_CREATE_ADDRESS })
  );
  // Todo en mayuscula carece de checksum (ethers lo admite) y normaliza igual.
  assert.equal(normalizeContractAddress(upperBody), EXPECTED_CREATE_ADDRESS);
});

test('26/27 mismo deployment -> mismo id; otra direccion -> otro id', () => {
  const a = deriveCanonicalDeploymentId({ ...BASE, contractAddress: EXPECTED_CREATE_ADDRESS });
  const b = deriveCanonicalDeploymentId({ ...BASE, contractAddress: EXPECTED_CREATE_ADDRESS });
  const c = deriveCanonicalDeploymentId({ ...BASE, contractAddress: OTHER_ADDRESS });

  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('28/29 red o chain equivocadas se rechazan', () => {
  for (const network of ['anvil', 'base_mainnet', 'base-sepolia', 'BASE_SEPOLIA', '', null, undefined]) {
    assert.throws(
      () => deriveCanonicalDeploymentId({ network, chainId: 84532, contractAddress: EXPECTED_CREATE_ADDRESS }),
      (e: unknown) => e instanceof DeploymentIdError && e.code === 'WRONG_NETWORK'
    );
  }
  for (const chainId of [31337, 8453, 1, '84532', 84532n, 0, null]) {
    assert.throws(
      () => deriveCanonicalDeploymentId({ network: 'base_sepolia', chainId, contractAddress: EXPECTED_CREATE_ADDRESS }),
      (e: unknown) => e instanceof DeploymentIdError && e.code === 'WRONG_CHAIN'
    );
  }
});

test('direcciones invalidas se rechazan: sin 0x, corta, no hex, cero, checksum erroneo, no string', () => {
  const body = EXPECTED_CREATE_ADDRESS.slice(2);
  // Cambiar la caja de una letra del checksum EIP-55 lo invalida.
  const letter = [...body].findIndex((ch) => /[a-fA-F]/.test(ch));
  const flipped = `0x${body.slice(0, letter)}${
    body[letter] === body[letter].toUpperCase() ? body[letter].toLowerCase() : body[letter].toUpperCase()
  }${body.slice(letter + 1)}`;

  for (const bad of [
    body,
    EXPECTED_CREATE_ADDRESS.slice(0, -1),
    `0x${'g'.repeat(40)}`,
    '0x0000000000000000000000000000000000000000',
    flipped,
    '',
    null,
    undefined,
    123
  ]) {
    assert.throws(
      () => deriveCanonicalDeploymentId({ ...BASE, contractAddress: bad }),
      (e: unknown) => e instanceof DeploymentIdError && e.code === 'INVALID_ADDRESS',
      String(bad)
    );
  }
});

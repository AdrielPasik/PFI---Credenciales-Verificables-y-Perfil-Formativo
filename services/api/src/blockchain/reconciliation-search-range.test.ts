import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  DEFAULT_MANIFEST_DIRECTORY,
  DeploymentSearchRangeError,
  resolveDeploymentSearchRange
} from './reconciliation-search-range';

const CONTRACT = '0xCb7401e268f61b1242B17fE141453471CFbdc6e1';
const DEPLOYMENT_ID = 'base-sepolia-84532-0xcb7401e268f61b1242b17fe141453471cfbdc6e1';

const IDENTITY = {
  network: 'base_sepolia',
  chainId: 84532,
  contractAddress: CONTRACT,
  deploymentId: DEPLOYMENT_ID
};

function manifest(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    schemaVersion: 'credential_registry_deployment_v1',
    deploymentId: DEPLOYMENT_ID,
    network: 'base_sepolia',
    chainId: 84532,
    contractAddress: CONTRACT,
    deploymentBlockNumber: 47934147,
    ...overrides
  });
}

function code(callback: () => unknown) {
  try {
    callback();
  } catch (error) {
    assert.ok(error instanceof DeploymentSearchRangeError);
    return error.code;
  }

  assert.fail('debia lanzar');
}

test('devuelve el bloque de deploy del manifest como limite inferior', () => {
  const range = resolveDeploymentSearchRange(IDENTITY, {
    manifestDirectory: '/m',
    readFile: () => manifest()
  });

  assert.deepEqual(range, { fromBlock: 47934147, toBlock: 'latest' });
});

test('acepta la direccion de la fila en minuscula (misma direccion, otro formato)', () => {
  const range = resolveDeploymentSearchRange(
    { ...IDENTITY, contractAddress: CONTRACT.toLowerCase() },
    { manifestDirectory: '/m', readFile: () => manifest() }
  );

  assert.equal(range.fromBlock, 47934147);
});

test('el deploymentId se valida ANTES de tocar el disco (sin traversal)', () => {
  let reads = 0;

  for (const deploymentId of [
    null,
    '',
    '../../etc/passwd',
    'base-sepolia-84532-0xCB7401e268f61b1242B17fE141453471CFbdc6e1',
    `${DEPLOYMENT_ID}/../x`,
    'unset'
  ]) {
    assert.equal(
      code(() =>
        resolveDeploymentSearchRange(
          { ...IDENTITY, deploymentId },
          {
            readFile: () => {
              reads += 1;
              return manifest();
            }
          }
        )
      ),
      'DEPLOYMENT_ID_INVALID'
    );
  }

  assert.equal(reads, 0);
});

test('manifest ausente, ilegible o no objeto = no disponible', () => {
  for (const read of [
    () => {
      throw new Error('ENOENT');
    },
    () => '{no json',
    () => 'null',
    () => '[]'
  ]) {
    assert.equal(
      code(() => resolveDeploymentSearchRange(IDENTITY, { readFile: read })),
      'MANIFEST_UNAVAILABLE'
    );
  }
});

test('un manifest que describe OTRO deployment, red, cadena o contrato se rechaza', () => {
  for (const overrides of [
    { deploymentId: 'base-sepolia-84532-0x' + 'a'.repeat(40) },
    { network: 'anvil' },
    { chainId: 31337 },
    { contractAddress: '0x' + '1'.repeat(40) },
    { contractAddress: 'no-es-direccion' },
    { schemaVersion: 'otro' },
    { deploymentBlockNumber: 0 },
    { deploymentBlockNumber: -5 },
    { deploymentBlockNumber: 1.5 },
    { deploymentBlockNumber: '47934147' },
    { deploymentBlockNumber: Number.MAX_SAFE_INTEGER + 2 }
  ]) {
    assert.equal(
      code(() =>
        resolveDeploymentSearchRange(IDENTITY, { readFile: () => manifest(overrides) })
      ),
      'MANIFEST_MISMATCH',
      JSON.stringify(overrides)
    );
  }
});

test('el manifest REAL del repo resuelve el bloque de deploy esperado', () => {
  const file = join(DEFAULT_MANIFEST_DIRECTORY, `${DEPLOYMENT_ID}.json`);
  assert.equal(existsSync(file), true, 'el manifest canonico debe existir en contracts/deployments');

  const range = resolveDeploymentSearchRange(IDENTITY);

  assert.deepEqual(range, { fromBlock: 47934147, toBlock: 'latest' });
});

test('los mensajes de error son fijos y no incluyen rutas ni valores', () => {
  try {
    resolveDeploymentSearchRange(IDENTITY, {
      readFile: () => {
        throw new Error('ENOENT /secret/path');
      }
    });
  } catch (error) {
    assert.ok(error instanceof DeploymentSearchRangeError);
    assert.equal(error.message.includes('/secret/path'), false);
    assert.equal(error.message.includes(DEPLOYMENT_ID), false);
  }
});

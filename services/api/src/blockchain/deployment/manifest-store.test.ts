import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';

import { DeploymentOperatorError, describeDeploymentError } from './deployment-errors';
import {
  type DeploymentManifest,
  buildDeploymentManifest,
  serializeDeploymentManifest
} from './deployment-manifest';
import { runCredentialRegistryDeployment } from './deployment-operator';
import {
  FileManifestStore,
  type ManifestFileSystem,
  ManifestStoreError,
  nodeManifestFileSystem
} from './manifest-store';
import {
  BLOCK_HASH,
  CREATION_HASH,
  DEPLOYER_ADDRESS,
  EXPECTED_CREATE_ADDRESS,
  RUNTIME_HASH,
  SOURCE_COMMIT,
  TX_HASH,
  makeHarness
} from './__fixtures__/deployment-fixtures';

/**
 * Publicacion ATOMICA y append-only del manifest -- S8c10.1.
 *
 * Filesystem REAL en un directorio temporal, con fallas deterministas inyectadas
 * en cada paso. Sin red, sin RPC, sin cadena.
 *
 * Invariantes bajo prueba:
 *   1. la ruta final NUNCA es visible parcialmente escrita;
 *   2. un manifest final existente NUNCA se sobrescribe;
 *   3. ninguna falla de publicacion puede provocar un segundo deployment.
 */

function manifest(): DeploymentManifest {
  return buildDeploymentManifest({
    contractAddress: EXPECTED_CREATE_ADDRESS,
    deploymentTransactionHash: TX_HASH,
    deploymentBlockNumber: 1000,
    deploymentBlockHash: BLOCK_HASH,
    deploymentTimestamp: '2026-09-21T14:13:20Z',
    deployerAddress: DEPLOYER_ADDRESS,
    deploymentSourceCommit: SOURCE_COMMIT,
    foundryVersion: '1.2.3-stable',
    creationBytecodeHash: CREATION_HASH,
    runtimeBytecodeHash: RUNTIME_HASH
  });
}

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'scope-manifest-atomic-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const finalPathOf = (m: DeploymentManifest) => join(directory, `${m.deploymentId}.json`);
const listing = () => readdirSync(directory).sort();

/** Filesystem real con ganchos para inyectar fallas en un paso concreto. */
function faulty(patch: Partial<ManifestFileSystem>): ManifestFileSystem {
  return { ...nodeManifestFileSystem, ...patch };
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: /home/operator/private-path`), { code });
}

async function expectStoreError(action: Promise<unknown>, code: ManifestStoreError['code']) {
  let thrown: unknown;
  try {
    await action;
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof ManifestStoreError, `se esperaba ${code}`);
  assert.equal(thrown.code, code);
  assert.equal(thrown.message.includes('/home/operator'), false, 'el error no refleja rutas');
  return thrown;
}

// ---------------------------------------------------------------------------
// D. publicacion exitosa
// ---------------------------------------------------------------------------

test('D. publicacion exitosa: el archivo final es EXACTAMENTE el manifest serializado y validado', async () => {
  const built = manifest();
  const store = new FileManifestStore(directory);

  const path = await store.writeNew(built);

  assert.equal(path, finalPathOf(built));
  assert.equal(readFileSync(path, 'utf8'), serializeDeploymentManifest(built));
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), JSON.parse(JSON.stringify(built)));
  // Sin temporales residuales: solo el manifest final.
  assert.deepEqual(listing(), [`${built.deploymentId}.json`]);
  assert.equal(await store.exists(built.deploymentId), true);
});

test('el filesystem real de esta plataforma soporta la primitiva (enlace duro exclusivo)', async () => {
  const a = join(directory, 'a.tmp');
  const b = join(directory, 'b.json');
  writeFileSync(a, 'x');

  await nodeManifestFileSystem.publish(a, b);
  assert.equal(readFileSync(b, 'utf8'), 'x');

  // Y es EXCLUSIVA: no reemplaza.
  writeFileSync(join(directory, 'c.tmp'), 'other');
  await assert.rejects(
    nodeManifestFileSystem.publish(join(directory, 'c.tmp'), b),
    (e: unknown) => (e as NodeJS.ErrnoException).code === 'EEXIST'
  );
  assert.equal(readFileSync(b, 'utf8'), 'x');
});

// ---------------------------------------------------------------------------
// A. falla antes de terminar el temporal
// ---------------------------------------------------------------------------

test('A. falla A MITAD de la escritura del temporal: ningun manifest final, y el temporal se limpia', async () => {
  const built = manifest();
  const serialized = serializeDeploymentManifest(built);
  const sawFinalDuringWrite: boolean[] = [];

  const store = new FileManifestStore(
    directory,
    faulty({
      async writeTemporary(path, contents) {
        // Escritura PARCIAL real en disco y despues el corte.
        writeFileSync(path, contents.slice(0, Math.floor(contents.length / 2)));
        sawFinalDuringWrite.push(await nodeManifestFileSystem.exists(finalPathOf(built)));
        throw errno('ENOSPC');
      }
    })
  );

  await expectStoreError(store.writeNew(built), 'MANIFEST_WRITE_FAILED');

  assert.deepEqual(sawFinalDuringWrite, [false], 'la ruta final no existia mientras se escribia');
  assert.equal(await store.exists(built.deploymentId), false);
  assert.deepEqual(listing(), [], 'el temporal parcial se limpio');
  assert.ok(serialized.length > 0);
});

test('A. si ademas falla la limpieza, el temporal parcial queda pero NO hay manifest final', async () => {
  const built = manifest();
  const store = new FileManifestStore(
    directory,
    faulty({
      async writeTemporary(path, contents) {
        writeFileSync(path, contents.slice(0, 10));
        throw errno('EIO');
      },
      async remove() {
        throw errno('EBUSY');
      }
    })
  );

  await expectStoreError(store.writeNew(built), 'MANIFEST_WRITE_FAILED');

  assert.equal(await store.exists(built.deploymentId), false);
  const leftovers = listing();
  assert.equal(leftovers.length, 1);
  // Un residuo NUNCA tiene forma de manifest final.
  assert.match(leftovers[0], /^\..+\.tmp$/);
  assert.equal(leftovers[0].endsWith('.json'), false);
});

// ---------------------------------------------------------------------------
// B. temporal completo, falla antes de publicar
// ---------------------------------------------------------------------------

test('B. temporal COMPLETO pero la publicacion falla: ningun manifest final, temporal limpiado', async () => {
  const built = manifest();
  let temporaryWasComplete = false;

  const store = new FileManifestStore(
    directory,
    faulty({
      async publish(temporaryPath) {
        temporaryWasComplete =
          readFileSync(temporaryPath, 'utf8') === serializeDeploymentManifest(built);
        throw errno('EPERM');
      }
    })
  );

  await expectStoreError(store.writeNew(built), 'MANIFEST_WRITE_FAILED');

  assert.equal(temporaryWasComplete, true, 'el temporal ya estaba completo y sincronizado');
  assert.equal(await store.exists(built.deploymentId), false);
  assert.deepEqual(listing(), []);
});

test('B. un filesystem sin enlaces duros FALLA CERRADO: no hay fallback que rompa un invariante', async () => {
  const built = manifest();

  for (const code of ['EPERM', 'ENOTSUP', 'EXDEV', 'EMLINK']) {
    const store = new FileManifestStore(directory, faulty({ async publish() { throw errno(code); } }));
    await expectStoreError(store.writeNew(built), 'MANIFEST_WRITE_FAILED');
    assert.equal(await store.exists(built.deploymentId), false, code);
  }
  assert.deepEqual(listing(), []);
});

test('B. corte total despues del temporal completo (limpieza tambien falla): solo queda un residuo inofensivo', async () => {
  const built = manifest();
  const store = new FileManifestStore(
    directory,
    faulty({
      async publish() {
        throw errno('EIO');
      },
      async remove() {
        throw errno('EIO');
      }
    })
  );

  await expectStoreError(store.writeNew(built), 'MANIFEST_WRITE_FAILED');

  assert.equal(await store.exists(built.deploymentId), false);
  assert.equal(listing().filter((name) => name.endsWith('.json')).length, 0);
  // El residuo no impide una publicacion posterior correcta.
  const retry = new FileManifestStore(directory);
  assert.equal(await retry.writeNew(built), finalPathOf(built));
  assert.equal(readFileSync(finalPathOf(built), 'utf8'), serializeDeploymentManifest(built));
});

// ---------------------------------------------------------------------------
// C. manifest final existente
// ---------------------------------------------------------------------------

test('C. manifest final existente: la publicacion falla y sus bytes quedan IDENTICOS', async () => {
  const built = manifest();
  const finalPath = finalPathOf(built);
  // Un manifest final valido ya publicado, con bytes distintos a los nuevos.
  const existing = `${serializeDeploymentManifest(built)}`.replace('"deploymentBlockNumber": 1000', '"deploymentBlockNumber": 1001');
  writeFileSync(finalPath, existing);

  const store = new FileManifestStore(directory);
  await expectStoreError(store.writeNew(built), 'MANIFEST_ALREADY_EXISTS');

  assert.equal(readFileSync(finalPath, 'utf8'), existing, 'byte-identico');
  assert.deepEqual(listing(), [`${built.deploymentId}.json`], 'sin temporales');
});

test('C. dos publicaciones concurrentes del mismo id: exactamente UNA gana y el final queda intacto', async () => {
  const built = manifest();
  const store = new FileManifestStore(directory);

  const results = await Promise.allSettled([store.writeNew(built), store.writeNew(built), store.writeNew(built)]);

  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  for (const rejected of results.filter((r) => r.status === 'rejected')) {
    assert.ok(
      (rejected as PromiseRejectedResult).reason instanceof ManifestStoreError &&
        (rejected as PromiseRejectedResult).reason.code === 'MANIFEST_ALREADY_EXISTS'
    );
  }
  assert.equal(readFileSync(finalPathOf(built), 'utf8'), serializeDeploymentManifest(built));
  assert.deepEqual(listing(), [`${built.deploymentId}.json`]);
});

// ---------------------------------------------------------------------------
// E. falla durante la limpieza
// ---------------------------------------------------------------------------

test('E. falla al limpiar el temporal DESPUES de publicar: el manifest final sigue valido e intacto', async () => {
  const built = manifest();
  const removals: string[] = [];
  const store = new FileManifestStore(
    directory,
    faulty({
      async remove(path) {
        removals.push(path);
        throw errno('EBUSY');
      }
    })
  );

  // La publicacion tuvo exito: NO se reporta como fallo.
  const path = await store.writeNew(built);

  assert.equal(path, finalPathOf(built));
  assert.equal(readFileSync(path, 'utf8'), serializeDeploymentManifest(built));
  assert.equal(removals.length, 1);
  assert.notEqual(removals[0], path, 'la limpieza nunca apunta a la ruta final');
  assert.match(removals[0], /\.tmp$/);
});

test('E. la limpieza nunca borra un manifest final ya publicado (ni siquiera uno ajeno)', async () => {
  const built = manifest();
  const finalPath = finalPathOf(built);
  writeFileSync(finalPath, 'bytes-de-un-manifest-existente');
  const removed: string[] = [];

  const store = new FileManifestStore(
    directory,
    faulty({
      async remove(path) {
        removed.push(path);
        await nodeManifestFileSystem.remove(path);
      }
    })
  );

  await expectStoreError(store.writeNew(built), 'MANIFEST_ALREADY_EXISTS');

  assert.equal(readFileSync(finalPath, 'utf8'), 'bytes-de-un-manifest-existente');
  assert.equal(removed.includes(finalPath), false);
});

// ---------------------------------------------------------------------------
// Atomicidad observable
// ---------------------------------------------------------------------------

test('la ruta final aparece de golpe y COMPLETA: antes de publicar no existe, despues ya es el manifest entero', async () => {
  const built = manifest();
  const observations: Array<{ beforeExists: boolean; afterBytes: string }> = [];

  const store = new FileManifestStore(
    directory,
    faulty({
      async publish(temporaryPath, finalPath) {
        const beforeExists = await nodeManifestFileSystem.exists(finalPath);
        await nodeManifestFileSystem.publish(temporaryPath, finalPath);
        observations.push({ beforeExists, afterBytes: readFileSync(finalPath, 'utf8') });
      }
    })
  );

  await store.writeNew(built);

  assert.deepEqual(observations, [
    { beforeExists: false, afterBytes: serializeDeploymentManifest(built) }
  ]);
});

test('un manifest invalido no toca el disco: ni temporal ni final', async () => {
  const store = new FileManifestStore(directory);

  await expectStoreError(
    store.writeNew({ ...manifest(), chainId: 1 } as unknown as DeploymentManifest),
    'MANIFEST_INVALID'
  );
  assert.deepEqual(listing(), []);
});

test('el nombre temporal jamas coincide con un nombre final y no es un manifest', async () => {
  const built = manifest();
  const names: string[] = [];
  const store = new FileManifestStore(
    directory,
    faulty({
      async writeTemporary(path, contents) {
        names.push(path);
        await nodeManifestFileSystem.writeTemporary(path, contents);
      }
    })
  );

  await store.writeNew(built);
  await expectStoreError(store.writeNew(built), 'MANIFEST_ALREADY_EXISTS');

  assert.equal(names.length, 2);
  assert.notEqual(names[0], names[1], 'nombres aleatorios por intento');
  for (const name of names) {
    assert.match(name.slice(directory.length + 1), /^\.base-sepolia-84532-0x[0-9a-f]{40}\.[0-9a-f]{16}\.tmp$/);
  }
});

// ---------------------------------------------------------------------------
// F. cadena exitosa + fallo de publicacion: NUNCA un segundo envio
// ---------------------------------------------------------------------------

test('F. deployment exitoso on-chain + fallo de publicacion: DEPLOYMENT_MANIFEST_PERSISTENCE_FAILED y UN solo envio', async () => {
  for (const failure of [
    faulty({ async writeTemporary() { throw errno('ENOSPC'); } }),
    faulty({ async publish() { throw errno('EPERM'); } })
  ]) {
    const { dependencies, counters } = makeHarness();
    const store = new FileManifestStore(directory, failure);

    let thrown: unknown;
    try {
      await runCredentialRegistryDeployment(
        { ...dependencies, manifestStore: store },
        { deploymentSourceCommit: SOURCE_COMMIT, mode: 'execute' }
      );
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown instanceof DeploymentOperatorError);
    assert.equal(thrown.code, 'DEPLOYMENT_MANIFEST_PERSISTENCE_FAILED');
    assert.equal(counters.send, 1, 'el contrato ya existe: ningun segundo envio');
    assert.equal(thrown.context.transactionHash, TX_HASH);
    assert.equal(thrown.context.contractAddress, EXPECTED_CREATE_ADDRESS);

    const printed = JSON.stringify(describeDeploymentError(thrown));
    assert.equal(printed.includes('/home/operator'), false);
    assert.equal(printed.includes('ENOSPC'), false);

    // Y no quedo ningun manifest final ni parcial.
    assert.equal(listing().filter((name) => name.endsWith('.json')).length, 0);
  }
});

test('F. el manifest ya publicado por una ejecucion previa impide una nueva ANTES de enviar', async () => {
  const first = makeHarness();
  const store = new FileManifestStore(directory);
  await runCredentialRegistryDeployment(
    { ...first.dependencies, manifestStore: store },
    { deploymentSourceCommit: SOURCE_COMMIT, mode: 'execute' }
  );
  const published = readFileSync(finalPathOf(manifest()), 'utf8');

  const second = makeHarness();
  let thrown: unknown;
  try {
    await runCredentialRegistryDeployment(
      { ...second.dependencies, manifestStore: store },
      { deploymentSourceCommit: SOURCE_COMMIT, mode: 'execute' }
    );
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown instanceof DeploymentOperatorError && thrown.code === 'MANIFEST_ALREADY_EXISTS');
  assert.equal(second.counters.send, 0);
  assert.equal(readFileSync(finalPathOf(manifest()), 'utf8'), published);
});

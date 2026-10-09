import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';

import { Transaction, Wallet, encryptKeystoreJson } from 'ethers';

import { type DeploymentProvider } from './deployment-operator';
import { DeploymentOperatorError, describeDeploymentError } from './deployment-errors';
import { runCredentialRegistryDeployment } from './deployment-operator';
import { KeystoreSignerError, KeystoreSignerSource } from './keystore-signer-source';
import {
  CREATION_BYTECODE,
  SOURCE_COMMIT,
  TEST_SCALAR_ONE,
  makeHarness
} from './__fixtures__/deployment-fixtures';

/**
 * Prueba OFFLINE del adaptador de produccion `KeystoreSignerSource` -- S8c10.1.
 *
 * Usa el adaptador REAL y el MISMO camino de archivo + descifrado que usara
 * S8c10.2, pero sobre un keystore efimero cifrado aca mismo con el escalar
 * publico de prueba 1 (sin fondos, sin significado operativo). La frase de paso
 * es una cadena de prueba. Nada de esto es un secreto: pero el test trata esos
 * valores como si lo fueran y comprueba que NUNCA salen del adaptador.
 *
 * Sin RPC, sin red, sin AWS, sin keystore real. Los archivos viven en un
 * directorio temporal que se borra al terminar. No se commitea ningun fixture.
 */

const PASSWORD = 'test-only-passphrase-do-not-reuse';
const WRONG_PASSWORD = 'another-test-only-passphrase';
// Direccion conocida del escalar publico 1.
const EXPECTED_ADDRESS = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';
const PRIVATE_SCALAR = TEST_SCALAR_ONE;

let directory: string;
let keystorePath: string;
let keystoreJson: string;

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'scope-keystore-'));
  const account = new Wallet(PRIVATE_SCALAR);
  // N bajo para que la prueba sea rapida: el costo de descifrado lo fija el archivo.
  keystoreJson = await encryptKeystoreJson(
    { address: account.address, privateKey: account.privateKey },
    PASSWORD,
    { scrypt: { N: 1 << 10, r: 8, p: 1 } }
  );
  keystorePath = join(directory, 'deployer.keystore.json');
  writeFileSync(keystorePath, keystoreJson, 'utf8');
});

after(() => {
  rmSync(directory, { recursive: true, force: true });
});

/** Provider minimo que NO habla con ninguna red. */
function offlineProvider(broadcasts: string[] = []) {
  return {
    async getNetwork() {
      return { chainId: 84532n, name: 'base-sepolia' };
    },
    async getFeeData() {
      return { gasPrice: 1_000_000n, maxFeePerGas: 2_000_000n, maxPriorityFeePerGas: 1_000n };
    },
    async estimateGas() {
      return 600_000n;
    },
    async broadcastTransaction(raw: string) {
      broadcasts.push(raw);
      const parsed = Transaction.from(raw);
      return {
        hash: parsed.hash,
        wait: async () => null
      };
    }
  };
}

async function load(path: string, password: string, broadcasts: string[] = []) {
  return new KeystoreSignerSource(path, async () => password).load(
    offlineProvider(broadcasts) as unknown as DeploymentProvider
  );
}

async function expectKeystoreError(action: Promise<unknown>, code: KeystoreSignerError['code']) {
  let thrown: unknown;
  try {
    await action;
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof KeystoreSignerError, `se esperaba ${code}`);
  assert.equal(thrown.code, code);
  return thrown;
}

/** Todo lo que un error podria dejar ver. */
function everythingPrintable(error: unknown): string {
  const e = error as Error & Record<string, unknown>;
  return [
    String(e.message),
    String(e.stack),
    JSON.stringify(error, Object.getOwnPropertyNames(e)),
    JSON.stringify(describeDeploymentError(error))
  ].join('\n');
}

function assertNoSecrets(printed: string) {
  assert.equal(printed.includes(PRIVATE_SCALAR), false, 'clave privada');
  assert.equal(printed.includes(PRIVATE_SCALAR.slice(2)), false, 'clave privada sin 0x');
  assert.equal(printed.includes(PASSWORD), false, 'frase de paso correcta');
  assert.equal(printed.includes(WRONG_PASSWORD), false, 'frase de paso erronea');
  assert.equal(printed.includes(keystorePath), false, 'ruta del keystore');
  assert.equal(printed.includes(directory), false, 'directorio temporal');
  for (const fragment of ['"crypto"', '"ciphertext"', '"kdfparams"', 'scrypt', 'ciphertext']) {
    assert.equal(printed.includes(fragment), false, `contenido del keystore: ${fragment}`);
  }
}

// ---------------------------------------------------------------------------
// A. keystore valido + frase correcta
// ---------------------------------------------------------------------------

test('A. keystore valido + frase correcta: descifra y la direccion es EXACTAMENTE la conocida', async () => {
  const signer = await load(keystorePath, PASSWORD);

  assert.equal(signer.address, EXPECTED_ADDRESS);
  assert.equal(signer.address, new Wallet(PRIVATE_SCALAR).address);
});

test('A. el signer devuelto firma la creacion correcta (offline, sin RPC) y solo expone direccion + envio', async () => {
  const broadcasts: string[] = [];
  const signer = await load(keystorePath, PASSWORD, broadcasts);

  // Superficie exacta: nada de clave, wallet ni material descifrado.
  assert.deepEqual(Object.keys(signer).sort(), ['address', 'sendDeployment']);
  assert.equal(JSON.stringify(signer), JSON.stringify({ address: EXPECTED_ADDRESS }));
  assert.deepEqual(Object.getOwnPropertyNames(signer).sort(), ['address', 'sendDeployment']);

  const sent = await signer.sendDeployment({ data: CREATION_BYTECODE, nonce: 7, chainId: 84532 });

  assert.equal(broadcasts.length, 1);
  const signed = Transaction.from(broadcasts[0]);
  assert.equal(signed.to, null, 'creacion de contrato: sin destinatario');
  assert.equal(signed.data.toLowerCase(), CREATION_BYTECODE);
  assert.equal(signed.nonce, 7);
  assert.equal(signed.chainId, 84532n);
  assert.equal(signed.from, EXPECTED_ADDRESS, 'firmada por la clave del keystore');
  assert.equal(sent.hash, signed.hash);
});

test('A. el operador REAL usa el adaptador real: preflight completo con el signer descifrado', async () => {
  const { dependencies } = makeHarness();
  const result = await runCredentialRegistryDeployment(
    {
      ...dependencies,
      signerSource: new KeystoreSignerSource(keystorePath, async () => PASSWORD)
    },
    { deploymentSourceCommit: SOURCE_COMMIT, mode: 'preflight' }
  );

  assert.equal(result.kind, 'preflight');
  assert.equal(result.kind === 'preflight' && result.evidence.deployerAddress, EXPECTED_ADDRESS);
});

// ---------------------------------------------------------------------------
// B. frase equivocada
// ---------------------------------------------------------------------------

test('B. frase equivocada: falla cerrado con error fijo, sin clave, frase ni keystore', async () => {
  const error = await expectKeystoreError(load(keystorePath, WRONG_PASSWORD), 'KEYSTORE_DECRYPTION_FAILED');

  assert.equal(error.message, 'No se pudo descifrar el keystore con la frase de paso provista.');
  assertNoSecrets(everythingPrintable(error));
});

test('B. via el operador: SIGNER_UNAVAILABLE, cero envios y sin secretos', async () => {
  const { dependencies, counters } = makeHarness();

  let thrown: unknown;
  try {
    await runCredentialRegistryDeployment(
      { ...dependencies, signerSource: new KeystoreSignerSource(keystorePath, async () => WRONG_PASSWORD) },
      { deploymentSourceCommit: SOURCE_COMMIT, mode: 'execute' }
    );
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown instanceof DeploymentOperatorError && thrown.code === 'SIGNER_UNAVAILABLE');
  assert.equal(counters.send, 0);
  assertNoSecrets(everythingPrintable(thrown));
});

// ---------------------------------------------------------------------------
// C. JSON malformado
// ---------------------------------------------------------------------------

test('C. JSON malformado o que no es un keystore: error fijo, sin citar el contenido, sin pedir la frase', async () => {
  const marker = 'SECRET-MARKER-0xdeadbeef';
  let prompted = 0;

  for (const content of [
    `{"version": 3, "x": "${marker}`,
    `not json at all ${marker}`,
    `{"a": "${marker}"}`,
    '[]',
    '',
    '{}'
  ]) {
    const path = join(directory, `malformed-${Math.random().toString(16).slice(2)}.json`);
    writeFileSync(path, content, 'utf8');

    const error = await expectKeystoreError(
      new KeystoreSignerSource(path, async () => {
        prompted += 1;
        return PASSWORD;
      }).load(offlineProvider() as unknown as DeploymentProvider),
      'KEYSTORE_MALFORMED'
    );

    const printed = everythingPrintable(error);
    assert.equal(printed.includes(marker), false, 'el contenido del archivo no se cita');
    assert.equal(printed.includes(path), false);
    assertNoSecrets(printed);
  }

  assert.equal(prompted, 0, 'un archivo invalido no hace tipear la frase de paso');
});

// ---------------------------------------------------------------------------
// D. archivo ausente o ilegible
// ---------------------------------------------------------------------------

test('D. archivo ausente o ilegible: error fijo, sin la ruta', async () => {
  const missing = join(directory, 'does-not-exist.json');
  const folder = join(directory, 'a-directory');
  mkdirSync(folder);
  let prompted = 0;

  for (const path of [missing, folder, join(directory, '..', '..', 'nowhere', 'k.json')]) {
    const error = await expectKeystoreError(
      new KeystoreSignerSource(path, async () => {
        prompted += 1;
        return PASSWORD;
      }).load(offlineProvider() as unknown as DeploymentProvider),
      'KEYSTORE_UNREADABLE'
    );

    const printed = everythingPrintable(error);
    assert.equal(printed.includes(path), false, 'la ruta no se refleja');
    assert.equal(printed.includes('ENOENT'), false);
    assert.equal(printed.includes('EISDIR'), false);
    assertNoSecrets(printed);
  }

  assert.equal(prompted, 0);
});

// ---------------------------------------------------------------------------
// E. el adaptador no loguea ni devuelve material secreto
// ---------------------------------------------------------------------------

test('E. durante todo el ciclo no se escribe NADA en consola ni en stdout/stderr, y nada secreto sale', async () => {
  const writes: string[] = [];
  const originals = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
    stdout: process.stdout.write.bind(process.stdout),
    stderr: process.stderr.write.bind(process.stderr)
  };

  const capture = (...args: unknown[]) => {
    writes.push(args.map(String).join(' '));
  };
  console.log = capture;
  console.info = capture;
  console.warn = capture;
  console.error = capture;
  console.debug = capture;
  process.stdout.write = ((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;

  const returned: unknown[] = [];
  try {
    const signer = await load(keystorePath, PASSWORD);
    returned.push(signer);
    returned.push(await signer.sendDeployment({ data: CREATION_BYTECODE, nonce: 1, chainId: 84532 }).catch(() => null));
    for (const attempt of [
      () => load(keystorePath, WRONG_PASSWORD),
      () => load(join(directory, 'nope.json'), PASSWORD)
    ]) {
      await attempt().catch((error: unknown) => returned.push(error));
    }
  } finally {
    console.log = originals.log;
    console.info = originals.info;
    console.warn = originals.warn;
    console.error = originals.error;
    console.debug = originals.debug;
    process.stdout.write = originals.stdout as typeof process.stdout.write;
    process.stderr.write = originals.stderr as typeof process.stderr.write;
  }

  assert.deepEqual(writes, [], 'el adaptador no escribe en ninguna salida');

  const serialized = returned
    .map((item) => {
      try {
        return JSON.stringify(item, (_key, value) => (typeof value === 'bigint' ? value.toString() : value));
      } catch {
        return String(item);
      }
    })
    .join('\n');
  assertNoSecrets(serialized);
});

test('E. el keystore de prueba es efimero: vive solo en el directorio temporal', () => {
  assert.ok(keystorePath.startsWith(tmpdir()));
  // Ningun archivo de keystore ni clave en el repositorio queda de esta prueba.
  assert.equal(__dirname.includes('scope-keystore-'), false);
});

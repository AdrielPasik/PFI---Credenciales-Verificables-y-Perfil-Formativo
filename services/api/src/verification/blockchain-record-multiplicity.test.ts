/**
 * INVARIANTE DE UNA SOLA FILA DE EVIDENCIA -- S8c7, item 64.
 *
 * La verificacion publica falla cerrado si una credencial tiene mas de un
 * `BlockchainRecord`, porque con el schema actual no hay forma honesta de
 * elegir una: la tabla no tiene `createdAt`, una fila `pending` tiene
 * `registeredAt` NULL y el orden de UUID no es cronologia.
 *
 * Ese "falla cerrado" solo es razonable si el dominio realmente crea UNA fila.
 * Estos tests congelan esa invariante sobre el codigo de produccion, para que
 * una slice futura que empiece a insertar una segunda fila rompa aca y no en la
 * pantalla publica.
 *
 * Deliberadamente NO se agrega una restriccion de unicidad en Prisma: eso es
 * schema y migracion, y S8c7 no toca ninguno de los dos. Que la invariante
 * pase a estar impuesta por la base es una decision de endurecimiento
 * posterior.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const API_SRC_DIR = join(__dirname, '..');
const PRISMA_DIR = join(__dirname, '..', '..', 'prisma');

function readSource(...segments: string[]): string {
  return readFileSync(join(API_SRC_DIR, ...segments), 'utf8');
}

/** Codigo ejecutable: sin comentarios de bloque ni de linea. */
function executableCode(contents: string): string {
  return contents
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

// ---------------------------------------------------------------------------
// UNA SOLA INSERCION POR CAMINO DE EMISION
// ---------------------------------------------------------------------------

test('64: en TODA la API hay exactamente DOS sitios que insertan evidencia', () => {
  // Uno por modo: el intent real de S8c6 y la fila mock. Ni uno mas.
  const sources = [
    'blockchain/blockchain-registration.service.ts',
    'blockchain/blockchain-evidence.service.ts',
    'blockchain/blockchain-record-reconciliation.service.ts',
    'blockchain/blockchain-registration-reconciliation.service.ts',
    'credentials/credentials.service.ts',
    'credentials/issuer-credential-issue.service.ts',
    'credentials/issuer-credential-revocation.service.ts',
    'verification/verification.service.ts'
  ];

  const creators: string[] = [];

  for (const source of sources) {
    const code = executableCode(readSource(source));

    for (const match of code.matchAll(/blockchainRecord\.(create|createMany|upsert)\(/g)) {
      creators.push(`${source}:${match[1]}`);
    }
  }

  assert.deepEqual(creators.sort(), [
    // Modo mock: la fila de evidencia local.
    'blockchain/blockchain-evidence.service.ts:create',
    // Modo real: el intent PENDING durable de S8c6.
    'blockchain/blockchain-registration.service.ts:create'
  ]);
});

test('64b: la emision real crea UNA fila, dentro de TX #1', () => {
  const registration = executableCode(
    readSource('blockchain/blockchain-registration.service.ts')
  );

  assert.equal(
    (registration.match(/blockchainRecord\.create\(/g) ?? []).length,
    1
  );
  // Y es el intent pendiente, no una fila ya registrada.
  assert.match(registration, /status: BlockchainRecordStatus\.pending/);
});

test('64c: la emision mock crea UNA fila y no pasa por el ciclo real', () => {
  const evidence = executableCode(
    readSource('blockchain/blockchain-evidence.service.ts')
  );

  assert.equal((evidence.match(/blockchainRecord\.create\(/g) ?? []).length, 1);
  // S8c6 dejo este servicio como SOLO mock.
  assert.match(evidence, /evidenceMode: BlockchainEvidenceMode\.mock/);
});

test('64d: la revocacion ACTUALIZA la fila existente y no inserta otra', () => {
  const revocation = executableCode(
    readSource('credentials/issuer-credential-revocation.service.ts')
  );

  // Hay actualizacion...
  assert.match(revocation, /blockchainRecord\.update/);
  // ...y ninguna insercion.
  assert.ok(!revocation.includes('blockchainRecord.create'));
  assert.ok(!revocation.includes('blockchainRecord.createMany'));
  assert.ok(!revocation.includes('blockchainRecord.upsert'));
});

test('64e: la finalizacion de S8c6 ACTUALIZA el intent, no crea una segunda fila', () => {
  const registration = executableCode(
    readSource('blockchain/blockchain-registration.service.ts')
  );

  // TX #2 es un updateMany acotado sobre la fila que ya existe.
  assert.match(registration, /blockchainRecord\.updateMany\(/);
  // Y la reconciliacion tampoco inserta.
  const reconciliation = executableCode(
    readSource('blockchain/blockchain-registration-reconciliation.service.ts')
  );
  assert.ok(!reconciliation.includes('blockchainRecord.create'));
});

test('64f: una credencial ya emitida no vuelve a crear evidencia', () => {
  const credentials = executableCode(readSource('credentials/credentials.service.ts'));

  // El guard optimista exige `status: draft` para emitir, asi que una segunda
  // emision de la misma credencial no llega a crear nada.
  assert.match(credentials, /status: CredentialStatus\.draft/);
  // Y este servicio no inserta evidencia por su cuenta.
  assert.ok(!credentials.includes('blockchainRecord.create'));
});

// ---------------------------------------------------------------------------
// LO QUE JUSTIFICA FALLAR CERRADO
// ---------------------------------------------------------------------------

test('el schema NO ofrece ninguna cronologia para ordenar varias filas', () => {
  const schema = readFileSync(join(PRISMA_DIR, 'schema.prisma'), 'utf8');
  const model = /model BlockchainRecord \{([\s\S]*?)\n\}/.exec(schema);
  assert.ok(model, 'no se encontro el modelo');

  const body = model[1];

  // Sin `createdAt` ni `updatedAt`: no hay orden de insercion.
  assert.ok(!/\n\s*createdAt\s/.test(body));
  assert.ok(!/\n\s*updatedAt\s/.test(body));

  // `registeredAt` es nullable desde S8c6, asi que no sirve de orden total.
  assert.match(body, /registeredAt\s+DateTime\?/);

  // Y `credentialId` NO es unico: la relacion admite varias filas, que es
  // justamente por lo que el verificador tiene que decidir que hacer con ellas.
  assert.ok(!/credentialId\s+String\s+@unique/.test(body));
  assert.match(body, /@@index\(\[credentialId\]\)/);
});

test('S8c7 no agrega ninguna restriccion de unicidad ni migracion', () => {
  const schema = readFileSync(join(PRISMA_DIR, 'schema.prisma'), 'utf8');
  const model = /model BlockchainRecord \{([\s\S]*?)\n\}/.exec(schema);
  assert.ok(model);

  // La invariante se congela con tests, no con DDL: S8c7 no toca el schema.
  assert.ok(!model[1].includes('@@unique'));
});

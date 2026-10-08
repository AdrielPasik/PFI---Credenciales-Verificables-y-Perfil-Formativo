/**
 * Evidencia por EVENTOS -- S8c6, matriz 32 y addendum D/F.
 *
 * Congela el contrato REAL del evento (auditado sobre
 * contracts/src/CredentialRegistry.sol), la decodificacion de un log, el
 * rechazo de evidencia incompleta o contradictoria, y la conversion de
 * `block.timestamp` a una fecha UTC.
 *
 * Sin red: todos los logs son objetos locales.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { PUBLIC_TEST_KEY_ONE, PUBLIC_TEST_KEY_TWO } from '../signing/__fixtures__/signer-test-keys';
import {
  CREDENTIAL_REGISTERED_EVENT_NAME,
  CREDENTIAL_REGISTERED_TOPIC,
  CREDENTIAL_REGISTRY_EVENT_ABI,
  type CredentialRegistryLog,
  buildCredentialRegisteredFilter,
  decodeCredentialRegisteredLog,
  isCanonicalTransactionHash,
  isValidBlockNumber,
  selectCredentialRegisteredEvidence,
  toSafeUnixSeconds,
  unixSecondsToDate
} from './credential-registry-events';

const CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const VALID_HASH =
  '0xaf032042c1bcfb72f9caac350eb3cb576f44ab07b1c1968f4b36264da44ff2ab';
const TX_HASH = `0x${'1'.repeat(64)}`;
const BLOCK_NUMBER = 4242;
const TIMESTAMP_SECONDS = 1_775_000_000;

function log(input: {
  credentialHash?: string;
  registrant?: string;
  timestampSeconds?: number;
  txHash?: string | null;
  blockNumber?: number | null;
  topics?: readonly string[];
}): CredentialRegistryLog {
  const registrant = input.registrant ?? PUBLIC_TEST_KEY_ONE.address;

  return {
    address: CONTRACT_ADDRESS,
    topics:
      input.topics ?? [
        CREDENTIAL_REGISTERED_TOPIC,
        (input.credentialHash ?? VALID_HASH).toLowerCase(),
        `0x${'0'.repeat(24)}${registrant.slice(2).toLowerCase()}`
      ],
    data: `0x${(input.timestampSeconds ?? TIMESTAMP_SECONDS)
      .toString(16)
      .padStart(64, '0')}`,
    transactionHash: input.txHash === undefined ? TX_HASH : input.txHash,
    blockNumber: input.blockNumber === undefined ? BLOCK_NUMBER : input.blockNumber
  };
}

// ---------------------------------------------------------------------------
// 32: EL CONTRATO DEL EVENTO ES EL REAL
// ---------------------------------------------------------------------------

test('32: el ABI del evento coincide EXACTAMENTE con el contrato', () => {
  assert.deepEqual(CREDENTIAL_REGISTRY_EVENT_ABI, [
    'event CredentialRegistered(bytes32 indexed credentialHash, address indexed issuer, uint256 registeredAt)'
  ]);
  assert.equal(CREDENTIAL_REGISTERED_EVENT_NAME, 'CredentialRegistered');

  const contract = readFileSync(
    join(__dirname, '..', '..', '..', '..', 'contracts', 'src', 'CredentialRegistry.sol'),
    'utf8'
  );

  // Los DOS datos que hacen falta para adoptar estan INDEXADOS.
  assert.match(contract, /bytes32 indexed credentialHash/);
  assert.match(contract, /address indexed issuer/);
  // Y `registeredAt` NO esta indexado: viaja en data.
  assert.match(contract, /uint256 registeredAt\s*\n\s*\)/);
  // `issuer` es `msg.sender`: es el REGISTRANTE, no la identidad institucional.
  assert.match(contract, /emit CredentialRegistered\(credentialHash, msg\.sender, registeredAt\)/);
});

test('el topic del evento es estable', () => {
  assert.match(CREDENTIAL_REGISTERED_TOPIC, /^0x[0-9a-f]{64}$/);
  assert.equal(
    CREDENTIAL_REGISTERED_TOPIC,
    '0xc7ea54e5db4b07e2d7a08ae81eab67ec69e7dc9efbf03e0acc1b7b2f331de191'
  );
});

// ---------------------------------------------------------------------------
// ADDENDUM D: EL FILTRO ESTA ACOTADO
// ---------------------------------------------------------------------------

test('addendum D: el filtro usa el hash indexado y un rango INYECTADO', () => {
  const filter = buildCredentialRegisteredFilter(CONTRACT_ADDRESS, VALID_HASH, {
    fromBlock: 1_000,
    toBlock: 2_000
  });

  assert.deepEqual(filter, {
    address: CONTRACT_ADDRESS,
    topics: [CREDENTIAL_REGISTERED_TOPIC, VALID_HASH],
    fromBlock: 1_000,
    toBlock: 2_000
  });

  // El hash va en minuscula, como topic: el nodo no escanea datos.
  const upper = buildCredentialRegisteredFilter(
    CONTRACT_ADDRESS,
    VALID_HASH.toUpperCase().replace('0X', '0x'),
    { fromBlock: 0, toBlock: 'latest' }
  );
  assert.equal(upper.topics[1], VALID_HASH);
});

// ---------------------------------------------------------------------------
// DECODIFICACION
// ---------------------------------------------------------------------------

test('un log bien formado produce evidencia completa', () => {
  const evidence = decodeCredentialRegisteredLog(log({}));

  assert.ok(evidence);
  assert.equal(evidence?.credentialHash, VALID_HASH);
  assert.equal(evidence?.registrant, PUBLIC_TEST_KEY_ONE.address);
  assert.equal(evidence?.registeredAtSeconds, TIMESTAMP_SECONDS);
  assert.equal(evidence?.txHash, TX_HASH);
  assert.equal(evidence?.blockNumber, BLOCK_NUMBER);
});

test('un log sin procedencia completa NO es adoptable', () => {
  // Sin `transactionHash` o sin `blockNumber` no hay nada que persistir, y
  // fabricar esos valores es justo lo que esta slice prohibe.
  const incomplete: Array<[string, CredentialRegistryLog]> = [
    ['sin txHash', log({ txHash: null })],
    ['txHash corto', log({ txHash: '0xabc' })],
    ['sin blockNumber', log({ blockNumber: null })],
    ['bloque negativo', log({ blockNumber: -1 })],
    ['bloque no entero', log({ blockNumber: 1.5 })],
    ['otro topic', log({ topics: [`0x${'e'.repeat(64)}`, VALID_HASH, `0x${'0'.repeat(64)}`] })],
    ['sin topics suficientes', log({ topics: [CREDENTIAL_REGISTERED_TOPIC] })],
    ['sin topics', log({ topics: [] })]
  ];

  for (const [label, candidate] of incomplete) {
    assert.equal(decodeCredentialRegisteredLog(candidate), null, label);
  }
});

test('un bloque fuera del rango Int32 de la columna no se acepta', () => {
  assert.ok(isValidBlockNumber(0));
  assert.ok(isValidBlockNumber(2_147_483_647));
  assert.ok(!isValidBlockNumber(2_147_483_648));
  assert.ok(!isValidBlockNumber(-1));
  assert.ok(!isValidBlockNumber(1.5));
  assert.ok(!isValidBlockNumber('4242'));
});

test('el hash de transaccion tiene que ser canonico', () => {
  assert.ok(isCanonicalTransactionHash(TX_HASH));
  assert.ok(isCanonicalTransactionHash(TX_HASH.toUpperCase().replace('0X', '0x')));
  assert.ok(!isCanonicalTransactionHash('0xabc'));
  assert.ok(!isCanonicalTransactionHash(TX_HASH.slice(2)));
  assert.ok(!isCanonicalTransactionHash(null));
});

// ---------------------------------------------------------------------------
// SELECCION: UNA SOLA, O NINGUNA
// ---------------------------------------------------------------------------

test('se selecciona la unica evidencia del hash y registrante esperados', () => {
  const selection = selectCredentialRegisteredEvidence([log({})], {
    credentialHash: VALID_HASH,
    registrant: PUBLIC_TEST_KEY_ONE.address
  });

  assert.equal(selection.kind, 'single');
});

test('otro registrante no se adopta', () => {
  const selection = selectCredentialRegisteredEvidence(
    [log({ registrant: PUBLIC_TEST_KEY_TWO.address })],
    { credentialHash: VALID_HASH, registrant: PUBLIC_TEST_KEY_ONE.address }
  );

  assert.equal(selection.kind, 'unexpected_registrant');
});

test('evidencia contradictoria falla cerrado en vez de elegir una', () => {
  const selection = selectCredentialRegisteredEvidence(
    [
      log({}),
      log({ txHash: `0x${'9'.repeat(64)}`, blockNumber: 5_000 })
    ],
    { credentialHash: VALID_HASH, registrant: PUBLIC_TEST_KEY_ONE.address }
  );

  assert.equal(selection.kind, 'conflicting');
});

test('dos logs IDENTICOS no son un conflicto', () => {
  const selection = selectCredentialRegisteredEvidence([log({}), log({})], {
    credentialHash: VALID_HASH,
    registrant: PUBLIC_TEST_KEY_ONE.address
  });

  assert.equal(selection.kind, 'single');
});

test('logs de OTRO hash se ignoran, no cuentan como ausencia de evidencia', () => {
  const selection = selectCredentialRegisteredEvidence(
    [log({ credentialHash: `0x${'b'.repeat(64)}` }), log({})],
    { credentialHash: VALID_HASH, registrant: PUBLIC_TEST_KEY_ONE.address }
  );

  assert.equal(selection.kind, 'single');
});

test('sin logs el resultado es "ninguna", que NO autoriza reenviar', () => {
  const selection = selectCredentialRegisteredEvidence([], {
    credentialHash: VALID_HASH,
    registrant: PUBLIC_TEST_KEY_ONE.address
  });

  assert.equal(selection.kind, 'none');
});

test('un registrante esperado mal formado falla cerrado', () => {
  const selection = selectCredentialRegisteredEvidence([log({})], {
    credentialHash: VALID_HASH,
    registrant: 'no-es-una-direccion'
  });

  assert.equal(selection.kind, 'conflicting');
});

// ---------------------------------------------------------------------------
// ADDENDUM F: CONVERSION DEL TIMESTAMP
// ---------------------------------------------------------------------------

test('addendum F: block.timestamp son SEGUNDOS Unix y se convierten una vez', () => {
  assert.equal(toSafeUnixSeconds(BigInt(TIMESTAMP_SECONDS)), TIMESTAMP_SECONDS);
  assert.equal(toSafeUnixSeconds(TIMESTAMP_SECONDS), TIMESTAMP_SECONDS);
  assert.equal(toSafeUnixSeconds(0), 0);

  const date = unixSecondsToDate(TIMESTAMP_SECONDS);
  assert.ok(date);
  assert.equal(date?.toISOString(), '2026-03-31T23:33:20.000Z');
  // Segundos, no milisegundos: tratarlo como ms daria 1970.
  assert.notEqual(date?.getUTCFullYear(), 1970);
});

test('addendum F: un timestamp invalido o ausente no se convierte', () => {
  for (const invalid of [
    undefined,
    null,
    'ayer',
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1n,
    BigInt(Number.MAX_SAFE_INTEGER) + 1n
  ]) {
    assert.equal(toSafeUnixSeconds(invalid), null, String(invalid));
  }
});

test('un timestamp que desborda el rango de Date no se convierte', () => {
  // `seconds * 1000` tiene que seguir siendo un entero seguro.
  assert.equal(unixSecondsToDate(Number.MAX_SAFE_INTEGER), null);
  assert.ok(unixSecondsToDate(TIMESTAMP_SECONDS));
});

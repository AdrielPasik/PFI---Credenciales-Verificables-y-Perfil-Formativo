/**
 * Constructor del DID Document del issuer -- S8c3.
 *
 * El vector dorado es el fixture PUBLICO del escalar 1 congelado en S8b.1, asi
 * que la salida de esta slice queda encadenada al contrato criptografico ya
 * congelado: si `x` o `y` cambiaran, fallarian S8b.1, S8c2 y S8c3 a la vez.
 *
 * Todo puro: sin base de datos, sin red, sin secretos, sin Wallet.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PUBLIC_TEST_KEY_ONE,
  PUBLIC_TEST_KEY_TWO
} from '../signing/__fixtures__/signer-test-keys';
import {
  buildIssuerDidDocument,
  IssuerDidDocumentError,
  type IssuerAssertionKeyInput
} from './issuer-did-document.builder';

const ISSUER_DID =
  'did:web:api.scopeedu.technology:did:issuers:3f2a7c18-5b94-4e61-9d0c-8a6f21b4e5d7';

/** Valores base64url exactos congelados en S8b.1 para el escalar 1. */
const GOLDEN_X = 'eb5mfvncu6xVoGKVzocLBwKb_NstzijZWfKBWxb4F5g';
const GOLDEN_Y = 'SDradyajxGVdpPv8DhEIqP0XtEimhVQZnEfQj_sQ1Lg';

function assertionKey(
  overrides: Partial<IssuerAssertionKeyInput> = {}
): IssuerAssertionKeyInput {
  return {
    keyVersion: 1,
    publicKeyX: PUBLIC_TEST_KEY_ONE.publicKeyX,
    publicKeyY: PUBLIC_TEST_KEY_ONE.publicKeyY,
    publicKeyCompressed: PUBLIC_TEST_KEY_ONE.publicKeyCompressed,
    ...overrides
  };
}

function expectError(
  input: Parameters<typeof buildIssuerDidDocument>[0],
  code: string
): void {
  try {
    buildIssuerDidDocument(input);
  } catch (error) {
    assert.ok(error instanceof IssuerDidDocumentError, String(error));
    assert.equal(error.code, code);
    return;
  }
  throw new Error(`se esperaba que fallara con ${code}`);
}

// ---------------------------------------------------------------------------
// 18-24: VECTOR DORADO
// ---------------------------------------------------------------------------

test('18-24: documento exacto para una clave de asercion valida', () => {
  const document = buildIssuerDidDocument({
    did: ISSUER_DID,
    assertionKeys: [assertionKey()]
  });

  assert.deepEqual(document, {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://www.w3.org/ns/cid/v1'
    ],
    id: ISSUER_DID,
    verificationMethod: [
      {
        id: `${ISSUER_DID}#assert-1`,
        type: 'JsonWebKey',
        controller: ISSUER_DID,
        publicKeyJwk: {
          kty: 'EC',
          crv: 'secp256k1',
          kid: 'assert-1',
          x: GOLDEN_X,
          y: GOLDEN_Y
        }
      }
    ],
    assertionMethod: [`${ISSUER_DID}#assert-1`]
  });
});

test('18: x/y reproducen EXACTAMENTE el vector base64url de S8b.1', () => {
  const document = buildIssuerDidDocument({
    did: ISSUER_DID,
    assertionKeys: [assertionKey()]
  });
  const jwk = document.verificationMethod![0].publicKeyJwk;

  assert.equal(jwk.x, GOLDEN_X);
  assert.equal(jwk.y, GOLDEN_Y);

  // Y son base64url SIN padding, de 32 bytes.
  for (const value of [jwk.x, jwk.y]) {
    assert.ok(!value.includes('='), 'sin padding');
    assert.ok(!value.includes('+') && !value.includes('/'), 'alfabeto url-safe');
    assert.equal(Buffer.from(value, 'base64url').length, 32);
  }
});

test('12: se codifica el hex DECODIFICADO, no los caracteres del texto "0x..."', () => {
  const document = buildIssuerDidDocument({
    did: ISSUER_DID,
    assertionKeys: [assertionKey()]
  });
  const jwk = document.verificationMethod![0].publicKeyJwk;

  // Round-trip: base64url -> bytes -> hex == la coordenada persistida.
  assert.equal(
    `0x${Buffer.from(jwk.x, 'base64url').toString('hex')}`,
    PUBLIC_TEST_KEY_ONE.publicKeyX
  );
  assert.equal(
    `0x${Buffer.from(jwk.y, 'base64url').toString('hex')}`,
    PUBLIC_TEST_KEY_ONE.publicKeyY
  );

  // El error clasico seria base64 del TEXTO; eso daria otra cosa.
  assert.notEqual(
    jwk.x,
    Buffer.from(PUBLIC_TEST_KEY_ONE.publicKeyX, 'utf8').toString('base64url')
  );
});

test('19-20: la JWK tiene EXACTAMENTE cinco claves, sin alg, sin use, sin d', () => {
  const document = buildIssuerDidDocument({
    did: ISSUER_DID,
    assertionKeys: [assertionKey()]
  });
  const jwk = document.verificationMethod![0].publicKeyJwk;

  assert.deepEqual(Object.keys(jwk).sort(), ['crv', 'kid', 'kty', 'x', 'y']);
  assert.equal(jwk.kty, 'EC');
  assert.equal(jwk.crv, 'secp256k1');
  assert.equal(jwk.kid, 'assert-1');

  const record = jwk as unknown as Record<string, unknown>;
  for (const forbidden of ['alg', 'use', 'd', 'k', 'key_ops', 'ext']) {
    assert.equal(record[forbidden], undefined, `no debe declarar ${forbidden}`);
  }
});

test('20: ninguna clave JSON privada en el documento serializado', () => {
  const document = buildIssuerDidDocument({
    did: ISSUER_DID,
    assertionKeys: [assertionKey()]
  });

  // Aserciones ESTRUCTURALES sobre claves JSON: un grep textual de "d" seria
  // absurdo, porque "id" contiene la letra d.
  const keys = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, nested] of Object.entries(value)) {
        keys.add(key);
        walk(nested);
      }
    }
  };
  walk(document);

  for (const forbidden of [
    'd',
    'privateKey',
    'secretRef',
    'mnemonic',
    'seed',
    'seedPhrase',
    'custody',
    'walletAddress',
    'anchorSignerProfileId',
    'blockchainAccountId',
    'publicKeyMultibase'
  ]) {
    assert.ok(!keys.has(forbidden), `el documento no debe tener la clave ${forbidden}`);
  }

  assert.deepEqual([...keys].sort(), [
    '@context',
    'assertionMethod',
    'controller',
    'crv',
    'id',
    'kid',
    'kty',
    'publicKeyJwk',
    'type',
    'verificationMethod',
    'x',
    'y'
  ]);
});

test('21-22: id del verification method y controller exactos', () => {
  const document = buildIssuerDidDocument({
    did: ISSUER_DID,
    assertionKeys: [assertionKey({ keyVersion: 7 })]
  });
  const method = document.verificationMethod![0];

  assert.equal(method.id, `${ISSUER_DID}#assert-7`);
  assert.equal(method.controller, ISSUER_DID);
  assert.equal(method.type, 'JsonWebKey');
  assert.equal(method.publicKeyJwk.kid, 'assert-7');
});

test('el DID almacenado se usa tal cual: sin minusculizar ni normalizar', () => {
  const mixedCaseDid =
    'did:web:api.scopeedu.technology:did:issuers:3F2A7C18-5B94-4E61-9D0C-8A6F21B4E5D7';

  const document = buildIssuerDidDocument({
    did: mixedCaseDid,
    assertionKeys: [assertionKey()]
  });

  assert.equal(document.id, mixedCaseDid);
  assert.equal(document.verificationMethod![0].id, `${mixedCaseDid}#assert-1`);
  assert.equal(document.verificationMethod![0].controller, mixedCaseDid);
});

test('23: assertionMethod referencia por id, no embebe un segundo objeto', () => {
  const document = buildIssuerDidDocument({
    did: ISSUER_DID,
    assertionKeys: [assertionKey()]
  });

  assert.deepEqual(document.assertionMethod, [`${ISSUER_DID}#assert-1`]);
  assert.equal(typeof document.assertionMethod![0], 'string');
  assert.equal(document.assertionMethod![0], document.verificationMethod![0].id);
});

test('24: contextos exactos y en orden', () => {
  const document = buildIssuerDidDocument({
    did: ISSUER_DID,
    assertionKeys: [assertionKey()]
  });

  assert.deepEqual(document['@context'], [
    'https://www.w3.org/ns/did/v1',
    'https://www.w3.org/ns/cid/v1'
  ]);
});

test('el documento no declara relaciones que no necesitamos', () => {
  const document = buildIssuerDidDocument({
    did: ISSUER_DID,
    assertionKeys: [assertionKey()]
  });

  assert.deepEqual(Object.keys(document).sort(), [
    '@context',
    'assertionMethod',
    'id',
    'verificationMethod'
  ]);

  const record = document as unknown as Record<string, unknown>;
  for (const forbidden of [
    'authentication',
    'capabilityInvocation',
    'capabilityDelegation',
    'keyAgreement',
    'service',
    'alsoKnownAs'
  ]) {
    assert.equal(record[forbidden], undefined, `no debe declarar ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// SIN CLAVES PUBLICABLES
// ---------------------------------------------------------------------------

test('3: sin claves publicables el DID resuelve, pero omite las propiedades', () => {
  const document = buildIssuerDidDocument({
    did: ISSUER_DID,
    assertionKeys: []
  });

  assert.deepEqual(document, {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://www.w3.org/ns/cid/v1'
    ],
    id: ISSUER_DID
  });

  // OMITIDAS, no vacias: DID Core dice que si estan presentes, su valor debe
  // ser un conjunto de UNA O MAS verification methods.
  assert.ok(!('verificationMethod' in document));
  assert.ok(!('assertionMethod' in document));
  assert.notDeepEqual(
    JSON.parse(JSON.stringify(document)).verificationMethod,
    []
  );
});

// ---------------------------------------------------------------------------
// 14-15: keyVersion
// ---------------------------------------------------------------------------

test('14-15: keyVersion debe ser un entero positivo', () => {
  for (const keyVersion of [0, -1, -7, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expectError(
      { did: ISSUER_DID, assertionKeys: [assertionKey({ keyVersion })] },
      'INVALID_KEY_VERSION'
    );
  }
});

test('keyVersion 1 y valores grandes son aceptables', () => {
  for (const keyVersion of [1, 2, 42]) {
    const document = buildIssuerDidDocument({
      did: ISSUER_DID,
      assertionKeys: [assertionKey({ keyVersion })]
    });
    assert.equal(
      document.verificationMethod![0].publicKeyJwk.kid,
      `assert-${keyVersion}`
    );
  }
});

// ---------------------------------------------------------------------------
// 9-13: MATERIAL PUBLICO
// ---------------------------------------------------------------------------

test('9-10: coordenadas mal formadas fallan cerrado', () => {
  const malformed = [
    null,
    '',
    // sin prefijo 0x
    PUBLIC_TEST_KEY_ONE.publicKeyX.slice(2),
    // MAYUSCULAS: no es la representacion congelada en S8c1
    PUBLIC_TEST_KEY_ONE.publicKeyX.toUpperCase(),
    '0x' + PUBLIC_TEST_KEY_ONE.publicKeyX.slice(2).toUpperCase(),
    // longitud incorrecta
    '0x1234',
    `${PUBLIC_TEST_KEY_ONE.publicKeyX}00`,
    // no hexadecimal
    `0x${'z'.repeat(64)}`,
    // con espacios
    ` ${PUBLIC_TEST_KEY_ONE.publicKeyX} `
  ];

  for (const value of malformed) {
    expectError(
      { did: ISSUER_DID, assertionKeys: [assertionKey({ publicKeyX: value })] },
      'MALFORMED_PUBLIC_COORDINATE'
    );
    expectError(
      { did: ISSUER_DID, assertionKeys: [assertionKey({ publicKeyY: value })] },
      'MALFORMED_PUBLIC_COORDINATE'
    );
  }
});

test('11: una clave comprimida mal formada falla cerrado', () => {
  const malformed = [
    null,
    '',
    // prefijo de paridad invalido
    `0x04${PUBLIC_TEST_KEY_ONE.publicKeyX.slice(2)}`,
    `0x01${PUBLIC_TEST_KEY_ONE.publicKeyX.slice(2)}`,
    // longitud de coordenada, no de clave comprimida
    PUBLIC_TEST_KEY_ONE.publicKeyX,
    // mayusculas
    PUBLIC_TEST_KEY_ONE.publicKeyCompressed.toUpperCase(),
    `0x${'z'.repeat(66)}`
  ];

  for (const value of malformed) {
    expectError(
      {
        did: ISSUER_DID,
        assertionKeys: [assertionKey({ publicKeyCompressed: value })]
      },
      'MALFORMED_COMPRESSED_PUBLIC_KEY'
    );
  }
});

test('12: x/y con forma valida pero que NO son un punto de secp256k1 fallan cerrado', () => {
  // Y modificada en un byte: la ecuacion de la curva deja de cumplirse.
  const offCurveY = `${PUBLIC_TEST_KEY_ONE.publicKeyY.slice(0, -2)}ff`;

  expectError(
    {
      did: ISSUER_DID,
      assertionKeys: [assertionKey({ publicKeyY: offCurveY })]
    },
    'PUBLIC_KEY_NOT_ON_CURVE'
  );
});

test('13: una clave comprimida que no corresponde a x/y falla cerrado', () => {
  expectError(
    {
      did: ISSUER_DID,
      assertionKeys: [
        assertionKey({
          publicKeyCompressed: PUBLIC_TEST_KEY_TWO.publicKeyCompressed
        })
      ]
    },
    'COMPRESSED_PUBLIC_KEY_MISMATCH'
  );
});

test('la paridad equivocada en la clave comprimida tambien falla', () => {
  // Misma X, prefijo de paridad invertido: es otro punto, no el persistido.
  const flipped = `0x03${PUBLIC_TEST_KEY_ONE.publicKeyCompressed.slice(4)}`;

  expectError(
    {
      did: ISSUER_DID,
      assertionKeys: [assertionKey({ publicKeyCompressed: flipped })]
    },
    'COMPRESSED_PUBLIC_KEY_MISMATCH'
  );
});

test('los errores del builder no filtran valores de la base', () => {
  try {
    buildIssuerDidDocument({
      did: ISSUER_DID,
      assertionKeys: [assertionKey({ publicKeyX: '0xdeadbeef' })]
    });
    throw new Error('deberia haber fallado');
  } catch (error) {
    assert.ok(error instanceof IssuerDidDocumentError);
    assert.ok(!error.message.includes('deadbeef'));
    assert.ok(!error.message.includes('0x'));
    // Tampoco el mensaje de ethers.
    assert.doesNotMatch(error.message, /bad point|equation/i);
  }
});

test('el error de punto fuera de curva descarta por completo el mensaje de ethers', () => {
  try {
    buildIssuerDidDocument({
      did: ISSUER_DID,
      assertionKeys: [
        assertionKey({
          publicKeyY: `${PUBLIC_TEST_KEY_ONE.publicKeyY.slice(0, -2)}ff`
        })
      ]
    });
    throw new Error('deberia haber fallado');
  } catch (error) {
    assert.ok(error instanceof IssuerDidDocumentError);
    assert.doesNotMatch(error.message, /equation left|bad point/i);
  }
});

// ---------------------------------------------------------------------------
// PREPARADO PARA ROTACION (S8c8)
// ---------------------------------------------------------------------------

test('el builder ya acepta varias claves, aunque S8c3 pase como maximo una', () => {
  const document = buildIssuerDidDocument({
    did: ISSUER_DID,
    assertionKeys: [
      assertionKey({ keyVersion: 1 }),
      {
        keyVersion: 2,
        publicKeyX: PUBLIC_TEST_KEY_TWO.publicKeyX,
        publicKeyY: PUBLIC_TEST_KEY_TWO.publicKeyY,
        publicKeyCompressed: PUBLIC_TEST_KEY_TWO.publicKeyCompressed
      }
    ]
  });

  assert.equal(document.verificationMethod!.length, 2);
  assert.deepEqual(document.assertionMethod, [
    `${ISSUER_DID}#assert-1`,
    `${ISSUER_DID}#assert-2`
  ]);
  assert.notEqual(
    document.verificationMethod![0].publicKeyJwk.x,
    document.verificationMethod![1].publicKeyJwk.x
  );
});

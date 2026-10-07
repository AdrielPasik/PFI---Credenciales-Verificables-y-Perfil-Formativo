/**
 * Contrato PURO de scope-proof-v1 -- S8c4, matriz 1-20.
 *
 * Lo que se congela aca son los BYTES, no el resultado de la firma: el
 * envelope es texto firmado, asi que un cambio de orden de lineas, de nombre
 * de campo o de separador invalida silenciosamente toda firma ya emitida. Un
 * test que solo mirara la firma final no distinguiria "cambio el envelope" de
 * "cambio la clave".
 *
 * Sin ethers, sin red, sin Wallet: este modulo es strings.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { CredentialProofError } from './credential-proof.error';
import {
  SCOPE_PROOF_V1_CANONICALIZATION_VERSION,
  SCOPE_PROOF_V1_CRYPTOSUITE,
  SCOPE_PROOF_V1_HASH_ALGORITHM,
  SCOPE_PROOF_V1_PROFILE,
  SCOPE_PROOF_V1_PROOF_PURPOSE,
  SCOPE_PROOF_V1_TYPE,
  assertCanonicalScopeProofValue,
  buildScopeProofV1,
  buildScopeProofV1Envelope,
  buildScopeProofV1VerificationMethod
} from './scope-proof-v1';

const ISSUER_DID =
  'did:web:api.scopeedu.technology:did:issuers:3f2a7c18-5b94-4e61-9d0c-8a6f21b4e5d7';
const VERIFICATION_METHOD = `${ISSUER_DID}#assert-1`;
const CANONICAL_HASH =
  '0x9fa83bee0aac884aed8ea28e593d08a858418ac5c4cbca608b2bd37014b1cbca';

/** Firma valida del vector dorado: v = 28 y `s` canonica. */
const GOLDEN_PROOF_VALUE =
  '0x59c5d2831ba95beeb568d98a99d4b4c4c4a0a714e63b3ce06aca16511a1f0532' +
  '21321abd6400ceb3875c05248cb3c32c41d29847aa65d2d71b17336fe662b4c31c';

function expectCode(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof CredentialProofError, String(error));
    assert.equal((error as CredentialProofError).code, code);
    return true;
  };
}

// ---------------------------------------------------------------------------
// 1-4: EL ENVELOPE, BYTE A BYTE
// ---------------------------------------------------------------------------

test('1: el envelope tiene EXACTAMENTE las seis lineas congeladas', () => {
  const envelope = buildScopeProofV1Envelope({
    verificationMethod: VERIFICATION_METHOD,
    canonicalHash: CANONICAL_HASH
  });

  assert.deepEqual(envelope.split('\n'), [
    'scope-proof-v1',
    'proofPurpose=assertionMethod',
    `verificationMethod=${VERIFICATION_METHOD}`,
    'canonicalizationVersion=canon_v2',
    'hashAlgorithm=sha-256',
    `canonicalHash=${CANONICAL_HASH}`
  ]);
});

test('1b: NO lleva type, cryptosuite, created, issuerId ni address', () => {
  const envelope = buildScopeProofV1Envelope({
    verificationMethod: VERIFICATION_METHOD,
    canonicalHash: CANONICAL_HASH
  });

  // `type` y `cryptosuite` son constantes fijas del profile y se validan como
  // literales; el profile SI va firmado, y es la primera linea.
  for (const absent of [
    'type=',
    'cryptosuite=',
    'created',
    'issuerId=',
    'address=',
    'ScopeCredentialProof2026',
    'ecdsa-secp256k1-eip191'
  ]) {
    assert.ok(!envelope.includes(absent), `el envelope no debe contener ${absent}`);
  }
});

test('2: el separador es LF y nunca CRLF', () => {
  const envelope = buildScopeProofV1Envelope({
    verificationMethod: VERIFICATION_METHOD,
    canonicalHash: CANONICAL_HASH
  });

  assert.ok(!envelope.includes('\r'));
  assert.equal((envelope.match(/\n/g) ?? []).length, 5);
  assert.ok(!envelope.includes('\r\n'));
});

test('3: NO hay salto de linea final', () => {
  const envelope = buildScopeProofV1Envelope({
    verificationMethod: VERIFICATION_METHOD,
    canonicalHash: CANONICAL_HASH
  });

  assert.ok(!envelope.endsWith('\n'));
  assert.ok(envelope.endsWith(CANONICAL_HASH));
});

test('4: un CR dentro del verificationMethod se rechaza', () => {
  // Llega por la via del patron: el alfabeto admitido no incluye CR, asi que
  // nunca puede partir el envelope en una linea mas.
  assert.throws(
    () =>
      buildScopeProofV1Envelope({
        verificationMethod: `${ISSUER_DID}\r#assert-1`,
        canonicalHash: CANONICAL_HASH
      }),
    expectCode('MALFORMED_VERIFICATION_METHOD')
  );

  assert.throws(
    () =>
      buildScopeProofV1Envelope({
        verificationMethod: `${VERIFICATION_METHOD}\r`,
        canonicalHash: CANONICAL_HASH
      }),
    expectCode('MALFORMED_VERIFICATION_METHOD')
  );
});

test('4b: un LF inyectado tampoco puede agregar lineas al envelope', () => {
  assert.throws(
    () =>
      buildScopeProofV1Envelope({
        verificationMethod: `${VERIFICATION_METHOD}\ncanonicalHash=0x00`,
        canonicalHash: CANONICAL_HASH
      }),
    expectCode('MALFORMED_VERIFICATION_METHOD')
  );
});

test('la invariante ASCII se comprueba sobre el envelope ARMADO', () => {
  const envelope = buildScopeProofV1Envelope({
    verificationMethod: VERIFICATION_METHOD,
    canonicalHash: CANONICAL_HASH
  });

  const bytes = Buffer.from(envelope, 'utf8');
  assert.ok(Array.from(bytes).every((byte) => byte <= 0x7f));
  assert.ok(!Array.from(bytes).includes(0x0d));
  // Texto ASCII: cada caracter es un byte.
  assert.equal(bytes.length, envelope.length);
});

// ---------------------------------------------------------------------------
// 5: NO ASCII
// ---------------------------------------------------------------------------

test('5: un verificationMethod no ASCII se rechaza sin normalizarlo', () => {
  for (const malformed of [
    'did:web:apí.scopeedu.technology:did:issuers:issuer-1#assert-1',
    `${ISSUER_DID}#assert-1 `,
    `did:web:api.scopeedu.technology:did:issuers:issuer-١#assert-1`,
    // Astral: un emoji no se "arregla" recortandolo.
    `${ISSUER_DID}#assert-1\u{1f600}`
  ]) {
    assert.throws(
      () =>
        buildScopeProofV1Envelope({
          verificationMethod: malformed,
          canonicalHash: CANONICAL_HASH
        }),
      expectCode('MALFORMED_VERIFICATION_METHOD'),
      malformed
    );
  }
});

test('5b: un DID que no es did:web no produce envelope', () => {
  for (const malformed of [
    'did:example:issuer-demo#assert-1',
    'did:key:z6Mk#assert-1',
    'did:web:api.scopeedu.technology:did:users:holder-1',
    `${ISSUER_DID}`,
    `${ISSUER_DID}#keys-1`,
    `${ISSUER_DID}#assertion-1`,
    `${ISSUER_DID}#ASSERT-1`,
    ''
  ]) {
    assert.throws(
      () =>
        buildScopeProofV1Envelope({
          verificationMethod: malformed,
          canonicalHash: CANONICAL_HASH
        }),
      expectCode('MALFORMED_VERIFICATION_METHOD'),
      malformed
    );
  }
});

// ---------------------------------------------------------------------------
// 6-8: canonicalHash
// ---------------------------------------------------------------------------

test('6: un canonicalHash en MAYUSCULA se rechaza', () => {
  // El envelope embebe el hash como TEXTO: dos representaciones del mismo
  // digest producirian dos firmas distintas sobre la misma credencial.
  assert.throws(
    () =>
      buildScopeProofV1Envelope({
        verificationMethod: VERIFICATION_METHOD,
        canonicalHash: CANONICAL_HASH.toUpperCase().replace('0X', '0x')
      }),
    expectCode('MALFORMED_CANONICAL_HASH')
  );

  assert.throws(
    () =>
      buildScopeProofV1Envelope({
        verificationMethod: VERIFICATION_METHOD,
        canonicalHash: `0x9FA83BEE${CANONICAL_HASH.slice(10)}`
      }),
    expectCode('MALFORMED_CANONICAL_HASH')
  );
});

test('7: un hash sin prefijo 0x se rechaza', () => {
  assert.throws(
    () =>
      buildScopeProofV1Envelope({
        verificationMethod: VERIFICATION_METHOD,
        canonicalHash: CANONICAL_HASH.slice(2)
      }),
    expectCode('MALFORMED_CANONICAL_HASH')
  );
});

test('8: un hash con longitud equivocada se rechaza', () => {
  for (const malformed of [
    `${CANONICAL_HASH}ab`,
    CANONICAL_HASH.slice(0, -1),
    '0x',
    '0x00',
    `0X${CANONICAL_HASH.slice(2)}`,
    `0x${'z'.repeat(64)}`,
    ' ' + CANONICAL_HASH,
    CANONICAL_HASH + '\n'
  ]) {
    assert.throws(
      () =>
        buildScopeProofV1Envelope({
          verificationMethod: VERIFICATION_METHOD,
          canonicalHash: malformed
        }),
      expectCode('MALFORMED_CANONICAL_HASH'),
      malformed
    );
  }
});

// ---------------------------------------------------------------------------
// 9-10: keyVersion y verificationMethod
// ---------------------------------------------------------------------------

test('9: keyVersion <= 0 o no entero se rechaza', () => {
  for (const malformed of [0, -1, -7, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => buildScopeProofV1VerificationMethod(ISSUER_DID, malformed),
      expectCode('INVALID_KEY_VERSION'),
      String(malformed)
    );
  }
});

test('10: el verificationMethod se arma con el DID ALMACENADO y la keyVersion', () => {
  assert.equal(
    buildScopeProofV1VerificationMethod(ISSUER_DID, 1),
    `${ISSUER_DID}#assert-1`
  );
  assert.equal(
    buildScopeProofV1VerificationMethod(ISSUER_DID, 7),
    `${ISSUER_DID}#assert-7`
  );
  assert.equal(
    buildScopeProofV1VerificationMethod(ISSUER_DID, 42),
    `${ISSUER_DID}#assert-42`
  );
});

test('10b: el DID almacenado no se normaliza ni se pasa a minusculas', () => {
  const mixedCase =
    'did:web:API.ScopeEdu.Technology:did:issuers:3F2A7C18-5b94-4e61-9d0c-8a6f21b4e5d7';

  assert.equal(
    buildScopeProofV1VerificationMethod(mixedCase, 1),
    `${mixedCase}#assert-1`
  );
});

test('10c: un DID almacenado inadmisible no produce fragmento', () => {
  for (const malformed of [
    'did:example:issuer-demo',
    'did:web:',
    '',
    `${ISSUER_DID}#assert-1`
  ]) {
    assert.throws(
      () => buildScopeProofV1VerificationMethod(malformed, 1),
      expectCode('MALFORMED_VERIFICATION_METHOD'),
      malformed
    );
  }
});

// ---------------------------------------------------------------------------
// 11-19: EL OBJETO proof
// ---------------------------------------------------------------------------

test('11: el proof tiene EXACTAMENTE ocho claves', () => {
  const proof = buildScopeProofV1({
    verificationMethod: VERIFICATION_METHOD,
    proofValue: GOLDEN_PROOF_VALUE
  });

  assert.deepEqual(Object.keys(proof).sort(), [
    'canonicalizationVersion',
    'cryptosuite',
    'hashAlgorithm',
    'profile',
    'proofPurpose',
    'proofValue',
    'type',
    'verificationMethod'
  ]);
  assert.equal(Object.keys(proof).length, 8);
});

test('12: proof.created esta AUSENTE', () => {
  const proof = buildScopeProofV1({
    verificationMethod: VERIFICATION_METHOD,
    proofValue: GOLDEN_PROOF_VALUE
  });

  // `issued_at` ya viaja autenticado dentro de canon_v2; un segundo timestamp
  // solo agregaria un campo mutable sin firmar.
  assert.ok(!('created' in proof));
  assert.ok(!('createdAt' in proof));
  assert.ok(!JSON.stringify(proof).includes('created'));
});

test('13: el proof NO duplica el canonicalHash', () => {
  const proof = buildScopeProofV1({
    verificationMethod: VERIFICATION_METHOD,
    proofValue: GOLDEN_PROOF_VALUE
  });

  // `canonicalHash` vive a nivel Credential. El envelope lo referencia; el
  // objeto proof no lo repite, para que no puedan divergir.
  assert.ok(!('canonicalHash' in proof));
  assert.ok(!JSON.stringify(proof).includes(CANONICAL_HASH));
});

test('13b: el proof no lleva nada del signer, de la red ni de JOSE', () => {
  const proof = buildScopeProofV1({
    verificationMethod: VERIFICATION_METHOD,
    proofValue: GOLDEN_PROOF_VALUE
  });

  for (const absent of [
    'issuerAddress',
    'signerAddress',
    'address',
    'keyVersion',
    'profileId',
    'secretRef',
    'txHash',
    'network',
    'chainId',
    'anchor',
    'alg',
    'jws',
    'signature',
    'publicKey'
  ]) {
    assert.ok(!(absent in proof), `el proof no debe tener ${absent}`);
  }
});

test('14-19: los seis literales del profile son exactos', () => {
  const proof = buildScopeProofV1({
    verificationMethod: VERIFICATION_METHOD,
    proofValue: GOLDEN_PROOF_VALUE
  });

  assert.equal(proof.type, 'ScopeCredentialProof2026');
  assert.equal(proof.profile, 'scope-proof-v1');
  assert.equal(proof.cryptosuite, 'ecdsa-secp256k1-eip191');
  assert.equal(proof.proofPurpose, 'assertionMethod');
  assert.equal(proof.canonicalizationVersion, 'canon_v2');
  assert.equal(proof.hashAlgorithm, 'sha-256');
  assert.equal(proof.verificationMethod, VERIFICATION_METHOD);
  assert.equal(proof.proofValue, GOLDEN_PROOF_VALUE);
});

test('14b: las constantes exportadas son las congeladas en S8b.1', () => {
  assert.equal(SCOPE_PROOF_V1_TYPE, 'ScopeCredentialProof2026');
  assert.equal(SCOPE_PROOF_V1_PROFILE, 'scope-proof-v1');
  assert.equal(SCOPE_PROOF_V1_CRYPTOSUITE, 'ecdsa-secp256k1-eip191');
  assert.equal(SCOPE_PROOF_V1_PROOF_PURPOSE, 'assertionMethod');
  assert.equal(SCOPE_PROOF_V1_CANONICALIZATION_VERSION, 'canon_v2');
  assert.equal(SCOPE_PROOF_V1_HASH_ALGORITHM, 'sha-256');
});

// ---------------------------------------------------------------------------
// 20: FORMA DEL proofValue
// ---------------------------------------------------------------------------

test('20: el proofValue exige 65 bytes, v en {27,28} y s canonica', () => {
  assert.doesNotThrow(() => assertCanonicalScopeProofValue(GOLDEN_PROOF_VALUE));

  const r = GOLDEN_PROOF_VALUE.slice(2, 66);
  const s = GOLDEN_PROOF_VALUE.slice(66, 130);

  // Forma
  for (const malformed of [
    GOLDEN_PROOF_VALUE.slice(0, -2),
    `${GOLDEN_PROOF_VALUE}00`,
    GOLDEN_PROOF_VALUE.slice(2),
    `0x${r}${s}`.toUpperCase().replace('0X', '0x'),
    '0x',
    `0x${'g'.repeat(130)}`
  ]) {
    assert.throws(
      () => assertCanonicalScopeProofValue(malformed),
      expectCode('MALFORMED_PROOF_VALUE'),
      malformed
    );
  }

  // v fuera de {27,28}: 0 y 1 son la forma "cruda" de ethers/EIP-2098, que
  // este profile NO admite.
  for (const badV of ['00', '01', '1a', '1d', 'ff']) {
    assert.throws(
      () => assertCanonicalScopeProofValue(`0x${r}${s}${badV}`),
      expectCode('NON_CANONICAL_SIGNATURE'),
      badV
    );
  }

  // `s` alta: la firma seria maleable (r, n-s, v' es igualmente valida).
  const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const highS = (n / 2n + 1n).toString(16).padStart(64, '0');
  assert.throws(
    () => assertCanonicalScopeProofValue(`0x${r}${highS}1b`),
    expectCode('NON_CANONICAL_SIGNATURE')
  );

  // `s` exactamente n/2 es admisible (el limite es inclusivo).
  const halfN = (n / 2n).toString(16).padStart(64, '0');
  assert.doesNotThrow(() =>
    assertCanonicalScopeProofValue(`0x${r}${halfN}1b`)
  );

  // `s` nula no es una firma.
  assert.throws(
    () => assertCanonicalScopeProofValue(`0x${r}${'0'.repeat(64)}1b`),
    expectCode('NON_CANONICAL_SIGNATURE')
  );
});

test('20b: buildScopeProofV1 rechaza una firma no canonica', () => {
  const r = GOLDEN_PROOF_VALUE.slice(2, 66);
  const s = GOLDEN_PROOF_VALUE.slice(66, 130);

  assert.throws(
    () =>
      buildScopeProofV1({
        verificationMethod: VERIFICATION_METHOD,
        proofValue: `0x${r}${s}00`
      }),
    expectCode('NON_CANONICAL_SIGNATURE')
  );
});

// ---------------------------------------------------------------------------
// LOS ERRORES NO FILTRAN NADA
// ---------------------------------------------------------------------------

test('los mensajes de error no arrastran el hash, el DID ni la firma', () => {
  const thrown: CredentialProofError[] = [];

  const attempt = (run: () => unknown) => {
    try {
      run();
    } catch (error) {
      thrown.push(error as CredentialProofError);
    }
  };

  attempt(() =>
    buildScopeProofV1Envelope({
      verificationMethod: VERIFICATION_METHOD,
      canonicalHash: 'no-es-un-hash-0xdeadbeef'
    })
  );
  attempt(() => buildScopeProofV1VerificationMethod('did:example:secreto', 1));
  attempt(() => assertCanonicalScopeProofValue('0xdeadbeef'));

  assert.equal(thrown.length, 3);

  for (const error of thrown) {
    for (const leak of ['deadbeef', 'secreto', CANONICAL_HASH, ISSUER_DID]) {
      assert.ok(
        !error.message.includes(leak),
        `el mensaje no debe contener ${leak}`
      );
    }
  }
});

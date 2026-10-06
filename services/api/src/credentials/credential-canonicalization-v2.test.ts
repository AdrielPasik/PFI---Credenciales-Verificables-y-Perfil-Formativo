/**
 * canon_v2 -- contrato congelado en S8b.1.
 *
 * canon_v2 es EXACTAMENTE canon_v1 + `credential_id`. Nada mas cambia: misma
 * normalizacion NFKC, mismo colapso de whitespace, mismas fechas truncadas al
 * segundo, mismas horas como string de dos decimales, mismo orden de claves y
 * de arrays, misma serializacion JSON, mismo SHA-256 sobre UTF-8.
 *
 * Esta canonicalizacion es un CONTRATO WIRE-LEVEL: su salida se firma (proof
 * `scope-proof-v1`) y se ancla on-chain (`bytes32`). Un cambio de bytes
 * invalidaria evidencia ya emitida, asi que los golden vectors de abajo son
 * normativos, no ilustrativos. Fueron calculados en S8b.1 con criptografia
 * puramente local y deben reproducirse exactamente.
 *
 * Los dos hashes congelados corresponden al MISMO credential:
 *   canon_v1  0x486243f2a72a882d756a17b1e2367b7f484edeb8c9fe708f8b5e1dc720413a9d
 *   canon_v2  0x9fa83bee0aac884aed8ea28e593d08a858418ac5c4cbca608b2bd37014b1cbca
 *
 * NO se testea aqui el proof: S8c1 no implementa firma. El vector completo de
 * `scope-proof-v1` (envelope, digest EIP-191, proofValue) se congela en S8c4,
 * donde existira el codigo que lo produce.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { BadRequestException } from '@nestjs/common';

import { CredentialHashingService } from './credential-hashing.service';

const service = new CredentialHashingService();

// ---------------------------------------------------------------------------
// VECTOR S8b.1 -- unica fuente de estas constantes en el repo.
//
// Ejercita a proposito varios bordes de canonicalizacion:
//   * NFKC compositivo: "o" + U+0301 -> "o" acentuada (UTF-8 c3 b3);
//   * NFKC compositivo: "e" + U+0303 -> U+1EBD (UTF-8 e1 ba bd);
//   * colapso de whitespace y trim en `title`;
//   * truncado de milisegundos en `issued_at`;
//   * `hours` numerico -> string de dos decimales;
//   * ordenamiento de arrays de strings.
// ---------------------------------------------------------------------------
const VECTOR_ISSUER_DID =
  'did:web:api.scopeedu.technology:did:issuers:3f2a7c18-5b94-4e61-9d0c-8a6f21b4e5d7';
const VECTOR_SUBJECT_DID =
  'did:web:api.scopeedu.technology:did:users:c41d8e92-7a35-4f08-b6e2-19d7c530a84b';

export const CANON_V2_VECTOR_CANONICAL_HASH =
  '0x9fa83bee0aac884aed8ea28e593d08a858418ac5c4cbca608b2bd37014b1cbca';
export const CANON_V1_VECTOR_CANONICAL_HASH =
  '0x486243f2a72a882d756a17b1e2367b7f484edeb8c9fe708f8b5e1dc720413a9d';

const VECTOR_CANONICAL_JSON =
  '{"credential_id":"8d4b1f60-2c73-4a95-8e01-5f7a9b3d6c28",' +
  '"credential_subject":{"academic_period":"2026-1C",' +
  '"achievement_name":"Programación Avanzada",' +
  '"competencies":["disẽno de software"],' +
  '"completion_date":"2026-03-10","grade":"9",' +
  '"institution_name":"Universidad Argentina de la Empresa (UADE)",' +
  '"skills":["Programación","TypeScript","álgebra"]},' +
  '"description":"Curso de programación orientada a objetos.",' +
  '"hours":"60.00","issued_at":"2026-03-15T10:42:17Z",' +
  `"issuer_did":"${VECTOR_ISSUER_DID}",` +
  '"schema_version":"credential_v2",' +
  `"subject_did":"${VECTOR_SUBJECT_DID}",` +
  '"title":"Programación Avanzada","type":"course"}';

const VECTOR_CANONICAL_JSON_UTF8_BYTES = 733;

function vectorInput() {
  return {
    credentialId: '8d4b1f60-2c73-4a95-8e01-5f7a9b3d6c28',
    schemaVersion: 'credential_v2',
    type: 'course',
    issuerDid: VECTOR_ISSUER_DID,
    subjectDid: VECTOR_SUBJECT_DID,
    // NFD + whitespace de sobra en los dos extremos y en el medio.
    title: '  Programación   Avanzada  ',
    description: 'Curso de programación orientada a objetos.',
    issuedAt: new Date('2026-03-15T10:42:17.853Z'),
    hours: 60,
    credentialSubject: {
      achievementName: 'Programación Avanzada',
      institution_name: 'Universidad Argentina de la Empresa (UADE)',
      skills: ['TypeScript', 'álgebra', 'Programación'],
      // "e" + COMBINING TILDE -> U+1EBD
      competencies: ['disẽno de software'],
      grade: '9',
      completionDate: '2026-03-10',
      academicPeriod: '2026-1C'
    }
  };
}

// ---------------------------------------------------------------------------
// GOLDEN VECTOR
// ---------------------------------------------------------------------------

test('vector S8b.1: canon_v2 reproduce el canonicalJson exacto', () => {
  const result = service.createCanonicalHashForVersion(
    vectorInput(),
    CredentialHashingService.CANONICALIZATION_VERSION_V2
  );

  assert.equal(result.canonicalJson, VECTOR_CANONICAL_JSON);
});

test('vector S8b.1: el canonicalJson tiene exactamente 733 bytes UTF-8', () => {
  const result = service.createCanonicalHashForVersion(
    vectorInput(),
    CredentialHashingService.CANONICALIZATION_VERSION_V2
  );

  assert.equal(
    Buffer.byteLength(result.canonicalJson, 'utf8'),
    VECTOR_CANONICAL_JSON_UTF8_BYTES
  );
});

test('vector S8b.1: canon_v2 reproduce el canonicalHash congelado', () => {
  const result = service.createCanonicalHashForVersion(
    vectorInput(),
    CredentialHashingService.CANONICALIZATION_VERSION_V2
  );

  assert.equal(result.canonicalHash, CANON_V2_VECTOR_CANONICAL_HASH);
  assert.equal(result.canonicalizationVersion, 'canon_v2');
  assert.equal(result.hashAlgorithm, 'sha-256');
});

test('el hash es SHA-256 sobre los bytes UTF-8 del canonicalJson', () => {
  const result = service.createCanonicalHashForVersion(
    vectorInput(),
    CredentialHashingService.CANONICALIZATION_VERSION_V2
  );

  // Recalculado de forma independiente del service.
  const digest = createHash('sha256')
    .update(Buffer.from(result.canonicalJson, 'utf8'))
    .digest('hex');

  assert.equal(result.canonicalHash, `0x${digest}`);
});

test('canonicalHashText: 0x + 64 hex EN MINUSCULA', () => {
  const result = service.createCanonicalHashForVersion(
    vectorInput(),
    CredentialHashingService.CANONICALIZATION_VERSION_V2
  );

  assert.match(result.canonicalHash, /^0x[0-9a-f]{64}$/);
  assert.equal(result.canonicalHash.length, 66);
  // canonicalHashBytes: los 32 bytes que ese hex representa.
  assert.equal(Buffer.from(result.canonicalHash.slice(2), 'hex').length, 32);
});

// ---------------------------------------------------------------------------
// canon_v1 vs canon_v2
// ---------------------------------------------------------------------------

test('el MISMO credential produce hashes distintos en canon_v1 y canon_v2', () => {
  const v1 = service.createCanonicalHashForVersion(
    vectorInput(),
    CredentialHashingService.CANONICALIZATION_VERSION_V1
  );
  const v2 = service.createCanonicalHashForVersion(
    vectorInput(),
    CredentialHashingService.CANONICALIZATION_VERSION_V2
  );

  assert.equal(v1.canonicalHash, CANON_V1_VECTOR_CANONICAL_HASH);
  assert.equal(v2.canonicalHash, CANON_V2_VECTOR_CANONICAL_HASH);
  assert.notEqual(v1.canonicalHash, v2.canonicalHash);
});

test('canon_v2 agrega UNA sola clave respecto de canon_v1: credential_id', () => {
  const v1 = service.createCanonicalProjectionForVersion(
    vectorInput(),
    CredentialHashingService.CANONICALIZATION_VERSION_V1
  );
  const v2 = service.createCanonicalProjectionForVersion(
    vectorInput(),
    CredentialHashingService.CANONICALIZATION_VERSION_V2
  );

  const v1Keys = Object.keys(v1).sort();
  const v2Keys = Object.keys(v2).sort();

  assert.deepEqual(v2Keys.filter((key) => !v1Keys.includes(key)), [
    'credential_id'
  ]);
  assert.deepEqual(v1Keys.filter((key) => !v2Keys.includes(key)), []);
});

test('canon_v1 por defecto: createCanonicalHash sigue siendo canon_v1', () => {
  const result = service.createCanonicalHash(vectorInput());

  assert.equal(result.canonicalizationVersion, 'canon_v1');
  assert.equal(result.canonicalHash, CANON_V1_VECTOR_CANONICAL_HASH);
});

test('canon_v1 IGNORA credentialId: pasarlo o no da el mismo hash', () => {
  const withId = service.createCanonicalHashForVersion(
    vectorInput(),
    CredentialHashingService.CANONICALIZATION_VERSION_V1
  );
  const withoutId = service.createCanonicalHashForVersion(
    { ...vectorInput(), credentialId: undefined },
    CredentialHashingService.CANONICALIZATION_VERSION_V1
  );

  assert.equal(withId.canonicalHash, withoutId.canonicalHash);
});

// ---------------------------------------------------------------------------
// credential_id
// ---------------------------------------------------------------------------

test('canon_v2 EXIGE credential_id y falla cerrado si falta', () => {
  for (const credentialId of [undefined, null, '', '   ']) {
    assert.throws(
      () =>
        service.createCanonicalHashForVersion(
          { ...vectorInput(), credentialId },
          CredentialHashingService.CANONICALIZATION_VERSION_V2
        ),
      BadRequestException
    );
  }
});

test('N-1: canon_v2 distingue dos credentials identicas del mismo segundo', () => {
  // Es exactamente el hallazgo que motivo canon_v2: en canon_v1 estas dos
  // colisionan, y la segunda registracion on-chain revertiria para siempre con
  // `CredentialAlreadyRegistered`.
  const first = vectorInput();
  const second = {
    ...vectorInput(),
    credentialId: '11111111-2222-4333-8444-555555555555'
  };

  const v1First = service.createCanonicalHashForVersion(first, 'canon_v1');
  const v1Second = service.createCanonicalHashForVersion(second, 'canon_v1');
  assert.equal(
    v1First.canonicalHash,
    v1Second.canonicalHash,
    'canon_v1 colisiona -- este es el bug'
  );

  const v2First = service.createCanonicalHashForVersion(first, 'canon_v2');
  const v2Second = service.createCanonicalHashForVersion(second, 'canon_v2');
  assert.notEqual(
    v2First.canonicalHash,
    v2Second.canonicalHash,
    'canon_v2 las distingue -- este es el fix'
  );
});

// ---------------------------------------------------------------------------
// EXCLUSIONES CONGELADAS
// ---------------------------------------------------------------------------

test('proof NO participa de canon_v2 -- sin construccion circular', () => {
  const base = vectorInput();
  const withProof = {
    ...base,
    proof: {
      type: 'ScopeCredentialProof2026',
      profile: 'scope-proof-v1',
      proofValue: '0xdeadbeef'
    }
  };

  const plain = service.createCanonicalHashForVersion(base, 'canon_v2');
  const withProofResult = service.createCanonicalHashForVersion(
    withProof,
    'canon_v2'
  );

  assert.equal(plain.canonicalHash, withProofResult.canonicalHash);
  assert.doesNotMatch(plain.canonicalJson, /proof/);
  assert.doesNotMatch(plain.canonicalJson, /proofValue/);
});

test('canonicalHash y canonicalizationVersion NO participan de canon_v2', () => {
  const base = vectorInput();
  const polluted = {
    ...base,
    canonicalHash: '0x' + 'ff'.repeat(32),
    canonicalizationVersion: 'canon_v99'
  };

  const plain = service.createCanonicalHashForVersion(base, 'canon_v2');
  const pollutedResult = service.createCanonicalHashForVersion(
    polluted,
    'canon_v2'
  );

  assert.equal(plain.canonicalHash, pollutedResult.canonicalHash);
  assert.doesNotMatch(plain.canonicalJson, /canonical_hash/);
  assert.doesNotMatch(plain.canonicalJson, /canonicalization_version/);
  assert.doesNotMatch(plain.canonicalJson, /canon_v/);
});

test('canon_v2 tiene EXACTAMENTE las 10 claves top-level congeladas', () => {
  const projection = service.createCanonicalProjectionForVersion(
    vectorInput(),
    'canon_v2'
  );

  assert.deepEqual(Object.keys(projection).sort(), [
    'credential_id',
    'credential_subject',
    'description',
    'hours',
    'issued_at',
    'issuer_did',
    'schema_version',
    'subject_did',
    'title',
    'type'
  ]);
});

test('credential_subject mantiene EXACTAMENTE las 7 claves congeladas', () => {
  const projection = service.createCanonicalProjectionForVersion(
    vectorInput(),
    'canon_v2'
  ) as { credential_subject: Record<string, unknown> };

  assert.deepEqual(Object.keys(projection.credential_subject).sort(), [
    'academic_period',
    'achievement_name',
    'competencies',
    'completion_date',
    'grade',
    'institution_name',
    'skills'
  ]);
});

test('credential_subject es una allowlist cerrada: claves ajenas se descartan', () => {
  const base = vectorInput();
  const polluted = vectorInput();
  (polluted.credentialSubject as Record<string, unknown>).evidence = [
    { label: 'x', url: 'https://example.test/x' }
  ];
  (polluted.credentialSubject as Record<string, unknown>).secretNote = 'nope';

  assert.equal(
    service.createCanonicalHashForVersion(base, 'canon_v2').canonicalHash,
    service.createCanonicalHashForVersion(polluted, 'canon_v2').canonicalHash
  );
});

// ---------------------------------------------------------------------------
// NORMALIZACION
// ---------------------------------------------------------------------------

test('NFKC compone: NFD y NFC del mismo texto dan el mismo hash', () => {
  const nfd = vectorInput();
  const nfc = {
    ...vectorInput(),
    title: 'Programación Avanzada',
    description: 'Curso de programación orientada a objetos.',
    credentialSubject: {
      ...vectorInput().credentialSubject,
      achievementName: 'Programación Avanzada',
      skills: ['TypeScript', 'álgebra', 'Programación'],
      competencies: ['disẽno de software']
    }
  };

  assert.equal(
    service.createCanonicalHashForVersion(nfd, 'canon_v2').canonicalHash,
    service.createCanonicalHashForVersion(nfc, 'canon_v2').canonicalHash
  );
});

test('el canonicalJson emite el texto NFKC compuesto, no el descompuesto', () => {
  const result = service.createCanonicalHashForVersion(
    vectorInput(),
    'canon_v2'
  );

  assert.match(result.canonicalJson, /Programación Avanzada/);
  assert.doesNotMatch(result.canonicalJson, /́/, 'sin acento combinante');
  assert.match(result.canonicalJson, /disẽno de software/);
  assert.doesNotMatch(result.canonicalJson, /̃/, 'sin tilde combinante');
});

test('hours queda como string de dos decimales, nunca como numero JSON', () => {
  const result = service.createCanonicalHashForVersion(
    vectorInput(),
    'canon_v2'
  );

  assert.match(result.canonicalJson, /"hours":"60\.00"/);
  assert.doesNotMatch(result.canonicalJson, /"hours":60/);
});

test('issued_at se trunca al segundo y queda en UTC con sufijo Z', () => {
  const result = service.createCanonicalHashForVersion(
    vectorInput(),
    'canon_v2'
  );

  assert.match(result.canonicalJson, /"issued_at":"2026-03-15T10:42:17Z"/);
  assert.doesNotMatch(result.canonicalJson, /\.\d{3}Z/);
});

// ---------------------------------------------------------------------------
// REGRESION DE ORDENAMIENTO UTF-16
//
// El comparador de canon es `<`/`>` sobre strings de JavaScript, es decir
// ORDEN DE UNIDADES DE CODIGO UTF-16. Para caracteres astrales (>= U+10000) eso
// DIFIERE del orden por code point: un par surrogado empieza en 0xD800-0xDBFF,
// que es MENOR que U+E000-U+FFFF.
//
// Una reimplementacion en Python/Go/Rust que use el orden nativo (por code
// point) produciria otro array, otro JSON y otro hash. Este test congela el
// comportamiento para que el contrato sea reproducible fuera de TypeScript.
// ---------------------------------------------------------------------------

const ASTRAL = '\u{1F600}alpha'; // U+1F600, unidades UTF-16: D83D DE00
const PRIVATE_USE = 'beta'; // U+E000, NFKC-estable, dentro de D800..FFFF

test('UTF-16: el fixture realmente discrimina entre los dos ordenes', () => {
  // Confirmamos que el caso NO es degenerado antes de congelar nada.
  const byCodeUnit = [ASTRAL, PRIVATE_USE].slice().sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  const byCodePoint = [ASTRAL, PRIVATE_USE]
    .slice()
    .sort(
      (left, right) =>
        (left.codePointAt(0) ?? 0) - (right.codePointAt(0) ?? 0)
    );

  assert.deepEqual(byCodeUnit, [ASTRAL, PRIVATE_USE]);
  assert.deepEqual(byCodePoint, [PRIVATE_USE, ASTRAL]);
  assert.notDeepEqual(byCodeUnit, byCodePoint);

  // NFKC no debe tocar ninguno de los dos, o el fixture no probaria el orden.
  assert.equal(ASTRAL.normalize('NFKC'), ASTRAL);
  assert.equal(PRIVATE_USE.normalize('NFKC'), PRIVATE_USE);
});

test('UTF-16: canon ordena por unidad de codigo, no por code point', () => {
  const input = {
    ...vectorInput(),
    credentialSubject: {
      ...vectorInput().credentialSubject,
      skills: [PRIVATE_USE, ASTRAL]
    }
  };

  const projection = service.createCanonicalProjectionForVersion(
    input,
    'canon_v2'
  ) as { credential_subject: { skills: string[] } };

  // El astral va PRIMERO. Un sort por code point lo pondria segundo.
  assert.deepEqual(projection.credential_subject.skills, [
    ASTRAL,
    PRIVATE_USE
  ]);
});

test('UTF-16: el orden de entrada no altera el resultado canonico', () => {
  const forward = {
    ...vectorInput(),
    credentialSubject: {
      ...vectorInput().credentialSubject,
      skills: [ASTRAL, PRIVATE_USE]
    }
  };
  const reversed = {
    ...vectorInput(),
    credentialSubject: {
      ...vectorInput().credentialSubject,
      skills: [PRIVATE_USE, ASTRAL]
    }
  };

  assert.equal(
    service.createCanonicalHashForVersion(forward, 'canon_v2').canonicalHash,
    service.createCanonicalHashForVersion(reversed, 'canon_v2').canonicalHash
  );
});

test('el orden de arrays del vector es el orden UTF-16 esperado', () => {
  const projection = service.createCanonicalProjectionForVersion(
    vectorInput(),
    'canon_v2'
  ) as { credential_subject: { skills: string[] } };

  // "P" (0x50) < "T" (0x54) < "a" acentuada (0xE1): mayusculas antes que
  // minusculas, y latin acentuado despues del ASCII.
  assert.deepEqual(projection.credential_subject.skills, [
    'Programación',
    'TypeScript',
    'álgebra'
  ]);
});

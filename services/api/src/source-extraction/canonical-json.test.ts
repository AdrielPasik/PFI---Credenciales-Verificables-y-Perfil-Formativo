import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  canonicalJson,
  canonicalPreimage,
  CanonicalJsonError,
  compareByCodePoint
} from './canonical-json';
import { loadCanonicalJsonGoldenVector } from './__fixtures__/source-extraction.fixtures';

const GOLDEN = loadCanonicalJsonGoldenVector();
const BACKSLASH = String.fromCharCode(0x5c);
const QUOTE = String.fromCharCode(0x22);

const sha256 = (text: string): string =>
  createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

// ---------------------------------------------------------------------------
// Golden vector — gate duro
// ---------------------------------------------------------------------------

test('golden vector: canonicalization token matches', () => {
  assert.equal(GOLDEN.canonicalization, 'MINIMAL_DETERMINISTIC_JSON_V1');
});

test('golden vector: TypeScript reproduces the frozen canonical string', () => {
  assert.equal(canonicalJson(GOLDEN.payload), GOLDEN.canonicalJson);
});

test('golden vector: TypeScript reproduces the frozen preimage byte length', () => {
  assert.equal(canonicalPreimage(GOLDEN.payload).length, GOLDEN.preimageByteLength);
});

test('golden vector: TypeScript reproduces the frozen SHA-256', () => {
  assert.equal(sha256(canonicalJson(GOLDEN.payload)), GOLDEN.sha256);
});

test('golden vector: uppercase hex variant is a DIFFERENT fingerprint, not an equivalence', () => {
  const produced = canonicalJson(GOLDEN.payload);
  assert.notEqual(produced, GOLDEN.rejectedUppercaseVariant.canonicalJson);
  assert.notEqual(sha256(produced), GOLDEN.rejectedUppercaseVariant.sha256);

  // Ambas formas parsean al MISMO objeto: por eso comparar objetos no probaria
  // nada y el criterio tiene que ser byte a byte.
  assert.deepEqual(
    JSON.parse(produced),
    JSON.parse(GOLDEN.rejectedUppercaseVariant.canonicalJson)
  );
});

// ---------------------------------------------------------------------------
// Tabla de escaping
// ---------------------------------------------------------------------------

const ESCAPES: [number, string][] = [
  [0x22, `${BACKSLASH}${QUOTE}`],
  [0x5c, `${BACKSLASH}${BACKSLASH}`],
  [0x08, `${BACKSLASH}b`],
  [0x09, `${BACKSLASH}t`],
  [0x0a, `${BACKSLASH}n`],
  [0x0c, `${BACKSLASH}f`],
  [0x0d, `${BACKSLASH}r`],
  [0x00, `${BACKSLASH}u0000`],
  [0x01, `${BACKSLASH}u0001`],
  [0x0b, `${BACKSLASH}u000b`],
  [0x1e, `${BACKSLASH}u001e`],
  [0x1f, `${BACKSLASH}u001f`]
];

for (const [codePoint, expected] of ESCAPES) {
  test(`escape table: U+${codePoint.toString(16).padStart(4, '0').toUpperCase()}`, () => {
    assert.equal(canonicalJson(String.fromCodePoint(codePoint)), QUOTE + expected + QUOTE);
  });
}

test('long-form hex digits are lowercase for every C0 control', () => {
  for (let codePoint = 0x00; codePoint < 0x20; codePoint += 1) {
    const produced = canonicalJson(String.fromCodePoint(codePoint));
    if (produced.includes(`${BACKSLASH}u`)) {
      const hex = codePoint.toString(16).padStart(4, '0');
      assert.equal(produced, `${QUOTE}${BACKSLASH}u${hex}${QUOTE}`);
      assert.equal(produced, produced.toLowerCase());
    }
  }
});

test('U+007F and non-ASCII stay literal, never in long form', () => {
  const del = String.fromCodePoint(0x7f);
  const nTilde = String.fromCodePoint(0xf1);
  const testTube = String.fromCodePoint(0x1f9ea);

  assert.equal(canonicalJson(del), QUOTE + del + QUOTE);
  assert.equal(canonicalJson(nTilde), QUOTE + nTilde + QUOTE);
  assert.equal(canonicalJson(testTube), QUOTE + testTube + QUOTE);
  assert.ok(!canonicalJson(nTilde + testTube + del).includes(`${BACKSLASH}u`));
});

// ---------------------------------------------------------------------------
// Orden de claves por code point — la trampa de UTF-16
// ---------------------------------------------------------------------------

test('object keys are sorted by Unicode code point', () => {
  const nTilde = String.fromCodePoint(0xf1);
  const payload: Record<string, number> = { b: 1, a: 2, A: 3 };
  payload[nTilde] = 4;
  assert.equal(canonicalJson(payload), `{"A":3,"a":2,"b":1,"${nTilde}":4}`);
});

test('astral key ordering differs from Array.prototype.sort and we follow code points', () => {
  // U+FFFD (65533) vs U+1F9EA (129514).
  //   code point:      U+FFFD  antes que  U+1F9EA
  //   code unit UTF-16: 0xD83E (55358) antes que 0xFFFD  -> al reves
  const replacement = String.fromCodePoint(0xfffd);
  const testTube = String.fromCodePoint(0x1f9ea);

  const naive = [testTube, replacement].sort();
  assert.equal(naive[0], testTube, 'sort() por defecto pone el astral primero');

  const byCodePoint = [testTube, replacement].sort(compareByCodePoint);
  assert.equal(byCodePoint[0], replacement, 'por code point va primero U+FFFD');

  const payload: Record<string, number> = {};
  payload[testTube] = 1;
  payload[replacement] = 2;
  assert.equal(canonicalJson(payload), `{"${replacement}":2,"${testTube}":1}`);
});

test('code point comparator handles prefixes and equality', () => {
  assert.equal(compareByCodePoint('a', 'a'), 0);
  assert.equal(compareByCodePoint('a', 'ab'), -1);
  assert.equal(compareByCodePoint('ab', 'a'), 1);
});

// ---------------------------------------------------------------------------
// Estructura
// ---------------------------------------------------------------------------

test('array order is preserved', () => {
  assert.equal(canonicalJson([3, 1, 2]), '[3,1,2]');
});

test('no whitespace is emitted', () => {
  assert.equal(canonicalJson({ a: [1, 2], b: { c: true } }), '{"a":[1,2],"b":{"c":true}}');
});

test('booleans and null are JSON literals', () => {
  assert.equal(
    canonicalJson({ t: true, f: false, n: null, i: 1, z: 0 }),
    '{"f":false,"i":1,"n":null,"t":true,"z":0}'
  );
});

test('integers have no leading zeros and no exponent', () => {
  assert.equal(canonicalJson({ n: 0 }), '{"n":0}');
  assert.equal(canonicalJson({ n: 1024 }), '{"n":1024}');
});

// ---------------------------------------------------------------------------
// Entradas invalidas
// ---------------------------------------------------------------------------

test('floats are rejected', () => {
  assert.throws(() => canonicalJson({ value: 1.5 }), (error: unknown) => {
    assert.ok(error instanceof CanonicalJsonError);
    assert.equal(error.reason, 'float_not_representable');
    return true;
  });
});

test('unsafe integers are rejected', () => {
  assert.throws(
    () => canonicalJson({ value: Number.MAX_SAFE_INTEGER + 2 }),
    CanonicalJsonError
  );
});

test('lone surrogates are invalid input', () => {
  const loneHigh = String.fromCharCode(0xd800);
  const loneLow = String.fromCharCode(0xdc00);

  for (const value of [loneHigh, loneLow, `a${loneHigh}b`]) {
    assert.throws(() => canonicalJson(value), (error: unknown) => {
      assert.ok(error instanceof CanonicalJsonError);
      assert.ok(error.reason.startsWith('lone_surrogate'));
      return true;
    });
  }
});

test('a well-formed surrogate pair is not a lone surrogate', () => {
  const testTube = String.fromCodePoint(0x1f9ea);
  assert.equal(canonicalJson(testTube), QUOTE + testTube + QUOTE);
});

test('undefined and functions are rejected', () => {
  assert.throws(() => canonicalJson(undefined), CanonicalJsonError);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  codePointLength,
  CodePointRangeError,
  hasLoneSurrogate,
  sliceByUnicodeCodePoints
} from './code-points';

const TEST_TUBE = String.fromCodePoint(0x1f9ea);
const NBSP = String.fromCodePoint(0xa0);

test('codePointLength counts code points, not UTF-16 code units', () => {
  assert.equal(codePointLength(TEST_TUBE), 1);
  assert.equal(TEST_TUBE.length, 2, 'string.length cuenta code units');

  const text = `A${TEST_TUBE}B`;
  assert.equal(codePointLength(text), 3);
  assert.equal(text.length, 4);
});

test('codePointLength handles empty and ASCII', () => {
  assert.equal(codePointLength(''), 0);
  assert.equal(codePointLength('hola'), 4);
  assert.equal(codePointLength(NBSP), 1);
});

test('sliceByUnicodeCodePoints reproduces Python str slicing on astral text', () => {
  const text = `A${TEST_TUBE}B`;
  assert.equal(sliceByUnicodeCodePoints(text, 0, 3), text);
  assert.equal(sliceByUnicodeCodePoints(text, 0, 1), 'A');
  assert.equal(sliceByUnicodeCodePoints(text, 1, 2), TEST_TUBE);
  assert.equal(sliceByUnicodeCodePoints(text, 2, 3), 'B');
});

test('naive UTF-16 slicing demonstrably differs on the astral case', () => {
  // Demostrativo: esta implementacion ingenua NO se usa en produccion. Existe
  // para que el riesgo quede probado y no como nota al pie.
  const text = `A${TEST_TUBE}B`;

  // Modo de fallo 1: excerpt truncado, bien formado y silenciosamente equivocado.
  // Es el peligroso, porque no rompe nada: produce una cita que parece valida.
  const naive = text.slice(0, 3);
  const correct = sliceByUnicodeCodePoints(text, 0, 3);

  assert.notEqual(naive, correct);
  assert.equal(correct, text, 'el span 0..3 son los tres code points completos');
  assert.equal(naive, `A${TEST_TUBE}`, 'slice() pierde la "B" y no avisa');
  assert.equal(hasLoneSurrogate(naive), false, 'este caso ni siquiera queda malformado');

  // Modo de fallo 2: el span parte el par de surrogates al medio.
  const halved = text.slice(1, 2);
  assert.ok(hasLoneSurrogate(halved), 'slice(1,2) devuelve medio emoji');
  assert.equal(sliceByUnicodeCodePoints(text, 1, 2), TEST_TUBE);
});

test('naive slicing also mislocates the tail of an astral string', () => {
  const text = `${TEST_TUBE}segundo`;
  assert.equal(sliceByUnicodeCodePoints(text, 1, 8), 'segundo');
  assert.notEqual(text.slice(1, 8), 'segundo');
});

test('negative offsets are rejected', () => {
  assert.throws(() => sliceByUnicodeCodePoints('hola', -1, 2), CodePointRangeError);
  assert.throws(() => sliceByUnicodeCodePoints('hola', 0, -2), CodePointRangeError);
});

test('reversed ranges are rejected instead of silently clamped', () => {
  assert.throws(() => sliceByUnicodeCodePoints('hola', 3, 1), (error: unknown) => {
    assert.ok(error instanceof CodePointRangeError);
    assert.equal(error.reason, 'end before start');
    return true;
  });
  // `String.prototype.slice` devolveria "" en vez de fallar.
  assert.equal('hola'.slice(3, 1), '');
});

test('out-of-range spans are rejected instead of truncated', () => {
  assert.throws(() => sliceByUnicodeCodePoints('hola', 0, 99), (error: unknown) => {
    assert.ok(error instanceof CodePointRangeError);
    assert.equal(error.reason, 'span exceeds container length');
    return true;
  });
  assert.equal('hola'.slice(0, 99), 'hola');
});

test('non-integer offsets are rejected', () => {
  assert.throws(() => sliceByUnicodeCodePoints('hola', 0, 1.5), CodePointRangeError);
});

test('a container with a lone surrogate is rejected', () => {
  const broken = `a${String.fromCharCode(0xd800)}b`;
  assert.throws(() => sliceByUnicodeCodePoints(broken, 0, 2), (error: unknown) => {
    assert.ok(error instanceof CodePointRangeError);
    assert.equal(error.reason, 'container contains a lone surrogate');
    return true;
  });
});

test('hasLoneSurrogate accepts well-formed pairs and rejects halves', () => {
  assert.equal(hasLoneSurrogate(`A${TEST_TUBE}B`), false);
  assert.equal(hasLoneSurrogate(''), false);
  assert.equal(hasLoneSurrogate(String.fromCharCode(0xd83e)), true);
  assert.equal(hasLoneSurrogate(String.fromCharCode(0xddea)), true);
  assert.equal(hasLoneSurrogate(TEST_TUBE.charAt(0)), true);
});

test('empty spans are representable by the primitive itself', () => {
  // El rechazo de segmentos vacios es un invariante del artifact, no de la
  // primitiva de slicing.
  assert.equal(sliceByUnicodeCodePoints('hola', 2, 2), '');
});

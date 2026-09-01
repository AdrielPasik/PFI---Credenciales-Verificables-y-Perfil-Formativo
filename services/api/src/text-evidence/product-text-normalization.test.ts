/**
 * Semántica congelada de `PRODUCT_NFC_LINEENDINGS_TRIM`.
 *
 * El parity vector viene de F0.3: 32 casos generados ejecutando la normalización
 * productiva REAL en Node y contrastados caso por caso contra
 * `validateTextEvidenceBody`. Este test lo usa para FIJAR la función compartida.
 *
 * La autoridad contractual del token es la lista de tres reglas, no "lo que esta
 * función haga en el futuro". Si alguien la cambiara —a NFKC, por ejemplo— estos
 * tests fallan, que es exactamente la señal de "hace falta un token nuevo": los
 * artifacts históricos declaran `PRODUCT_NFC_LINEENDINGS_TRIM` y su significado
 * no puede cambiar retroactivamente.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { validateTextEvidenceBody } from './text-evidence.validator';
import {
  isProductNormalizedText,
  PRODUCT_NORMALIZATION_TOKEN,
  productNormalizeText
} from './product-text-normalization';

const VECTOR = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      'ai-service',
      'tests',
      'contracts',
      'fixtures',
      'source_extraction_v1',
      'text-evidence-normalization-parity-vector.json'
    ),
    'utf8'
  )
) as {
  token: string;
  frozenSemantics: string[];
  order: string;
  cases: {
    name: string;
    rawCodePoints: number[];
    expectedCodePoints: number[];
    isNormalizedFixedPoint: boolean;
    acceptedByProductValidator: boolean;
  }[];
};

const textOf = (codePoints: number[]): string =>
  codePoints.map((point) => String.fromCodePoint(point)).join('');

test('the frozen token semantics are exactly three rules, in order', () => {
  assert.equal(PRODUCT_NORMALIZATION_TOKEN, VECTOR.token);
  assert.deepEqual(VECTOR.frozenSemantics, [
    'Unicode NFC',
    'CRLF / CR -> LF',
    'ECMAScript String.prototype.trim'
  ]);
  assert.equal(VECTOR.order, 'NFC -> lineEndings -> trim');
});

for (const entry of VECTOR.cases) {
  test(`normalization parity: ${entry.name}`, () => {
    const raw = textOf(entry.rawCodePoints);
    const produced = productNormalizeText(raw);
    assert.deepEqual(
      Array.from(produced).map((character) => character.codePointAt(0)),
      entry.expectedCodePoints
    );
    assert.equal(isProductNormalizedText(raw), entry.isNormalizedFixedPoint);
  });
}

test('the extracted helper still matches the productive validator exactly', () => {
  // Prueba de que la extracción no cambió comportamiento: para cada caso que el
  // validador productivo acepta, su `content` es el de la función compartida.
  for (const entry of VECTOR.cases) {
    if (!entry.acceptedByProductValidator) {
      continue;
    }
    const raw = textOf(entry.rawCodePoints);
    const validated = validateTextEvidenceBody({ content: raw });
    assert.equal(validated.content, productNormalizeText(raw), entry.name);
  }
});

test('every normalized form is itself a fixed point', () => {
  for (const entry of VECTOR.cases) {
    assert.ok(isProductNormalizedText(textOf(entry.expectedCodePoints)), entry.name);
  }
});

test('U+FEFF is trimmed and U+0085 is not — ECMAScript, not Python', () => {
  // Las dos divergencias que F0.3 midió. Si esta función pasara a usar una
  // semántica de trim distinta, esto lo delata.
  const bom = String.fromCodePoint(0xfeff);
  const nel = String.fromCodePoint(0x85);

  assert.equal(productNormalizeText(`${bom}Uno${bom}`), 'Uno');
  assert.equal(productNormalizeText(`${nel}Uno${nel}`), `${nel}Uno${nel}`);
  assert.ok(isProductNormalizedText(`${nel}Uno${nel}`));
  assert.ok(!isProductNormalizedText(`${bom}Uno`));
});

test('U+200B is not trimmed, so content starting with it is a valid fixed point', () => {
  const zwsp = String.fromCodePoint(0x200b);
  assert.ok(isProductNormalizedText(`${zwsp}Contenido${zwsp}`));
});

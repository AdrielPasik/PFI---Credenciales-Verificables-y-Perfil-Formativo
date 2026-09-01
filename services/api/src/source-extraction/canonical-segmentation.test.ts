/**
 * Completitud exacta de `segments[]` — `CANONICAL_SEGMENTATION_CONTRACT`.
 *
 * Verificar cada segmento por separado no alcanzaba. Un duplicado, una omisión o
 * un subspan alineado dentro de otro segmento pasaban TODAS las comprobaciones
 * individuales —dirección válida, id derivado, alineamiento exacto, orden
 * canónico— porque cada segmento apunta a texto real. Medido antes de
 * implementar: los tres eran aceptados.
 *
 * En cada caso negativo se muta `segments`, se recalcula el fingerprint
 * correctamente y se comprueba que la verificación de fingerprint PASA, para que
 * el rechazo pruebe la membresía y no otra cosa. El fingerprint se recalcula con
 * el productor TypeScript; nunca se consulta a Python.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveBlockSpans,
  deriveCanonicalSegments,
  isPythonWhitespaceOnly,
  PYTHON_WHITESPACE_CODE_POINTS
} from './canonical-segmentation';
import { computeArtifactFingerprint } from './source-extraction-artifact.invariants';
import { validateSourceExtractionArtifactShape } from './source-extraction-artifact.validator';
import { verifySourceExtractionArtifact } from './source-extraction-artifact.verifier';
import { SourceExtractionVerificationError } from './source-extraction-verification.errors';
import {
  cloneArtifact,
  loadProducerArtifact,
  loadProducerCorpusManifest
} from './__fixtures__/source-extraction.fixtures';

const MANIFEST = loadProducerCorpusManifest();
const NBSP = String.fromCodePoint(0xa0);
const TEST_TUBE = String.fromCodePoint(0x1f9ea);

function reseal(artifact: Record<string, any>): Record<string, any> {
  artifact.artifactContentFingerprint = computeArtifactFingerprint(
    validateSourceExtractionArtifactShape({
      ...artifact,
      artifactContentFingerprint: '0'.repeat(64)
    })
  );
  return artifact;
}

function assertFingerprintPasses(artifact: Record<string, any>): void {
  assert.equal(
    artifact.artifactContentFingerprint,
    computeArtifactFingerprint(
      validateSourceExtractionArtifactShape({
        ...artifact,
        artifactContentFingerprint: '0'.repeat(64)
      })
    ),
    'el fingerprint debe cerrar, o el rechazo no probaria nada sobre la membresia'
  );
}

function expectRejection(artifact: Record<string, any>, invariant: string): void {
  assertFingerprintPasses(artifact);
  try {
    verifySourceExtractionArtifact(artifact);
  } catch (error) {
    assert.ok(error instanceof SourceExtractionVerificationError, String(error));
    assert.equal(error.code, 'ADDRESS_INVALID');
    assert.equal(error.detail.invariant, invariant);
    return;
  }
  throw new assert.AssertionError({ message: `se esperaba ${invariant} y fue aceptado` });
}

function containerOf(artifact: Record<string, any>, pageIndex: number | null): string {
  return pageIndex === null
    ? artifact.documentCanonicalText
    : artifact.pages[pageIndex].canonicalText;
}

function segmentFor(
  artifact: Record<string, any>,
  pageIndex: number | null,
  start: number,
  end: number
): Record<string, unknown> {
  const container = containerOf(artifact, pageIndex);
  return {
    segmentId: pageIndex === null ? `d:${start}-${end}` : `p${pageIndex}:${start}-${end}`,
    pageIndex,
    charStart: start,
    charEnd: end,
    exactExcerpt: Array.from(container).slice(start, end).join('')
  };
}

// ---------------------------------------------------------------------------
// Paridad con el productor real sobre los 12 artifacts congelados
// ---------------------------------------------------------------------------

test('the TypeScript derivation reproduces the frozen segments of every producer artifact', () => {
  for (const entry of MANIFEST.cases) {
    const artifact = verifySourceExtractionArtifact(loadProducerArtifact(entry.name));
    const derived = deriveCanonicalSegments(artifact as never);

    assert.equal(derived.length, artifact.segments.length, entry.name);
    for (let index = 0; index < derived.length; index += 1) {
      assert.deepEqual(derived[index], artifact.segments[index], `${entry.name}[${index}]`);
    }
  }
});

test('the derivation ignores artifact.segments entirely', () => {
  // Si tomara `segments` como entrada, estaria verificando el artifact contra
  // si mismo. Borrarlos no cambia lo derivado.
  const artifact = cloneArtifact(loadProducerArtifact('text-multiple-paragraphs')) as Record<string, any>;
  const expected = deriveCanonicalSegments(
    validateSourceExtractionArtifactShape(artifact) as never
  );

  artifact.segments = [];
  const withoutSegments = deriveCanonicalSegments(
    validateSourceExtractionArtifactShape(reseal(artifact)) as never
  );

  assert.deepEqual(withoutSegments, expected);
  assert.ok(expected.length >= 3);
});

// ---------------------------------------------------------------------------
// Casos conocidos del algoritmo
// ---------------------------------------------------------------------------

test('block spans follow the frozen cursor arithmetic', () => {
  assert.deepEqual(deriveBlockSpans('Primer bloque.\n\nSegundo bloque.'), [
    { start: 0, end: 14 },
    { start: 16, end: 31 }
  ]);
});

test('repeated identical blocks get DIFFERENT addresses', () => {
  // Con `str.find` los tres colapsarian a la misma direccion. La identidad la da
  // la direccion, no el contenido textual.
  assert.deepEqual(deriveBlockSpans('repetido\n\nrepetido\n\nrepetido'), [
    { start: 0, end: 8 },
    { start: 10, end: 18 },
    { start: 20, end: 28 }
  ]);
});

test('a single newline does not split a block', () => {
  assert.deepEqual(deriveBlockSpans('Linea uno\nLinea dos'), [{ start: 0, end: 19 }]);
});

test('an ODD run of newlines leaves the extra newline inside the next block', () => {
  // Comportamiento registrado por F0.2 y reproducido literalmente. No se
  // "simplifica" a una nocion intuitiva de parrafo: recortar el salto sobrante
  // sin corregir los offsets rompe el invariante de alineamiento.
  const text = 'A\n\n\nB';
  assert.deepEqual(deriveBlockSpans(text), [
    { start: 0, end: 1 },
    { start: 3, end: 5 }
  ]);
  assert.equal(Array.from(text).slice(3, 5).join(''), '\nB');
});

test('an EVEN run of newlines produces an empty middle block that is discarded', () => {
  // Y el cursor igual avanza: descartar un bloque no corre las direcciones de
  // los que siguen.
  assert.deepEqual(deriveBlockSpans('A\n\n\n\nB'), [
    { start: 0, end: 1 },
    { start: 5, end: 6 }
  ]);
});

test('whitespace-only blocks are discarded without shifting later addresses', () => {
  const text = 'X\n\n   \n\nY';
  assert.deepEqual(deriveBlockSpans(text), [
    { start: 0, end: 1 },
    { start: 8, end: 9 }
  ]);
  assert.equal(Array.from(text).slice(8, 9).join(''), 'Y');
});

test('astral characters count as one code point in the spans', () => {
  const text = `A${TEST_TUBE}B\n\nsegundo`;
  assert.deepEqual(deriveBlockSpans(text), [
    { start: 0, end: 3 },
    { start: 5, end: 12 }
  ]);
});

test('an internal NBSP does not split a block and is preserved', () => {
  const text = `Carga: 40${NBSP}horas\n\nSegundo`;
  const spans = deriveBlockSpans(text);
  assert.equal(spans.length, 2);
  assert.ok(Array.from(text).slice(spans[0].start, spans[0].end).join('').includes(NBSP));
});

// ---------------------------------------------------------------------------
// El predicado de whitespace es el de PYTHON, no el de ECMAScript
// ---------------------------------------------------------------------------

test('the whitespace predicate follows Python str.strip, not ECMAScript trim', () => {
  // Imagen espejo del hallazgo de F0.3, que necesitaba trim de ECMAScript dentro
  // de Python. Los dos conjuntos difieren EN AMBAS DIRECCIONES.
  const nel = String.fromCodePoint(0x85);
  const fileSeparator = String.fromCodePoint(0x1c);
  const bom = String.fromCodePoint(0xfeff);

  // Python SI los considera whitespace; ECMAScript NO.
  assert.equal(isPythonWhitespaceOnly(nel), true);
  assert.equal(isPythonWhitespaceOnly(fileSeparator), true);
  assert.equal(nel.trim(), nel, 'ECMAScript no recorta NEL');

  // ECMAScript SI; Python NO. Un bloque de solo BOM ES un segmento canonico.
  assert.equal(isPythonWhitespaceOnly(bom), false);
  assert.equal(bom.trim(), '', 'ECMAScript si recorta el BOM');
  assert.deepEqual(deriveBlockSpans(bom), [{ start: 0, end: 1 }]);
});

test('the frozen Python whitespace set covers every current Zs code point', () => {
  for (let codePoint = 0; codePoint <= 0x3000; codePoint += 1) {
    const character = String.fromCodePoint(codePoint);
    // Zs se aproxima con la propiedad de espacio de ECMAScript menos el BOM,
    // que es la unica divergencia conocida en esa direccion.
    if (codePoint !== 0xfeff && character.trim() === '' && character !== '') {
      assert.ok(
        PYTHON_WHITESPACE_CODE_POINTS.has(codePoint),
        `U+${codePoint.toString(16).toUpperCase()} deberia estar en el conjunto`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Negativos obligatorios — PDF
// ---------------------------------------------------------------------------

test('PDF: a duplicated segment is rejected', () => {
  const artifact = cloneArtifact(loadProducerArtifact('pdf-astral-unicode')) as Record<string, any>;
  artifact.segments.splice(1, 0, JSON.parse(JSON.stringify(artifact.segments[0])));
  expectRejection(reseal(artifact), 'SEGMENT_DUPLICATE_ADDRESS');
});

test('PDF: an omitted canonical segment is rejected', () => {
  const artifact = cloneArtifact(loadProducerArtifact('pdf-full-multipage')) as Record<string, any>;
  assert.ok(artifact.segments.length >= 2);
  artifact.segments.splice(0, 1);
  expectRejection(reseal(artifact), 'SEGMENT_MISSING_CANONICAL');
});

test('PDF: an extra aligned subspan inside an existing segment is rejected', () => {
  const artifact = cloneArtifact(loadProducerArtifact('pdf-full-multipage')) as Record<string, any>;
  const first = artifact.segments[0];
  artifact.segments.splice(
    0,
    0,
    segmentFor(artifact, first.pageIndex, first.charStart, first.charStart + 4)
  );
  expectRejection(reseal(artifact), 'SEGMENT_EXTRA_NON_CANONICAL');
});

test('PDF: an extra overlapping aligned segment is rejected', () => {
  const artifact = cloneArtifact(loadProducerArtifact('pdf-full-multipage')) as Record<string, any>;
  const first = artifact.segments[0];
  artifact.segments.splice(
    1,
    0,
    segmentFor(artifact, first.pageIndex, first.charStart + 2, first.charEnd - 2)
  );
  expectRejection(reseal(artifact), 'SEGMENT_EXTRA_NON_CANONICAL');
});

test('PDF: reordered segments are still rejected', () => {
  const artifact = cloneArtifact(loadProducerArtifact('pdf-full-multipage')) as Record<string, any>;
  [artifact.segments[0], artifact.segments[1]] = [artifact.segments[1], artifact.segments[0]];
  expectRejection(reseal(artifact), 'SEGMENT_ORDER_NON_CANONICAL');
});

// ---------------------------------------------------------------------------
// Negativos obligatorios — TEXT
// ---------------------------------------------------------------------------

test('TEXT: a duplicated segment is rejected', () => {
  const artifact = cloneArtifact(loadProducerArtifact('text-multiple-paragraphs')) as Record<string, any>;
  artifact.segments.splice(1, 0, JSON.parse(JSON.stringify(artifact.segments[0])));
  expectRejection(reseal(artifact), 'SEGMENT_DUPLICATE_ADDRESS');
});

test('TEXT: an omitted canonical segment is rejected', () => {
  const artifact = cloneArtifact(loadProducerArtifact('text-multiple-paragraphs')) as Record<string, any>;
  artifact.segments.splice(1, 1);
  expectRejection(reseal(artifact), 'SEGMENT_MISSING_CANONICAL');
});

test('TEXT: an extra aligned subspan is rejected', () => {
  const artifact = cloneArtifact(loadProducerArtifact('text-multiple-paragraphs')) as Record<string, any>;
  const first = artifact.segments[0];
  artifact.segments.splice(0, 0, segmentFor(artifact, null, first.charStart, first.charStart + 3));
  expectRejection(reseal(artifact), 'SEGMENT_EXTRA_NON_CANONICAL');
});

test('TEXT: reordered segments are still rejected', () => {
  const artifact = cloneArtifact(loadProducerArtifact('text-multiple-paragraphs')) as Record<string, any>;
  [artifact.segments[0], artifact.segments[1]] = [artifact.segments[1], artifact.segments[0]];
  expectRejection(reseal(artifact), 'SEGMENT_ORDER_NON_CANONICAL');
});

// ---------------------------------------------------------------------------
// Bloques idénticos repetidos: la identidad la da la dirección
// ---------------------------------------------------------------------------

test('repeated identical blocks: omitting the middle one is detected', () => {
  // Los tres excerpts son la palabra "repetido". Si la identidad dependiera del
  // contenido textual, omitir el del medio seria indetectable: seguiria habiendo
  // "repetido" en el array. La direccion es lo que lo delata.
  const artifact = cloneArtifact(loadProducerArtifact('text-repeated-blocks')) as Record<string, any>;
  assert.equal(artifact.segments.length, 3);
  assert.equal(new Set(artifact.segments.map((s: any) => s.exactExcerpt)).size, 1);

  const removed = artifact.segments.splice(1, 1)[0];
  expectRejection(reseal(artifact), 'SEGMENT_MISSING_CANONICAL');
  assert.equal(removed.segmentId, 'd:10-18');
});

test('repeated identical blocks: duplicating one is detected', () => {
  const artifact = cloneArtifact(loadProducerArtifact('text-repeated-blocks')) as Record<string, any>;
  artifact.segments.splice(1, 0, JSON.parse(JSON.stringify(artifact.segments[0])));
  expectRejection(reseal(artifact), 'SEGMENT_DUPLICATE_ADDRESS');
});

test('repeated identical blocks: swapping two identical excerpts is still an order violation', () => {
  const artifact = cloneArtifact(loadProducerArtifact('text-repeated-blocks')) as Record<string, any>;
  [artifact.segments[0], artifact.segments[2]] = [artifact.segments[2], artifact.segments[0]];
  expectRejection(reseal(artifact), 'SEGMENT_ORDER_NON_CANONICAL');
});

// ---------------------------------------------------------------------------
// El verificador no repara
// ---------------------------------------------------------------------------

test('the verifier never completes, deduplicates or reorders the input', () => {
  const artifact = cloneArtifact(loadProducerArtifact('text-multiple-paragraphs')) as Record<string, any>;
  artifact.segments.splice(1, 1);
  reseal(artifact);

  const before = JSON.stringify(artifact.segments);
  try {
    verifySourceExtractionArtifact(artifact);
  } catch {
    /* esperado */
  }
  assert.equal(JSON.stringify(artifact.segments), before);
});

test('errors about segmentation never leak the document content', () => {
  const artifact = cloneArtifact(loadProducerArtifact('text-multiple-paragraphs')) as Record<string, any>;
  const excerpts = artifact.segments.map((segment: any) => segment.exactExcerpt);
  artifact.segments.splice(1, 1);
  reseal(artifact);

  try {
    verifySourceExtractionArtifact(artifact);
    throw new assert.AssertionError({ message: 'se esperaba un rechazo' });
  } catch (error) {
    assert.ok(error instanceof SourceExtractionVerificationError);
    const serialized = `${error.message} ${JSON.stringify(error.detail)}`;
    for (const excerpt of excerpts) {
      assert.ok(!serialized.includes(excerpt), 'el error no debe incluir el excerpt');
    }
  }
});

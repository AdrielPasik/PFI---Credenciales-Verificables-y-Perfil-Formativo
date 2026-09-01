/**
 * Orden canónico de `segments[]` — contrato congelado.
 *
 *     PDF_DOCUMENT   ASC(pageIndex, charStart, charEnd)
 *     TEXT           ASC(charStart, charEnd)
 *
 * Estos artifacts se construyen sintéticamente, pero desde el cierre de
 * completitud (`CANONICAL_SEGMENTATION_CONTRACT`) ya no basta con inventar spans
 * alineados: el conjunto tiene que ser EXACTAMENTE la segmentación canónica del
 * texto, o el rechazo llega por membresía en vez de por orden. Los casos
 * negativos son por lo tanto PERMUTACIONES del conjunto canónico completo, para
 * que aíslen el orden y nada más.
 *
 * Consecuencia registrada: la tercera clave del comparator (`charEnd`) quedó
 * INALCANZABLE a través de la API pública, porque dos segmentos canónicos nunca
 * comparten `(pageIndex, charStart)`. Ver el último bloque de este archivo.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveBlockSpans } from './canonical-segmentation';
import { computeArtifactFingerprint } from './source-extraction-artifact.invariants';
import { validateSourceExtractionArtifactShape } from './source-extraction-artifact.validator';
import { verifySourceExtractionArtifact } from './source-extraction-artifact.verifier';
import { SourceExtractionVerificationError } from './source-extraction-verification.errors';
import {
  loadProducerArtifact,
  loadProducerCorpusManifest
} from './__fixtures__/source-extraction.fixtures';

const SHA = 'a'.repeat(64);

const PAGE_A = 'Alfa.\n\nBeta larga.'; // bloques canonicos: (0,5) (7,18)
const PAGE_B = 'Gamma.\n\nDelta.'; //     bloques canonicos: (0,6) (8,14)
const DOCUMENT = 'Uno.\n\nDos largo.\n\nTres.'; // (0,4) (6,16) (18,23)

type Span = { page: number | null; start: number; end: number };

function textArtifact(document: string, spans: Span[]): Record<string, unknown> {
  const characters = Array.from(document);
  const artifact: Record<string, unknown> = {
    schemaVersion: 'source_extraction_v1',
    sourceType: 'TEXT',
    source: { textEvidenceId: 'text-order-001', sourceSha256: SHA },
    extractionIdentity: {
      schemaVersion: 'source_extraction_v1',
      implementationVersion: 'source_extractor_v1.0.0',
      parserProfile: 'TEXT_DIRECT'
    },
    sourceNormalizationApplied: 'PRODUCT_NFC_LINEENDINGS_TRIM',
    offsetUnit: 'UNICODE_CODE_POINT',
    coverageStatus: 'FULL',
    pages: [],
    documentCanonicalText: document,
    segments: spans.map((span) => ({
      segmentId: `d:${span.start}-${span.end}`,
      pageIndex: null,
      charStart: span.start,
      charEnd: span.end,
      exactExcerpt: characters.slice(span.start, span.end).join('')
    })),
    diagnostics: document === '' ? [
      { code: 'EMPTY_SOURCE_TEXT', severity: 'INFO', scope: 'SOURCE', pageIndex: null, affectsCoverage: false }
    ] : [],
    artifactContentFingerprint: '0'.repeat(64)
  };
  artifact.artifactContentFingerprint = computeArtifactFingerprint(
    validateSourceExtractionArtifactShape(artifact)
  );
  return artifact;
}

function pdfArtifact(pageTexts: string[], spans: Span[]): Record<string, unknown> {
  let offset = 0;
  const pages = pageTexts.map((canonicalText, index) => {
    const start = offset;
    const end = start + Array.from(canonicalText).length;
    offset = end + 2;
    return {
      pageIndex: index,
      pageNumber: index + 1,
      canonicalText,
      pageOffsetStart: start,
      pageOffsetEnd: end,
      pageObservationStatus: 'EXTRACTED'
    };
  });

  const artifact: Record<string, unknown> = {
    schemaVersion: 'source_extraction_v1',
    sourceType: 'PDF_DOCUMENT',
    source: {
      documentEvidenceId: 'doc-order-001',
      sourceSha256: SHA,
      storageKey: 'documents/doc-order-001.pdf'
    },
    extractionIdentity: {
      schemaVersion: 'source_extraction_v1',
      implementationVersion: 'source_extractor_v1.0.0',
      parserProfile: 'PDFPLUMBER',
      dependencyFingerprint: 'b'.repeat(64)
    },
    sourceNormalizationApplied: 'NONE',
    offsetUnit: 'UNICODE_CODE_POINT',
    coverageStatus: 'FULL',
    pages,
    documentCanonicalText: pageTexts.join('\n\n'),
    segments: spans.map((span) => ({
      segmentId: `p${span.page}:${span.start}-${span.end}`,
      pageIndex: span.page,
      charStart: span.start,
      charEnd: span.end,
      exactExcerpt: Array.from(pageTexts[span.page as number])
        .slice(span.start, span.end)
        .join('')
    })),
    diagnostics: [],
    artifactContentFingerprint: '0'.repeat(64)
  };
  artifact.artifactContentFingerprint = computeArtifactFingerprint(
    validateSourceExtractionArtifactShape(artifact)
  );
  return artifact;
}

function expectOrderRejection(input: unknown): void {
  try {
    verifySourceExtractionArtifact(input);
  } catch (error) {
    assert.ok(error instanceof SourceExtractionVerificationError, String(error));
    assert.equal(error.code, 'ADDRESS_INVALID');
    assert.equal(
      error.detail.invariant,
      'SEGMENT_ORDER_NON_CANONICAL',
      `se esperaba rechazo por ORDEN, llego ${error.detail.invariant}`
    );
    return;
  }
  throw new assert.AssertionError({
    message: 'se esperaba SEGMENT_ORDER_NON_CANONICAL y el artifact fue aceptado'
  });
}

/** Conjunto canonico completo de las dos paginas sinteticas. */
const PDF_CANONICAL: Span[] = [
  { page: 0, start: 0, end: 5 },
  { page: 0, start: 7, end: 18 },
  { page: 1, start: 0, end: 6 },
  { page: 1, start: 8, end: 14 }
];

/** Conjunto canonico completo del documento sintetico. */
const TEXT_CANONICAL: Span[] = [
  { page: null, start: 0, end: 4 },
  { page: null, start: 6, end: 16 },
  { page: null, start: 18, end: 23 }
];

// ---------------------------------------------------------------------------
// PDF — ASC(pageIndex, charStart, charEnd)
// ---------------------------------------------------------------------------

test('PDF: the synthetic pages really do yield the spans this suite assumes', () => {
  assert.deepEqual(deriveBlockSpans(PAGE_A), [
    { start: 0, end: 5 },
    { start: 7, end: 18 }
  ]);
  assert.deepEqual(deriveBlockSpans(PAGE_B), [
    { start: 0, end: 6 },
    { start: 8, end: 14 }
  ]);
});

test('PDF: the canonical set in canonical order is accepted', () => {
  const artifact = verifySourceExtractionArtifact(pdfArtifact([PAGE_A, PAGE_B], PDF_CANONICAL));
  assert.equal(artifact.segments.length, 4);
});

test('PDF: pageIndex out of order is rejected', () => {
  // Permutacion del conjunto canonico COMPLETO: la membresia pasa y lo unico
  // que difiere es el orden.
  expectOrderRejection(
    pdfArtifact([PAGE_A, PAGE_B], [
      PDF_CANONICAL[2],
      PDF_CANONICAL[0],
      PDF_CANONICAL[1],
      PDF_CANONICAL[3]
    ])
  );
});

test('PDF: same pageIndex, charStart out of order is rejected', () => {
  expectOrderRejection(
    pdfArtifact([PAGE_A, PAGE_B], [
      PDF_CANONICAL[1],
      PDF_CANONICAL[0],
      PDF_CANONICAL[2],
      PDF_CANONICAL[3]
    ])
  );
});

test('PDF: a later page with a smaller charStart is still canonical', () => {
  // pageIndex domina: p1:0-6 va despues de p0:7-18 aunque su charStart sea menor.
  const artifact = verifySourceExtractionArtifact(pdfArtifact([PAGE_A, PAGE_B], PDF_CANONICAL));
  const [, second, third] = artifact.segments;
  assert.equal(second.segmentId, 'p0:7-18');
  assert.equal(third.segmentId, 'p1:0-6');
  assert.ok((third.charStart as number) < (second.charStart as number));
});

// ---------------------------------------------------------------------------
// TEXT — ASC(charStart, charEnd)
// ---------------------------------------------------------------------------

test('TEXT: the synthetic document really does yield the spans this suite assumes', () => {
  assert.deepEqual(deriveBlockSpans(DOCUMENT), [
    { start: 0, end: 4 },
    { start: 6, end: 16 },
    { start: 18, end: 23 }
  ]);
});

test('TEXT: the canonical set in canonical order is accepted', () => {
  const artifact = verifySourceExtractionArtifact(textArtifact(DOCUMENT, TEXT_CANONICAL));
  assert.equal(artifact.segments.length, 3);
});

test('TEXT: charStart out of order is rejected', () => {
  expectOrderRejection(
    textArtifact(DOCUMENT, [TEXT_CANONICAL[1], TEXT_CANONICAL[0], TEXT_CANONICAL[2]])
  );
});

test('TEXT: a fully reversed canonical set is rejected on order', () => {
  expectOrderRejection(textArtifact(DOCUMENT, [...TEXT_CANONICAL].reverse()));
});

test('TEXT: pageIndex plays no part in the comparator', () => {
  // Para TEXT `pageIndex` es siempre null. Si el comparator lo mirara, comparar
  // null contra null seria un empate espurio en la clave principal y el orden
  // real quedaria sin verificar — este caso lo detectaria.
  const artifact = verifySourceExtractionArtifact(textArtifact(DOCUMENT, TEXT_CANONICAL));
  for (const segment of artifact.segments) {
    assert.equal(segment.pageIndex, null);
  }
  expectOrderRejection(
    textArtifact(DOCUMENT, [TEXT_CANONICAL[2], TEXT_CANONICAL[1], TEXT_CANONICAL[0]])
  );
});

// ---------------------------------------------------------------------------
// Casos borde
// ---------------------------------------------------------------------------

test('a single canonical segment is trivially ordered', () => {
  const single = 'Solo un bloque.';
  assert.deepEqual(deriveBlockSpans(single), [{ start: 0, end: 15 }]);

  const artifact = verifySourceExtractionArtifact(
    textArtifact(single, [{ page: null, start: 0, end: 15 }])
  );
  assert.equal(artifact.segments.length, 1);
});

test('a document whose blocks are all whitespace yields zero segments', () => {
  // `"\n\n"` da dos bloques vacios; ninguno es sustantivo. El documento NO es
  // vacio, asi que no corresponde EMPTY_SOURCE_TEXT.
  assert.deepEqual(deriveBlockSpans('\n\n'), []);

  const artifact = verifySourceExtractionArtifact(textArtifact('\n\n', []));
  assert.deepEqual(artifact.segments, []);
  assert.equal(artifact.diagnostics.length, 0);
});

// ---------------------------------------------------------------------------
// La tercera clave del comparator quedó inalcanzable
// ---------------------------------------------------------------------------

test('no canonical segmentation ever produces two segments sharing charStart', () => {
  /**
   * Antes del cierre de completitud, la clave `charEnd` del comparator estaba
   * "no ejercitada por los productores". Ahora es mas fuerte: es INALCANZABLE a
   * traves de la API publica, porque un artifact con dos segmentos que comparten
   * `(pageIndex, charStart)` se rechaza por membresia antes de que el orden
   * pueda distinguirlos.
   *
   * La clave se mantiene en el comparator para que el orden quede totalmente
   * definido; este test documenta por que no se puede testear de otra forma.
   */
  const texts = [
    PAGE_A,
    PAGE_B,
    DOCUMENT,
    'Solo un bloque.',
    'A\n\n\nB',
    'A\n\n\n\nB',
    'X\n\n   \n\nY',
    ''
  ];

  for (const text of texts) {
    const spans = deriveBlockSpans(text);
    const starts = spans.map((span) => span.start);
    assert.equal(new Set(starts).size, starts.length, JSON.stringify(text));
  }

  const manifest = loadProducerCorpusManifest();
  for (const entry of manifest.cases) {
    const artifact = verifySourceExtractionArtifact(loadProducerArtifact(entry.name));
    const keys = artifact.segments.map((segment) => `${segment.pageIndex}:${segment.charStart}`);
    assert.equal(new Set(keys).size, keys.length, entry.name);
  }
});

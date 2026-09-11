/**
 * Verificación source-addressable de las EvidenceUnits — F3.4.
 *
 * Cada test parte de un catálogo VÁLIDO y de un artifact de extracción real: lo
 * que se prueba no es la forma sino que las coordenadas persistidas sean
 * reproducibles contra el texto canónico verificado.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasoningRunArtifactError } from './reasoning-run-artifact.errors';
import { verifyEvidenceUnitsArtifact } from './evidence-units-artifact.validator';
import { verifyEvidenceUnitsAgainstSourceExtractions } from './evidence-units-source-addressable.verifier';

const TEXT = 'Curso de APIs REST.\n\nContenidos: endpoints y testing.';

function textArtifact(canonical = TEXT): any {
  return {
    schemaVersion: 'source_extraction_v1',
    sourceType: 'TEXT',
    source: { textEvidenceId: 'te_1', sourceSha256: 'a'.repeat(64) },
    extractionIdentity: {
      schemaVersion: 'source_extraction_v1',
      implementationVersion: 'test',
      parserProfile: 'PRODUCT_TEXT_V1'
    },
    sourceNormalizationApplied: 'PRODUCT_NFC_LINEENDINGS_TRIM',
    offsetUnit: 'UNICODE_CODE_POINT',
    coverageStatus: 'FULL',
    pages: [],
    documentCanonicalText: canonical,
    segments: [
      { segmentId: 'd:0-19', pageIndex: null, charStart: 0, charEnd: 19, exactExcerpt: canonical.slice(0, 19) },
      { segmentId: 'd:21-53', pageIndex: null, charStart: 21, charEnd: 53, exactExcerpt: canonical.slice(21, 53) }
    ],
    diagnostics: [],
    artifactContentFingerprint: 'b'.repeat(64)
  };
}

function pdfArtifact(): any {
  const canonical = TEXT;
  return {
    ...textArtifact(canonical),
    sourceType: 'PDF_DOCUMENT',
    source: {
      documentEvidenceId: 'de_1',
      sourceSha256: 'a'.repeat(64),
      storageKey: 'documents/x.pdf'
    },
    extractionIdentity: {
      schemaVersion: 'source_extraction_v1',
      implementationVersion: 'test',
      parserProfile: 'PDFPLUMBER_V1',
      dependencyFingerprint: 'c'.repeat(64)
    },
    sourceNormalizationApplied: 'NONE',
    pages: [
      {
        pageIndex: 0,
        pageNumber: 1,
        canonicalText: canonical.slice(0, 19),
        pageOffsetStart: 0,
        pageOffsetEnd: 19,
        pageObservationStatus: 'EXTRACTED'
      },
      {
        pageIndex: 1,
        pageNumber: 2,
        canonicalText: canonical.slice(21),
        pageOffsetStart: 21,
        pageOffsetEnd: canonical.length,
        pageObservationStatus: 'EXTRACTED'
      }
    ]
  };
}

function unit(overrides: Record<string, unknown> = {}): any {
  const trace = {
    sourceId: 'src_01',
    sourceSha256: 'a'.repeat(64),
    segmentId: 'd:0-19',
    pageNumber: null,
    charStart: 0,
    charEnd: 19,
    exactExcerpt: TEXT.slice(0, 19),
    ...((overrides.sourceTrace as object) ?? {})
  };
  return {
    evidenceUnitId: 'eu_01',
    normalizedProposition: 'El curso cubre APIs REST.',
    claimType: 'DECLARED_CONTENT',
    semanticQualifiers: [],
    exactQuote: trace.exactExcerpt,
    contextBefore: '',
    contextAfter: '',
    sectionLabel: null,
    interpretationProvenance: 'AI_INFERRED',
    extractionQuality: 'FULL',
    ...overrides,
    // Siempre la traza construida arriba: los overrides de `sourceTrace` ya se
    // fusionaron en ella.
    sourceTrace: trace
  };
}

function catalog(...units: any[]): any {
  return {
    schemaVersion: 'evidence_units_v1',
    sources: [{ sourceId: 'src_01', sourceProvenance: 'ISSUER_DECLARED' }],
    evidenceUnits: units,
    preparation: {
      mode: 'FULL_SCAN',
      evidenceUnitIds: units.map((item) => item.evidenceUnitId),
      exactRedundancyGroups: [],
      sourceObservabilityFacts: [
        {
          sourceId: 'src_01',
          coverageStatus: 'FULL',
          observedEvidenceUnitIds: units.map((item) => item.evidenceUnitId),
          extractionDiagnostics: []
        }
      ],
      discardedEvidenceProposalCount: 0
    },
    validations: []
  };
}

function extractions(artifact: any = textArtifact()): ReadonlyMap<string, any> {
  return new Map([['src_01', artifact]]);
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error: unknown) {
    assert.ok(error instanceof ReasoningRunArtifactError, String(error));
    assert.equal(error.code, code);
    return;
  }
  throw new Error(`expected ${code} but nothing was thrown`);
}

// ---------------------------------------------------------------------------
// Anclaje correcto
// ---------------------------------------------------------------------------

test('una unidad anclada contra el canonico verificado pasa', () => {
  const verified = verifyEvidenceUnitsArtifact(catalog(unit()));
  verifyEvidenceUnitsAgainstSourceExtractions(verified, extractions());
});

test('un catalogo vacio pasa trivialmente', () => {
  const empty = catalog();
  empty.preparation.sourceObservabilityFacts[0].observedEvidenceUnitIds = [];
  const verified = verifyEvidenceUnitsArtifact(empty);
  verifyEvidenceUnitsAgainstSourceExtractions(verified, extractions());
});

test('la pagina se verifica contra el offset en una fuente con paginas', () => {
  const verified = verifyEvidenceUnitsArtifact(
    catalog(
      unit({
        sourceTrace: {
          segmentId: 'd:21-53',
          charStart: 21,
          charEnd: 53,
          exactExcerpt: TEXT.slice(21, 53),
          pageNumber: 2
        }
      })
    )
  );
  verifyEvidenceUnitsAgainstSourceExtractions(verified, extractions(pdfArtifact()));
});

// ---------------------------------------------------------------------------
// Coordenadas manipuladas
// ---------------------------------------------------------------------------

test('un excerpt manipulado no se persiste', () => {
  // El caso central: el texto dice otra cosa que la rebanada del canonico.
  const tampered = unit();
  tampered.sourceTrace.exactExcerpt = 'Curso de PYTHON.';
  tampered.exactQuote = 'Curso de PYTHON.';
  const verified = verifyEvidenceUnitsArtifact(catalog(tampered));

  expectCode(
    () => verifyEvidenceUnitsAgainstSourceExtractions(verified, extractions()),
    'SPAN_INVALID'
  );
});

test('un offset corrido no se persiste', () => {
  const tampered = unit();
  tampered.sourceTrace.charStart = 3;
  const verified = verifyEvidenceUnitsArtifact(catalog(tampered));

  expectCode(
    () => verifyEvidenceUnitsAgainstSourceExtractions(verified, extractions()),
    'SPAN_INVALID'
  );
});

test('un span fuera del texto no se persiste', () => {
  const tampered = unit();
  tampered.sourceTrace.charEnd = 9999;
  const verified = verifyEvidenceUnitsArtifact(catalog(tampered));

  expectCode(
    () => verifyEvidenceUnitsAgainstSourceExtractions(verified, extractions()),
    'SPAN_INVALID'
  );
});

test('exactQuote y el excerpt de la traza deben coincidir', () => {
  const tampered = unit();
  tampered.exactQuote = 'otra cosa';
  const verified = verifyEvidenceUnitsArtifact(catalog(tampered));

  expectCode(
    () => verifyEvidenceUnitsAgainstSourceExtractions(verified, extractions()),
    'SPAN_INVALID'
  );
});

// ---------------------------------------------------------------------------
// Identidad estructural
// ---------------------------------------------------------------------------

test('un segmento que no pertenece a la fuente se rechaza', () => {
  const tampered = unit();
  tampered.sourceTrace.segmentId = 'd:999-1000';
  const verified = verifyEvidenceUnitsArtifact(catalog(tampered));

  expectCode(
    () => verifyEvidenceUnitsAgainstSourceExtractions(verified, extractions()),
    'SPAN_INVALID'
  );
});

test('un span que se sale de su segmento declarado se rechaza', () => {
  const tampered = unit();
  tampered.sourceTrace.charEnd = 30;
  tampered.sourceTrace.exactExcerpt = TEXT.slice(0, 30);
  tampered.exactQuote = TEXT.slice(0, 30);
  const verified = verifyEvidenceUnitsArtifact(catalog(tampered));

  expectCode(
    () => verifyEvidenceUnitsAgainstSourceExtractions(verified, extractions()),
    'SPAN_INVALID'
  );
});

test('una pagina declarada en una fuente sin paginas se rechaza', () => {
  const tampered = unit();
  tampered.sourceTrace.pageNumber = 1;
  const verified = verifyEvidenceUnitsArtifact(catalog(tampered));

  expectCode(
    () => verifyEvidenceUnitsAgainstSourceExtractions(verified, extractions()),
    'SPAN_INVALID'
  );
});

test('una pagina equivocada se rechaza', () => {
  const tampered = unit({
    sourceTrace: {
      segmentId: 'd:21-53',
      charStart: 21,
      charEnd: 53,
      exactExcerpt: TEXT.slice(21, 53),
      pageNumber: 1
    }
  });
  const verified = verifyEvidenceUnitsArtifact(catalog(tampered));

  expectCode(
    () => verifyEvidenceUnitsAgainstSourceExtractions(verified, extractions(pdfArtifact())),
    'SPAN_INVALID'
  );
});

test('una fuente sin extraccion verificada se rechaza', () => {
  const verified = verifyEvidenceUnitsArtifact(catalog(unit()));
  expectCode(
    () => verifyEvidenceUnitsAgainstSourceExtractions(verified, new Map()),
    'SOURCE_REFERENCE_NOT_GROUNDED'
  );
});

// ---------------------------------------------------------------------------
// Offsets Unicode
// ---------------------------------------------------------------------------

test('los offsets se cuentan en PUNTOS DE CODIGO, no en unidades UTF-16', () => {
  // Con un emoji fuera del BMP, `slice` de JavaScript daria otra rebanada que
  // Python. Si los dos lados no cuentan igual, la verificacion cruzada no
  // verifica nada.
  const emoji = String.fromCodePoint(0x1f9ea);
  const canonical = `${emoji} Curso de APIs REST.`;
  const artifact = textArtifact(canonical);
  artifact.segments = [
    {
      segmentId: 'd:0-21',
      pageIndex: null,
      charStart: 0,
      charEnd: 21,
      exactExcerpt: [...canonical].slice(0, 21).join('')
    }
  ];

  const item = unit({
    sourceTrace: {
      segmentId: 'd:0-21',
      charStart: 2,
      charEnd: 21,
      exactExcerpt: [...canonical].slice(2, 21).join(''),
      pageNumber: null
    }
  });
  const verified = verifyEvidenceUnitsArtifact(catalog(item));

  verifyEvidenceUnitsAgainstSourceExtractions(verified, extractions(artifact));
  // Y la lectura UTF-16 del mismo rango es OTRA cosa: el test seria vacuo si no.
  assert.notEqual(canonical.slice(2, 21), [...canonical].slice(2, 21).join(''));
});

// ---------------------------------------------------------------------------
// Privacidad
// ---------------------------------------------------------------------------

test('el error no filtra el texto canonico ni el excerpt', () => {
  const secret = 'TEXTO-CONFIDENCIAL-DEL-HOLDER';
  const canonical = `Curso con ${secret} adentro.`;
  const artifact = textArtifact(canonical);
  artifact.segments = [
    { segmentId: 'd:0-10', pageIndex: null, charStart: 0, charEnd: 10, exactExcerpt: canonical.slice(0, 10) }
  ];

  const tampered = unit({
    sourceTrace: {
      segmentId: 'd:0-10',
      charStart: 0,
      charEnd: 10,
      exactExcerpt: 'manipulado',
      pageNumber: null
    }
  });
  const verified = verifyEvidenceUnitsArtifact(catalog(tampered));

  try {
    verifyEvidenceUnitsAgainstSourceExtractions(verified, extractions(artifact));
  } catch (error: unknown) {
    assert.ok(error instanceof ReasoningRunArtifactError);
    assert.ok(!error.message.includes(secret));
    assert.ok(!String(error.observed).includes('manipulado'));
    return;
  }
  throw new Error('expected the verification to fail');
});

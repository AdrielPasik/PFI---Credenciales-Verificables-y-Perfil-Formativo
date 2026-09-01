/**
 * Verificacion contra el corpus CONTRACTUAL de F0.1, escrito a mano.
 *
 * Este corpus ejercita casos limite que un productor real quiza nunca emita, y
 * separa deliberadamente dos clases de rechazo:
 *
 *   invalid-schema     mal formados estructuralmente
 *   invalid-invariant  schema-validos A PROPOSITO, rechazados por invariante
 *
 * El segundo grupo es el que importa: son los artifacts que un motor de JSON
 * Schema aceptaria y que igual son mentira.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  derivePdfCoverage,
  deriveTextCoverage,
  materialProjection
} from './source-extraction-artifact.invariants';
import { verifySourceExtractionArtifact } from './source-extraction-artifact.verifier';
import {
  SourceExtractionVerificationError,
  type SourceExtractionVerificationCode
} from './source-extraction-verification.errors';
import {
  cloneArtifact,
  INVALID_INVARIANT_FIXTURE_NAMES,
  INVALID_SCHEMA_FIXTURE_NAMES,
  loadContractFixture,
  VALID_FIXTURE_NAMES
} from './__fixtures__/source-extraction.fixtures';

function expectRejection(input: unknown): SourceExtractionVerificationError {
  try {
    verifySourceExtractionArtifact(input);
  } catch (error) {
    assert.ok(
      error instanceof SourceExtractionVerificationError,
      `se esperaba SourceExtractionVerificationError, llego ${String(error)}`
    );
    return error;
  }
  throw new assert.AssertionError({ message: 'se esperaba un rechazo y el artifact fue aceptado' });
}

// ---------------------------------------------------------------------------
// Corpus valido
// ---------------------------------------------------------------------------

test('the frozen valid corpus is not empty', () => {
  assert.ok(VALID_FIXTURE_NAMES.length >= 9);
  assert.ok(INVALID_SCHEMA_FIXTURE_NAMES.length >= 15);
  assert.ok(INVALID_INVARIANT_FIXTURE_NAMES.length >= 9);
});

for (const name of VALID_FIXTURE_NAMES) {
  test(`valid fixture accepted: ${name}`, () => {
    const artifact = verifySourceExtractionArtifact(loadContractFixture('valid', name));
    assert.equal(artifact.schemaVersion, 'source_extraction_v1');
    assert.equal(artifact.offsetUnit, 'UNICODE_CODE_POINT');
  });
}

// ---------------------------------------------------------------------------
// Rechazos
// ---------------------------------------------------------------------------

for (const name of INVALID_SCHEMA_FIXTURE_NAMES) {
  test(`schema-invalid fixture rejected: ${name}`, () => {
    expectRejection(loadContractFixture('invalid-schema', name));
  });
}

const INVARIANT_EXPECTATIONS: Record<string, SourceExtractionVerificationCode> = {
  'coverage-inconsistent-with-pages': 'COVERAGE_INCONSISTENT',
  'document-canonical-text-mismatch': 'ADDRESS_INVALID',
  'excerpt-misaligned': 'ALIGNMENT_MISMATCH',
  'fingerprint-wrong': 'FINGERPRINT_MISMATCH',
  'page-number-relation-wrong': 'ADDRESS_INVALID',
  'page-offset-end-wrong': 'ADDRESS_INVALID',
  'page-offset-start-wrong': 'ADDRESS_INVALID',
  'reversed-span': 'ADDRESS_INVALID',
  'segment-references-unknown-page': 'ADDRESS_INVALID'
};

for (const name of INVALID_INVARIANT_FIXTURE_NAMES) {
  test(`schema-valid but invariant-invalid fixture rejected: ${name}`, () => {
    const error = expectRejection(loadContractFixture('invalid-invariant', name));
    const expected = INVARIANT_EXPECTATIONS[name];
    if (expected !== undefined) {
      assert.equal(error.code, expected, `${name} deberia rechazarse con ${expected}`);
    }
  });
}

test('every invariant fixture name has a declared expectation', () => {
  for (const name of INVALID_INVARIANT_FIXTURE_NAMES) {
    assert.ok(
      name in INVARIANT_EXPECTATIONS,
      `falta la expectativa de codigo para la fixture ${name}`
    );
  }
});

// ---------------------------------------------------------------------------
// Discriminacion por sourceType
// ---------------------------------------------------------------------------

test('PDF artifacts carry a four-field identity and NONE normalization', () => {
  const artifact = verifySourceExtractionArtifact(loadContractFixture('valid', 'pdf-full'));
  assert.equal(artifact.sourceType, 'PDF_DOCUMENT');
  assert.equal(artifact.sourceNormalizationApplied, 'NONE');
  if (artifact.sourceType !== 'PDF_DOCUMENT') {
    throw new Error('unreachable');
  }
  assert.ok(['PDFPLUMBER', 'PYPDF'].includes(artifact.extractionIdentity.parserProfile));
  assert.match(artifact.extractionIdentity.dependencyFingerprint, /^[a-f0-9]{64}$/);
  assert.ok('documentEvidenceId' in artifact.source);
  assert.ok('storageKey' in artifact.source);
});

test('TEXT artifacts have no pages and a three-field identity', () => {
  const artifact = verifySourceExtractionArtifact(loadContractFixture('valid', 'text-full'));
  assert.equal(artifact.sourceType, 'TEXT');
  assert.equal(artifact.sourceNormalizationApplied, 'PRODUCT_NFC_LINEENDINGS_TRIM');
  assert.deepEqual(artifact.pages, []);
  if (artifact.sourceType !== 'TEXT') {
    throw new Error('unreachable');
  }
  assert.equal(artifact.extractionIdentity.parserProfile, 'TEXT_DIRECT');
  assert.ok(!('dependencyFingerprint' in artifact.extractionIdentity));
  assert.ok('textEvidenceId' in artifact.source);
});

test('TEXT with a dependencyFingerprint is rejected, even though it is a valid sha', () => {
  const artifact = cloneArtifact(loadContractFixture('valid', 'text-full')) as Record<string, any>;
  artifact.extractionIdentity.dependencyFingerprint = 'a'.repeat(64);
  const error = expectRejection(artifact);
  assert.equal(error.code, 'SCHEMA_INVALID');
  assert.equal(error.detail.invariant, 'unknown_property');
});

test('TEXT with a null dependencyFingerprint is rejected too', () => {
  const artifact = cloneArtifact(loadContractFixture('valid', 'text-full')) as Record<string, any>;
  artifact.extractionIdentity.dependencyFingerprint = null;
  assert.equal(expectRejection(artifact).code, 'SCHEMA_INVALID');
});

test('a synthetic page on a TEXT source is rejected', () => {
  const artifact = cloneArtifact(loadContractFixture('valid', 'text-full')) as Record<string, any>;
  artifact.pages = [
    {
      pageIndex: 0,
      pageNumber: 1,
      canonicalText: artifact.documentCanonicalText,
      pageOffsetStart: 0,
      pageOffsetEnd: 1,
      pageObservationStatus: 'EXTRACTED'
    }
  ];
  assert.equal(expectRejection(artifact).code, 'SCHEMA_INVALID');
});

// ---------------------------------------------------------------------------
// Coverage por tipo de fuente
// ---------------------------------------------------------------------------

test('PDF coverage derivation follows the frozen rule', () => {
  assert.equal(derivePdfCoverage(['EXTRACTED', 'EXTRACTED']), 'FULL');
  assert.equal(derivePdfCoverage(['EXTRACTED', 'OBSERVED_EMPTY']), 'FULL');
  assert.equal(derivePdfCoverage(['EXTRACTED', 'UNOBSERVED_OR_UNEXTRACTABLE']), 'PARTIAL');
  assert.equal(derivePdfCoverage(['EXTRACTED', 'FAILED']), 'PARTIAL');
  assert.equal(
    derivePdfCoverage(['UNOBSERVED_OR_UNEXTRACTABLE', 'UNOBSERVED_OR_UNEXTRACTABLE']),
    'FAILED'
  );
  assert.equal(derivePdfCoverage([]), 'FAILED');
});

test('the PDF empty rule is NOT applied to TEXT', () => {
  // Reutilizarla daria FAILED para todo TextEvidence, que siempre tiene pages: [].
  assert.equal(derivePdfCoverage([]), 'FAILED');
  assert.equal(deriveTextCoverage(), 'FULL');

  const empty = verifySourceExtractionArtifact(loadContractFixture('valid', 'text-empty-full'));
  assert.equal(empty.coverageStatus, 'FULL');
  assert.deepEqual(empty.segments, []);
  assert.equal(empty.documentCanonicalText, '');
});

test('empty TEXT declares EMPTY_SOURCE_TEXT with the frozen combination', () => {
  const empty = verifySourceExtractionArtifact(loadContractFixture('valid', 'text-empty-full'));
  const diagnostic = empty.diagnostics.find((entry) => entry.code === 'EMPTY_SOURCE_TEXT');
  assert.ok(diagnostic);
  assert.equal(diagnostic.severity, 'INFO');
  assert.equal(diagnostic.scope, 'SOURCE');
  assert.equal(diagnostic.pageIndex, null);
  assert.equal(diagnostic.affectsCoverage, false);
});

test('OBSERVED_EMPTY remains representable and does not degrade coverage', () => {
  const artifact = verifySourceExtractionArtifact(
    loadContractFixture('valid', 'pdf-observed-empty-full')
  );
  assert.equal(artifact.coverageStatus, 'FULL');
  assert.ok(artifact.pages.some((page) => page.pageObservationStatus === 'OBSERVED_EMPTY'));
});

// ---------------------------------------------------------------------------
// Diagnosticos
// ---------------------------------------------------------------------------

test('a diagnostic whose severity contradicts the frozen table is rejected', () => {
  const artifact = cloneArtifact(
    loadContractFixture('valid', 'pdf-partial-unobservable-page')
  ) as Record<string, any>;
  artifact.diagnostics[0].severity = 'INFO';
  const error = expectRejection(artifact);
  assert.equal(error.code, 'DIAGNOSTIC_INCONSISTENT');
  assert.equal(error.detail.invariant, 'severity_does_not_match_frozen_table');
});

test('a diagnostic whose affectsCoverage contradicts the frozen table is rejected', () => {
  const artifact = cloneArtifact(
    loadContractFixture('valid', 'pdf-partial-unobservable-page')
  ) as Record<string, any>;
  artifact.diagnostics[0].affectsCoverage = false;
  assert.equal(expectRejection(artifact).code, 'DIAGNOSTIC_INCONSISTENT');
});

test('a PAGE diagnostic pointing at a non-existent page is rejected', () => {
  const artifact = cloneArtifact(
    loadContractFixture('valid', 'pdf-partial-unobservable-page')
  ) as Record<string, any>;
  artifact.diagnostics[0].pageIndex = 99;
  const error = expectRejection(artifact);
  assert.equal(error.code, 'DIAGNOSTIC_INCONSISTENT');
  assert.equal(error.detail.pageIndex, 99);
});

// ---------------------------------------------------------------------------
// Astral end-to-end
// ---------------------------------------------------------------------------

test('astral fixture: spans are code points and the excerpt reconstructs', () => {
  const artifact = verifySourceExtractionArtifact(
    loadContractFixture('valid', 'pdf-astral-unicode')
  );
  const withAstral = artifact.segments.find((segment) =>
    Array.from(segment.exactExcerpt).some((character) => (character.codePointAt(0) as number) > 0xffff)
  );
  assert.ok(withAstral, 'la fixture astral debe contener un segmento con un caracter astral');

  const page = artifact.pages.find((entry) => entry.pageIndex === withAstral.pageIndex);
  assert.ok(page);
  // El span declarado, leido como code units UTF-16, daria otra cosa.
  const naive = page.canonicalText.slice(withAstral.charStart, withAstral.charEnd);
  assert.notEqual(naive, withAstral.exactExcerpt);
});

// ---------------------------------------------------------------------------
// Modelo de error: nada de contenido del documento
// ---------------------------------------------------------------------------

test('errors never leak canonicalText or exactExcerpt', () => {
  const artifact = cloneArtifact(loadContractFixture('valid', 'pdf-full')) as Record<string, any>;
  const secret = 'CONTENIDO CONFIDENCIAL DEL TITULAR';
  artifact.pages[0].canonicalText = secret;
  artifact.segments[0].exactExcerpt = secret;

  const error = expectRejection(artifact);
  const serialized = `${error.message} ${JSON.stringify(error.detail)}`;
  for (const word of secret.split(' ')) {
    assert.ok(!serialized.includes(word), `el error filtro la palabra ${word}`);
  }
});

test('errors carry a stable code, path and invariant for F0.5', () => {
  const error = expectRejection(loadContractFixture('invalid-invariant', 'fingerprint-wrong'));
  assert.equal(error.code, 'FINGERPRINT_MISMATCH');
  assert.equal(error.detail.path, 'artifact.artifactContentFingerprint');
  assert.equal(error.detail.invariant, 'recomputed_fingerprint_does_not_match');
});

// ---------------------------------------------------------------------------
// Material projection
// ---------------------------------------------------------------------------

test('material projection excludes detail and the derived fields', () => {
  const artifact = verifySourceExtractionArtifact(
    loadContractFixture('valid', 'pdf-pypdf-fallback')
  );
  const projection = materialProjection(artifact as never) as Record<string, any>;

  assert.deepEqual(Object.keys(projection).sort(), [
    'coverageStatus',
    'diagnostics',
    'extractionIdentity',
    'offsetUnit',
    'pages',
    'segments',
    'sourceNormalizationApplied',
    'sourceSha256'
  ]);
  assert.ok(!('artifactContentFingerprint' in projection));
  assert.ok(!('documentCanonicalText' in projection));
  for (const diagnostic of projection.diagnostics) {
    assert.ok(!('detail' in diagnostic));
  }
  for (const page of projection.pages) {
    assert.ok(!('pageOffsetStart' in page));
    assert.ok(!('pageOffsetEnd' in page));
  }
  for (const segment of projection.segments) {
    assert.ok(!('exactExcerpt' in segment));
  }
});

test('changing only diagnostic.detail does not change the fingerprint', () => {
  const base = loadContractFixture('valid', 'pdf-pypdf-fallback') as Record<string, any>;
  const mutated = cloneArtifact(base);
  mutated.diagnostics[0].detail = 'otro detalle acotado y no sensible';

  const first = verifySourceExtractionArtifact(base);
  const second = verifySourceExtractionArtifact(mutated);
  assert.equal(
    first.artifactContentFingerprint,
    second.artifactContentFingerprint,
    'detail esta fuera del preimage por diseño'
  );
});

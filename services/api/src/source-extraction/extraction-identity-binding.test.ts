/**
 * `EXACTLY_ONE_EXTRACTION_IDENTITY_PER_SOURCE`, con alcance de run.
 *
 * Los bindings se construyen a mano porque lo que se prueba es la primitiva de
 * validación, no el trust gate: éste ya tiene su propia suite.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { assertSingleExtractionIdentityPerSourceForRun } from './extraction-identity-binding';
import { SourceExtractionTrustError } from './source-extraction-trust.errors';
import { type AuthoritativeSourceBoundExtraction } from './source-extraction-trust.types';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const DEP_1 = '1'.repeat(64);
const DEP_2 = '2'.repeat(64);

function pdfBinding(options: {
  run?: string;
  sha?: string;
  parserProfile?: 'PDFPLUMBER' | 'PYPDF';
  dependencyFingerprint?: string;
  implementationVersion?: string;
  sourceId?: string;
}): AuthoritativeSourceBoundExtraction {
  return {
    analysisRunId: options.run ?? 'run-1',
    analysisRunSourceId: options.sourceId ?? 'ars-1',
    sourceType: 'PDF_DOCUMENT',
    sourceEntityId: 'doc-1',
    sourceSha256: options.sha ?? SHA_A,
    extractionIdentity: {
      schemaVersion: 'source_extraction_v1',
      implementationVersion: options.implementationVersion ?? 'source_extractor_v1.0.0',
      parserProfile: options.parserProfile ?? 'PDFPLUMBER',
      dependencyFingerprint: options.dependencyFingerprint ?? DEP_1
    },
    extractionDerivationTrust: 'PRODUCER_ASSUMED',
    artifact: {} as never
  };
}

function textBinding(options: {
  run?: string;
  sha?: string;
  implementationVersion?: string;
  sourceId?: string;
}): AuthoritativeSourceBoundExtraction {
  return {
    analysisRunId: options.run ?? 'run-1',
    analysisRunSourceId: options.sourceId ?? 'ars-text-1',
    sourceType: 'TEXT',
    sourceEntityId: 'text-1',
    sourceSha256: options.sha ?? SHA_A,
    extractionIdentity: {
      schemaVersion: 'source_extraction_v1',
      implementationVersion: options.implementationVersion ?? 'source_extractor_v1.0.0',
      parserProfile: 'TEXT_DIRECT'
    },
    extractionDerivationTrust: 'AUTHORITATIVE_CONTENT_MATCHED',
    artifact: {} as never
  };
}

function expectConflict(
  bindings: AuthoritativeSourceBoundExtraction[],
  code: string,
  run = 'run-1'
): void {
  try {
    assertSingleExtractionIdentityPerSourceForRun(run, bindings);
  } catch (error) {
    assert.ok(error instanceof SourceExtractionTrustError, String(error));
    assert.equal(error.code, code);
    return;
  }
  throw new assert.AssertionError({ message: `se esperaba ${code} y fue aceptado` });
}

// ---------------------------------------------------------------------------
// Casos permitidos
// ---------------------------------------------------------------------------

test('the same source with the same extraction identity is allowed', () => {
  // "Exactamente una IDENTIDAD" no es "exactamente una instancia de artifact".
  // Repetir la misma identity para la misma fuente no viola el contrato, y no se
  // amplía la regla unilateralmente.
  assertSingleExtractionIdentityPerSourceForRun('run-1', [
    pdfBinding({}),
    pdfBinding({ sourceId: 'ars-2' })
  ]);
});

test('different sources with different identities are allowed', () => {
  assertSingleExtractionIdentityPerSourceForRun('run-1', [
    pdfBinding({ sha: SHA_A, parserProfile: 'PDFPLUMBER' }),
    pdfBinding({ sha: SHA_B, parserProfile: 'PYPDF', sourceId: 'ars-2' })
  ]);
});

test('an empty set of bindings is allowed', () => {
  assertSingleExtractionIdentityPerSourceForRun('run-1', []);
});

test('PDF and TEXT sources coexist in one run', () => {
  assertSingleExtractionIdentityPerSourceForRun('run-1', [
    pdfBinding({ sha: SHA_A }),
    textBinding({ sha: SHA_B })
  ]);
});

// ---------------------------------------------------------------------------
// Conflictos de identity
// ---------------------------------------------------------------------------

test('the same source with PDFPLUMBER and PYPDF is rejected', () => {
  // Los dos parsers producen texto distinto para los mismos bytes: combinarlos
  // en un run fabricaría corroboración a partir de un artefacto de parseo, y el
  // run no tendría un único espacio de direcciones.
  expectConflict(
    [
      pdfBinding({ sha: SHA_A, parserProfile: 'PDFPLUMBER' }),
      pdfBinding({ sha: SHA_A, parserProfile: 'PYPDF', sourceId: 'ars-2' })
    ],
    'EXTRACTION_IDENTITY_BINDING_CONFLICT'
  );
});

test('the same source and parser with a different dependencyFingerprint is rejected', () => {
  expectConflict(
    [
      pdfBinding({ sha: SHA_A, dependencyFingerprint: DEP_1 }),
      pdfBinding({ sha: SHA_A, dependencyFingerprint: DEP_2, sourceId: 'ars-2' })
    ],
    'EXTRACTION_IDENTITY_BINDING_CONFLICT'
  );
});

test('the same source with a different implementationVersion is rejected', () => {
  expectConflict(
    [
      pdfBinding({ sha: SHA_A, implementationVersion: 'source_extractor_v1.0.0' }),
      pdfBinding({
        sha: SHA_A,
        implementationVersion: 'source_extractor_v1.1.0',
        sourceId: 'ars-2'
      })
    ],
    'EXTRACTION_IDENTITY_BINDING_CONFLICT'
  );
});

test('TEXT: the same source with a different implementationVersion is rejected', () => {
  expectConflict(
    [
      textBinding({ sha: SHA_A }),
      textBinding({
        sha: SHA_A,
        implementationVersion: 'source_extractor_v2.0.0',
        sourceId: 'ars-text-2'
      })
    ],
    'EXTRACTION_IDENTITY_BINDING_CONFLICT'
  );
});

test('a conflict is detected regardless of the order of the bindings', () => {
  const first = pdfBinding({ sha: SHA_A, parserProfile: 'PYPDF' });
  const second = pdfBinding({ sha: SHA_A, parserProfile: 'PDFPLUMBER', sourceId: 'ars-2' });
  expectConflict([first, second], 'EXTRACTION_IDENTITY_BINDING_CONFLICT');
  expectConflict([second, first], 'EXTRACTION_IDENTITY_BINDING_CONFLICT');
});

// ---------------------------------------------------------------------------
// Alcance de run
// ---------------------------------------------------------------------------

test('bindings from another run cannot be validated as one set', () => {
  expectConflict(
    [pdfBinding({ run: 'run-1' }), pdfBinding({ run: 'run-2', sourceId: 'ars-2' })],
    'RUN_SCOPE_MISMATCH'
  );
});

test('two runs sharing a source do not conflict when validated separately', () => {
  // El binding de una-identity-por-fuente tiene alcance de RUN. Dos runs
  // distintos pueden legítimamente haber elegido parsers distintos para la misma
  // fuente; lo que está prohibido es mezclarlos dentro de uno.
  const runOne = [pdfBinding({ run: 'run-1', sha: SHA_A, parserProfile: 'PDFPLUMBER' })];
  const runTwo = [pdfBinding({ run: 'run-2', sha: SHA_A, parserProfile: 'PYPDF' })];

  assertSingleExtractionIdentityPerSourceForRun('run-1', runOne);
  assertSingleExtractionIdentityPerSourceForRun('run-2', runTwo);
  expectConflict([...runOne, ...runTwo], 'RUN_SCOPE_MISMATCH');
});

test('the run scope check fires before the identity comparison', () => {
  // Un binding de otro run no debe poder "sembrar" la identidad esperada.
  expectConflict(
    [pdfBinding({ run: 'run-2', parserProfile: 'PYPDF' }), pdfBinding({ run: 'run-1' })],
    'RUN_SCOPE_MISMATCH'
  );
});

test('conflict errors carry domain identifiers and no content', () => {
  try {
    assertSingleExtractionIdentityPerSourceForRun('run-1', [
      pdfBinding({ sha: SHA_A, parserProfile: 'PDFPLUMBER' }),
      pdfBinding({ sha: SHA_A, parserProfile: 'PYPDF', sourceId: 'ars-2' })
    ]);
    throw new assert.AssertionError({ message: 'se esperaba un conflicto' });
  } catch (error) {
    assert.ok(error instanceof SourceExtractionTrustError);
    assert.equal(error.detail.analysisRunId, 'run-1');
    assert.equal(error.detail.analysisRunSourceId, 'ars-2');
    assert.equal(error.detail.sourceType, 'PDF_DOCUMENT');
  }
});

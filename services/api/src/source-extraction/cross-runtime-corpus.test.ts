/**
 * Compatibilidad cross-runtime contra el productor REAL.
 *
 * Cadena probatoria::
 *
 *     productor Python F0.2/F0.3
 *       -> artifact congelado en disco
 *         -> verificador TypeScript lo acepta de forma independiente
 *
 * y NO::
 *
 *     verificador TypeScript -> le pregunta a Python cual es la respuesta
 *
 * Estos tests no invocan Python, no llaman a FastAPI y no regeneran nada: leen
 * JSON estatico. Los casos negativos se construyen mutando copias de esos
 * artifacts, tambien sin volver a consultar al productor.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

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

function expectRejection(input: unknown): SourceExtractionVerificationError {
  try {
    verifySourceExtractionArtifact(input);
  } catch (error) {
    assert.ok(error instanceof SourceExtractionVerificationError, String(error));
    return error;
  }
  throw new assert.AssertionError({ message: 'se esperaba un rechazo' });
}

// ---------------------------------------------------------------------------
// El corpus
// ---------------------------------------------------------------------------

test('the producer corpus covers the required cases', () => {
  assert.equal(MANIFEST.fixture, 'F0_PRODUCER_CROSS_RUNTIME_CORPUS');
  assert.equal(MANIFEST.schemaVersion, 'source_extraction_v1');

  const names = new Set(MANIFEST.cases.map((entry) => entry.name));
  for (const required of [
    'pdf-full-multipage',
    'pdf-partial-scanned-page',
    'pdf-failed-fully-scanned',
    'pdf-astral-unicode',
    'pdf-pypdf-fallback',
    'text-simple',
    'text-multiple-paragraphs',
    'text-astral-unicode',
    'text-empty-contractual'
  ]) {
    assert.ok(names.has(required), `falta el caso ${required} en el corpus del productor`);
  }
});

for (const entry of MANIFEST.cases) {
  test(`TypeScript accepts the real producer output: ${entry.name}`, () => {
    const artifact = verifySourceExtractionArtifact(loadProducerArtifact(entry.name));

    assert.equal(artifact.sourceType, entry.sourceType);
    assert.equal(artifact.coverageStatus, entry.coverageStatus);
    assert.equal(artifact.source.sourceSha256, entry.sourceSha256);
    assert.equal(artifact.pages.length, entry.pageCount);
    assert.equal(artifact.segments.length, entry.segmentCount);
    assert.deepEqual(
      artifact.diagnostics.map((diagnostic) => diagnostic.code),
      entry.diagnosticCodes
    );

    // El fingerprint lo RECALCULA el verificador; que coincida con el que
    // registro el productor es la prueba cross-runtime.
    assert.equal(artifact.artifactContentFingerprint, entry.artifactContentFingerprint);
  });
}

test('both parser profiles appear in the corpus and give different identities', () => {
  const pdfplumber = MANIFEST.cases.find((entry) => entry.name === 'pdf-full-multipage');
  const pypdf = MANIFEST.cases.find((entry) => entry.name === 'pdf-pypdf-fallback');
  assert.ok(pdfplumber && pypdf);
  assert.equal(pdfplumber.extractionIdentity.parserProfile, 'PDFPLUMBER');
  assert.equal(pypdf.extractionIdentity.parserProfile, 'PYPDF');
  assert.notEqual(pdfplumber.artifactContentFingerprint, pypdf.artifactContentFingerprint);
});

// ---------------------------------------------------------------------------
// Casos negativos por mutacion
// ---------------------------------------------------------------------------

test('tampered fingerprint on a real artifact is rejected', () => {
  const artifact = cloneArtifact(loadProducerArtifact('pdf-full-multipage')) as Record<string, any>;
  artifact.artifactContentFingerprint = 'f'.repeat(64);
  assert.equal(expectRejection(artifact).code, 'FINGERPRINT_MISMATCH');
});

test('tampered exactExcerpt on a real artifact is rejected', () => {
  const artifact = cloneArtifact(loadProducerArtifact('pdf-full-multipage')) as Record<string, any>;
  artifact.segments[0].exactExcerpt = `${artifact.segments[0].exactExcerpt}X`;
  assert.equal(expectRejection(artifact).code, 'ALIGNMENT_MISMATCH');
});

test('tampered address on a real artifact is rejected', () => {
  const artifact = cloneArtifact(loadProducerArtifact('text-multiple-paragraphs')) as Record<string, any>;
  artifact.segments[0].charEnd += 1;
  // El id deriva de la direccion, asi que mover el span lo invalida primero.
  assert.equal(expectRejection(artifact).code, 'ADDRESS_INVALID');
});

test('a moved span with a consistently rewritten id still fails on alignment', () => {
  const artifact = cloneArtifact(loadProducerArtifact('text-multiple-paragraphs')) as Record<string, any>;
  const segment = artifact.segments[0];
  segment.charEnd -= 1;
  segment.segmentId = `d:${segment.charStart}-${segment.charEnd}`;
  assert.equal(expectRejection(artifact).code, 'ALIGNMENT_MISMATCH');
});

test('reordered diagnostics are rejected even after recomputing the fingerprint', () => {
  // El escenario que motiva verificar el orden: un artifact puede reordenar,
  // recalcular su propio fingerprint y quedar internamente consistente — pero
  // ya no representa la forma canonica producida bajo esa extractionIdentity.
  const artifact = cloneArtifact(loadProducerArtifact('pdf-failed-fully-scanned')) as Record<string, any>;
  assert.ok(artifact.diagnostics.length >= 3);

  const [first, ...rest] = artifact.diagnostics;
  artifact.diagnostics = [...rest, first];

  const error = expectRejection(artifact);
  assert.equal(error.code, 'DIAGNOSTIC_INCONSISTENT');
  assert.equal(error.detail.invariant, 'page_diagnostics_must_precede_source_diagnostics');
});

test('page diagnostics out of ascending page order are rejected', () => {
  const artifact = cloneArtifact(loadProducerArtifact('pdf-failed-fully-scanned')) as Record<string, any>;
  const pageScoped = artifact.diagnostics.filter((entry: any) => entry.scope === 'PAGE');
  assert.ok(pageScoped.length >= 2);

  const sourceScoped = artifact.diagnostics.filter((entry: any) => entry.scope === 'SOURCE');
  artifact.diagnostics = [...pageScoped.reverse(), ...sourceScoped];

  const error = expectRejection(artifact);
  assert.equal(error.code, 'DIAGNOSTIC_INCONSISTENT');
  assert.equal(error.detail.invariant, 'page_diagnostics_must_ascend_by_page_index');
});

test('an artifact whose pages were reordered is rejected', () => {
  const artifact = cloneArtifact(loadProducerArtifact('pdf-full-multipage')) as Record<string, any>;
  artifact.pages.reverse();
  assert.equal(expectRejection(artifact).code, 'ADDRESS_INVALID');
});

// ---------------------------------------------------------------------------
// Snapshot verificado: desacoplado e inmutable
// ---------------------------------------------------------------------------

test('verification does not mutate the untrusted input', () => {
  const input = loadProducerArtifact('pdf-full-multipage');
  const before = JSON.stringify(input);
  verifySourceExtractionArtifact(input);
  assert.equal(JSON.stringify(input), before, 'el validador no puede tocar el input');
});

test('mutating the input AFTER verification does not change the verified artifact', () => {
  // El escenario que esto evita:
  //   verificar A -> el llamador muta A -> F0.5 persiste A' sin verificar
  const input = loadProducerArtifact('pdf-full-multipage') as Record<string, any>;
  const verified = verifySourceExtractionArtifact(input);

  const originalFingerprint = verified.artifactContentFingerprint;
  const originalExcerpt = verified.segments[0].exactExcerpt;
  const originalPageText = verified.pages[0].canonicalText;

  input.artifactContentFingerprint = '0'.repeat(64);
  input.segments[0].exactExcerpt = 'CONTENIDO INYECTADO';
  input.pages[0].canonicalText = 'CONTENIDO INYECTADO';
  input.segments.push({ segmentId: 'd:0-1', pageIndex: null, charStart: 0, charEnd: 1, exactExcerpt: 'x' });

  assert.equal(verified.artifactContentFingerprint, originalFingerprint);
  assert.equal(verified.segments[0].exactExcerpt, originalExcerpt);
  assert.equal(verified.pages[0].canonicalText, originalPageText);
  assert.equal(verified.segments.length, MANIFEST.cases.find((c) => c.name === 'pdf-full-multipage')!.segmentCount);
});

test('the verified artifact is deeply frozen', () => {
  const verified = verifySourceExtractionArtifact(loadProducerArtifact('pdf-full-multipage'));

  assert.ok(Object.isFrozen(verified));
  assert.ok(Object.isFrozen(verified.pages));
  assert.ok(Object.isFrozen(verified.pages[0]));
  assert.ok(Object.isFrozen(verified.segments));
  assert.ok(Object.isFrozen(verified.segments[0]));
  assert.ok(Object.isFrozen(verified.diagnostics));
  assert.ok(Object.isFrozen(verified.source));
  assert.ok(Object.isFrozen(verified.extractionIdentity));
});

test('mutating the verified artifact is ineffective', () => {
  const verified = verifySourceExtractionArtifact(loadProducerArtifact('text-simple'));
  const fingerprint = verified.artifactContentFingerprint;

  // Sin 'use strict' esto seria un no-op silencioso; en modulos TS es un throw.
  assert.throws(() => {
    (verified as Record<string, any>).artifactContentFingerprint = '0'.repeat(64);
  }, TypeError);
  assert.equal(verified.artifactContentFingerprint, fingerprint);

  assert.throws(() => {
    (verified.segments as unknown[]).push({});
  }, TypeError);
});

// ---------------------------------------------------------------------------
// Orden canonico de segmentos — contrato CONGELADO
// ---------------------------------------------------------------------------

/**
 * Reordena dos segmentos y recalcula el fingerprint correctamente.
 *
 * El punto de estos casos es que la verificacion de fingerprint PASE: si el
 * artifact permutado llevara un fingerprint viejo, el rechazo seria por
 * FINGERPRINT_MISMATCH y no probaria nada sobre el orden. El fingerprint se
 * recalcula con el productor TypeScript, nunca consultando a Python.
 */
function permuteFirstTwoSegmentsAndReseal(name: string): Record<string, any> {
  const artifact = cloneArtifact(loadProducerArtifact(name)) as Record<string, any>;
  assert.ok(artifact.segments.length >= 2, `${name} necesita al menos dos segmentos`);

  [artifact.segments[0], artifact.segments[1]] = [artifact.segments[1], artifact.segments[0]];

  artifact.artifactContentFingerprint = computeArtifactFingerprint(
    validateSourceExtractionArtifactShape({
      ...artifact,
      artifactContentFingerprint: '0'.repeat(64)
    })
  );
  return artifact;
}

test('every producer artifact satisfies the frozen canonical segment order', () => {
  for (const entry of MANIFEST.cases) {
    const artifact = verifySourceExtractionArtifact(loadProducerArtifact(entry.name));
    const isText = artifact.sourceType === 'TEXT';

    for (let index = 1; index < artifact.segments.length; index += 1) {
      const previous = artifact.segments[index - 1];
      const current = artifact.segments[index];

      const previousKey = isText
        ? [previous.charStart, previous.charEnd]
        : [previous.pageIndex as number, previous.charStart, previous.charEnd];
      const currentKey = isText
        ? [current.charStart, current.charEnd]
        : [current.pageIndex as number, current.charStart, current.charEnd];

      let ordered = false;
      for (let position = 0; position < previousKey.length; position += 1) {
        if (previousKey[position] !== currentKey[position]) {
          ordered = previousKey[position] < currentKey[position];
          break;
        }
      }
      assert.ok(ordered, `${entry.name}: segmentos fuera del orden canonico en ${index}`);
    }
  }
});

test('PDF: reordered segments WITH a correctly recomputed fingerprint are rejected', () => {
  const artifact = permuteFirstTwoSegmentsAndReseal('pdf-full-multipage');

  // El fingerprint es correcto: el rechazo no puede ser por FINGERPRINT_MISMATCH.
  assert.equal(
    artifact.artifactContentFingerprint,
    computeArtifactFingerprint(
      validateSourceExtractionArtifactShape({
        ...artifact,
        artifactContentFingerprint: '0'.repeat(64)
      })
    )
  );

  const error = expectRejection(artifact);
  assert.equal(error.code, 'ADDRESS_INVALID');
  assert.equal(error.detail.invariant, 'SEGMENT_ORDER_NON_CANONICAL');
});

test('TEXT: reordered segments WITH a correctly recomputed fingerprint are rejected', () => {
  const artifact = permuteFirstTwoSegmentsAndReseal('text-multiple-paragraphs');

  const error = expectRejection(artifact);
  assert.equal(error.code, 'ADDRESS_INVALID');
  assert.equal(error.detail.invariant, 'SEGMENT_ORDER_NON_CANONICAL');
});

test('a fully reversed segment array is rejected on both source types', () => {
  for (const name of ['pdf-full-multipage', 'text-repeated-blocks']) {
    const artifact = cloneArtifact(loadProducerArtifact(name)) as Record<string, any>;
    artifact.segments.reverse();
    artifact.artifactContentFingerprint = computeArtifactFingerprint(
      validateSourceExtractionArtifactShape({
        ...artifact,
        artifactContentFingerprint: '0'.repeat(64)
      })
    );
    const error = expectRejection(artifact);
    assert.equal(error.detail.invariant, 'SEGMENT_ORDER_NON_CANONICAL', name);
  }
});

test('the verifier reports the offending segment position without leaking content', () => {
  const artifact = permuteFirstTwoSegmentsAndReseal('text-multiple-paragraphs');
  const error = expectRejection(artifact);

  assert.equal(error.detail.path, 'artifact.segments[1]');
  assert.ok(error.detail.segmentId);

  const serialized = `${error.message} ${JSON.stringify(error.detail)}`;
  const original = verifySourceExtractionArtifact(
    loadProducerArtifact('text-multiple-paragraphs')
  );
  for (const segment of original.segments) {
    assert.ok(
      !serialized.includes(segment.exactExcerpt),
      'el error no debe incluir el excerpt'
    );
  }
});

test('the verifier rejects a non-canonical order instead of sorting it', () => {
  // Ordenar el input convertiria en silencio una representacion no canonica en
  // una canonica, que es exactamente lo que este invariante existe para impedir.
  const artifact = permuteFirstTwoSegmentsAndReseal('pdf-full-multipage');
  const beforeIds = artifact.segments.map((segment: any) => segment.segmentId);

  expectRejection(artifact);

  assert.deepEqual(
    artifact.segments.map((segment: any) => segment.segmentId),
    beforeIds,
    'el verificador no debe tocar el input, ni siquiera para ordenarlo'
  );
});

// ---------------------------------------------------------------------------
// Independencia
// ---------------------------------------------------------------------------

test('no module in this slice imports Python, a process spawner or a network client', () => {
  // Se inspeccionan las sentencias `import`/`require` de TODOS los archivos del
  // slice, no el texto plano de este archivo: un chequeo por substring se
  // auto-detectaria con su propia lista de prohibidos — el mismo defecto que
  // arrastra el test por substring de F0.1.
  const allowed = new Set(['node:assert/strict', 'node:crypto', 'node:fs', 'node:path', 'node:test']);
  const files = readdirSync(__dirname)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(__dirname, name))
    .concat(join(__dirname, '__fixtures__', 'source-extraction.fixtures.ts'));

  assert.ok(files.length >= 8);

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const specifiers = [
      ...source.matchAll(/(?:from|require\()\s*['"]([^'"]+)['"]/g)
    ].map((match) => match[1]);

    for (const specifier of specifiers) {
      const isRelative = specifier.startsWith('.');
      const isAllowedBuiltin = allowed.has(specifier);
      const isNestCommon = specifier === '@nestjs/common';
      assert.ok(
        isRelative || isAllowedBuiltin || isNestCommon,
        `${file} importa ${specifier}, fuera del conjunto permitido`
      );
    }
  }
});

/**
 * Trust gate de F0.5 — binding con la fuente autoritativa.
 *
 * Los artifacts son los del corpus real de F0.2/F0.3 y los bytes/contenido
 * autoritativos son las source fixtures reales. Prisma y el storage port se
 * falsean con objetos a mano, siguiendo la convención de
 * `analysis-run-execution.service.test.ts`.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { SourceExtractionTrustGateService } from './source-extraction-trust-gate.service';
import { SourceExtractionTrustError } from './source-extraction-trust.errors';
import { SourceExtractionVerificationError } from './source-extraction-verification.errors';
import {
  cloneArtifact,
  loadProducerArtifact,
  loadSourceBytes
} from './__fixtures__/source-extraction.fixtures';

const PDF_FIXTURE = 'normal-multipage.pdf';
const PDF_BYTES = loadSourceBytes(PDF_FIXTURE);
const PDF_SHA = createHash('sha256').update(PDF_BYTES).digest('hex');

function shaOfText(content: string): string {
  return createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');
}

type SourceRow = Record<string, any> | null;

function setup(options: {
  row?: SourceRow;
  bytes?: Buffer;
  readError?: Error;
} = {}) {
  const reads: string[] = [];
  const prisma = {
    analysisRunSource: {
      async findUnique(_args: any) {
        return options.row === undefined ? null : options.row;
      }
    }
  } as any;
  const storage = {
    async saveDocument() {
      throw new Error('no usado');
    },
    async readDocument(storageKey: string) {
      reads.push(storageKey);
      if (options.readError) {
        throw options.readError;
      }
      return options.bytes ?? PDF_BYTES;
    },
    async deleteDocument() {
      throw new Error('no usado');
    }
  } as any;

  return {
    reads,
    service: new SourceExtractionTrustGateService(prisma, storage)
  };
}

/** Fila autoritativa de PDF coherente con el artifact del corpus. */
function pdfRow(overrides: Record<string, any> = {}): Record<string, any> {
  const artifact = loadProducerArtifact('pdf-full-multipage') as Record<string, any>;
  return {
    id: 'ars-pdf-1',
    analysisRunId: 'run-1',
    sourceType: 'document_evidence',
    documentEvidenceId: artifact.source.documentEvidenceId,
    textEvidenceId: null,
    sourceSha256: PDF_SHA,
    documentEvidence: {
      id: artifact.source.documentEvidenceId,
      sha256: PDF_SHA,
      storageKey: artifact.source.storageKey
    },
    textEvidence: null,
    ...overrides
  };
}

/** Fila autoritativa de TEXT coherente con el artifact del corpus. */
function textRow(
  name = 'text-multiple-paragraphs',
  overrides: Record<string, any> = {}
): Record<string, any> {
  const artifact = loadProducerArtifact(name) as Record<string, any>;
  const content = artifact.documentCanonicalText as string;
  return {
    id: 'ars-text-1',
    analysisRunId: 'run-1',
    sourceType: 'text_evidence',
    documentEvidenceId: null,
    textEvidenceId: artifact.source.textEvidenceId,
    sourceSha256: shaOfText(content),
    documentEvidence: null,
    textEvidence: {
      id: artifact.source.textEvidenceId,
      content,
      sha256: shaOfText(content)
    },
    ...overrides
  };
}

async function expectTrustRejection(
  promise: Promise<unknown>,
  code: string,
  invariant?: string
): Promise<SourceExtractionTrustError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(
      error instanceof SourceExtractionTrustError,
      `se esperaba SourceExtractionTrustError, llego ${String(error)}`
    );
    assert.equal(error.code, code);
    if (invariant !== undefined) {
      assert.equal(error.detail.invariant, invariant);
    }
    return error;
  }
  throw new assert.AssertionError({ message: `se esperaba ${code} y fue aceptado` });
}

// ---------------------------------------------------------------------------
// PDF — camino autoritativo
// ---------------------------------------------------------------------------

test('PDF: a valid artifact bound to the authoritative source is trusted', async () => {
  const { service, reads } = setup({ row: pdfRow() });
  const binding = await service.trustSourceExtractionForAnalysisRunSource({
    analysisRunSourceId: 'ars-pdf-1',
    artifact: loadProducerArtifact('pdf-full-multipage')
  });

  assert.equal(binding.sourceType, 'PDF_DOCUMENT');
  assert.equal(binding.analysisRunId, 'run-1');
  assert.equal(binding.sourceSha256, PDF_SHA);
  assert.equal(binding.extractionDerivationTrust, 'PRODUCER_ASSUMED');
  assert.deepEqual(reads, ['documents/normal-multipage.pdf']);
});

test('PDF: the storage read uses the AUTHORITATIVE storageKey, never the artifact one', async () => {
  // Se hace que el artifact declare el mismo storageKey autoritativo (si no, se
  // rechazaria antes), y se comprueba de donde salio la lectura.
  const row = pdfRow();
  row.documentEvidence.storageKey = 'documents/normal-multipage.pdf';
  const { service, reads } = setup({ row });

  await service.trustSourceExtractionForAnalysisRunSource({
    analysisRunSourceId: 'ars-pdf-1',
    artifact: loadProducerArtifact('pdf-full-multipage')
  });

  assert.equal(reads.length, 1);
  assert.equal(reads[0], row.documentEvidence.storageKey);
});

test('PDF: an artifact with a different documentEvidenceId is rejected', async () => {
  const artifact = cloneArtifact(loadProducerArtifact('pdf-full-multipage')) as Record<string, any>;
  artifact.source.documentEvidenceId = 'doc-otro';
  const { service, reads } = setup({ row: pdfRow() });

  await expectTrustRejection(
    service.trustSourceExtractionForAnalysisRunSource({
      analysisRunSourceId: 'ars-pdf-1',
      artifact
    }),
    'SOURCE_ENTITY_MISMATCH'
  );
  assert.deepEqual(reads, [], 'no debe leerse la fuente si la identidad no coincide');
});

test('PDF: an artifact whose sha differs from the frozen run sha is rejected', async () => {
  const { service } = setup({ row: pdfRow({ sourceSha256: 'b'.repeat(64) }) });
  await expectTrustRejection(
    service.trustSourceExtractionForAnalysisRunSource({
      analysisRunSourceId: 'ars-pdf-1',
      artifact: loadProducerArtifact('pdf-full-multipage')
    }),
    'SOURCE_SHA_MISMATCH',
    'artifact_sha_does_not_match_frozen_run_sha'
  );
});

test('PDF: DocumentEvidence.sha256 disagreeing with the frozen run sha is rejected', async () => {
  const row = pdfRow();
  row.documentEvidence.sha256 = 'c'.repeat(64);
  const { service } = setup({ row });

  await expectTrustRejection(
    service.trustSourceExtractionForAnalysisRunSource({
      analysisRunSourceId: 'ars-pdf-1',
      artifact: loadProducerArtifact('pdf-full-multipage')
    }),
    'SOURCE_SHA_MISMATCH',
    'document_evidence_sha_does_not_match_frozen_run_sha'
  );
});

test('PDF: authoritative bytes that do not hash to the frozen sha are rejected', async () => {
  const { service } = setup({
    row: pdfRow(),
    bytes: Buffer.concat([PDF_BYTES, Buffer.from('X')])
  });

  await expectTrustRejection(
    service.trustSourceExtractionForAnalysisRunSource({
      analysisRunSourceId: 'ars-pdf-1',
      artifact: loadProducerArtifact('pdf-full-multipage')
    }),
    'SOURCE_SHA_MISMATCH',
    'authoritative_bytes_sha_does_not_match_frozen_run_sha'
  );
});

test('PDF: an artifact with a non-authoritative storageKey is rejected', async () => {
  const artifact = cloneArtifact(loadProducerArtifact('pdf-full-multipage')) as Record<string, any>;
  artifact.source.storageKey = 'documents/otro.pdf';
  const { service, reads } = setup({ row: pdfRow() });

  await expectTrustRejection(
    service.trustSourceExtractionForAnalysisRunSource({
      analysisRunSourceId: 'ars-pdf-1',
      artifact
    }),
    'SOURCE_STORAGE_MISMATCH'
  );
  assert.deepEqual(reads, [], 'nunca debe leerse el storageKey del artifact');
});

test('PDF: a storage read failure produces no binding', async () => {
  const { service } = setup({ row: pdfRow(), readError: new Error('storage caido') });
  await expectTrustRejection(
    service.trustSourceExtractionForAnalysisRunSource({
      analysisRunSourceId: 'ars-pdf-1',
      artifact: loadProducerArtifact('pdf-full-multipage')
    }),
    'SOURCE_READ_FAILED'
  );
});

test('PDF: a missing DocumentEvidence produces no binding', async () => {
  const { service } = setup({ row: pdfRow({ documentEvidence: null }) });
  await expectTrustRejection(
    service.trustSourceExtractionForAnalysisRunSource({
      analysisRunSourceId: 'ars-pdf-1',
      artifact: loadProducerArtifact('pdf-full-multipage')
    }),
    'SOURCE_ENTITY_NOT_FOUND'
  );
});

// ---------------------------------------------------------------------------
// Coverage NO decide el trust
// ---------------------------------------------------------------------------

for (const [name, sourceFile, coverage] of [
  ['pdf-full-multipage', 'normal-multipage.pdf', 'FULL'],
  ['pdf-partial-scanned-page', 'scanned-image-only-page.pdf', 'PARTIAL'],
  ['pdf-failed-fully-scanned', 'fully-scanned.pdf', 'FAILED'],
  ['pdf-failed-encrypted', 'encrypted.pdf', 'FAILED']
] as const) {
  test(`PDF: a ${coverage} artifact can still be authoritatively bound (${name})`, async () => {
    const artifact = loadProducerArtifact(name) as Record<string, any>;
    const bytes = loadSourceBytes(sourceFile);
    const sha = createHash('sha256').update(bytes).digest('hex');

    const { service } = setup({
      row: pdfRow({
        documentEvidenceId: artifact.source.documentEvidenceId,
        sourceSha256: sha,
        documentEvidence: {
          id: artifact.source.documentEvidenceId,
          sha256: sha,
          storageKey: artifact.source.storageKey
        }
      }),
      bytes
    });

    const binding = await service.trustSourceExtractionForAnalysisRunSource({
      analysisRunSourceId: 'ars-pdf-1',
      artifact
    });
    assert.equal(binding.artifact.coverageStatus, coverage);
  });
}

// ---------------------------------------------------------------------------
// TEXT — camino autoritativo
// ---------------------------------------------------------------------------

test('TEXT: a valid artifact bound to the authoritative content is trusted', async () => {
  const { service } = setup({ row: textRow() });
  const binding = await service.trustSourceExtractionForAnalysisRunSource({
    analysisRunSourceId: 'ars-text-1',
    artifact: loadProducerArtifact('text-multiple-paragraphs')
  });

  assert.equal(binding.sourceType, 'TEXT');
  assert.equal(binding.extractionDerivationTrust, 'AUTHORITATIVE_CONTENT_MATCHED');
});

test('TEXT: an artifact with a different textEvidenceId is rejected', async () => {
  const artifact = cloneArtifact(loadProducerArtifact('text-multiple-paragraphs')) as Record<string, any>;
  artifact.source.textEvidenceId = 'text-otro';
  const { service } = setup({ row: textRow() });

  await expectTrustRejection(
    service.trustSourceExtractionForAnalysisRunSource({
      analysisRunSourceId: 'ars-text-1',
      artifact
    }),
    'SOURCE_ENTITY_MISMATCH'
  );
});

test('TEXT: an artifact sha differing from the frozen run sha is rejected', async () => {
  const { service } = setup({ row: textRow('text-multiple-paragraphs', { sourceSha256: 'd'.repeat(64) }) });
  await expectTrustRejection(
    service.trustSourceExtractionForAnalysisRunSource({
      analysisRunSourceId: 'ars-text-1',
      artifact: loadProducerArtifact('text-multiple-paragraphs')
    }),
    'SOURCE_SHA_MISMATCH',
    'artifact_sha_does_not_match_frozen_run_sha'
  );
});

test('TEXT: TextEvidence.sha256 disagreeing with the frozen run sha is rejected', async () => {
  const row = textRow();
  row.textEvidence.sha256 = 'e'.repeat(64);
  const { service } = setup({ row });

  await expectTrustRejection(
    service.trustSourceExtractionForAnalysisRunSource({
      analysisRunSourceId: 'ars-text-1',
      artifact: loadProducerArtifact('text-multiple-paragraphs')
    }),
    'SOURCE_SHA_MISMATCH',
    'text_evidence_sha_does_not_match_frozen_run_sha'
  );
});

test('TEXT: stored content whose recomputed sha disagrees is rejected', async () => {
  // La fila declara un sha coherente en todos lados, pero el contenido real no
  // hashea a eso: exactamente el caso que la recomputacion existe para atrapar.
  const row = textRow();
  row.textEvidence.content = 'Contenido distinto del que declara el sha.';
  const { service } = setup({ row });

  await expectTrustRejection(
    service.trustSourceExtractionForAnalysisRunSource({
      analysisRunSourceId: 'ars-text-1',
      artifact: loadProducerArtifact('text-multiple-paragraphs')
    }),
    'SOURCE_SHA_MISMATCH',
    'recomputed_content_sha_does_not_match_frozen_run_sha'
  );
});

test('TEXT: stored content that is no longer a normalization fixed point is rejected', async () => {
  const content = `  ${(loadProducerArtifact('text-simple') as any).documentCanonicalText}  `;
  const sha = shaOfText(content);
  const artifact = cloneArtifact(loadProducerArtifact('text-simple')) as Record<string, any>;

  const { service } = setup({
    row: textRow('text-simple', {
      sourceSha256: sha,
      textEvidence: { id: artifact.source.textEvidenceId, content, sha256: sha }
    })
  });

  // El artifact declara el mismo sha para que el rechazo sea por normalizacion.
  artifact.source.sourceSha256 = sha;
  artifact.artifactContentFingerprint = recomputeFingerprint(artifact);

  await expectTrustRejection(
    service.trustSourceExtractionForAnalysisRunSource({
      analysisRunSourceId: 'ars-text-1',
      artifact
    }),
    'TEXT_NORMALIZATION_DRIFT'
  );
});

test('TEXT: an internally valid artifact with fabricated canonicalText is REJECTED', async () => {
  // El binding fuerte que sólo TEXT permite. El artifact es impecable para F0.4
  // y declara el sha correcto, pero su texto canónico no es el contenido
  // autoritativo — y acá eso sí se puede comprobar.
  const authoritative = loadProducerArtifact('text-multiple-paragraphs') as Record<string, any>;
  const fabricated = cloneArtifact(loadProducerArtifact('text-simple')) as Record<string, any>;

  fabricated.source.textEvidenceId = authoritative.source.textEvidenceId;
  fabricated.source.sourceSha256 = authoritative.source.sourceSha256;
  fabricated.artifactContentFingerprint = recomputeFingerprint(fabricated);

  const { service } = setup({ row: textRow() });
  await expectTrustRejection(
    service.trustSourceExtractionForAnalysisRunSource({
      analysisRunSourceId: 'ars-text-1',
      artifact: fabricated
    }),
    'TEXT_CANONICAL_TEXT_MISMATCH'
  );
});

test('TEXT: the empty contractual source binds when every authority invariant holds', async () => {
  // Fixture de autoridad a nivel unitario: NO se inserta en base una entidad que
  // el validador productivo prohíbe (`normalizeContent` rechaza el vacío) sólo
  // para hacer pasar el test. El contrato F0 sí permite representar el caso.
  const artifact = loadProducerArtifact('text-empty-contractual') as Record<string, any>;
  const content = artifact.documentCanonicalText as string;
  assert.equal(content, '');

  const { service } = setup({
    row: textRow('text-empty-contractual', {
      sourceSha256: shaOfText(content),
      textEvidence: {
        id: artifact.source.textEvidenceId,
        content,
        sha256: shaOfText(content)
      }
    })
  });

  const binding = await service.trustSourceExtractionForAnalysisRunSource({
    analysisRunSourceId: 'ars-text-1',
    artifact
  });
  assert.equal(binding.artifact.coverageStatus, 'FULL');
  assert.equal(binding.extractionDerivationTrust, 'AUTHORITATIVE_CONTENT_MATCHED');
});

// ---------------------------------------------------------------------------
// Autoridad primero
// ---------------------------------------------------------------------------

test('an F0.4-invalid artifact is rejected BEFORE any source authority is touched', async () => {
  const artifact = cloneArtifact(loadProducerArtifact('pdf-full-multipage')) as Record<string, any>;
  artifact.artifactContentFingerprint = '0'.repeat(64);
  const { service, reads } = setup({ row: pdfRow() });

  await assert.rejects(
    service.trustSourceExtractionForAnalysisRunSource({
      analysisRunSourceId: 'ars-pdf-1',
      artifact
    }),
    (error: unknown) => {
      assert.ok(error instanceof SourceExtractionVerificationError);
      assert.equal(error.code, 'FINGERPRINT_MISMATCH');
      return true;
    }
  );
  assert.deepEqual(reads, []);
});

test('a missing AnalysisRunSource produces no binding', async () => {
  const { service } = setup({ row: null });
  await expectTrustRejection(
    service.trustSourceExtractionForAnalysisRunSource({
      analysisRunSourceId: 'no-existe',
      artifact: loadProducerArtifact('pdf-full-multipage')
    }),
    'ANALYSIS_RUN_SOURCE_NOT_FOUND'
  );
});

test('an AnalysisRunSource violating the document/text XOR is rejected', async () => {
  const { service } = setup({
    row: pdfRow({ textEvidenceId: 'text-1', textEvidence: { id: 'text-1', content: '', sha256: PDF_SHA } })
  });
  await expectTrustRejection(
    service.trustSourceExtractionForAnalysisRunSource({
      analysisRunSourceId: 'ars-pdf-1',
      artifact: loadProducerArtifact('pdf-full-multipage')
    }),
    'ANALYSIS_RUN_SOURCE_INVALID',
    'analysis_run_source_must_reference_exactly_one_entity'
  );
});

test('an AnalysisRunSource with neither reference is rejected', async () => {
  const { service } = setup({ row: pdfRow({ documentEvidenceId: null, documentEvidence: null }) });
  await expectTrustRejection(
    service.trustSourceExtractionForAnalysisRunSource({
      analysisRunSourceId: 'ars-pdf-1',
      artifact: loadProducerArtifact('pdf-full-multipage')
    }),
    'ANALYSIS_RUN_SOURCE_INVALID'
  );
});

test('the source type is decided by the AUTHORITY, not by the artifact', async () => {
  // Autoridad dice documento; el artifact dice TEXT.
  const { service, reads } = setup({ row: pdfRow() });
  await expectTrustRejection(
    service.trustSourceExtractionForAnalysisRunSource({
      analysisRunSourceId: 'ars-pdf-1',
      artifact: loadProducerArtifact('text-simple')
    }),
    'SOURCE_TYPE_MISMATCH',
    'authority_declares_document_evidence_but_artifact_is_text'
  );
  assert.deepEqual(reads, []);

  // Y al reves.
  const text = setup({ row: textRow() });
  await expectTrustRejection(
    text.service.trustSourceExtractionForAnalysisRunSource({
      analysisRunSourceId: 'ars-text-1',
      artifact: loadProducerArtifact('pdf-full-multipage')
    }),
    'SOURCE_TYPE_MISMATCH',
    'authority_declares_text_evidence_but_artifact_is_document'
  );
});

// ---------------------------------------------------------------------------
// Snapshot y privacidad
// ---------------------------------------------------------------------------

test('the binding is detached and runtime immutable', async () => {
  const { service } = setup({ row: textRow() });
  const binding = await service.trustSourceExtractionForAnalysisRunSource({
    analysisRunSourceId: 'ars-text-1',
    artifact: loadProducerArtifact('text-multiple-paragraphs')
  });

  assert.ok(Object.isFrozen(binding));
  assert.ok(Object.isFrozen(binding.artifact));
  assert.throws(() => {
    (binding as Record<string, any>).sourceSha256 = 'x'.repeat(64);
  }, TypeError);
});

test('the binding carries no source bytes and no duplicated content', async () => {
  const { service } = setup({ row: textRow() });
  const binding = await service.trustSourceExtractionForAnalysisRunSource({
    analysisRunSourceId: 'ars-text-1',
    artifact: loadProducerArtifact('text-multiple-paragraphs')
  });

  assert.deepEqual(Object.keys(binding).sort(), [
    'analysisRunId',
    'analysisRunSourceId',
    'artifact',
    'extractionDerivationTrust',
    'extractionIdentity',
    'sourceEntityId',
    'sourceSha256',
    'sourceType'
  ]);
});

test('trust errors never leak source content', async () => {
  const secret = 'Informe medico confidencial del titular.';
  const row = textRow();
  row.textEvidence.content = secret;
  const { service } = setup({ row });

  const error = await expectTrustRejection(
    service.trustSourceExtractionForAnalysisRunSource({
      analysisRunSourceId: 'ars-text-1',
      artifact: loadProducerArtifact('text-multiple-paragraphs')
    }),
    'SOURCE_SHA_MISMATCH'
  );
  const serialized = `${error.message} ${JSON.stringify(error.detail)}`;
  for (const word of secret.split(' ')) {
    assert.ok(!serialized.includes(word), `el error filtro ${word}`);
  }
});

// ---------------------------------------------------------------------------
// Límite explícito: PDF queda source-bound, no derivation-proven
// ---------------------------------------------------------------------------

test('LIMITATION: a fabricated but F0.4-valid PDF representation still binds', async () => {
  /**
   * Demostración controlada del límite de F0.5, no un defecto a corregir acá.
   *
   * Se toma la fuente PDF autoritativa real, con su SHA correcto, y se sustituye
   * el texto canónico por uno fabricado — manteniendo el artifact internamente
   * válido y con el fingerprint recalculado. El gate lo ACEPTA, porque NestJS no
   * reejecuta pdfplumber/pypdf y por lo tanto no puede refutar la derivación.
   *
   *     SOURCE_BOUND_BUT_DERIVATION_NOT_INDEPENDENTLY_PROVEN
   *
   * El contraste con TEXT es lo que hace visible el límite: allí el contenido
   * autoritativo ES el texto canónico, y el mismo ataque se rechaza con
   * TEXT_CANONICAL_TEXT_MISMATCH (ver el test correspondiente).
   *
   * Cerrarlo requiere procedencia del productor, que F0.5 no tiene todavía:
   *
   *     PDF_PRODUCER_PROVENANCE_ENFORCED_IN_F0_5:  NO
   */
  const artifact = cloneArtifact(loadProducerArtifact('pdf-full-multipage')) as Record<string, any>;
  const fabricated = 'Texto inventado que jamas estuvo en el PDF.';

  artifact.pages = [
    {
      pageIndex: 0,
      pageNumber: 1,
      canonicalText: fabricated,
      pageOffsetStart: 0,
      pageOffsetEnd: Array.from(fabricated).length,
      pageObservationStatus: 'EXTRACTED'
    }
  ];
  artifact.documentCanonicalText = fabricated;
  artifact.segments = [
    {
      segmentId: `p0:0-${Array.from(fabricated).length}`,
      pageIndex: 0,
      charStart: 0,
      charEnd: Array.from(fabricated).length,
      exactExcerpt: fabricated
    }
  ];
  artifact.diagnostics = [];
  artifact.artifactContentFingerprint = recomputeFingerprint(artifact);

  const { service } = setup({ row: pdfRow() });
  const binding = await service.trustSourceExtractionForAnalysisRunSource({
    analysisRunSourceId: 'ars-pdf-1',
    artifact
  });

  assert.equal(binding.sourceType, 'PDF_DOCUMENT');
  assert.equal(
    binding.extractionDerivationTrust,
    'PRODUCER_ASSUMED',
    'el binding debe declarar que la derivacion es asumida, no demostrada'
  );
  assert.equal(binding.artifact.documentCanonicalText, fabricated);
});

// ---------------------------------------------------------------------------

function recomputeFingerprint(artifact: Record<string, any>): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { computeArtifactFingerprint } = require('./source-extraction-artifact.invariants');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { validateSourceExtractionArtifactShape } = require('./source-extraction-artifact.validator');
  return computeArtifactFingerprint(
    validateSourceExtractionArtifactShape({
      ...artifact,
      artifactContentFingerprint: '0'.repeat(64)
    })
  );
}

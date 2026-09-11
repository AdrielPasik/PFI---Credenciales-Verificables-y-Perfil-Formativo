/**
 * Orquestacion de extraccion de fuente — F1.4.
 *
 * DECISION DE TEST: el trust gate de F0.5 y el repositorio de F1.2 son los
 * SERVICIOS REALES, no dobles. Falsear F0.5 haria que "F0.5 corre antes de
 * persistir" fuese una afirmacion sobre el mock y no sobre la cadena. Solo se
 * falsean los bordes de infraestructura —Prisma, el storage port y el cliente
 * HTTP—, que es donde ya estan las convenciones del repo.
 *
 * Los artifacts salen del corpus real de F0.2/F0.3 y los bytes de las source
 * fixtures reales. Nunca se invoca Python ni se regenera nada.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { AiServiceClient } from '../ai/ai-service.client';
import { AiServiceClientError } from '../ai/ai-service.types';
import { DocumentStorageError } from '../document-evidence/document-storage.error';
import { canonicalJson } from './canonical-json';
import { verifySourceExtractionArtifact } from './source-extraction-artifact.verifier';
import { SourceExtractionOrchestrationError } from './source-extraction-orchestration.errors';
import { SourceExtractionOrchestrationService } from './source-extraction-orchestration.service';
import { SourceExtractionSlotError } from './source-extraction-slot.errors';
import { SourceExtractionSlotService } from './source-extraction-slot.service';
import { SourceExtractionTrustGateService } from './source-extraction-trust-gate.service';
import { SourceExtractionTrustError } from './source-extraction-trust.errors';
import {
  cloneArtifact,
  loadProducerArtifact,
  loadSourceBytes
} from './__fixtures__/source-extraction.fixtures';

const SOURCE_ID = 'ars-1';
const RUN_ID = 'run-1';
const CREDENTIAL_ID = 'cred-1';

const ABSENT_SLOT = {
  extractionArtifactCanonicalJson: null,
  artifactBlobSha256: null,
  extractionDerivationTrust: null
};

/** Fixture PDF de cada caso del corpus. */
const PDF_SOURCE_FIXTURE: Record<string, string> = {
  'pdf-full-multipage': 'normal-multipage.pdf',
  'pdf-partial-blank-page': 'blank-page.pdf',
  'pdf-partial-scanned-page': 'scanned-image-only-page.pdf',
  'pdf-failed-fully-scanned': 'fully-scanned.pdf',
  'pdf-failed-encrypted': 'encrypted.pdf',
  'pdf-astral-unicode': 'astral-unicode.pdf'
};

const shaOfBytes = (bytes: Buffer): string =>
  createHash('sha256').update(bytes).digest('hex');

const shaOfText = (content: string): string =>
  createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');

// ---------------------------------------------------------------------------
// Filas autoritativas
// ---------------------------------------------------------------------------

/** Fila PDF coherente con un caso del corpus y su fixture de bytes real. */
function pdfRow(
  name = 'pdf-full-multipage',
  overrides: Record<string, any> = {}
): Record<string, any> {
  const artifact = loadProducerArtifact(name) as Record<string, any>;
  const sha = shaOfBytes(loadSourceBytes(PDF_SOURCE_FIXTURE[name]));
  const { documentEvidence, ...rest } = overrides;
  return {
    id: SOURCE_ID,
    analysisRunId: RUN_ID,
    sourceType: 'document_evidence',
    documentEvidenceId: artifact.source.documentEvidenceId,
    textEvidenceId: null,
    sourceSha256: sha,
    analysisRun: { credentialId: CREDENTIAL_ID },
    // `documentEvidence: null` en los overrides significa "la entidad ya no
    // existe". Hay que distinguirlo de "sin override": esparcir null sobre los
    // defaults los dejaria intactos y el caso negativo no probaria nada.
    documentEvidence:
      documentEvidence === null
        ? null
        : {
            id: artifact.source.documentEvidenceId,
            credentialId: CREDENTIAL_ID,
            kind: 'pdf',
            mimeType: 'application/pdf',
            sha256: sha,
            storageKey: artifact.source.storageKey,
            ...documentEvidence
          },
    textEvidence: null,
    ...ABSENT_SLOT,
    ...rest
  };
}

/** Fila TEXT coherente con un caso del corpus. */
function textRow(
  name = 'text-multiple-paragraphs',
  overrides: Record<string, any> = {}
): Record<string, any> {
  const artifact = loadProducerArtifact(name) as Record<string, any>;
  const content = artifact.documentCanonicalText as string;
  const { textEvidence, ...rest } = overrides;
  return {
    id: SOURCE_ID,
    analysisRunId: RUN_ID,
    sourceType: 'text_evidence',
    documentEvidenceId: null,
    textEvidenceId: artifact.source.textEvidenceId,
    sourceSha256: shaOfText(content),
    analysisRun: { credentialId: CREDENTIAL_ID },
    documentEvidence: null,
    textEvidence:
      textEvidence === null
        ? null
        : {
            id: artifact.source.textEvidenceId,
            credentialId: CREDENTIAL_ID,
            content,
            sha256: shaOfText(content),
            ...textEvidence
          },
    ...ABSENT_SLOT,
    ...rest
  };
}

/** Slot PRESENT coherente, construido desde un artifact del corpus. */
function presentSlot(name: string, overrides: Record<string, any> = {}) {
  const artifact = loadProducerArtifact(name) as Record<string, any>;
  const canonical = canonicalJson(verifySourceExtractionArtifact(artifact));
  return {
    extractionArtifactCanonicalJson: canonical,
    artifactBlobSha256: shaOfText(canonical),
    extractionDerivationTrust:
      artifact.sourceType === 'TEXT' ? 'AUTHORITATIVE_CONTENT_MATCHED' : 'PRODUCER_ASSUMED',
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Banco de pruebas
// ---------------------------------------------------------------------------

interface SetupOptions {
  row?: Record<string, any> | null;
  /** Fila devuelta DESPUES de un compare-and-set perdido: modela la carrera. */
  rowAfterFailedFill?: Record<string, any>;
  updateCount?: number;
  bytes?: Buffer;
  readError?: Error;
  /** Respuesta del productor. Puede ser cualquier `unknown`. */
  artifact?: unknown;
  producerError?: Error;
}

function setup(options: SetupOptions = {}) {
  const calls = {
    sourceFinds: 0,
    storageReads: [] as string[],
    pdfCalls: [] as any[],
    textCalls: [] as any[],
    updates: [] as any[],
    trustGate: 0,
    fills: 0,
    /** Cualquier intento de RESELECCIONAR la evidencia actual de la credencial. */
    evidenceLookups: [] as string[]
  };

  let updateAttempted = false;

  const prisma = {
    analysisRunSource: {
      async findUnique(_args: any) {
        calls.sourceFinds += 1;
        if (updateAttempted && options.rowAfterFailedFill) {
          return options.rowAfterFailedFill;
        }
        return options.row === undefined ? null : options.row;
      },
      async updateMany(args: any) {
        updateAttempted = true;
        calls.updates.push(args);
        return { count: options.updateCount ?? 1 };
      }
    },
    // Trampas: si la orquestacion volviese a buscar "la evidencia actual" en vez
    // de usar la relacion congelada, caeria aca y el test lo veria.
    documentEvidence: {
      async findFirst() {
        calls.evidenceLookups.push('documentEvidence.findFirst');
        return null;
      },
      async findMany() {
        calls.evidenceLookups.push('documentEvidence.findMany');
        return [];
      },
      async findUnique() {
        calls.evidenceLookups.push('documentEvidence.findUnique');
        return null;
      }
    },
    textEvidence: {
      async findFirst() {
        calls.evidenceLookups.push('textEvidence.findFirst');
        return null;
      },
      async findMany() {
        calls.evidenceLookups.push('textEvidence.findMany');
        return [];
      },
      async findUnique() {
        calls.evidenceLookups.push('textEvidence.findUnique');
        return null;
      }
    }
  } as any;

  const storage = {
    async saveDocument() {
      throw new Error('no usado');
    },
    async readDocument(storageKey: string) {
      calls.storageReads.push(storageKey);
      if (options.readError) throw options.readError;
      return options.bytes ?? Buffer.alloc(0);
    },
    async deleteDocument() {
      throw new Error('no usado');
    }
  } as any;

  const aiClient = {
    async extractPdfSource(input: any) {
      calls.pdfCalls.push(input);
      if (options.producerError) throw options.producerError;
      return options.artifact;
    },
    async extractTextSource(input: any) {
      calls.textCalls.push(input);
      if (options.producerError) throw options.producerError;
      return options.artifact;
    }
  } as unknown as AiServiceClient;

  const trustGate = new SourceExtractionTrustGateService(prisma, storage);
  const slots = new SourceExtractionSlotService(prisma);

  // Espias que DELEGAN en el servicio real: cuentan las llamadas sin sustituir
  // el comportamiento verificado.
  const realTrust = trustGate.trustSourceExtractionForAnalysisRunSource.bind(trustGate);
  (trustGate as any).trustSourceExtractionForAnalysisRunSource = (input: any) => {
    calls.trustGate += 1;
    return realTrust(input);
  };
  const realFill = slots.fillExtractionSlot.bind(slots);
  (slots as any).fillExtractionSlot = (binding: any) => {
    calls.fills += 1;
    return realFill(binding);
  };

  const service = new SourceExtractionOrchestrationService(
    prisma,
    aiClient,
    trustGate,
    slots,
    storage
  );

  return { calls, service };
}

/** Ni el productor, ni el gate, ni la persistencia llegaron a tocarse. */
function assertNoProducerNoWrite(calls: ReturnType<typeof setup>['calls']) {
  assert.equal(calls.pdfCalls.length, 0, 'el productor PDF no debe invocarse');
  assert.equal(calls.textCalls.length, 0, 'el productor TEXT no debe invocarse');
  assert.equal(calls.trustGate, 0, 'el trust gate no debe invocarse');
  assert.equal(calls.fills, 0, 'no debe intentarse llenar el slot');
  assert.equal(calls.updates.length, 0, 'no debe escribirse nada');
}

async function expectRejection<T extends Error>(
  promise: Promise<unknown>,
  type: new (...args: any[]) => T,
  code?: string,
  invariant?: string
): Promise<T> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof type, `tipo inesperado: ${String(error)}`);
    if (code !== undefined) assert.equal((error as any).code, code);
    if (invariant !== undefined) {
      assert.match((error as any).detail.invariant, new RegExp(invariant));
    }
    return error as T;
  }
  throw new assert.AssertionError({ message: `se esperaba ${type.name} y resolvio` });
}

// ---------------------------------------------------------------------------
// §3 — Superficie de la API
// ---------------------------------------------------------------------------

test('api: the public method takes the AnalysisRunSource id and nothing else', () => {
  // Un llamador NO puede decir "procesa esta fuente" y "pero usa este material":
  // la aridad hace que la segunda mitad no sea expresable.
  assert.equal(
    SourceExtractionOrchestrationService.prototype.ensureExtractionForAnalysisRunSource.length,
    1
  );
});

// ---------------------------------------------------------------------------
// §19 — Slot ya presente
// ---------------------------------------------------------------------------

test('existing slot: a valid PRESENT slot is returned with zero side effects', async () => {
  const { service, calls } = setup({
    row: { ...pdfRow(), ...presentSlot('pdf-full-multipage') }
  });

  const result = await service.ensureExtractionForAnalysisRunSource(SOURCE_ID);

  assert.equal(result.analysisRunSourceId, SOURCE_ID);
  assert.equal(result.extractionDerivationTrust, 'PRODUCER_ASSUMED');
  assert.equal(result.artifact.coverageStatus, 'FULL');

  assert.equal(calls.storageReads.length, 0, 'cero lecturas de storage');
  assertNoProducerNoWrite(calls);
});

test('existing slot: a retry within the SAME run never re-extracts', async () => {
  const { service, calls } = setup({
    row: { ...textRow(), ...presentSlot('text-multiple-paragraphs') }
  });

  const first = await service.ensureExtractionForAnalysisRunSource(SOURCE_ID);
  const second = await service.ensureExtractionForAnalysisRunSource(SOURCE_ID);

  assert.equal(first.artifactBlobSha256, second.artifactBlobSha256);
  // Reintento dentro del mismo run, NO reuso cross-run: la lectura esta indexada
  // por analysisRunSourceId, asi que otro run tiene su propia fila y su propia
  // extraccion. REUSE_SCOPE sigue siendo NONE_IN_V1.
  assertNoProducerNoWrite(calls);
});

test('existing slot: a corrupt PRESENT slot is rejected, never silently repaired', async () => {
  const corrupt = presentSlot('pdf-full-multipage', {
    artifactBlobSha256: 'f'.repeat(64)
  });
  const { service, calls } = setup({ row: { ...pdfRow(), ...corrupt } });

  await expectRejection(
    service.ensureExtractionForAnalysisRunSource(SOURCE_ID),
    SourceExtractionSlotError,
    'ARTIFACT_BLOB_SHA_MISMATCH'
  );

  // Re-extraer por encima convertiria una perdida de integridad DETECTADA en un
  // dato nuevo que la tapa.
  assert.equal(calls.storageReads.length, 0);
  assertNoProducerNoWrite(calls);
});

test('existing slot: a partially populated bundle is rejected, not treated as ABSENT', async () => {
  const { service, calls } = setup({
    row: {
      ...pdfRow(),
      extractionArtifactCanonicalJson: '{}',
      artifactBlobSha256: null,
      extractionDerivationTrust: null
    }
  });

  await expectRejection(
    service.ensureExtractionForAnalysisRunSource(SOURCE_ID),
    SourceExtractionSlotError,
    'EXTRACTION_SLOT_INCONSISTENT'
  );
  assertNoProducerNoWrite(calls);
});

test('existing slot: a missing AnalysisRunSource is an orchestration failure', async () => {
  const { service, calls } = setup({ row: null });

  await expectRejection(
    service.ensureExtractionForAnalysisRunSource('nope'),
    SourceExtractionOrchestrationError,
    'ANALYSIS_RUN_SOURCE_NOT_FOUND_FOR_EXTRACTION'
  );
  assertNoProducerNoWrite(calls);
});

// ---------------------------------------------------------------------------
// §20 — Camino causal PDF
// ---------------------------------------------------------------------------

test('pdf: the full causal chain runs from authority to persisted extraction', async () => {
  const artifact = loadProducerArtifact('pdf-full-multipage') as Record<string, any>;
  const bytes = loadSourceBytes('normal-multipage.pdf');
  const row = pdfRow();
  const { service, calls } = setup({ row, bytes, artifact });

  const persisted = await service.ensureExtractionForAnalysisRunSource(SOURCE_ID);

  // Se leyo por el storageKey AUTORITATIVO de la DocumentEvidence congelada.
  assert.equal(calls.storageReads[0], row.documentEvidence.storageKey);

  // Los bytes enviados son EXACTAMENTE los leidos.
  const [sent] = calls.pdfCalls;
  assert.equal(Buffer.compare(Buffer.from(sent.fileBytes), bytes), 0);
  assert.equal(sent.fileBytes.byteLength, bytes.byteLength);

  // Identidad autoritativa, nunca aportada por el llamador.
  assert.equal(sent.documentEvidenceId, row.documentEvidence.id);
  assert.equal(sent.sourceSha256, row.sourceSha256, 'viaja el sha CONGELADO por el run');
  assert.equal(sent.storageKey, row.documentEvidence.storageKey);
  assert.deepEqual(
    Object.keys(sent).sort(),
    ['documentEvidenceId', 'fileBytes', 'sourceSha256', 'storageKey'],
    'no se inventa metadata extra en el borde'
  );

  // La respuesta paso por F0.5 y solo despues por F1.2.
  assert.equal(calls.trustGate, 1);
  assert.equal(calls.fills, 1);
  assert.equal(calls.updates.length, 1);

  assert.equal(persisted.analysisRunSourceId, SOURCE_ID);
  assert.equal(persisted.artifact.coverageStatus, 'FULL');
  assert.equal(persisted.extractionDerivationTrust, 'PRODUCER_ASSUMED');
});

test('pdf: F0.5 re-reads the authoritative bytes, and that second read is deliberate', async () => {
  const artifact = loadProducerArtifact('pdf-full-multipage');
  const bytes = loadSourceBytes('normal-multipage.pdf');
  const row = pdfRow();
  const { service, calls } = setup({ row, bytes, artifact });

  await service.ensureExtractionForAnalysisRunSource(SOURCE_ID);

  // DOS lecturas: la del orquestador para transportar, y la de F0.5 para
  // verificar el binding. No se debilita F0.5 para ahorrar una lectura: la
  // independencia de la frontera vale mas que el I/O que cuesta.
  assert.deepEqual(calls.storageReads, [
    row.documentEvidence.storageKey,
    row.documentEvidence.storageKey
  ]);
});

for (const [name, coverage] of [
  ['pdf-full-multipage', 'FULL'],
  ['pdf-partial-blank-page', 'PARTIAL'],
  ['pdf-partial-scanned-page', 'PARTIAL'],
  ['pdf-failed-fully-scanned', 'FAILED'],
  ['pdf-failed-encrypted', 'FAILED']
] as const) {
  test(`pdf: coverage ${coverage} completes the orchestration (${name})`, async () => {
    const artifact = loadProducerArtifact(name);
    const bytes = loadSourceBytes(PDF_SOURCE_FIXTURE[name]);
    const { service, calls } = setup({ row: pdfRow(name), bytes, artifact });

    const persisted = await service.ensureExtractionForAnalysisRunSource(SOURCE_ID);

    // Coverage FAILED es un RESULTADO de observacion, no un fallo de
    // orquestacion: "identificamos la fuente y no pudimos leer su contenido" es
    // un hecho verdadero que Evidence Reasoning necesita para abstenerse con
    // honestidad, y por eso se persiste.
    assert.equal(persisted.artifact.coverageStatus, coverage);
    assert.equal(calls.updates.length, 1, 'se persistio');
  });
}

test('pdf: an artifact bound to a different source is rejected before any write', async () => {
  const bytes = loadSourceBytes('normal-multipage.pdf');
  const impostor = cloneArtifact(
    loadProducerArtifact('pdf-full-multipage') as Record<string, any>
  );
  impostor.source.documentEvidenceId = 'doc-de-otra-credencial';

  const { service, calls } = setup({ row: pdfRow(), bytes, artifact: impostor });

  await expectRejection(
    service.ensureExtractionForAnalysisRunSource(SOURCE_ID),
    SourceExtractionTrustError,
    'SOURCE_ENTITY_MISMATCH'
  );

  assert.equal(calls.trustGate, 1, 'el gate SI corrio');
  assert.equal(calls.fills, 0, 'fillExtractionSlot NUNCA se llamo');
  assert.equal(calls.updates.length, 0, 'el slot queda ABSENT');
});

test('pdf: a producer response of the wrong shape never reaches persistence', async () => {
  const bytes = loadSourceBytes('normal-multipage.pdf');
  const { service, calls } = setup({ row: pdfRow(), bytes, artifact: { unexpected: true } });

  // El cliente devuelve `unknown` y el orquestador no lo inspecciona ni lo
  // castea: quien lo rechaza es F0.4 desde dentro de F0.5.
  await assert.rejects(service.ensureExtractionForAnalysisRunSource(SOURCE_ID));
  assert.equal(calls.fills, 0);
  assert.equal(calls.updates.length, 0);
});

test('pdf: a storage read failure never reaches the producer', async () => {
  const { service, calls } = setup({
    row: pdfRow(),
    readError: new DocumentStorageError('not_found', 'no existe el objeto')
  });

  // Infraestructura ausente NO se convierte en un artifact FAILED fabricado: sin
  // material autoritativo no hay nada que observar, y eso es distinto de haber
  // observado y no haber podido leer.
  await assert.rejects(
    service.ensureExtractionForAnalysisRunSource(SOURCE_ID),
    DocumentStorageError
  );
  assert.equal(calls.storageReads.length, 1);
  assertNoProducerNoWrite(calls);
});

// ---------------------------------------------------------------------------
// §5B — document_evidence NO implica PDF
// ---------------------------------------------------------------------------

for (const [label, documentEvidence] of [
  ['image/png', { kind: 'image', mimeType: 'image/png' }],
  ['image/jpeg', { kind: 'image', mimeType: 'image/jpeg' }]
] as const) {
  test(`eligibility: an ${label} DocumentEvidence is rejected before the producer`, async () => {
    const { service, calls } = setup({ row: pdfRow('pdf-full-multipage', { documentEvidence }) });

    await expectRejection(
      service.ensureExtractionForAnalysisRunSource(SOURCE_ID),
      SourceExtractionOrchestrationError,
      'DOCUMENT_SOURCE_NOT_SUPPORTED_FOR_EXTRACTION',
      'document_kind_is_not_pdf'
    );

    // Una imagen conocida por el dominio NO se convierte en un PDF FAILED: eso
    // afirmaria "es un PDF y no pudimos leerlo", que es falso.
    assert.equal(calls.storageReads.length, 0, 'ni siquiera se leyeron los bytes');
    assertNoProducerNoWrite(calls);
  });
}

test('eligibility: kind=pdf with an incompatible authoritative mimeType is rejected', async () => {
  const { service, calls } = setup({
    row: pdfRow('pdf-full-multipage', { documentEvidence: { mimeType: 'image/png' } })
  });

  await expectRejection(
    service.ensureExtractionForAnalysisRunSource(SOURCE_ID),
    SourceExtractionOrchestrationError,
    'DOCUMENT_SOURCE_NOT_SUPPORTED_FOR_EXTRACTION',
    'document_mime_type_is_not_application_pdf'
  );
  assert.equal(calls.storageReads.length, 0);
  assertNoProducerNoWrite(calls);
});

test('eligibility: the error carries the domain enum, never the raw mimeType', async () => {
  const error = await expectRejection(
    setup({
      row: pdfRow('pdf-full-multipage', {
        documentEvidence: { kind: 'image', mimeType: 'image/png' }
      })
    }).service.ensureExtractionForAnalysisRunSource(SOURCE_ID),
    SourceExtractionOrchestrationError
  );

  assert.equal(error.detail.documentKind, 'image');
  const serialized = JSON.stringify(error.detail) + error.message;
  assert.ok(!serialized.includes('image/png'), 'no se ecoa el valor recibido');
});

test('eligibility: malformed PDF bytes DO reach the producer — no magic-header guard', async () => {
  // F1.3 tuvo que sacar el guard de `%PDF-` del transporte porque suprimia un
  // artifact que el diseño F0 §15 exige que exista. Reinstalarlo en NestJS seria
  // la misma regresion por otra puerta: el DOMINIO decide si la evidencia es una
  // fuente PDF, F0.2 decide que puede observar de sus bytes.
  const malformed = loadSourceBytes('malformed.pdf');
  const sha = shaOfBytes(malformed);
  const { service, calls } = setup({
    row: pdfRow('pdf-full-multipage', {
      sourceSha256: sha,
      documentEvidence: { sha256: sha }
    }),
    bytes: malformed,
    artifact: { notAnArtifact: true }
  });

  await assert.rejects(service.ensureExtractionForAnalysisRunSource(SOURCE_ID));

  assert.equal(calls.pdfCalls.length, 1, 'el productor SI fue invocado');
  assert.equal(
    Buffer.compare(Buffer.from(calls.pdfCalls[0].fileBytes), malformed),
    0,
    'con los bytes malformados intactos'
  );
  assert.ok(
    !malformed.subarray(0, 5).equals(Buffer.from('%PDF-', 'ascii')),
    'la fixture no tiene cabecera PDF: el guard, de existir, habria disparado'
  );
});

// ---------------------------------------------------------------------------
// §5D — Fuente historica exacta
// ---------------------------------------------------------------------------

test('history: the frozen source is used even after it stopped being current', async () => {
  const artifact = loadProducerArtifact('pdf-full-multipage');
  const bytes = loadSourceBytes('normal-multipage.pdf');
  const row = pdfRow('pdf-full-multipage', {
    // La evidencia que este run congelo ya fue reemplazada por otra mas nueva.
    documentEvidence: { status: 'replaced' }
  });
  const { service, calls } = setup({ row, bytes, artifact });

  const persisted = await service.ensureExtractionForAnalysisRunSource(SOURCE_ID);

  // La pregunta es "que fuente congelo este AnalysisRun", no "cual es la fuente
  // actual de la credencial hoy". Un run historico debe poder extraer la
  // evidencia que uso aunque despues haya sido sustituida.
  assert.equal(calls.pdfCalls[0].documentEvidenceId, row.documentEvidence.id);
  assert.equal(calls.storageReads[0], row.documentEvidence.storageKey);
  assert.deepEqual(
    calls.evidenceLookups,
    [],
    'no se busca la evidencia actual de la credencial por ningun camino'
  );
  assert.equal(persisted.artifact.coverageStatus, 'FULL');
});

// ---------------------------------------------------------------------------
// §5C — Coherencia del snapshot autoritativo
// ---------------------------------------------------------------------------

test('snapshot: an entity sha that drifted from the frozen run sha stops before transport', async () => {
  const { service, calls } = setup({
    row: pdfRow('pdf-full-multipage', { documentEvidence: { sha256: 'a'.repeat(64) } })
  });

  await expectRejection(
    service.ensureExtractionForAnalysisRunSource(SOURCE_ID),
    SourceExtractionOrchestrationError,
    'AUTHORITATIVE_SNAPSHOT_MISMATCH',
    'document_evidence_sha_does_not_match_frozen_run_sha'
  );
  assert.equal(calls.storageReads.length, 0);
  assertNoProducerNoWrite(calls);
});

test('snapshot: a source entity from another credential stops before transport', async () => {
  const { service, calls } = setup({
    row: textRow('text-multiple-paragraphs', { textEvidence: { credentialId: 'otra-cred' } })
  });

  await expectRejection(
    service.ensureExtractionForAnalysisRunSource(SOURCE_ID),
    SourceExtractionOrchestrationError,
    'AUTHORITATIVE_SNAPSHOT_MISMATCH',
    'text_evidence_belongs_to_a_different_credential'
  );
  assertNoProducerNoWrite(calls);
});

test('snapshot: the fail-fast checks do NOT replace F0.5', async () => {
  // Un snapshot coherente pasa el fail-fast y aun asi el binding lo establece
  // F0.5 despues de la respuesta: aqui el artifact es valido pero de otra fuente.
  const bytes = loadSourceBytes('normal-multipage.pdf');
  const { service, calls } = setup({
    row: pdfRow(),
    bytes,
    artifact: loadProducerArtifact('text-simple')
  });

  await expectRejection(
    service.ensureExtractionForAnalysisRunSource(SOURCE_ID),
    SourceExtractionTrustError,
    'SOURCE_TYPE_MISMATCH'
  );
  assert.equal(calls.pdfCalls.length, 1, 'el fail-fast dejo pasar el snapshot');
  assert.equal(calls.fills, 0, 'y aun asi F0.5 impidio persistir');
});

// ---------------------------------------------------------------------------
// §21 — Camino causal TEXT
// ---------------------------------------------------------------------------

test('text: content, id and frozen sha travel authoritatively and unmodified', async () => {
  const artifact = loadProducerArtifact('text-multiple-paragraphs') as Record<string, any>;
  const row = textRow('text-multiple-paragraphs');
  const { service, calls } = setup({ row, artifact });

  const persisted = await service.ensureExtractionForAnalysisRunSource(SOURCE_ID);

  const [sent] = calls.textCalls;
  assert.equal(sent.content, row.textEvidence.content);
  assert.equal(sent.textEvidenceId, row.textEvidence.id);
  assert.equal(sent.sourceSha256, row.sourceSha256);
  assert.deepEqual(Object.keys(sent).sort(), ['content', 'sourceSha256', 'textEvidenceId']);

  assert.equal(calls.storageReads.length, 0, 'TEXT no toca storage');
  // Para TEXT la derivacion queda DEMOSTRADA: el contenido autoritativo ES el
  // texto canonico y F0.5 comprueba igualdad exacta.
  assert.equal(persisted.extractionDerivationTrust, 'AUTHORITATIVE_CONTENT_MATCHED');
});

for (const name of [
  'text-simple',
  'text-multiple-paragraphs',
  'text-astral-unicode',
  'text-repeated-blocks',
  'text-empty-contractual'
] as const) {
  test(`text: ${name} survives the chain code point by code point`, async () => {
    const artifact = loadProducerArtifact(name) as Record<string, any>;
    const row = textRow(name);
    const { service, calls } = setup({ row, artifact });

    const persisted = await service.ensureExtractionForAnalysisRunSource(SOURCE_ID);

    const content = row.textEvidence.content as string;
    const sent = calls.textCalls[0].content as string;
    assert.equal(sent, content);
    assert.deepEqual(Array.from(sent), Array.from(content), 'ni un code point de diferencia');
    assert.equal(persisted.artifact.documentCanonicalText, content);
  });
}

test('text: astral characters are not damaged by any UTF-16 slicing', async () => {
  const artifact = loadProducerArtifact('text-astral-unicode') as Record<string, any>;
  const content = artifact.documentCanonicalText as string;
  const { service, calls } = setup({ row: textRow('text-astral-unicode'), artifact });

  await service.ensureExtractionForAnalysisRunSource(SOURCE_ID);

  const sent = calls.textCalls[0].content as string;
  assert.ok(
    Array.from(content).some((ch) => (ch.codePointAt(0) as number) > 0xffff),
    'la fixture tiene al menos un caracter fuera del BMP'
  );
  assert.equal(Array.from(sent).length, Array.from(content).length);
  assert.ok(!/[\ud800-\udfff]/.test(sent.replace(/[\ud800-\udbff][\udc00-\udfff]/g, '')));
});

test('text: an internal BOM is transported, not stripped', async () => {
  // El BOM AL INICIO si lo recorta el trim de ECMAScript, asi que un contenido
  // que empieza con BOM no es punto fijo de la normalizacion de producto. El caso
  // valido -y el que importa- es el BOM INTERNO.
  const content = `Modulo uno.\n\nCarga${String.fromCodePoint(0xfeff)}horaria: 40.`;
  const sha = shaOfText(content);
  const { service, calls } = setup({
    row: textRow('text-multiple-paragraphs', {
      sourceSha256: sha,
      textEvidence: { content, sha256: sha }
    }),
    artifact: { notAnArtifact: true }
  });

  await assert.rejects(service.ensureExtractionForAnalysisRunSource(SOURCE_ID));

  assert.equal(calls.textCalls[0].content, content);
  assert.ok(calls.textCalls[0].content.includes(String.fromCodePoint(0xfeff)));
});

test('text: content that violates the F0.3 precondition is NOT normalized here', async () => {
  // Contenido con espacio inicial: no es punto fijo de
  // PRODUCT_NFC_LINEENDINGS_TRIM. F1.4 no lo arregla — lo envia tal cual y deja
  // que el productor lo detecte. Normalizarlo aca esconderia el defecto de origen
  // y desalinearia el sha almacenado.
  const content = '   Contenido sin normalizar.   ';
  const sha = shaOfText(content);
  const { service, calls } = setup({
    row: textRow('text-multiple-paragraphs', {
      sourceSha256: sha,
      textEvidence: { content, sha256: sha }
    }),
    producerError: new AiServiceClientError(
      'content_is_not_product_normalized',
      'http',
      422
    )
  });

  await assert.rejects(
    service.ensureExtractionForAnalysisRunSource(SOURCE_ID),
    AiServiceClientError
  );

  assert.equal(calls.textCalls[0].content, content, 'viajo sin trim');
  assert.equal(calls.trustGate, 0);
  assert.equal(calls.updates.length, 0, 'el slot queda ABSENT');
});

// ---------------------------------------------------------------------------
// §22 — Orden de fallos y efectos
// ---------------------------------------------------------------------------

test('order: a producer failure stops before the trust gate and before persistence', async () => {
  const { service, calls } = setup({
    row: pdfRow(),
    bytes: loadSourceBytes('normal-multipage.pdf'),
    producerError: new AiServiceClientError('sin respuesta', 'unavailable')
  });

  await assert.rejects(
    service.ensureExtractionForAnalysisRunSource(SOURCE_ID),
    AiServiceClientError
  );
  assert.equal(calls.pdfCalls.length, 1);
  assert.equal(calls.trustGate, 0, 'el trust gate no se llamo');
  assert.equal(calls.fills, 0);
  assert.equal(calls.updates.length, 0, 'el slot queda ABSENT');
});

test('order: a concurrent fill with the SAME bundle converges without overwriting', async () => {
  const artifact = loadProducerArtifact('pdf-full-multipage');
  const bytes = loadSourceBytes('normal-multipage.pdf');
  const { service, calls } = setup({
    row: pdfRow(),
    bytes,
    artifact,
    updateCount: 0,
    rowAfterFailedFill: { ...pdfRow(), ...presentSlot('pdf-full-multipage') }
  });

  const persisted = await service.ensureExtractionForAnalysisRunSource(SOURCE_ID);

  assert.equal(persisted.artifact.coverageStatus, 'FULL');
  assert.equal(calls.updates.length, 1, 'un solo intento condicional, y no aplico');
});

test('order: a concurrent fill with a DIFFERENT bundle conflicts and preserves the slot', async () => {
  const bytes = loadSourceBytes('normal-multipage.pdf');
  const { service, calls } = setup({
    row: pdfRow(),
    bytes,
    artifact: loadProducerArtifact('pdf-full-multipage'),
    updateCount: 0,
    // Otro worker llego primero con otra extraccion de la misma fuente.
    rowAfterFailedFill: { ...pdfRow(), ...presentSlot('pdf-pypdf-fallback') }
  });

  await expectRejection(
    service.ensureExtractionForAnalysisRunSource(SOURCE_ID),
    SourceExtractionSlotError,
    'EXTRACTION_SLOT_CONFLICT'
  );

  // Nada de last-write-wins: el unico update fue el condicional, que no aplico.
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.updates[0].where.extractionArtifactCanonicalJson, null);
});

test('order: a missing source entity never reaches the producer', async () => {
  const { service, calls } = setup({
    row: pdfRow('pdf-full-multipage', { documentEvidence: null })
  });

  await expectRejection(
    service.ensureExtractionForAnalysisRunSource(SOURCE_ID),
    SourceExtractionOrchestrationError,
    'SOURCE_ENTITY_NOT_FOUND_FOR_EXTRACTION',
    'document_evidence_does_not_exist'
  );
  assert.equal(calls.storageReads.length, 0);
  assertNoProducerNoWrite(calls);
});

test('order: a missing TextEvidence never reaches the producer either', async () => {
  const { service, calls } = setup({
    row: textRow('text-simple', { textEvidence: null })
  });

  await expectRejection(
    service.ensureExtractionForAnalysisRunSource(SOURCE_ID),
    SourceExtractionOrchestrationError,
    'SOURCE_ENTITY_NOT_FOUND_FOR_EXTRACTION',
    'text_evidence_does_not_exist'
  );
  assertNoProducerNoWrite(calls);
});

for (const [label, overrides] of [
  ['both references set', { documentEvidenceId: 'doc-1', textEvidenceId: 'text-1' }],
  ['neither reference set', { documentEvidenceId: null, textEvidenceId: null }],
  ['a frozen sha that is not hex', { sourceSha256: 'no-es-un-sha' }],
  ['a declared type that contradicts the reference', { sourceType: 'text_evidence' }]
] as const) {
  test(`order: an invalid authority row (${label}) never reaches the producer`, async () => {
    const { service, calls } = setup({ row: pdfRow('pdf-full-multipage', overrides) });

    await expectRejection(
      service.ensureExtractionForAnalysisRunSource(SOURCE_ID),
      SourceExtractionOrchestrationError,
      'ANALYSIS_RUN_SOURCE_INVALID_FOR_EXTRACTION'
    );
    assert.equal(calls.storageReads.length, 0);
    assertNoProducerNoWrite(calls);
  });
}

// ---------------------------------------------------------------------------
// §12 — Valor de retorno
// ---------------------------------------------------------------------------

test('return: only the persisted, verified representation crosses the boundary', async () => {
  const { service } = setup({
    row: pdfRow(),
    bytes: loadSourceBytes('normal-multipage.pdf'),
    artifact: loadProducerArtifact('pdf-full-multipage')
  });

  const persisted = await service.ensureExtractionForAnalysisRunSource(SOURCE_ID);

  assert.deepEqual(Object.keys(persisted).sort(), [
    'analysisRunSourceId',
    'artifact',
    'artifactBlobSha256',
    'extractionDerivationTrust'
  ]);
  // Ni la respuesta HTTP cruda, ni el canonical JSON, ni bytes, ni contenido.
  assert.ok(Object.isFrozen(persisted));
  assert.ok(Object.isFrozen(persisted.artifact));
});

test('return: the persisted artifact is the one F1.2 re-verified, not the raw response', async () => {
  const artifact = loadProducerArtifact('text-simple');
  const { service } = setup({ row: textRow('text-simple'), artifact });

  const persisted = await service.ensureExtractionForAnalysisRunSource(SOURCE_ID);

  // Mutar la respuesta cruda despues no puede afectar a lo devuelto: F0.4
  // entrega un snapshot desacoplado y congelado.
  (artifact as Record<string, any>).coverageStatus = 'FAILED';
  assert.equal(persisted.artifact.coverageStatus, 'FULL');
});

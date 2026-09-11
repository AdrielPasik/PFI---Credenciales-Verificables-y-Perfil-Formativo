/**
 * Repositorio del extraction slot — F1.2.
 *
 * Prisma se falsea con un objeto a mano, siguiendo la convención de
 * `analysis-run-execution.service.test.ts`. Los artifacts son los del corpus real
 * de F0.2/F0.3: nunca se invoca Python ni se regenera nada.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { canonicalJson } from './canonical-json';
import { verifySourceExtractionArtifact } from './source-extraction-artifact.verifier';
import { SourceExtractionSlotError } from './source-extraction-slot.errors';
import { SourceExtractionSlotService } from './source-extraction-slot.service';
import { type AuthoritativeSourceBoundExtraction } from './source-extraction-trust.types';
import { cloneArtifact, loadProducerArtifact } from './__fixtures__/source-extraction.fixtures';

const SOURCE_ID = 'ars-1';

const shaOf = (value: string): string =>
  createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');

type Row = Record<string, unknown> | null;

function bindingFor(
  name: string,
  overrides: Partial<AuthoritativeSourceBoundExtraction> = {}
): AuthoritativeSourceBoundExtraction {
  const artifact = verifySourceExtractionArtifact(loadProducerArtifact(name));
  return {
    analysisRunId: 'run-1',
    analysisRunSourceId: SOURCE_ID,
    sourceType: artifact.sourceType,
    sourceEntityId: 'entity-1',
    sourceSha256: artifact.source.sourceSha256,
    extractionIdentity: artifact.extractionIdentity,
    extractionDerivationTrust:
      artifact.sourceType === 'TEXT' ? 'AUTHORITATIVE_CONTENT_MATCHED' : 'PRODUCER_ASSUMED',
    artifact,
    ...overrides
  } as AuthoritativeSourceBoundExtraction;
}

/** Slot PRESENT coherente, construido desde un artifact del corpus. */
function presentSlot(name: string, overrides: Record<string, unknown> = {}) {
  const artifact = loadProducerArtifact(name);
  const canonical = canonicalJson(verifySourceExtractionArtifact(artifact));
  return {
    extractionArtifactCanonicalJson: canonical,
    artifactBlobSha256: shaOf(canonical),
    extractionDerivationTrust:
      (artifact as Record<string, unknown>).sourceType === 'TEXT'
        ? 'AUTHORITATIVE_CONTENT_MATCHED'
        : 'PRODUCER_ASSUMED',
    ...overrides
  };
}

const ABSENT_SLOT = {
  extractionArtifactCanonicalJson: null,
  artifactBlobSha256: null,
  extractionDerivationTrust: null
};

function setup(options: { row?: Row; updateCount?: number } = {}) {
  const calls = { updates: [] as any[], finds: 0 };

  const prisma = {
    analysisRunSource: {
      async findUnique(_args: any) {
        calls.finds += 1;
        return options.row === undefined ? null : options.row;
      },
      async updateMany(args: any) {
        calls.updates.push(args);
        return { count: options.updateCount ?? 1 };
      }
    }
  } as any;

  return { calls, service: new SourceExtractionSlotService(prisma) };
}

function expectSlotError(promise: Promise<unknown>, code: string, invariant?: string) {
  return promise.then(
    () => {
      throw new assert.AssertionError({ message: `se esperaba ${code} y resolvio` });
    },
    (error: unknown) => {
      assert.ok(error instanceof SourceExtractionSlotError, String(error));
      assert.equal(error.code, code);
      if (invariant !== undefined) {
        assert.match(error.detail.invariant, new RegExp(invariant));
      }
      return error;
    }
  );
}

// ---------------------------------------------------------------------------
// ESCRITURA
// ---------------------------------------------------------------------------

test('write: an ABSENT slot is filled and returns the persisted extraction', async () => {
  const { service, calls } = setup({ row: { ...ABSENT_SLOT } });
  const binding = bindingFor('pdf-full-multipage');

  const persisted = await service.fillExtractionSlot(binding);

  assert.equal(persisted.analysisRunSourceId, SOURCE_ID);
  assert.equal(persisted.extractionDerivationTrust, 'PRODUCER_ASSUMED');
  assert.equal(calls.updates.length, 1, 'una sola operacion de escritura');
});

test('write: the three fields go in ONE operation, with the ABSENT guard', async () => {
  const { service, calls } = setup({ row: { ...ABSENT_SLOT } });
  await service.fillExtractionSlot(bindingFor('text-simple'));

  const [update] = calls.updates;
  assert.deepEqual(Object.keys(update.data).sort(), [
    'artifactBlobSha256',
    'extractionArtifactCanonicalJson',
    'extractionDerivationTrust'
  ]);
  // El guard del compare-and-set: sólo escribe si el slot sigue ABSENT.
  assert.equal(update.where.id, SOURCE_ID);
  assert.equal(update.where.extractionArtifactCanonicalJson, null);
  assert.equal(update.where.artifactBlobSha256, null);
  assert.equal(update.where.extractionDerivationTrust, null);
});

test('write: the persisted blob is the canonical serialization and its exact SHA', async () => {
  const { service, calls } = setup({ row: { ...ABSENT_SLOT } });
  const binding = bindingFor('text-astral-unicode');
  const persisted = await service.fillExtractionSlot(binding);

  const written = calls.updates[0].data;
  assert.equal(written.extractionArtifactCanonicalJson, canonicalJson(binding.artifact));
  assert.equal(written.artifactBlobSha256, shaOf(written.extractionArtifactCanonicalJson));
  assert.equal(persisted.artifactBlobSha256, written.artifactBlobSha256);
});

test('write: the SHA is over UTF-8 bytes, not UTF-16 code units', async () => {
  // El artifact astral contiene un caracter fuera del BMP: los dos conjuntos de
  // bytes difieren, asi que un hash calculado sobre UTF-16 daria otro valor.
  const { service, calls } = setup({ row: { ...ABSENT_SLOT } });
  await service.fillExtractionSlot(bindingFor('text-astral-unicode'));

  const { extractionArtifactCanonicalJson: json, artifactBlobSha256: sha } = calls.updates[0].data;
  assert.ok(
    Array.from(json as string).some((ch) => (ch.codePointAt(0) as number) > 0xffff),
    'la fixture astral debe contener un caracter fuera del BMP'
  );
  assert.equal(sha, createHash('sha256').update(Buffer.from(json, 'utf8')).digest('hex'));
  assert.notEqual(
    sha,
    createHash('sha256').update(Buffer.from(json, 'utf16le')).digest('hex'),
    'un hash sobre code units UTF-16 seria distinto y esta mal'
  );
});

test('write: the destination is derived from the binding, never supplied separately', async () => {
  // La firma recibe un unico argumento portador de autoridad, asi que no es
  // representable pedir un destino distinto del que el binding declara.
  const { service, calls } = setup({ row: { ...ABSENT_SLOT } });
  const binding = bindingFor('text-simple', { analysisRunSourceId: 'ars-desde-el-binding' } as never);

  await service.fillExtractionSlot(binding);
  assert.equal(calls.updates[0].where.id, 'ars-desde-el-binding');
});

test('write: a missing AnalysisRunSource is rejected', async () => {
  const { service } = setup({ updateCount: 0, row: null });
  await expectSlotError(
    service.fillExtractionSlot(bindingFor('pdf-full-multipage')),
    'ANALYSIS_RUN_SOURCE_NOT_FOUND'
  );
});

test('write: a pre-existing partial slot is rejected without writing', async () => {
  const partial = { ...presentSlot('pdf-full-multipage'), artifactBlobSha256: null };
  const { service, calls } = setup({ updateCount: 0, row: partial });

  await expectSlotError(
    service.fillExtractionSlot(bindingFor('pdf-full-multipage')),
    'EXTRACTION_SLOT_INCONSISTENT'
  );
  assert.equal(calls.updates.length, 1, 'el CAS se intento una vez y no aplico');
});

test('write: the SAME exact bundle converges idempotently, with no second write', async () => {
  const existing = presentSlot('pdf-full-multipage');
  const { service, calls } = setup({ updateCount: 0, row: existing });

  const persisted = await service.fillExtractionSlot(bindingFor('pdf-full-multipage'));

  assert.equal(persisted.artifactBlobSha256, existing.artifactBlobSha256);
  assert.equal(calls.updates.length, 1, 'no hay una segunda escritura');
  // MONOTONIC_FILL_ONCE intacto: PRESENT nunca se reescribio.
});

test('write: a DIFFERENT artifact in the slot is a conflict, never an overwrite', async () => {
  const existing = presentSlot('text-multiple-paragraphs');
  const { service, calls } = setup({ updateCount: 0, row: existing });

  await expectSlotError(
    service.fillExtractionSlot(bindingFor('text-simple')),
    'EXTRACTION_SLOT_CONFLICT',
    'different_bundle'
  );
  assert.equal(calls.updates.length, 1, 'el CAS perdido no se reintenta');
});

test('write: the same artifact with a different derivationTrust is a conflict', async () => {
  const existing = presentSlot('text-simple', {
    extractionDerivationTrust: 'PRODUCER_ASSUMED'
  });
  const { service } = setup({ updateCount: 0, row: existing });

  // El artifact es byte-identico; sólo difiere la afirmacion de derivacion.
  await expectSlotError(
    service.fillExtractionSlot(bindingFor('text-simple')),
    'EXTRACTION_SLOT_CONFLICT'
  );
});

test('write: a lost CAS over an existing CORRUPT slot reports the corruption', async () => {
  // El slot existente sólo puede considerarse un estado con el cual converger si
  // atraviesa la misma lectura segura. Uno corrupto no lo hace.
  const corrupt = presentSlot('text-simple', { artifactBlobSha256: 'f'.repeat(64) });
  const { service } = setup({ updateCount: 0, row: corrupt });

  await expectSlotError(
    service.fillExtractionSlot(bindingFor('text-simple')),
    'ARTIFACT_BLOB_SHA_MISMATCH'
  );
});

test('write: exactly one of two concurrent workers changes state', async () => {
  const shared: Record<string, unknown> = { ...ABSENT_SLOT };
  const updates: any[] = [];
  const prisma = {
    analysisRunSource: {
      async findUnique() {
        return { ...shared };
      },
      async updateMany(args: any) {
        // Compare-and-set real sobre el estado compartido.
        const absent =
          shared.extractionArtifactCanonicalJson === null &&
          shared.artifactBlobSha256 === null &&
          shared.extractionDerivationTrust === null;
        if (!absent) {
          return { count: 0 };
        }
        Object.assign(shared, args.data);
        updates.push(args);
        return { count: 1 };
      }
    }
  } as any;

  const service = new SourceExtractionSlotService(prisma);
  const binding = bindingFor('pdf-full-multipage');

  const [first, second] = await Promise.all([
    service.fillExtractionSlot(binding),
    service.fillExtractionSlot(binding)
  ]);

  assert.equal(updates.length, 1, 'exactamente una escritura que cambia estado');
  assert.equal(first.artifactBlobSha256, second.artifactBlobSha256);
});

// ---------------------------------------------------------------------------
// LECTURA
// ---------------------------------------------------------------------------

test('read: a missing source is reported, not thrown', async () => {
  const { service } = setup({ row: null });
  const outcome = await service.readExtractionSlot(SOURCE_ID);
  assert.equal(outcome.status, 'SOURCE_NOT_FOUND');
});

test('read: an ABSENT slot is reported, not thrown, and is NOT coverage FAILED', async () => {
  const { service } = setup({ row: { ...ABSENT_SLOT } });
  const outcome = await service.readExtractionSlot(SOURCE_ID);

  assert.equal(outcome.status, 'SLOT_ABSENT');
  // Un slot ABSENT dice "nunca se extrajo esta fuente"; un artifact FAILED dice
  // "la identificamos y no pudimos leer su contenido". Son cosas distintas.
  assert.ok(!('extraction' in outcome));
});

test('read: a valid slot returns the verified artifact', async () => {
  const { service } = setup({ row: presentSlot('pdf-partial-scanned-page') });
  const outcome = await service.readExtractionSlot(SOURCE_ID);

  assert.equal(outcome.status, 'SLOT_PRESENT');
  if (outcome.status !== 'SLOT_PRESENT') throw new Error('unreachable');
  assert.equal(outcome.extraction.artifact.coverageStatus, 'PARTIAL');
  assert.equal(outcome.extraction.extractionDerivationTrust, 'PRODUCER_ASSUMED');
});

test('read: the persisted derivationTrust is returned, not re-inferred', async () => {
  // Se guarda un valor que NO es el que la regla actual derivaria de sourceType.
  // Si la lectura lo re-infiriera, devolveria el otro y actualizaria
  // retroactivamente una afirmacion historica.
  const slot = presentSlot('text-simple', {
    extractionDerivationTrust: 'PRODUCER_ASSUMED'
  });
  const { service } = setup({ row: slot });
  const outcome = await service.readExtractionSlot(SOURCE_ID);

  if (outcome.status !== 'SLOT_PRESENT') throw new Error('unreachable');
  assert.equal(outcome.extraction.artifact.sourceType, 'TEXT');
  assert.equal(outcome.extraction.extractionDerivationTrust, 'PRODUCER_ASSUMED');
});

test('read: a partial slot is REJECTED, never treated as ABSENT', async () => {
  const partial = { ...presentSlot('text-simple'), extractionDerivationTrust: null };
  const { service } = setup({ row: partial });

  const error = await expectSlotError(
    service.readExtractionSlot(SOURCE_ID),
    'EXTRACTION_SLOT_INCONSISTENT'
  );
  assert.ok(error.detail.presentFields?.includes('extractionArtifactCanonicalJson'));
});

test('read: a blob SHA mismatch is rejected BEFORE trusting the payload', async () => {
  const { service } = setup({
    row: presentSlot('text-simple', { artifactBlobSha256: 'a'.repeat(64) })
  });
  await expectSlotError(service.readExtractionSlot(SOURCE_ID), 'ARTIFACT_BLOB_SHA_MISMATCH');
});

test('read: mutating diagnostic.detail without updating the SHA is caught by the blob SHA', async () => {
  // `diagnostic.detail` es el unico campo que ni el fingerprint ni los
  // invariantes derivados de F0.4 cubren. Es exactamente el valor marginal que
  // F0.6 preservo al conservar artifactBlobSha256.
  const artifact = cloneArtifact(loadProducerArtifact('pdf-failed-encrypted')) as Record<string, any>;
  assert.ok(artifact.diagnostics[0].detail, 'la fixture debe traer un detail');

  const original = canonicalJson(verifySourceExtractionArtifact(artifact));
  artifact.diagnostics[0].detail = 'otro detalle acotado';
  const mutated = canonicalJson(verifySourceExtractionArtifact(artifact));
  assert.notEqual(mutated, original);

  const { service } = setup({
    row: {
      extractionArtifactCanonicalJson: mutated,
      artifactBlobSha256: shaOf(original), // testigo viejo
      extractionDerivationTrust: 'PRODUCER_ASSUMED'
    }
  });
  await expectSlotError(service.readExtractionSlot(SOURCE_ID), 'ARTIFACT_BLOB_SHA_MISMATCH');
});

test('read: invalid JSON with a matching stored SHA is rejected', async () => {
  const broken = '{"schemaVersion":';
  const { service } = setup({
    row: {
      extractionArtifactCanonicalJson: broken,
      artifactBlobSha256: shaOf(broken),
      extractionDerivationTrust: 'PRODUCER_ASSUMED'
    }
  });
  await expectSlotError(service.readExtractionSlot(SOURCE_ID), 'ARTIFACT_BLOB_JSON_INVALID');
});

test('read: an F0.4-invalid artifact with a correctly recomputed SHA is rejected', async () => {
  // Integridad de blob PASS, integridad interna FAIL. Por eso F0.4 es obligatorio
  // otra vez en la lectura: el SHA sólo dice que los bytes no cambiaron.
  const artifact = cloneArtifact(loadProducerArtifact('pdf-full-multipage')) as Record<string, any>;
  artifact.artifactContentFingerprint = '0'.repeat(64);
  const json = JSON.stringify(artifact);

  const { service } = setup({
    row: {
      extractionArtifactCanonicalJson: json,
      artifactBlobSha256: shaOf(json),
      extractionDerivationTrust: 'PRODUCER_ASSUMED'
    }
  });
  const error = await expectSlotError(
    service.readExtractionSlot(SOURCE_ID),
    'ARTIFACT_VERIFICATION_FAILED'
  );
  assert.match(error.detail.invariant, /FINGERPRINT_MISMATCH/);
});

// ---------------------------------------------------------------------------
// CANONICAL-AT-REST
// ---------------------------------------------------------------------------

test('read: non-canonical JSON passes blob SHA and F0.4, and is STILL rejected', async () => {
  // El caso que motiva el invariante canonical-at-rest. Se persiste una
  // serializacion semanticamente equivalente pero no canonica —claves en otro
  // orden y whitespace— con su SHA correctamente recalculado.
  const artifact = loadProducerArtifact('text-simple') as Record<string, unknown>;
  // Mismo contenido, otra serializacion: whitespace insignificante. No se usa un
  // replacer array porque ese FILTRA claves en todos los niveles y dejaria el
  // artifact incompleto -- lo rechazaria F0.4, no el invariante que se prueba.
  const nonCanonical = JSON.stringify(artifact, null, 2);

  const canonical = canonicalJson(verifySourceExtractionArtifact(artifact));
  assert.notEqual(nonCanonical, canonical, 'la fixture debe ser no canonica');

  const { service } = setup({
    row: {
      extractionArtifactCanonicalJson: nonCanonical,
      artifactBlobSha256: shaOf(nonCanonical),
      extractionDerivationTrust: 'AUTHORITATIVE_CONTENT_MATCHED'
    }
  });

  // Se demuestran los tres hechos por separado: blob SHA PASS, F0.4 PASS,
  // canonical-at-rest FAIL.
  assert.equal(shaOf(nonCanonical), shaOf(nonCanonical));
  assert.doesNotThrow(() => verifySourceExtractionArtifact(JSON.parse(nonCanonical)));

  await expectSlotError(
    service.readExtractionSlot(SOURCE_ID),
    'ARTIFACT_CANONICAL_BLOB_MISMATCH',
    'not_the_canonical_serialization'
  );
});

test('read: the canonical stored representation passes', async () => {
  const { service } = setup({ row: presentSlot('text-multiple-paragraphs') });
  const outcome = await service.readExtractionSlot(SOURCE_ID);
  assert.equal(outcome.status, 'SLOT_PRESENT');
});

// ---------------------------------------------------------------------------
// Snapshot y privacidad
// ---------------------------------------------------------------------------

test('the returned extraction is runtime immutable and carries no raw blob', async () => {
  const { service } = setup({ row: presentSlot('text-simple') });
  const outcome = await service.readExtractionSlot(SOURCE_ID);
  if (outcome.status !== 'SLOT_PRESENT') throw new Error('unreachable');

  assert.deepEqual(Object.keys(outcome.extraction).sort(), [
    'analysisRunSourceId',
    'artifact',
    'artifactBlobSha256',
    'extractionDerivationTrust'
  ]);
  assert.ok(Object.isFrozen(outcome.extraction));
  assert.ok(Object.isFrozen(outcome.extraction.artifact));
  assert.throws(() => {
    (outcome.extraction as Record<string, any>).artifactBlobSha256 = 'x';
  }, TypeError);
});

test('slot errors never leak the blob or the document content', async () => {
  const artifact = loadProducerArtifact('text-multiple-paragraphs') as Record<string, unknown>;
  const canonical = canonicalJson(verifySourceExtractionArtifact(artifact));
  const excerpts = (artifact.segments as any[]).map((segment) => segment.exactExcerpt);

  const { service } = setup({
    row: {
      extractionArtifactCanonicalJson: canonical,
      artifactBlobSha256: 'b'.repeat(64),
      extractionDerivationTrust: 'AUTHORITATIVE_CONTENT_MATCHED'
    }
  });

  const error = await expectSlotError(
    service.readExtractionSlot(SOURCE_ID),
    'ARTIFACT_BLOB_SHA_MISMATCH'
  );
  const serialized = `${error.message} ${JSON.stringify(error.detail)}`;
  assert.ok(!serialized.includes(canonical));
  for (const excerpt of excerpts) {
    assert.ok(!serialized.includes(excerpt), 'el error no debe incluir excerpts');
  }
});

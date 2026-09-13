/**
 * Backfill del slot de extraccion F1 — P2.4.
 *
 * Lo que se defiende no es que el backfill funcione: es que NO PUEDA hacer de
 * mas. Cero extraccion real, cero base, cero red. El orquestador esta espiado,
 * asi que cada test puede afirmar exactamente cuantas veces se lo llamo y con
 * que id.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SourceExtractionBackfillService,
  readSlotState
} from './source-extraction-backfill.service';

// ---------------------------------------------------------------------------
// Dobles
// ---------------------------------------------------------------------------

interface Slot {
  extractionArtifactCanonicalJson: string | null;
  artifactBlobSha256: string | null;
  extractionDerivationTrust: string | null;
}

const EMPTY_SLOT: Slot = {
  extractionArtifactCanonicalJson: null,
  artifactBlobSha256: null,
  extractionDerivationTrust: null
};

const COMPLETE_SLOT: Slot = {
  extractionArtifactCanonicalJson: '{"schemaVersion":"x"}',
  artifactBlobSha256: 'a'.repeat(64),
  extractionDerivationTrust: 'AUTHORITATIVE_CONTENT_MATCHED'
};

const PARTIAL_SLOT: Slot = {
  extractionArtifactCanonicalJson: '{"schemaVersion":"x"}',
  artifactBlobSha256: null,
  extractionDerivationTrust: null
};

interface Row {
  id: string;
  sourceType: string;
  extractionArtifactCanonicalJson: string | null;
  artifactBlobSha256: string | null;
  extractionDerivationTrust: string | null;
}

function row(id: string, sourceType: string, slot: Slot): Row {
  return { id, sourceType, ...slot };
}

interface Spy {
  calls: string[];
  fail?: string;
}

function build(rows: Row[], spy: Spy) {
  const prisma = {
    analysisRunSource: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        rows.filter((candidate) => where.id.in.includes(candidate.id))
    }
  };

  const orchestrator = {
    async ensureExtractionForAnalysisRunSource(analysisRunSourceId: string) {
      spy.calls.push(analysisRunSourceId);
      if (spy.fail === analysisRunSourceId) {
        const error = new Error('detalle interno que no debe salir');
        error.name = 'SourceExtractionSlotError';
        throw error;
      }
      return {
        analysisRunSourceId,
        artifact: { coverageStatus: 'FULL' },
        extractionDerivationTrust: 'AUTHORITATIVE_CONTENT_MATCHED',
        artifactBlobSha256: 'b'.repeat(64)
      };
    }
  };

  return new SourceExtractionBackfillService(
    prisma as never,
    orchestrator as never
  );
}

// ---------------------------------------------------------------------------
// Lectura del estado del slot
// ---------------------------------------------------------------------------

test('el estado sale de los TRES campos juntos, nunca de uno', () => {
  assert.equal(readSlotState(EMPTY_SLOT), 'EMPTY');
  assert.equal(readSlotState(COMPLETE_SLOT), 'COMPLETE');
  assert.equal(readSlotState(PARTIAL_SLOT), 'PARTIAL');
  assert.equal(
    readSlotState({ ...EMPTY_SLOT, extractionDerivationTrust: 'PRODUCER_ASSUMED' }),
    'PARTIAL'
  );
});

// ---------------------------------------------------------------------------
// DRY-RUN: no toca nada
// ---------------------------------------------------------------------------

test('dry-run: un slot vacio es elegible y NO se extrae', async () => {
  const spy: Spy = { calls: [] };
  const service = build([row('id-1', 'TEXT', EMPTY_SLOT)], spy);

  const summary = await service.run(['id-1'], { execute: false });

  assert.equal(summary.execute, false);
  assert.equal(summary.rows[0].outcome, 'DRY_RUN_ELIGIBLE');
  assert.equal(summary.rows[0].slotState, 'EMPTY');
  assert.equal(summary.rows[0].sourceType, 'TEXT');
  assert.deepEqual(spy.calls, [], 'dry-run no puede invocar la orquestacion');
});

test('dry-run: un slot completo se reporta y no se toca', async () => {
  const spy: Spy = { calls: [] };
  const service = build([row('id-1', 'TEXT', COMPLETE_SLOT)], spy);

  const summary = await service.run(['id-1'], { execute: false });

  assert.equal(summary.rows[0].outcome, 'ALREADY_COMPLETE');
  assert.deepEqual(spy.calls, []);
});

test('dry-run: un bundle a medias pide revision y aborta', async () => {
  const spy: Spy = { calls: [] };
  const service = build([row('id-1', 'TEXT', PARTIAL_SLOT)], spy);

  const summary = await service.run(['id-1'], { execute: false });

  assert.equal(summary.rows[0].outcome, 'PARTIAL_SLOT_INTEGRITY_REVIEW_REQUIRED');
  assert.equal(summary.abortedBeforeExecution, true);
  assert.deepEqual(spy.calls, []);
});

test('dry-run: una fila inexistente se reporta sin inventarla', async () => {
  const spy: Spy = { calls: [] };
  const service = build([], spy);

  const summary = await service.run(['id-fantasma'], { execute: false });

  assert.equal(summary.rows[0].outcome, 'NOT_FOUND');
  assert.equal(summary.rows[0].slotState, null);
  assert.equal(summary.rows[0].sourceType, null);
  assert.deepEqual(spy.calls, []);
});

test('el orden del resumen es el que escribio el operador', async () => {
  const spy: Spy = { calls: [] };
  const service = build(
    [row('id-2', 'TEXT', EMPTY_SLOT), row('id-1', 'PDF_DOCUMENT', EMPTY_SLOT)],
    spy
  );

  const summary = await service.run(['id-1', 'id-2'], { execute: false });

  assert.deepEqual(
    summary.rows.map((entry) => entry.analysisRunSourceId),
    ['id-1', 'id-2']
  );
});

// ---------------------------------------------------------------------------
// EXECUTE: delega, y solo lo elegible
// ---------------------------------------------------------------------------

test('execute: llama al orquestador UNA vez, con el id exacto', async () => {
  const spy: Spy = { calls: [] };
  const service = build([row('id-1', 'TEXT', EMPTY_SLOT)], spy);

  const summary = await service.run(['id-1'], { execute: true });

  assert.deepEqual(spy.calls, ['id-1']);
  assert.equal(summary.rows[0].outcome, 'EXTRACTION_COMPLETED');
  assert.equal(
    summary.rows[0].extractionDerivationTrust,
    'AUTHORITATIVE_CONTENT_MATCHED'
  );
});

test('execute: un slot completo NO se vuelve a extraer', async () => {
  // Fill-once. Si esto se rompiera, el backfill podria pisar historia.
  const spy: Spy = { calls: [] };
  const service = build([row('id-1', 'TEXT', COMPLETE_SLOT)], spy);

  const summary = await service.run(['id-1'], { execute: true });

  assert.deepEqual(spy.calls, []);
  assert.equal(summary.rows[0].outcome, 'ALREADY_COMPLETE');
});

test('execute: un bundle a medias NO se completa por encima', async () => {
  const spy: Spy = { calls: [] };
  const service = build([row('id-1', 'TEXT', PARTIAL_SLOT)], spy);

  const summary = await service.run(['id-1'], { execute: true });

  assert.deepEqual(spy.calls, [], 'jamas se repara un slot inconsistente');
  assert.equal(summary.abortedBeforeExecution, true);
});

test('execute: UNA precondicion rota aborta el conjunto entero', async () => {
  // Fail-closed sobre el conjunto: el operador nombro esas filas juntas, asi que
  // una premisa rota pone en duda la operacion completa.
  const spy: Spy = { calls: [] };
  const service = build(
    [
      row('id-1', 'TEXT', EMPTY_SLOT),
      row('id-2', 'TEXT', PARTIAL_SLOT),
      row('id-3', 'TEXT', EMPTY_SLOT)
    ],
    spy
  );

  const summary = await service.run(['id-1', 'id-2', 'id-3'], { execute: true });

  assert.deepEqual(spy.calls, [], 'ni siquiera se extrae la primera, que era elegible');
  assert.equal(summary.abortedBeforeExecution, true);
});

test('execute: un fallo corta el resto y no expone el mensaje', async () => {
  const spy: Spy = { calls: [], fail: 'id-1' };
  const service = build(
    [row('id-1', 'TEXT', EMPTY_SLOT), row('id-2', 'TEXT', EMPTY_SLOT)],
    spy
  );

  const summary = await service.run(['id-1', 'id-2'], { execute: true });

  assert.deepEqual(spy.calls, ['id-1'], 'no se sigue tras un fallo');
  assert.equal(summary.rows[0].outcome, 'EXTRACTION_FAILED');
  assert.equal(summary.rows[0].failureName, 'SourceExtractionSlotError');
  assert.equal(summary.rows[1].outcome, 'DRY_RUN_ELIGIBLE', 'la segunda no se intento');

  const serialized = JSON.stringify(summary);
  assert.ok(
    !serialized.includes('detalle interno'),
    'el mensaje del error no viaja en el resumen'
  );
});

test('execute: el tipo de fuente no cambia el camino — lo decide la orquestacion', async () => {
  const spy: Spy = { calls: [] };
  const service = build(
    [row('id-doc', 'PDF_DOCUMENT', EMPTY_SLOT), row('id-txt', 'TEXT', EMPTY_SLOT)],
    spy
  );

  await service.run(['id-doc', 'id-txt'], { execute: true });

  // Misma llamada para los dos: el backfill no ramifica por tipo.
  assert.deepEqual(spy.calls, ['id-doc', 'id-txt']);
});

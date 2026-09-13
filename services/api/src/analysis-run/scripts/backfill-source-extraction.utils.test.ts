/**
 * Argumentos y salida del backfill de extraccion F1 — P2.4.
 *
 * El invariante caro esta en el primer bloque: pasar ids NO alcanza para
 * escribir. Si eso se rompe, un dry-run se convierte en una mutacion remota.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BACKFILL_EXIT,
  backfillExitCode,
  formatBackfillSourceExtractionSummary,
  parseBackfillSourceExtractionArgs
} from './backfill-source-extraction.utils';
import type {
  SourceExtractionBackfillRow,
  SourceExtractionBackfillSummary
} from '../source-extraction-backfill.service';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

const summaryOf = (
  rows: SourceExtractionBackfillRow[],
  overrides: Partial<SourceExtractionBackfillSummary> = {}
): SourceExtractionBackfillSummary => ({
  execute: false,
  abortedBeforeExecution: false,
  rows,
  ...overrides
});

// ---------------------------------------------------------------------------
// Seguro por defecto
// ---------------------------------------------------------------------------

test('sin --execute NO se escribe, por muchos ids que se pasen', () => {
  const args = parseBackfillSourceExtractionArgs([ID_A, ID_B]);
  assert.equal(args.execute, false);
  assert.deepEqual(args.analysisRunSourceIds, [ID_A, ID_B]);
});

test('--execute es la unica autorizacion', () => {
  assert.equal(parseBackfillSourceExtractionArgs([ID_A, '--execute']).execute, true);
});

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------

test('un id invalido se rechaza en vez de convertirse en NOT_FOUND', () => {
  for (const bad of ['no-es-uuid', '1234', `${ID_A}x`, '']) {
    assert.throws(
      () => parseBackfillSourceExtractionArgs([bad]),
      /No es un analysisRunSourceId valido|Hace falta al menos/,
      `acepto ${JSON.stringify(bad)}`
    );
  }
});

test('los ids repetidos se colapsan conservando el orden', () => {
  const args = parseBackfillSourceExtractionArgs([ID_A, ID_B, ID_A]);
  assert.deepEqual(args.analysisRunSourceIds, [ID_A, ID_B]);
});

test('sin ids no se hace nada: no existe barrido automatico', () => {
  assert.throws(
    () => parseBackfillSourceExtractionArgs(['--execute']),
    /Hace falta al menos un analysisRunSourceId/
  );
});

test('un flag desconocido se rechaza, no se ignora', () => {
  // `--force` no existe a proposito: no hay modo sobrescritura.
  for (const flag of ['--force', '--all', '--yes']) {
    assert.throws(
      () => parseBackfillSourceExtractionArgs([ID_A, flag]),
      /Argumento desconocido/,
      flag
    );
  }
});

test('--help no necesita ids', () => {
  const args = parseBackfillSourceExtractionArgs(['--help']);
  assert.equal(args.help, true);
  assert.deepEqual(args.analysisRunSourceIds, []);
});

// ---------------------------------------------------------------------------
// Codigos de salida
// ---------------------------------------------------------------------------

test('el fallo no se esconde detras de un log', () => {
  const base = { analysisRunSourceId: ID_A, sourceType: 'TEXT', slotState: 'EMPTY' } as const;

  assert.equal(
    backfillExitCode(summaryOf([{ ...base, outcome: 'DRY_RUN_ELIGIBLE' }])),
    BACKFILL_EXIT.OK
  );
  assert.equal(
    backfillExitCode(summaryOf([{ ...base, outcome: 'ALREADY_COMPLETE' }])),
    BACKFILL_EXIT.OK
  );
  assert.equal(
    backfillExitCode(summaryOf([{ ...base, outcome: 'EXTRACTION_COMPLETED' }])),
    BACKFILL_EXIT.OK
  );
  assert.equal(
    backfillExitCode(
      summaryOf([{ ...base, outcome: 'PARTIAL_SLOT_INTEGRITY_REVIEW_REQUIRED' }])
    ),
    BACKFILL_EXIT.PRECONDITION_FAILED
  );
  assert.equal(
    backfillExitCode(summaryOf([{ ...base, outcome: 'NOT_FOUND' }])),
    BACKFILL_EXIT.PRECONDITION_FAILED
  );
  assert.equal(
    backfillExitCode(summaryOf([{ ...base, outcome: 'EXTRACTION_FAILED' }])),
    BACKFILL_EXIT.EXTRACTION_FAILED
  );
});

test('un fallo de extraccion gana sobre una precondicion rota', () => {
  const code = backfillExitCode(
    summaryOf([
      { analysisRunSourceId: ID_A, sourceType: null, slotState: null, outcome: 'NOT_FOUND' },
      {
        analysisRunSourceId: ID_B,
        sourceType: 'TEXT',
        slotState: 'EMPTY',
        outcome: 'EXTRACTION_FAILED'
      }
    ])
  );
  assert.equal(code, BACKFILL_EXIT.EXTRACTION_FAILED);
});

// ---------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------

test('el dry-run se anuncia como tal y ofrece el paso siguiente', () => {
  const text = formatBackfillSourceExtractionSummary(
    summaryOf([
      {
        analysisRunSourceId: ID_A,
        sourceType: 'TEXT',
        slotState: 'EMPTY',
        outcome: 'DRY_RUN_ELIGIBLE'
      }
    ])
  );

  assert.match(text, /DRY-RUN \(no se escribio nada\)/);
  assert.match(text, /--execute/);
  assert.match(text, /elegibles=1/);
});

test('el aborto se dice, no se deduce del conteo', () => {
  const text = formatBackfillSourceExtractionSummary(
    summaryOf(
      [
        {
          analysisRunSourceId: ID_A,
          sourceType: 'TEXT',
          slotState: 'PARTIAL',
          outcome: 'PARTIAL_SLOT_INTEGRITY_REVIEW_REQUIRED'
        }
      ],
      { execute: true, abortedBeforeExecution: true }
    )
  );

  assert.match(text, /ABORTADO en la inspeccion/);
  assert.match(text, /No se intento ninguna extraccion/);
});

test('el resumen no lleva contenido de fuente ni rutas', () => {
  const text = formatBackfillSourceExtractionSummary(
    summaryOf([
      {
        analysisRunSourceId: ID_A,
        sourceType: 'PDF_DOCUMENT',
        slotState: 'EMPTY',
        outcome: 'EXTRACTION_COMPLETED',
        extractionDerivationTrust: 'PRODUCER_ASSUMED'
      }
    ])
  );

  for (const forbidden of ['storageKey', 'sha256=', 'content', 'http', '@']) {
    assert.ok(!text.includes(forbidden), `el resumen menciona ${forbidden}`);
  }
  assert.match(text, /PRODUCER_ASSUMED/);
});

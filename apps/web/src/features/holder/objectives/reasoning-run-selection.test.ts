/**
 * Regla de seleccion del analisis a mostrar — P2.4B.
 *
 * Funcion pura, asi que la regla se prueba entera sin montar la pantalla. Lo que
 * se fija aca es lo que evita el error caro: abrir un objetivo NO puede terminar
 * creando un run nuevo porque no encontramos el que ya existia.
 */

import { describe, expect, it } from 'vitest';

import {
  deduplicateRunRepresentations,
  reconcileCompletedHistory,
  selectObjectiveReasoningRun
} from '@/features/holder/objectives/reasoning-run-selection';
import type {
  ReasoningRunDetailVM,
  ReasoningRunStatus,
  ReasoningRunSummaryVM
} from '@/models/reasoning-runs';

/** La lista real llega ordenada por `createdAt` descendente. */
const run = (
  reference: string,
  status: ReasoningRunStatus,
  objectiveReference = 'obj-1'
): ReasoningRunSummaryVM => ({
  reasoningRunReference: reference,
  objectiveReference,
  objectiveTitle: 'Backend Engineer',
  status,
  requirementCount: 4,
  failureCategory: null,
  createdAt: '2026-09-11T10:00:00.000Z',
  createdAtLabel: '11 de septiembre de 2026'
});

describe('seleccion del analisis de un objetivo', () => {
  it('sin runs no selecciona nada', () => {
    expect(selectObjectiveReasoningRun([], 'obj-1').selected).toBeNull();
  });

  it('ignora runs de otros objetivos', () => {
    const selection = selectObjectiveReasoningRun(
      [run('run-ajeno', 'completed', 'obj-9')],
      'obj-1'
    );
    expect(selection.selected).toBeNull();
    expect(selection.completedHistory).toEqual([]);
  });

  it('un running gana sobre todo: ocultarlo invitaria a lanzar otro en paralelo', () => {
    const selection = selectObjectiveReasoningRun(
      [run('run-3', 'completed'), run('run-2', 'running'), run('run-1', 'pending')],
      'obj-1'
    );
    expect(selection.selected?.reasoningRunReference).toBe('run-2');
  });

  it('un pending gana sobre un completado: es el unico reintento seguro', () => {
    const selection = selectObjectiveReasoningRun(
      [run('run-2', 'pending'), run('run-1', 'completed')],
      'obj-1'
    );
    expect(selection.selected?.reasoningRunReference).toBe('run-2');
  });

  it('un completado gana sobre un failed', () => {
    const selection = selectObjectiveReasoningRun(
      [run('run-2', 'failed'), run('run-1', 'completed')],
      'obj-1'
    );
    expect(selection.selected?.reasoningRunReference).toBe('run-1');
  });

  it('con solo failed, muestra el failed', () => {
    const selection = selectObjectiveReasoningRun([run('run-1', 'failed')], 'obj-1');
    expect(selection.selected?.reasoningRunReference).toBe('run-1');
  });

  it('dentro de un mismo estado gana el mas reciente', () => {
    // La lista ya viene descendente: el primero es el mas nuevo.
    const selection = selectObjectiveReasoningRun(
      [run('run-nuevo', 'completed'), run('run-viejo', 'completed')],
      'obj-1'
    );
    expect(selection.selected?.reasoningRunReference).toBe('run-nuevo');
  });

  it('conserva TODOS los completados: un analisis nuevo no borra el anterior', () => {
    const selection = selectObjectiveReasoningRun(
      [
        run('run-3', 'pending'),
        run('run-2', 'completed'),
        run('run-1', 'completed'),
        run('run-0', 'failed')
      ],
      'obj-1'
    );
    expect(selection.selected?.reasoningRunReference).toBe('run-3');
    expect(
      selection.completedHistory.map((entry) => entry.reasoningRunReference)
    ).toEqual(['run-2', 'run-1']);
  });
});

// ---------------------------------------------------------------------------
// Identidad del run: precede a la prioridad
// ---------------------------------------------------------------------------

const detail = (
  overrides: Partial<ReasoningRunDetailVM> = {}
): ReasoningRunDetailVM => ({
  reasoningRunReference: 'run-1',
  status: 'completed',
  objectiveReference: 'obj-1',
  objectiveTitle: 'Backend Engineer',
  failureCategory: null,
  createdAt: '2026-09-11T10:00:00.000Z',
  createdAtLabel: '11 de septiembre de 2026',
  completedAtLabel: '11 de septiembre de 2026',
  requirementResults: [],
  ...overrides
});

describe('un mismo run no son dos candidatos', () => {
  it('colapsa representaciones repetidas conservando la mas reciente', () => {
    const collapsed = deduplicateRunRepresentations([
      run('run-1', 'completed'),
      run('run-1', 'pending')
    ]);

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].status).toBe('completed');
  });

  it('un pending VIEJO del mismo run no gana por prioridad', () => {
    // Sin colapsar por identidad, `pending` le ganaria a `completed` y la
    // pantalla ofreceria continuar un analisis que ya termino.
    const selection = selectObjectiveReasoningRun(
      [run('run-1', 'completed'), run('run-1', 'pending')],
      'obj-1'
    );

    expect(selection.selected?.status).toBe('completed');
    expect(selection.completedHistory).toHaveLength(1);
  });

  it('runs DISTINTOS siguen respetando la prioridad', () => {
    const selection = selectObjectiveReasoningRun(
      [run('run-2', 'completed'), run('run-1', 'pending')],
      'obj-1'
    );

    expect(selection.selected?.reasoningRunReference).toBe('run-1');
  });
});

describe('reconciliacion del historial', () => {
  it('reemplaza la representacion vieja del mismo run, sin duplicar', () => {
    const history = [run('run-1', 'completed'), run('run-0', 'completed')];
    const reconciled = reconcileCompletedHistory(
      history,
      detail({ requirementResults: [] })
    );

    expect(
      reconciled.map((entry) => entry.reasoningRunReference)
    ).toEqual(['run-1', 'run-0']);
  });

  it('incorpora un run que la lista todavia no conocia, con su fecha real', () => {
    const reconciled = reconcileCompletedHistory(
      [run('run-0', 'completed')],
      detail({
        reasoningRunReference: 'run-nuevo',
        createdAt: '2026-09-12T08:00:00.000Z'
      })
    );

    expect(reconciled).toHaveLength(2);
    expect(reconciled[0].reasoningRunReference).toBe('run-nuevo');
    // La fecha sale del detalle autoritativo; no se inventa en el cliente.
    expect(reconciled[0].createdAt).toBe('2026-09-12T08:00:00.000Z');
  });

  it('un run que NO quedo completado sale del historial de completados', () => {
    const reconciled = reconcileCompletedHistory(
      [run('run-1', 'completed')],
      detail({ status: 'failed', requirementResults: null })
    );

    expect(reconciled).toHaveLength(0);
  });

  it('reconcilia por referencia, nunca por titulo ni fecha', () => {
    // Mismo titulo y misma fecha, run distinto: son dos observaciones.
    const reconciled = reconcileCompletedHistory(
      [run('run-otro', 'completed')],
      detail({ reasoningRunReference: 'run-1' })
    );

    expect(reconciled).toHaveLength(2);
  });
});

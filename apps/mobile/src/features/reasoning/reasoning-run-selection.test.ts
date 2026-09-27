import {
  deduplicateRunRepresentations,
  reconcileCompletedHistory,
  selectObjectiveReasoningRun
} from '@/features/reasoning/reasoning-run-selection';
import type {
  ReasoningRunDetailVM,
  ReasoningRunStatus,
  ReasoningRunSummaryVM
} from '@/types/reasoning-runs';

function run(
  reference: string,
  status: ReasoningRunStatus,
  objectiveReference = 'obj_1'
): ReasoningRunSummaryVM {
  return {
    reasoningRunReference: reference,
    objectiveReference,
    objectiveTitle: 'Analista',
    status,
    requirementCount: 3,
    failureCategory: null,
    createdAt: '2026-09-20T10:00:00.000Z',
    createdAtLabel: '20 de septiembre de 2026'
  };
}

function detail(
  reference: string,
  status: ReasoningRunStatus
): ReasoningRunDetailVM {
  return {
    reasoningRunReference: reference,
    status,
    objectiveReference: 'obj_1',
    objectiveTitle: 'Analista',
    failureCategory: null,
    createdAt: '2026-09-21T10:00:00.000Z',
    createdAtLabel: '21 de septiembre de 2026',
    completedAtLabel: status === 'completed' ? '21 de septiembre de 2026' : null,
    requirementResults: status === 'completed' ? [] : null,
    synthesis: null
  };
}

describe('prioridad de visualización', () => {
  it('running gana a todo: ocultarlo invitaría a lanzar otro en paralelo', () => {
    const selection = selectObjectiveReasoningRun(
      [run('r_completed', 'completed'), run('r_running', 'running')],
      'obj_1'
    );

    expect(selection.selected?.reasoningRunReference).toBe('r_running');
  });

  it('pending gana a completed: es el único reintento seguro', () => {
    const selection = selectObjectiveReasoningRun(
      [run('r_completed', 'completed'), run('r_pending', 'pending')],
      'obj_1'
    );

    expect(selection.selected?.reasoningRunReference).toBe('r_pending');
  });

  it('completed gana a failed', () => {
    const selection = selectObjectiveReasoningRun(
      [run('r_failed', 'failed'), run('r_completed', 'completed')],
      'obj_1'
    );

    expect(selection.selected?.reasoningRunReference).toBe('r_completed');
  });

  it('dentro del mismo estado gana el más reciente (el primero de la lista)', () => {
    const selection = selectObjectiveReasoningRun(
      [run('r_nuevo', 'completed'), run('r_viejo', 'completed')],
      'obj_1'
    );

    expect(selection.selected?.reasoningRunReference).toBe('r_nuevo');
  });

  it('ignora runs de otros objetivos', () => {
    const selection = selectObjectiveReasoningRun(
      [run('r_otro', 'running', 'obj_2'), run('r_mio', 'completed', 'obj_1')],
      'obj_1'
    );

    expect(selection.selected?.reasoningRunReference).toBe('r_mio');
  });

  it('sin runs devuelve null, no un run inventado', () => {
    const selection = selectObjectiveReasoningRun([], 'obj_1');

    expect(selection.selected).toBeNull();
    expect(selection.completedHistory).toEqual([]);
  });

  it('conserva el historial completo de runs completados', () => {
    const selection = selectObjectiveReasoningRun(
      [
        run('r_running', 'running'),
        run('r_c1', 'completed'),
        run('r_c2', 'completed')
      ],
      'obj_1'
    );

    expect(selection.selected?.reasoningRunReference).toBe('r_running');
    expect(
      selection.completedHistory.map((entry) => entry.reasoningRunReference)
    ).toEqual(['r_c1', 'r_c2']);
  });
});

describe('deduplicación por identidad', () => {
  it('colapsa dos representaciones del MISMO run conservando la primera', () => {
    const collapsed = deduplicateRunRepresentations([
      run('r_1', 'completed'),
      run('r_1', 'pending')
    ]);

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]?.status).toBe('completed');
  });

  it('la identidad se resuelve ANTES que la prioridad', () => {
    // Si la prioridad corriera primero elegiría el `pending`, que es la foto
    // vieja del mismo run.
    const selection = selectObjectiveReasoningRun(
      [run('r_1', 'completed'), run('r_1', 'pending')],
      'obj_1'
    );

    expect(selection.selected?.status).toBe('completed');
  });
});

describe('reconciliación del historial', () => {
  it('agrega un run completado al frente del historial', () => {
    const history = [run('r_viejo', 'completed')];
    const next = reconcileCompletedHistory(history, detail('r_nuevo', 'completed'));

    expect(next.map((entry) => entry.reasoningRunReference)).toEqual([
      'r_nuevo',
      'r_viejo'
    ]);
  });

  it('reemplaza POR REFERENCIA, no por título ni fecha', () => {
    const history = [run('r_1', 'completed'), run('r_2', 'completed')];
    const next = reconcileCompletedHistory(history, detail('r_1', 'completed'));

    expect(next).toHaveLength(2);
    expect(next[0]?.reasoningRunReference).toBe('r_1');
    expect(next[0]?.createdAt).toBe('2026-09-21T10:00:00.000Z');
  });

  it('un run que ya no está completado sale del historial', () => {
    const history = [run('r_1', 'completed')];
    const next = reconcileCompletedHistory(history, detail('r_1', 'failed'));

    expect(next).toEqual([]);
  });

  it('usa el conteo de resultados y cae al previo cuando no hay', () => {
    const history = [run('r_1', 'completed')];
    const withResults = reconcileCompletedHistory(history, {
      ...detail('r_1', 'completed'),
      requirementResults: [
        {
          requirementId: 'req_01',
          requirementText: 'x',
          finalState: 'SUPPORTED',
          supportedWeakerClaim: null,
          evidence: []
        }
      ]
    });

    expect(withResults[0]?.requirementCount).toBe(1);
  });
});

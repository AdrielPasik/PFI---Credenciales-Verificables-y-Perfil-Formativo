import { mapReviewItemToRequirement } from '@/features/objectives/review-draft';
import {
  initialObjectiveFlowState,
  objectiveFlowReducer,
  type ObjectiveFlowState
} from '@/features/objectives/use-objective-flow';
import type {
  AnalyzedObjectiveSnapshot,
  ObjectiveProposalVM
} from '@/types/objectives';

const SNAPSHOT: AnalyzedObjectiveSnapshot = {
  objectiveType: 'EMPLOYMENT',
  title: 'Analista',
  rawObjectiveText: 'Python avanzado. SQL intermedio.'
};

const PROPOSAL: ObjectiveProposalVM = {
  candidates: [
    {
      candidateId: 'cand_01',
      proposedRequirementText: 'Python avanzado',
      primaryExcerpt: 'Python avanzado',
      excerptRange: { start: 0, end: 15 },
      grounding: 'UNIQUE',
      confirmableAsSourceDerived: true,
      sourceSectionLabel: null,
      isExactDuplicate: false
    },
    {
      candidateId: 'cand_02',
      proposedRequirementText: 'SQL intermedio',
      primaryExcerpt: 'SQL intermedio',
      excerptRange: { start: 17, end: 31 },
      grounding: 'UNIQUE',
      confirmableAsSourceDerived: true,
      sourceSectionLabel: null,
      isExactDuplicate: false
    }
  ],
  unresolvedPassageCount: 1
};

function reviewing(): ObjectiveFlowState {
  return objectiveFlowReducer(initialObjectiveFlowState, {
    type: 'analyzeSucceeded',
    snapshot: SNAPSHOT,
    proposal: PROPOSAL
  });
}

describe('carga del objetivo', () => {
  it('no tiene tipo elegido por defecto', () => {
    expect(initialObjectiveFlowState.intake.objectiveType).toBeNull();
  });

  it('recibir la propuesta fija fase, snapshot y borrador a la vez', () => {
    const state = reviewing();

    expect(state.phase).toBe('review');
    expect(state.draft?.snapshot).toEqual(SNAPSHOT);
    expect(state.draft?.items).toHaveLength(2);
    expect(state.proposedCount).toBe(2);
    expect(state.draft?.unresolvedPassageCount).toBe(1);
  });

  it('un fallo de análisis conserva TODO lo escrito', () => {
    const typed = objectiveFlowReducer(initialObjectiveFlowState, {
      type: 'setIntakeField',
      field: 'rawObjectiveText',
      value: 'texto largo que costó pegar'
    });
    const failed = objectiveFlowReducer(typed, {
      type: 'analyzeFailed',
      message: 'sin servicio',
      retryable: true
    });

    expect(failed.intake.rawObjectiveText).toBe('texto largo que costó pegar');
    expect(failed.analyzing).toBe(false);
    expect(failed.error).toBe('sin servicio');
  });
});

describe('operaciones de revisión', () => {
  it('editar marca el item y no toca a los demás', () => {
    const state = objectiveFlowReducer(reviewing(), {
      type: 'editItem',
      localKey: reviewing().draft!.items[0]!.localKey,
      text: 'Python experto'
    });

    expect(state.draft?.items[1]?.wasEverEdited).toBe(false);
  });

  it('agregar un requisito manual lo pone al final y pide foco', () => {
    const state = objectiveFlowReducer(reviewing(), { type: 'addManualItem' });

    expect(state.draft?.items).toHaveLength(3);
    expect(state.draft?.items[2]?.origin).toBe('MANUAL');
    expect(state.focusRequestKey).toBe(state.draft?.items[2]?.localKey);
  });

  it('eliminar guarda el item y su posición para deshacer', () => {
    const base = reviewing();
    const state = objectiveFlowReducer(base, {
      type: 'removeItem',
      localKey: base.draft!.items[0]!.localKey
    });

    expect(state.draft?.items).toHaveLength(1);
    expect(state.lastRemoved?.index).toBe(0);
  });

  it('deshacer restituye en la POSICIÓN original', () => {
    const base = reviewing();
    const removed = objectiveFlowReducer(base, {
      type: 'removeItem',
      localKey: base.draft!.items[0]!.localKey
    });
    const restored = objectiveFlowReducer(removed, { type: 'undoRemove' });

    expect(restored.draft?.items).toHaveLength(2);
    expect(restored.draft?.items[0]?.candidateId).toBe('cand_01');
    expect(restored.lastRemoved).toBeNull();
  });

  it('deshacer NO resetea wasEverEdited', () => {
    const base = reviewing();
    const key = base.draft!.items[0]!.localKey;
    const edited = objectiveFlowReducer(base, {
      type: 'editItem',
      localKey: key,
      text: 'otra cosa'
    });
    const removed = objectiveFlowReducer(edited, {
      type: 'removeItem',
      localKey: key
    });
    const restored = objectiveFlowReducer(removed, { type: 'undoRemove' });

    expect(restored.draft?.items[0]?.wasEverEdited).toBe(true);
  });

  it('mover intercambia posiciones sin tocar la procedencia', () => {
    const base = reviewing();
    const before = base.draft!.items.map(mapReviewItemToRequirement);
    const moved = objectiveFlowReducer(base, {
      type: 'moveItem',
      localKey: base.draft!.items[0]!.localKey,
      direction: 1
    });
    const after = moved.draft!.items.map(mapReviewItemToRequirement);

    expect(after[0]).toEqual(before[1]);
    expect(after[1]).toEqual(before[0]);
    expect(moved.draft?.items[0]?.wasEverEdited).toBe(false);
    expect(moved.draft?.items[1]?.wasEverEdited).toBe(false);
  });

  it('mover fuera de rango no hace nada', () => {
    const base = reviewing();
    const up = objectiveFlowReducer(base, {
      type: 'moveItem',
      localKey: base.draft!.items[0]!.localKey,
      direction: -1
    });
    expect(up).toBe(base);

    const down = objectiveFlowReducer(base, {
      type: 'moveItem',
      localKey: base.draft!.items[1]!.localKey,
      direction: 1
    });
    expect(down).toBe(base);
  });
});

describe('descartar la revisión', () => {
  it('vuelve a la carga y descarta borrador, propuesta y deshacer', () => {
    const base = reviewing();
    const removed = objectiveFlowReducer(base, {
      type: 'removeItem',
      localKey: base.draft!.items[0]!.localKey
    });
    const discarded = objectiveFlowReducer(removed, { type: 'discardReview' });

    expect(discarded.phase).toBe('intake');
    expect(discarded.draft).toBeNull();
    expect(discarded.proposedCount).toBe(0);
    expect(discarded.lastRemoved).toBeNull();
  });
});

describe('fallo al confirmar', () => {
  it('deja el borrador INTACTO para reintentar sólo la creación', () => {
    const base = reviewing();
    const confirming = objectiveFlowReducer(base, { type: 'confirmStarted' });
    const failed = objectiveFlowReducer(confirming, {
      type: 'confirmFailed',
      message: 'sin servicio',
      retryable: true
    });

    expect(failed.confirming).toBe(false);
    expect(failed.draft?.items).toHaveLength(2);
    expect(failed.phase).toBe('review');
    // La propuesta NO se vuelve a pedir: sigue siendo la misma.
    expect(failed.draft?.snapshot).toEqual(SNAPSHOT);
  });
});

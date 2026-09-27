import { useCallback, useMemo, useReducer } from 'react';

import {
  applyTextEdit,
  buildReviewDraft,
  createManualItem
} from '@/features/objectives/review-draft';
import type {
  AnalyzedObjectiveSnapshot,
  ObjectiveProposalVM,
  ObjectiveReviewDraft,
  ObjectiveTypeToken,
  ReviewItem
} from '@/types/objectives';

/**
 * Estado del flujo de objetivo.
 *
 * Un `useReducer` y no varios `useState` porque las transiciones son CONJUNTAS:
 * recibir la propuesta fija fase, snapshot y borrador a la vez, y si esas tres
 * se pudieran mover por separado existiría un estado intermedio donde hay
 * borrador sin snapshot. El snapshot es la autoridad del texto, así que ese
 * estado no puede existir.
 *
 * Todo es local y en memoria. No hay store global, no hay borrador en servidor,
 * y NADA se persiste: la propuesta es transitoria por contrato, y guardar el
 * texto privado de un objetivo en el dispositivo sólo para sobrevivir a una
 * navegación sería crear una copia de datos privados que nadie pidió.
 */

export interface IntakeState {
  objectiveType: ObjectiveTypeToken | null;
  title: string;
  rawObjectiveText: string;
}

interface RemovedItem {
  item: ReviewItem;
  index: number;
}

export interface ObjectiveFlowState {
  phase: 'intake' | 'review';
  intake: IntakeState;
  draft: ObjectiveReviewDraft | null;
  proposedCount: number;
  analyzing: boolean;
  confirming: boolean;
  error: string | null;
  errorRetryable: boolean;
  lastRemoved: RemovedItem | null;
  focusRequestKey: string | null;
}

export const initialObjectiveFlowState: ObjectiveFlowState = {
  phase: 'intake',
  intake: { objectiveType: null, title: '', rawObjectiveText: '' },
  draft: null,
  proposedCount: 0,
  analyzing: false,
  confirming: false,
  error: null,
  errorRetryable: false,
  lastRemoved: null,
  focusRequestKey: null
};

export type ObjectiveFlowAction =
  | { type: 'setIntakeField'; field: keyof IntakeState; value: string }
  | { type: 'setObjectiveType'; value: ObjectiveTypeToken }
  | { type: 'analyzeStarted' }
  | {
      type: 'analyzeSucceeded';
      snapshot: AnalyzedObjectiveSnapshot;
      proposal: ObjectiveProposalVM;
    }
  | { type: 'analyzeFailed'; message: string; retryable: boolean }
  | { type: 'confirmStarted' }
  | { type: 'confirmFailed'; message: string; retryable: boolean }
  | { type: 'failLocally'; message: string; localKey?: string }
  | { type: 'dismissError' }
  | { type: 'discardReview' }
  | { type: 'editItem'; localKey: string; text: string }
  | { type: 'removeItem'; localKey: string }
  | { type: 'undoRemove' }
  | { type: 'clearUndo' }
  | { type: 'addManualItem' }
  | { type: 'moveItem'; localKey: string; direction: -1 | 1 }
  | { type: 'focusHandled' };

function withDraft(
  state: ObjectiveFlowState,
  update: (draft: ObjectiveReviewDraft) => ObjectiveReviewDraft
): ObjectiveFlowState {
  if (state.draft === null) return state;
  return { ...state, draft: update(state.draft) };
}

export function objectiveFlowReducer(
  state: ObjectiveFlowState,
  action: ObjectiveFlowAction
): ObjectiveFlowState {
  switch (action.type) {
    case 'setIntakeField':
      return {
        ...state,
        intake: { ...state.intake, [action.field]: action.value },
        error: null
      };

    case 'setObjectiveType':
      return {
        ...state,
        intake: { ...state.intake, objectiveType: action.value },
        error: null
      };

    case 'analyzeStarted':
      return { ...state, analyzing: true, error: null, errorRetryable: false };

    case 'analyzeSucceeded': {
      const draft = buildReviewDraft(action.snapshot, action.proposal);
      return {
        ...state,
        phase: 'review',
        analyzing: false,
        draft,
        proposedCount: action.proposal.candidates.length,
        error: null,
        errorRetryable: false,
        lastRemoved: null
      };
    }

    case 'analyzeFailed':
      // Se conserva TODO lo escrito: perderlo obligaría a pegar el objetivo de
      // nuevo por un fallo que no es de la persona.
      return {
        ...state,
        analyzing: false,
        error: action.message,
        errorRetryable: action.retryable
      };

    case 'confirmStarted':
      return { ...state, confirming: true, error: null, errorRetryable: false };

    case 'confirmFailed':
      // El borrador queda INTACTO. Y no se re-dispara la propuesta: el
      // proveedor no se vuelve a llamar por un fallo de creación.
      return {
        ...state,
        confirming: false,
        error: action.message,
        errorRetryable: action.retryable
      };

    case 'failLocally':
      return {
        ...state,
        confirming: false,
        analyzing: false,
        error: action.message,
        errorRetryable: false,
        focusRequestKey: action.localKey ?? null
      };

    case 'dismissError':
      return { ...state, error: null, errorRetryable: false };

    case 'discardReview':
      // Vuelve al intake con los valores previos. La propuesta, el borrador y
      // el deshacer se descartan enteros: no se reaprovecha ningún candidato.
      return {
        ...state,
        phase: 'intake',
        draft: null,
        proposedCount: 0,
        lastRemoved: null,
        error: null,
        errorRetryable: false
      };

    case 'editItem':
      return withDraft(state, (draft) => ({
        ...draft,
        items: draft.items.map((item) =>
          item.localKey === action.localKey
            ? applyTextEdit(item, action.text)
            : item
        )
      }));

    case 'removeItem': {
      if (state.draft === null) return state;
      const index = state.draft.items.findIndex(
        (item) => item.localKey === action.localKey
      );
      if (index === -1) return state;
      const item = state.draft.items[index];
      if (item === undefined) return state;

      return {
        ...state,
        draft: {
          ...state.draft,
          items: state.draft.items.filter((_, position) => position !== index)
        },
        lastRemoved: { item, index }
      };
    }

    case 'undoRemove': {
      if (state.draft === null || state.lastRemoved === null) return state;
      const { item, index } = state.lastRemoved;
      const items = [...state.draft.items];
      // Se restituye en su POSICIÓN original, con su estado intacto —incluida
      // `wasEverEdited`, que es monotónica y no puede resetearse por deshacer.
      items.splice(Math.min(index, items.length), 0, item);

      return {
        ...state,
        draft: { ...state.draft, items },
        lastRemoved: null,
        focusRequestKey: item.localKey
      };
    }

    case 'clearUndo':
      return { ...state, lastRemoved: null };

    case 'addManualItem': {
      if (state.draft === null) return state;
      const item = createManualItem();

      return {
        ...state,
        draft: { ...state.draft, items: [...state.draft.items, item] },
        focusRequestKey: item.localKey,
        error: null
      };
    }

    case 'moveItem': {
      if (state.draft === null) return state;
      const index = state.draft.items.findIndex(
        (item) => item.localKey === action.localKey
      );
      const target = index + action.direction;
      if (index === -1 || target < 0 || target >= state.draft.items.length) {
        return state;
      }

      const items = [...state.draft.items];
      const current = items[index];
      const swapped = items[target];
      if (current === undefined || swapped === undefined) return state;
      items[index] = swapped;
      items[target] = current;

      // Mover NO toca `wasEverEdited` ni la procedencia: el servidor deriva
      // `order` de la posición final y la procedencia viaja dentro del item.
      return { ...state, draft: { ...state.draft, items } };
    }

    case 'focusHandled':
      return { ...state, focusRequestKey: null };

    default:
      return state;
  }
}

export function useObjectiveFlow() {
  const [state, dispatch] = useReducer(
    objectiveFlowReducer,
    initialObjectiveFlowState
  );

  const actions = useMemo(
    () => ({
      setIntakeField: (field: keyof IntakeState, value: string) =>
        dispatch({ type: 'setIntakeField', field, value }),
      setObjectiveType: (value: ObjectiveTypeToken) =>
        dispatch({ type: 'setObjectiveType', value }),
      editItem: (localKey: string, text: string) =>
        dispatch({ type: 'editItem', localKey, text }),
      removeItem: (localKey: string) =>
        dispatch({ type: 'removeItem', localKey }),
      undoRemove: () => dispatch({ type: 'undoRemove' }),
      clearUndo: () => dispatch({ type: 'clearUndo' }),
      addManualItem: () => dispatch({ type: 'addManualItem' }),
      moveItem: (localKey: string, direction: -1 | 1) =>
        dispatch({ type: 'moveItem', localKey, direction }),
      discardReview: () => dispatch({ type: 'discardReview' }),
      dismissError: () => dispatch({ type: 'dismissError' }),
      focusHandled: () => dispatch({ type: 'focusHandled' })
    }),
    []
  );

  const dispatchAction = useCallback(
    (action: ObjectiveFlowAction) => dispatch(action),
    []
  );

  return { state, dispatch: dispatchAction, actions };
}

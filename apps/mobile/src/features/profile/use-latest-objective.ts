import { useQuery } from '@tanstack/react-query';

import { useObjectives } from '@/features/objectives/use-objectives';
import { selectObjectiveReasoningRun } from '@/features/reasoning/reasoning-run-selection';
import {
  getMyReasoningRunRequest,
  listMyReasoningRunsRequest
} from '@/lib/api/scope-api';
import { useAuthenticatedRequest } from '@/lib/auth/session-provider';
import { queryKeys } from '@/lib/query/query-client';
import type { ObjectiveSummaryVM } from '@/types/objectives';
import type { ObjectiveSynthesisStateSummaryVM } from '@/types/reasoning-runs';

export type LatestObjectiveAnalysis =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'none' }
  | { kind: 'in-progress' }
  | { kind: 'failed' }
  | {
      kind: 'completed';
      analyzedAtLabel: string;
      stateSummary: ObjectiveSynthesisStateSummaryVM | null;
    };

export type LatestObjectiveState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'empty' }
  | {
      status: 'ready';
      objective: ObjectiveSummaryVM;
      analysis: LatestObjectiveAnalysis;
    };

/**
 * Objetivo más reciente y el estado de su análisis, para el inicio.
 *
 * SÓLO LECTURA, con los mismos endpoints que ya usan la lista de objetivos y
 * el detalle: la lista de objetivos (orden descendente, como en Scope Web),
 * la lista de análisis y, si el último terminó, su detalle para leer los
 * recuentos de la síntesis. Nunca crea ni ejecuta un análisis.
 *
 * Si algo falla, la tarjeta pierde ese dato pero el inicio sigue funcionando.
 */
export function useLatestObjective() {
  const request = useAuthenticatedRequest();
  const objectivesQuery = useObjectives();
  const latest = objectivesQuery.data?.[0] ?? null;

  const runsQuery = useQuery({
    queryKey: queryKeys.reasoningRuns,
    queryFn: () => listMyReasoningRunsRequest(request),
    enabled: latest !== null
  });

  const selected =
    latest && runsQuery.data
      ? selectObjectiveReasoningRun(runsQuery.data, latest.objectiveReference)
          .selected
      : null;
  const completedReference =
    selected?.status === 'completed' ? selected.reasoningRunReference : null;

  const runQuery = useQuery({
    queryKey: queryKeys.reasoningRun(completedReference ?? ''),
    queryFn: () => getMyReasoningRunRequest(request, completedReference ?? ''),
    enabled: completedReference !== null
  });

  const refetch = () => {
    void objectivesQuery.refetch();
    if (latest) void runsQuery.refetch();
    if (completedReference) void runQuery.refetch();
  };

  let state: LatestObjectiveState;
  if (objectivesQuery.isLoading) {
    state = { status: 'loading' };
  } else if (objectivesQuery.isError) {
    state = { status: 'unavailable' };
  } else if (latest === null) {
    state = { status: 'empty' };
  } else {
    state = {
      status: 'ready',
      objective: latest,
      analysis: analysisFor(selected, runsQuery, runQuery)
    };
  }

  return { state, refetch };
}

function analysisFor(
  selected: ReturnType<typeof selectObjectiveReasoningRun>['selected'],
  runsQuery: { isLoading: boolean; isError: boolean },
  runQuery: {
    isLoading: boolean;
    isError: boolean;
    data?: { synthesis: { stateSummary: ObjectiveSynthesisStateSummaryVM } | null };
  }
): LatestObjectiveAnalysis {
  if (runsQuery.isLoading) return { kind: 'loading' };
  if (runsQuery.isError) return { kind: 'unavailable' };
  if (selected === null) return { kind: 'none' };
  if (selected.status === 'failed') return { kind: 'failed' };
  if (selected.status !== 'completed') return { kind: 'in-progress' };
  if (runQuery.isLoading) return { kind: 'loading' };
  return {
    kind: 'completed',
    analyzedAtLabel: selected.createdAtLabel,
    // Sin detalle (o sin síntesis) se muestra que hubo análisis, sin recuentos.
    stateSummary: runQuery.isError ? null : (runQuery.data?.synthesis?.stateSummary ?? null)
  };
}

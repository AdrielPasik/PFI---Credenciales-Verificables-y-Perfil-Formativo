/**
 * Que analisis mostrar para un objetivo — P2.4B.
 *
 * Funcion PURA sobre el contrato de resumen, para que la regla se pueda leer y
 * probar sin montar la pantalla. Es la pieza que evita el error mas caro de esta
 * slice: crear un run nuevo en cada visita.
 *
 * ENTRADA: `GET /me/reasoning-runs`, que ya llega ordenado por `createdAt`
 * descendente. No se reordena; se filtra por objetivo y se elige por estado.
 */

import type {
  ReasoningRunDetailVM,
  ReasoningRunStatus,
  ReasoningRunSummaryVM
} from '@/models/reasoning-runs';

/**
 * PRIORIDAD DE VISUALIZACION, y el porqué de cada escalon:
 *
 *   running    hay una ejecucion en vuelo. Ocultarla invitaria a lanzar otra en
 *              paralelo, que compraria llamadas al proveedor por duplicado.
 *   pending    el run existe y no ejecuto. Es el UNICO reintento seguro que el
 *              backend admite sobre la misma fila, asi que tiene que verse
 *              antes que un resultado viejo — si no, esa continuacion queda
 *              inalcanzable.
 *   completed  el resultado. Debajo de los dos anteriores porque esos son
 *              acciones en curso, no historia.
 *   failed     ultimo recurso: solo cuando no hay nada mejor que mostrar.
 *
 * Dentro de un mismo estado gana el MAS RECIENTE, que es el primero de la lista.
 */
const DISPLAY_PRIORITY: readonly ReasoningRunStatus[] = [
  'running',
  'pending',
  'completed',
  'failed'
];

export interface ObjectiveReasoningSelection {
  /** El run a mostrar, o `null` si el objetivo todavia no tiene ninguno. */
  selected: ReasoningRunSummaryVM | null;
  /**
   * Todos los runs COMPLETADOS de este objetivo, del mas reciente al mas viejo.
   *
   * Se conservan enteros aunque se muestre otro: un run es una observacion
   * fechada e inmutable, y un analisis nuevo no borra el anterior.
   */
  completedHistory: readonly ReasoningRunSummaryVM[];
}

/**
 * Colapsa representaciones REPETIDAS de un mismo run, conservando la primera.
 *
 * La prioridad de arriba compara runs DISTINTOS. No puede usarse para elegir
 * entre dos representaciones del MISMO run: `pending` y `completed` con la
 * misma referencia no son dos candidatos, son un run visto en dos momentos —y
 * la prioridad elegiria el `pending`, que es justamente el viejo—.
 *
 * Por eso la identidad se resuelve ANTES que la prioridad. La entrada llega
 * ordenada por el servidor de mas nuevo a mas viejo, asi que la primera
 * aparicion es la representacion mas reciente.
 */
export function deduplicateRunRepresentations(
  runs: readonly ReasoningRunSummaryVM[]
): ReasoningRunSummaryVM[] {
  const seen = new Set<string>();
  const collapsed: ReasoningRunSummaryVM[] = [];

  for (const run of runs) {
    if (seen.has(run.reasoningRunReference)) continue;
    seen.add(run.reasoningRunReference);
    collapsed.push(run);
  }

  return collapsed;
}

/**
 * Incorpora al historial el run que acaba de devolver una operacion autoritativa.
 *
 * Se reconcilia POR REFERENCIA, que es identidad del backend. Nunca por titulo,
 * fecha ni estado parecido: dos runs del mismo objetivo comparten titulo y
 * pueden compartir dia, asi que emparejarlos por ahi fusionaria observaciones
 * distintas.
 *
 * Un run que ya no esta `completed` sale del historial de completados en vez de
 * quedar como una entrada fantasma.
 */
export function reconcileCompletedHistory(
  history: readonly ReasoningRunSummaryVM[],
  run: ReasoningRunDetailVM
): ReasoningRunSummaryVM[] {
  const others = history.filter(
    (entry) => entry.reasoningRunReference !== run.reasoningRunReference
  );

  if (run.status !== 'completed') return others;

  const previous = history.find(
    (entry) => entry.reasoningRunReference === run.reasoningRunReference
  );

  const entry: ReasoningRunSummaryVM = {
    reasoningRunReference: run.reasoningRunReference,
    objectiveReference: run.objectiveReference,
    objectiveTitle: run.objectiveTitle,
    status: 'completed',
    requirementCount: run.requirementResults?.length ?? previous?.requirementCount ?? 0,
    failureCategory: run.failureCategory,
    createdAt: run.createdAt,
    createdAtLabel: run.createdAtLabel
  };

  // Va primero: es el mas reciente de este objetivo, que es el mismo criterio
  // con el que el servidor ordena la lista.
  return [entry, ...others];
}

export function selectObjectiveReasoningRun(
  runs: readonly ReasoningRunSummaryVM[],
  objectiveReference: string
): ObjectiveReasoningSelection {
  const mine = deduplicateRunRepresentations(runs).filter(
    (run) => run.objectiveReference === objectiveReference
  );

  let selected: ReasoningRunSummaryVM | null = null;
  for (const status of DISPLAY_PRIORITY) {
    const match = mine.find((run) => run.status === status);
    if (match) {
      selected = match;
      break;
    }
  }

  return {
    selected,
    completedHistory: mine.filter((run) => run.status === 'completed')
  };
}

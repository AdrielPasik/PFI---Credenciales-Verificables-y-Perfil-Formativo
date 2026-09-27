import type {
  ReasoningRunDetailVM,
  ReasoningRunStatus,
  ReasoningRunSummaryVM
} from '@/types/reasoning-runs';

/**
 * Qué análisis mostrar para un objetivo.
 *
 * Función PURA sobre el contrato de resumen, para que la regla se pueda leer y
 * probar sin montar la pantalla. Es la pieza que evita el error más caro de
 * esta capacidad: crear un run nuevo en cada visita.
 *
 * ENTRADA: `GET /me/reasoning-runs`, que ya llega ordenado por `createdAt`
 * descendente. No se reordena; se filtra por objetivo y se elige por estado.
 */

/**
 * PRIORIDAD DE VISUALIZACIÓN, y el porqué de cada escalón:
 *
 *   running    hay una ejecución en vuelo. Ocultarla invitaría a lanzar otra en
 *              paralelo, que compraría llamadas al proveedor por duplicado.
 *   pending    el run existe y no ejecutó. Es el ÚNICO reintento seguro que el
 *              backend admite sobre la misma fila, así que tiene que verse
 *              antes que un resultado viejo — si no, esa continuación queda
 *              inalcanzable.
 *   completed  el resultado. Debajo de los dos anteriores porque esos son
 *              acciones en curso, no historia.
 *   failed     último recurso: sólo cuando no hay nada mejor que mostrar.
 *
 * Dentro de un mismo estado gana el MÁS RECIENTE, que es el primero de la lista.
 */
const DISPLAY_PRIORITY: readonly ReasoningRunStatus[] = [
  'running',
  'pending',
  'completed',
  'failed'
];

export interface ObjectiveReasoningSelection {
  /** El run a mostrar, o `null` si el objetivo todavía no tiene ninguno. */
  selected: ReasoningRunSummaryVM | null;
  /**
   * Todos los runs COMPLETADOS de este objetivo, del más reciente al más viejo.
   *
   * Se conservan enteros aunque se muestre otro: un run es una observación
   * fechada e inmutable, y un análisis nuevo no borra el anterior.
   */
  completedHistory: readonly ReasoningRunSummaryVM[];
}

/**
 * Colapsa representaciones REPETIDAS de un mismo run, conservando la primera.
 *
 * La prioridad de arriba compara runs DISTINTOS. No puede usarse para elegir
 * entre dos representaciones del MISMO run: `pending` y `completed` con la
 * misma referencia no son dos candidatos, son un run visto en dos momentos —y
 * la prioridad elegiría el `pending`, que es justamente el viejo—.
 *
 * Por eso la identidad se resuelve ANTES que la prioridad. La entrada llega
 * ordenada por el servidor de más nuevo a más viejo, así que la primera
 * aparición es la representación más reciente.
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
 * Incorpora al historial el run que acaba de devolver una operación
 * autoritativa.
 *
 * Se reconcilia POR REFERENCIA, que es identidad del backend. Nunca por título,
 * fecha ni estado parecido: dos runs del mismo objetivo comparten título y
 * pueden compartir día, así que emparejarlos por ahí fusionaría observaciones
 * distintas.
 *
 * Un run que ya no está `completed` sale del historial de completados en vez de
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
    requirementCount:
      run.requirementResults?.length ?? previous?.requirementCount ?? 0,
    failureCategory: run.failureCategory,
    createdAt: run.createdAt,
    createdAtLabel: run.createdAtLabel
  };

  // Va primero: es el más reciente de este objetivo, que es el mismo criterio
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

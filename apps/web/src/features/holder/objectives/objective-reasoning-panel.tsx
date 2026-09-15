'use client';

/**
 * Analisis de trayectoria de un objetivo — P2.4B.
 *
 * Maneja el lifecycle REAL de F3, que tiene una forma poco habitual y conviene
 * tener presente al leer esto:
 *
 *     crear   congela el universo de evidencia. NO ejecuta. Es barato.
 *     ejecutar  compra observaciones al proveedor. Es SINCRONO y puede tardar.
 *
 * NO EXISTEN `/retry`, `/cancel` ni `/reset`. Reintentar es volver a llamar a
 * `execute` sobre un run propio que quedo `pending`. Un run que quedo `running`
 * NO se rescata —`NON_RECOVERABLE_RUNNING_CLAIM`—: la respuesta de producto es
 * crear uno nuevo, no insistir sobre el viejo.
 *
 * NADA SE DISPARA SOLO. El efecto solo LEE la lista de runs; crear y ejecutar
 * ocurren unicamente por un click. Un `useEffect` que ejecutara compraria
 * llamadas al proveedor sin que nadie las pidiera.
 */

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { Button } from '@/components/ui/button';
import {
  CompactRequirementList,
  requirementMatchesFilter,
  type RequirementFilter
} from '@/features/holder/objectives/compact-requirement-list';
import { RequirementResultCard } from '@/features/holder/objectives/requirement-result-card';
import {
  ObjectiveSynthesisMetadata,
  ObjectiveSynthesisOverview
} from '@/features/holder/objectives/objective-synthesis-overview';
import {
  reconcileCompletedHistory,
  selectObjectiveReasoningRun
} from '@/features/holder/objectives/reasoning-run-selection';
import {
  createMyReasoningRunRequest,
  executeMyReasoningRunRequest,
  getMyReasoningRunRequest,
  listMyReasoningRunsRequest
} from '@/lib/api/reasoning-runs-api';
import {
  describeRunFailure,
  mapReasoningRunActionError,
  mapReasoningRunReadError
} from '@/lib/errors/reasoning-run-error-mapper';
import { useSession } from '@/lib/session/session-provider';
import {
  countByFinalState,
  type ReasoningRunDetailVM,
  type ReasoningRunSummaryVM
} from '@/models/reasoning-runs';

type PanelState =
  | { phase: 'loading' }
  /** No hay ningun run para este objetivo. */
  | { phase: 'absent' }
  /** Hay un run; `detail` es `null` mientras se resuelve su contenido. */
  | { phase: 'ready'; run: ReasoningRunDetailVM }
  /** Estamos comprando el analisis AHORA. Distinto de encontrarlo `running`. */
  | { phase: 'executing' }
  | { phase: 'error'; message: string; retryable: boolean };

export function ObjectiveReasoningPanel({
  objectiveReference,
  onCompletedSynthesisChange,
  completedSynthesisContext
}: {
  objectiveReference: string;
  onCompletedSynthesisChange?: (hasCompletedSynthesis: boolean) => void;
  completedSynthesisContext?: ReactNode;
}) {
  const { requestAuthenticated } = useSession();
  const [state, setState] = useState<PanelState>({ phase: 'loading' });
  const [history, setHistory] = useState<readonly ReasoningRunSummaryVM[]>([]);
  const [reloadToken, setReloadToken] = useState(0);

  const hasCompletedSynthesis =
    state.phase === 'ready' &&
    state.run.status === 'completed' &&
    state.run.synthesis !== null;

  useEffect(() => {
    onCompletedSynthesisChange?.(hasCompletedSynthesis);
  }, [hasCompletedSynthesis, onCompletedSynthesisChange]);

  /**
   * Cerrojo de una sola operacion en vuelo.
   *
   * Es un `ref` y no un estado: tiene que bloquear en el MISMO tick del click,
   * antes de cualquier re-render. Un doble click rapido sobre "Analizar" con
   * solo el `disabled` de React podria colarse entre el primer click y el
   * repintado, y eso son dos runs y dos tandas de llamadas al proveedor.
   */
  const busyRef = useRef(false);

  /**
   * QUIEN GANA CUANDO DOS RESPUESTAS COMPITEN.
   *
   * Esta pantalla tiene DOS escritores del mismo estado: el efecto de lectura y
   * los clicks que ejecutan. Corren en paralelo y no llegan en orden — la
   * ejecucion es sincrona y tarda decenas de segundos, y `requestAuthenticated`
   * se recrea en cada render del proveedor de sesion, asi que el efecto puede
   * volver a dispararse EN MEDIO de una ejecucion.
   *
   * Sin arbitro, una lectura que arranco antes y resuelve despues pisa el run
   * completado con la foto vieja —`pending` o `running`— y la pantalla queda
   * mostrando trabajo en curso sobre un analisis que ya termino. Desde ahi la
   * unica salida es recargar, o el boton de iniciar otro analisis, que compraria
   * cinco llamadas mas al proveedor.
   *
   * El arbitro es un numero de operacion monotono, y la asimetria es deliberada:
   *
   *   una LECTURA saca su turno cuando ARRANCA. Refleja el estado de ese momento.
   *   una MUTACION saca su turno cuando RESUELVE. Acaba de cambiar el servidor,
   *     asi que es lo mas fresco que existe.
   *
   * Con eso, una lectura iniciada antes de que la ejecucion terminara siempre
   * tiene un turno menor y se descarta. No hay timestamps del cliente ni
   * heuristicas: solo el orden real de las operaciones.
   */
  const operationSeqRef = useRef(0);
  const appliedSeqRef = useRef(0);

  /** Reserva el proximo turno. */
  const takeTicket = useCallback(() => {
    operationSeqRef.current += 1;
    return operationSeqRef.current;
  }, []);

  /** `true` si este turno todavia puede escribir; lo consume si puede. */
  const acceptTicket = useCallback((ticket: number) => {
    if (ticket < appliedSeqRef.current) return false;
    appliedSeqRef.current = ticket;
    return true;
  }, []);

  useEffect(() => {
    let active = true;
    const ticket = takeTicket();

    // Solo LECTURA. Una consulta a la lista; el detalle se pide unicamente si
    // hay un run completado que mostrar.
    void listMyReasoningRunsRequest(requestAuthenticated)
      .then(async (runs) => {
        if (!active) return;
        const selection = selectObjectiveReasoningRun(runs, objectiveReference);

        if (selection.selected === null) {
          // `busyRef` se consulta al RESOLVER, no al arrancar: mientras nosotros
          // mismos tenemos una operacion en vuelo, ninguna lectura toca el
          // estado. El desenlace autoritativo lo escribe esa operacion.
          if (busyRef.current || !acceptTicket(ticket)) return;
          setHistory(selection.completedHistory);
          setState({ phase: 'absent' });
          return;
        }
        const detail = await getMyReasoningRunRequest(
          requestAuthenticated,
          selection.selected.reasoningRunReference
        );
        if (!active || busyRef.current || !acceptTicket(ticket)) return;
        setHistory(selection.completedHistory);
        setState({ phase: 'ready', run: detail });
      })
      .catch((error: unknown) => {
        if (!active || busyRef.current || !acceptTicket(ticket)) return;
        setState({
          phase: 'error',
          message: mapReasoningRunReadError(error),
          retryable: true
        });
      });

    return () => {
      active = false;
    };
  }, [acceptTicket, objectiveReference, reloadToken, requestAuthenticated, takeTicket]);

  /**
   * Publica el desenlace de una operacion propia. Es la escritura autoritativa:
   * saca turno AHORA, asi que gana sobre cualquier lectura ya en vuelo.
   */
  const commitExecutedRun = useCallback(
    (run: ReasoningRunDetailVM) => {
      if (!acceptTicket(takeTicket())) return;
      setState({ phase: 'ready', run });
      // El historial se reconcilia por referencia: el run recien devuelto no
      // puede quedar duplicado ni conservar su representacion vieja.
      setHistory((current) => reconcileCompletedHistory(current, run));
    },
    [acceptTicket, takeTicket]
  );

  const commitOperationFailure = useCallback(
    (error: unknown) => {
      const mapped = mapReasoningRunActionError(error);
      if (!acceptTicket(takeTicket())) return;
      setState({ phase: 'error', message: mapped.message, retryable: mapped.retryable });
    },
    [acceptTicket, takeTicket]
  );

  const reload = useCallback(() => {
    setState({ phase: 'loading' });
    setReloadToken((token) => token + 1);
  }, []);

  /** Crear y ejecutar, en ese orden y una sola vez cada uno. */
  const startAnalysis = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    // La pantalla de ejecucion tambien saca turno: si no, una lectura anterior
    // que resuelva recien ahora la borraria antes de que se vea.
    if (acceptTicket(takeTicket())) setState({ phase: 'executing' });
    try {
      const created = await createMyReasoningRunRequest(
        requestAuthenticated,
        objectiveReference
      );

      // Un run puede NACER `failed` si el inventario congelado quedo bloqueado.
      // No se intenta ejecutarlo: no hay nada que ejecutar.
      if (created.status === 'failed') {
        commitExecutedRun(created);
        return;
      }

      commitExecutedRun(
        await executeMyReasoningRunRequest(
          requestAuthenticated,
          created.reasoningRunReference
        )
      );
    } catch (error: unknown) {
      commitOperationFailure(error);
    } finally {
      busyRef.current = false;
    }
  }, [
    acceptTicket,
    commitExecutedRun,
    commitOperationFailure,
    objectiveReference,
    requestAuthenticated,
    takeTicket
  ]);

  /** Continuar un run que quedo `pending`: el unico reintento seguro que existe. */
  const continueAnalysis = useCallback(
    async (reasoningRunReference: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      if (acceptTicket(takeTicket())) setState({ phase: 'executing' });
      try {
        commitExecutedRun(
          await executeMyReasoningRunRequest(
            requestAuthenticated,
            reasoningRunReference
          )
        );
      } catch (error: unknown) {
        commitOperationFailure(error);
      } finally {
        busyRef.current = false;
      }
    },
    [
      acceptTicket,
      commitExecutedRun,
      commitOperationFailure,
      requestAuthenticated,
      takeTicket
    ]
  );

  return (
    <section aria-labelledby="objective-reasoning-title" className="grid min-w-0 gap-6">
      {!hasCompletedSynthesis ? (
        <div className="grid min-w-0 gap-2">
          <h2
            id="objective-reasoning-title"
            className="text-2xl font-bold tracking-tight text-text-strong"
          >
            Analisis de tu trayectoria
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-text-muted">
            Scope revisa la evidencia disponible en tus credenciales frente a cada
            requisito confirmado de este objetivo.
          </p>
        </div>
      ) : null}

      {/*
        `aria-live` para que el cambio de estado se anuncie: la ejecucion es
        sincrona y larga, y sin esto un lector de pantalla no se entera de que
        arranco ni de que termino.
      */}
      <div aria-live="polite" className="grid min-w-0 gap-6">
        {state.phase === 'loading' ? (
          <p className="text-sm text-text-muted">Buscando analisis previos...</p>
        ) : null}

        {state.phase === 'executing' ? <ExecutingState /> : null}

        {state.phase === 'absent' ? (
          <AbsentState onStart={startAnalysis} />
        ) : null}

        {state.phase === 'error' ? (
          <div className="grid gap-4">
            <FeedbackAlert variant="warning" title="No pudimos completar el analisis">
              {state.message}
            </FeedbackAlert>
            <div className="flex flex-wrap gap-3">
              {state.retryable ? (
                <Button type="button" variant="secondary" onClick={reload}>
                  Reintentar
                </Button>
              ) : (
                <Button type="button" variant="secondary" onClick={reload}>
                  Actualizar el estado del analisis
                </Button>
              )}
            </div>
          </div>
        ) : null}

        {state.phase === 'ready' ? (
          <RunState
            run={state.run}
            history={history}
            onContinue={continueAnalysis}
            onStartNew={startAnalysis}
            completedSynthesisContext={completedSynthesisContext}
          />
        ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------

function AbsentState({ onStart }: { onStart: () => void }) {
  return (
    <div className="grid min-w-0 gap-4 rounded-card border border-border-default bg-surface p-6">
      <p className="max-w-2xl text-sm leading-6 text-text-muted">
        Todavia no analizaste tu trayectoria frente a este objetivo. Scope va a
        revisar la evidencia disponible en tus credenciales, requisito por
        requisito, y te va a mostrar con que evidencia concreta respalda cada
        conclusion.
      </p>
      <div>
        <Button type="button" onClick={onStart}>
          Analizar mi trayectoria
        </Button>
      </div>
    </div>
  );
}

/**
 * Ejecucion en vuelo.
 *
 * SIN PORCENTAJE. No hay ninguna senal de progreso real que el backend
 * entregue, asi que una barra seria una invencion. Tampoco se nombran las
 * etapas ni el proveedor.
 */
function ExecutingState() {
  return (
    <div className="grid min-w-0 gap-2 rounded-card border border-border-default bg-surface p-6">
      <p className="font-semibold text-text-strong">
        Analizando tu trayectoria frente a este objetivo...
      </p>
      <p className="text-sm leading-6 text-text-muted">
        Scope esta revisando la evidencia disponible para cada requisito. Puede
        tardar unos minutos. No cierres esta pagina.
      </p>
    </div>
  );
}

function RunState({
  run,
  history,
  onContinue,
  onStartNew,
  completedSynthesisContext
}: {
  run: ReasoningRunDetailVM;
  history: readonly ReasoningRunSummaryVM[];
  onContinue: (reasoningRunReference: string) => void;
  onStartNew: () => void;
  completedSynthesisContext?: ReactNode;
}) {
  if (run.status === 'pending') {
    return (
      <div className="grid min-w-0 gap-4 rounded-card border border-border-default bg-surface p-6">
        <p className="max-w-2xl text-sm leading-6 text-text-muted">
          Preparamos la evidencia de este objetivo pero el analisis todavia no se
          completo. Podes continuarlo ahora.
        </p>
        <div>
          <Button type="button" onClick={() => onContinue(run.reasoningRunReference)}>
            Continuar analisis
          </Button>
        </div>
      </div>
    );
  }

  if (run.status === 'running') {
    /*
      El run figura `running` en el servidor y NO lo lanzamos nosotros en esta
      visita. Puede estar realmente en curso en otra pestaña, o puede haber
      quedado asi por una interrupcion: el backend no puede distinguirlo y no
      admite reclamarlo. La limitacion se dice, no se esconde — y no se
      reintenta sola.
    */
    return (
      <div className="grid min-w-0 gap-4 rounded-card border border-border-default bg-surface p-6">
        <p className="font-semibold text-text-strong">
          Hay un analisis en curso para este objetivo.
        </p>
        <p className="max-w-2xl text-sm leading-6 text-text-muted">
          Si lo dejaste corriendo en otra pestaña, va a aparecer aca cuando
          termine. Si se interrumpio, ese analisis no puede retomarse: podes
          iniciar uno nuevo.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="secondary" onClick={onStartNew}>
            Iniciar un analisis nuevo
          </Button>
        </div>
      </div>
    );
  }

  if (run.status === 'failed') {
    return (
      <div className="grid min-w-0 gap-4">
        <FeedbackAlert variant="warning" title="El analisis no pudo completarse">
          {describeRunFailure(run.failureCategory)}
        </FeedbackAlert>
        <p className="max-w-2xl text-sm leading-6 text-text-muted">
          Este analisis no se reanuda, porque congelo la evidencia en el momento
          en que se creo. Podes iniciar uno nuevo con tus credenciales actuales.
        </p>
        <div>
          <Button type="button" onClick={onStartNew}>
            Iniciar un analisis nuevo
          </Button>
        </div>
      </div>
    );
  }

  // completed
  if (run.synthesis !== null) {
    return (
      <CompletedSynthesisState
        run={run}
        history={history}
        onStartNew={onStartNew}
        context={completedSynthesisContext}
      />
    );
  }

  const results = run.requirementResults ?? [];
  const counts = countByFinalState(results);

  return (
    <div className="grid min-w-0 gap-6">
      <div className="grid min-w-0 gap-3 rounded-card border border-border-default bg-surface-muted p-5">
        <p className="text-sm text-text-muted">
          Analisis realizado el {run.completedAtLabel ?? run.createdAtLabel}, sobre{' '}
          {results.length}{' '}
          {results.length === 1 ? 'requisito confirmado' : 'requisitos confirmados'}.
        </p>
        {/*
          Recuento DESCRIPTIVO. No se divide por el total, no hay porcentaje, no
          hay puntaje ni orden por "mejor resultado": describe la evidencia, no
          califica a la persona.
        */}
        {counts.length > 0 ? (
          <ul className="flex min-w-0 flex-wrap gap-x-5 gap-y-2 text-sm text-text-default">
            {counts.map((entry) => (
              <li key={entry.state}>
                <span className="font-semibold">{entry.count}</span> ·{' '}
                {entry.label.toLowerCase()}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Se preserva el ORDEN de los requisitos confirmados. */}
      <ol className="grid min-w-0 list-none gap-5">
        {results.map((result, index) => (
          <li key={result.requirementId} className="min-w-0">
            <RequirementResultCard result={result} order={index + 1} />
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-3 border-t border-border-default pt-5">
        <Button type="button" variant="secondary" onClick={onStartNew}>
          Volver a analizar
        </Button>
        <p className="text-xs text-text-muted">
          Un analisis nuevo no reemplaza a este: cada uno queda como una
          observacion con su fecha.
        </p>
      </div>

      {history.length > 1 ? (
        <details className="rounded-card border border-border-default bg-surface p-5">
          <summary className="cursor-pointer text-sm font-semibold text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">
            Analisis anteriores ({history.length - 1})
          </summary>
          <ul className="mt-4 grid list-none gap-2 text-sm text-text-muted">
            {history
              .filter(
                (entry) => entry.reasoningRunReference !== run.reasoningRunReference
              )
              .map((entry) => (
                <li key={entry.reasoningRunReference}>
                  Analisis del {entry.createdAtLabel} · {entry.requirementCount}{' '}
                  requisitos
                </li>
              ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function CompletedSynthesisState({
  run,
  history,
  onStartNew,
  context
}: {
  run: ReasoningRunDetailVM;
  history: readonly ReasoningRunSummaryVM[];
  onStartNew: () => void;
  context?: ReactNode;
}) {
  const results = run.requirementResults ?? [];
  const [activeRequirementFilter, setActiveRequirementFilter] =
    useState<RequirementFilter>('ALL');
  const [expandedRequirementIds, setExpandedRequirementIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  const focusTargetRef = useRef<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);

  const changeRequirementFilter = (filter: RequirementFilter) => {
    setActiveRequirementFilter(filter);
    setExpandedRequirementIds(
      (current) =>
        new Set(
          [...current].filter((requirementId) => {
            const result = results.find((candidate) => candidate.requirementId === requirementId);
            return result !== undefined && requirementMatchesFilter(result, filter);
          })
        )
    );
  };

  const toggleRequirement = (requirementId: string) => {
    setExpandedRequirementIds((current) => {
      const next = new Set(current);
      if (next.has(requirementId)) next.delete(requirementId);
      else next.add(requirementId);
      return next;
    });
  };

  const showRequirementDetail = (requirementId: string) => {
    setActiveRequirementFilter('ALL');
    setExpandedRequirementIds((current) => new Set(current).add(requirementId));
    focusTargetRef.current = requirementId;
    setFocusRequest((current) => current + 1);
  };

  useEffect(() => {
    const requirementId = focusTargetRef.current;
    if (focusRequest === 0 || requirementId === null) return;
    const target = document.getElementById(`requirement-result-${requirementId}`);
    if (target === null) return;
    target.scrollIntoView?.({ block: 'start' });
    target.focus({ preventScroll: true });
    focusTargetRef.current = null;
  }, [focusRequest]);

  return (
    <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start lg:gap-x-10 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 lg:col-start-1 lg:row-start-1">
        <ObjectiveSynthesisOverview
          synthesis={run.synthesis!}
          completedAtLabel={run.completedAtLabel}
          onRequirementDetail={showRequirementDetail}
          showMetadata={false}
        />
      </div>

      <aside
        aria-labelledby="analysis-summary-title"
        className="grid min-w-0 gap-4 rounded-card border border-border-default bg-surface p-5 lg:col-start-2 lg:row-start-1"
      >
        <h3 id="analysis-summary-title" className="text-base font-semibold text-text-strong">
          Resumen del análisis
        </h3>
        <ObjectiveSynthesisMetadata
          synthesis={run.synthesis!}
          completedAtLabel={run.completedAtLabel}
        />
      </aside>

      <section
        aria-labelledby="analyzed-requirements-title"
        className="grid min-w-0 gap-4 border-t border-border-default pt-8 lg:col-start-1 lg:row-start-2"
      >
        <div className="grid gap-1">
          <h3
            id="analyzed-requirements-title"
            className="text-xl font-bold tracking-tight text-text-strong"
          >
            Requisitos analizados
          </h3>
          <p className="text-sm text-text-muted">
            Abrí un requisito para consultar su conclusión y la evidencia disponible.
          </p>
        </div>
        <CompactRequirementList
          results={results}
          synthesis={run.synthesis!}
          activeFilter={activeRequirementFilter}
          expandedIds={expandedRequirementIds}
          onFilterChange={changeRequirementFilter}
          onToggle={toggleRequirement}
        />
      </section>

      <aside className="grid min-w-0 gap-5 lg:col-start-2 lg:row-start-2">
        {context ?? null}

        {history.length > 1 ? (
          <details className="rounded-card border border-border-default bg-surface p-5">
            <summary className="cursor-pointer text-sm font-semibold text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">
              Analisis anteriores ({history.length - 1})
            </summary>
            <ul className="mt-4 grid list-none gap-2 text-sm text-text-muted">
              {history
                .filter((entry) => entry.reasoningRunReference !== run.reasoningRunReference)
                .map((entry) => (
                  <li key={entry.reasoningRunReference}>
                    Analisis del {entry.createdAtLabel} · {entry.requirementCount} requisitos
                  </li>
                ))}
            </ul>
          </details>
        ) : null}

        <div className="grid gap-3 border-t border-border-default pt-5">
          <div>
            <Button type="button" variant="secondary" onClick={onStartNew}>
              Volver a analizar
            </Button>
          </div>
          <p className="text-xs leading-5 text-text-muted">
            Un analisis nuevo no reemplaza a este: cada uno queda como una observacion con su fecha.
          </p>
        </div>
      </aside>
    </div>
  );
}

import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ScopeButton } from '@/components/ui/button';
import { ScopeCard } from '@/components/ui/surfaces';
import {
  ScopeLoadingState,
  ScopeNotice
} from '@/components/ui/states';
import { ScopeText } from '@/components/ui/text';
import { ObjectiveSynthesisOverview } from '@/features/reasoning/objective-synthesis-overview';
import {
  reconcileCompletedHistory,
  selectObjectiveReasoningRun
} from '@/features/reasoning/reasoning-run-selection';
import { RequirementResultCard } from '@/features/reasoning/requirement-result-card';
import {
  createMyReasoningRunRequest,
  executeMyReasoningRunRequest,
  getMyReasoningRunRequest,
  listMyReasoningRunsRequest
} from '@/lib/api/scope-api';
import { useAuthenticatedRequest } from '@/lib/auth/session-provider';
import {
  describeRunFailure,
  mapReasoningRunActionError,
  mapReasoningRunReadError
} from '@/lib/errors/reasoning-run-error-mapper';
import { colors, spacing } from '@/lib/theme/tokens';
import type {
  ReasoningRunDetailVM,
  ReasoningRunSummaryVM
} from '@/types/reasoning-runs';

/**
 * Análisis de trayectoria de un objetivo.
 *
 * REGLA CENTRAL: abrir esta pantalla NUNCA crea ni ejecuta un run. Sólo LEE el
 * historial y elige cuál mostrar. Crear y ejecutar son acciones explícitas, y
 * cada una cuesta llamadas al proveedor — la ejecución hace una POR REQUISITO.
 *
 * El backend no tiene cola ni worker: `execute` es SÍNCRONO. No se inventa acá
 * un polling, un websocket ni un job en segundo plano que el servidor no
 * expone; se muestra un estado largo honesto y se documenta la limitación.
 */

type PanelState =
  | { phase: 'loading' }
  | { phase: 'absent' }
  | {
      phase: 'run';
      run: ReasoningRunDetailVM;
      history: readonly ReasoningRunSummaryVM[];
    }
  | { phase: 'executing' }
  | { phase: 'error'; message: string; retryable: boolean };

export function ObjectiveReasoningPanel({
  objectiveReference
}: {
  objectiveReference: string;
}) {
  const request = useAuthenticatedRequest();
  const router = useRouter();

  const [state, setState] = useState<PanelState>({ phase: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [history, setHistory] = useState<readonly ReasoningRunSummaryVM[]>([]);

  /**
   * Cerrojo del MISMO tick.
   *
   * `state.phase === 'executing'` sólo se aplica en el próximo render, así que
   * dos toques rápidos podrían disparar dos creaciones — y cada una congela
   * evidencia y compra llamadas al proveedor.
   */
  const busyRef = useRef(false);

  /**
   * Turno de petición: una lectura vieja que resuelve tarde NUNCA pisa un
   * resultado más nuevo. Abortar no alcanza porque no toda capa honra la señal.
   */
  const ticketRef = useRef(0);
  const takeTicket = useCallback(() => {
    ticketRef.current += 1;
    return ticketRef.current;
  }, []);
  const acceptTicket = useCallback(
    (ticket: number) => ticket === ticketRef.current,
    []
  );

  // Carga inicial: SÓLO lecturas.
  useEffect(() => {
    let active = true;
    const ticket = takeTicket();

    async function load() {
      try {
        const runs = await listMyReasoningRunsRequest(request);
        if (!active || busyRef.current || !acceptTicket(ticket)) return;

        const selection = selectObjectiveReasoningRun(runs, objectiveReference);
        setHistory(selection.completedHistory);

        if (selection.selected === null) {
          setState({ phase: 'absent' });
          return;
        }

        const detail = await getMyReasoningRunRequest(
          request,
          selection.selected.reasoningRunReference
        );
        if (!active || busyRef.current || !acceptTicket(ticket)) return;

        setState({
          phase: 'run',
          run: detail,
          history: selection.completedHistory
        });
      } catch (error) {
        if (!active || busyRef.current || !acceptTicket(ticket)) return;
        setState({
          phase: 'error',
          message: mapReasoningRunReadError(error),
          retryable: true
        });
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [acceptTicket, objectiveReference, reloadToken, request, takeTicket]);

  const commitRun = useCallback(
    (run: ReasoningRunDetailVM) => {
      if (!acceptTicket(takeTicket())) return;
      const nextHistory = reconcileCompletedHistory(history, run);
      setHistory(nextHistory);
      setState({ phase: 'run', run, history: nextHistory });
    },
    [acceptTicket, history, takeTicket]
  );

  const commitFailure = useCallback(
    (error: unknown) => {
      const mapped = mapReasoningRunActionError(error);
      if (!acceptTicket(takeTicket())) return;
      setState({
        phase: 'error',
        message: mapped.message,
        retryable: mapped.retryable
      });
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
    if (acceptTicket(takeTicket())) setState({ phase: 'executing' });

    try {
      const created = await createMyReasoningRunRequest(
        request,
        objectiveReference
      );

      // Un run puede NACER `failed` si el inventario congelado quedó bloqueado.
      // No se intenta ejecutarlo: no hay nada que ejecutar.
      if (created.status === 'failed') {
        commitRun(created);
        return;
      }

      commitRun(
        await executeMyReasoningRunRequest(
          request,
          created.reasoningRunReference
        )
      );
    } catch (error) {
      commitFailure(error);
    } finally {
      busyRef.current = false;
    }
  }, [
    acceptTicket,
    commitFailure,
    commitRun,
    objectiveReference,
    request,
    takeTicket
  ]);

  /** Continuar un run que quedó `pending`: el único reintento seguro que existe. */
  const continueAnalysis = useCallback(
    async (reasoningRunReference: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      if (acceptTicket(takeTicket())) setState({ phase: 'executing' });

      try {
        commitRun(
          await executeMyReasoningRunRequest(request, reasoningRunReference)
        );
      } catch (error) {
        commitFailure(error);
      } finally {
        busyRef.current = false;
      }
    },
    [acceptTicket, commitFailure, commitRun, request, takeTicket]
  );

  const openCredential = useCallback(
    (credentialReference: string) => {
      router.push(`/credentials/${encodeURIComponent(credentialReference)}`);
    },
    [router]
  );

  return (
    <View style={styles.root} testID="objective-reasoning-panel">
      {state.phase === 'loading' ? (
        <ScopeLoadingState label="Buscando análisis de este objetivo" />
      ) : null}

      {state.phase === 'absent' ? (
        <AbsentState onStart={() => void startAnalysis()} />
      ) : null}

      {state.phase === 'executing' ? <ExecutingState /> : null}

      {state.phase === 'error' ? (
        <View style={styles.block}>
          <ScopeNotice tone="warning" title="No pudimos completar el análisis">
            <ScopeText variant="small" style={styles.warningText}>
              {state.message}
            </ScopeText>
          </ScopeNotice>
          <View style={styles.actions}>
            {state.retryable ? (
              <ScopeButton
                testID="reasoning-retry"
                variant="secondary"
                label="Reintentar"
                onPress={reload}
              />
            ) : (
              <ScopeButton
                testID="reasoning-reload"
                variant="secondary"
                label="Volver a cargar"
                onPress={reload}
              />
            )}
          </View>
        </View>
      ) : null}

      {state.phase === 'run' ? (
        <RunState
          run={state.run}
          onContinue={(reference) => void continueAnalysis(reference)}
          onStartNew={() => void startAnalysis()}
          onOpenCredential={openCredential}
        />
      ) : null}
    </View>
  );
}

function AbsentState({ onStart }: { onStart: () => void }) {
  return (
    <ScopeCard style={styles.block}>
      <ScopeText variant="sectionTitle" tone="strong" accessibilityRole="header">
        Análisis de tu trayectoria
      </ScopeText>
      <ScopeText variant="small" tone="muted">
        Todavía no analizaste tu trayectoria frente a este objetivo. Scope va a
        revisar la evidencia disponible en tus credenciales, requisito por
        requisito, y te va a mostrar con qué evidencia concreta respalda cada
        conclusión.
      </ScopeText>
      <ScopeButton
        testID="reasoning-start"
        label="Analizar mi trayectoria"
        onPress={onStart}
      />
    </ScopeCard>
  );
}

/**
 * Ejecución en vuelo.
 *
 * SIN PORCENTAJE. No hay ninguna señal de progreso real que el backend
 * entregue, así que una barra sería una invención. Tampoco se nombran las
 * etapas ni el proveedor.
 */
function ExecutingState() {
  return (
    <ScopeCard style={styles.block}>
      <ScopeText
        variant="bodyStrong"
        tone="strong"
        accessibilityLiveRegion="polite"
      >
        Analizando tu trayectoria…
      </ScopeText>
      <ScopeText variant="small" tone="muted">
        Scope está revisando la evidencia disponible para cada requisito. Puede
        tardar unos minutos. No cierres la aplicación mientras tanto.
      </ScopeText>
      <ScopeLoadingState label="Analizando tu trayectoria" />
    </ScopeCard>
  );
}

function RunState({
  run,
  onContinue,
  onStartNew,
  onOpenCredential
}: {
  run: ReasoningRunDetailVM;
  onContinue: (reasoningRunReference: string) => void;
  onStartNew: () => void;
  onOpenCredential: (credentialReference: string) => void;
}) {
  if (run.status === 'pending') {
    return (
      <ScopeCard style={styles.block}>
        <ScopeText variant="small" tone="muted">
          Preparamos la evidencia de este objetivo pero el análisis todavía no
          se completó. Podés continuarlo ahora.
        </ScopeText>
        <ScopeButton
          testID="reasoning-continue"
          label="Continuar análisis"
          onPress={() => onContinue(run.reasoningRunReference)}
        />
      </ScopeCard>
    );
  }

  if (run.status === 'running') {
    /*
      El run figura `running` en el servidor y NO lo lanzamos nosotros en esta
      visita. Puede estar realmente en curso en otro dispositivo, o puede haber
      quedado así por una interrupción: el backend no puede distinguirlo y no
      admite reclamarlo. La limitación se dice, no se esconde — y no se
      reintenta sola.
    */
    return (
      <ScopeCard style={styles.block}>
        <ScopeText variant="bodyStrong" tone="strong">
          Hay un análisis en curso para este objetivo.
        </ScopeText>
        <ScopeText variant="small" tone="muted">
          Si lo dejaste corriendo en otro dispositivo, va a aparecer acá cuando
          termine. Si se interrumpió, ese análisis no puede retomarse: podés
          iniciar uno nuevo.
        </ScopeText>
        <ScopeButton
          testID="reasoning-start-new"
          variant="secondary"
          label="Iniciar un análisis nuevo"
          onPress={onStartNew}
        />
      </ScopeCard>
    );
  }

  if (run.status === 'failed') {
    return (
      <View style={styles.block}>
        <ScopeNotice tone="warning" title="El análisis no pudo completarse">
          <ScopeText variant="small" style={styles.warningText}>
            {describeRunFailure(run.failureCategory)}
          </ScopeText>
        </ScopeNotice>
        <ScopeText variant="small" tone="muted">
          Este análisis no se reanuda, porque congeló la evidencia en el momento
          en que se creó. Podés iniciar uno nuevo con tus credenciales actuales.
        </ScopeText>
        <ScopeButton
          testID="reasoning-start-new"
          label="Iniciar un análisis nuevo"
          onPress={onStartNew}
        />
      </View>
    );
  }

  // completed
  return (
    <View style={styles.block}>
      {run.synthesis !== null ? (
        <ObjectiveSynthesisOverview
          synthesis={run.synthesis}
          completedAtLabel={run.completedAtLabel}
        />
      ) : (
        <ScopeText variant="sectionTitle" tone="strong" accessibilityRole="header">
          Análisis de tu trayectoria
        </ScopeText>
      )}

      {run.requirementResults !== null ? (
        <View style={styles.results}>
          <ScopeText variant="sectionTitle" tone="strong" accessibilityRole="header">
            Requisito por requisito
          </ScopeText>
          {run.requirementResults.map((result, index) => (
            <RequirementResultCard
              key={result.requirementId}
              result={result}
              index={index}
              onOpenCredential={onOpenCredential}
            />
          ))}
        </View>
      ) : null}

      <ScopeButton
        testID="reasoning-start-new"
        variant="secondary"
        label="Analizar de nuevo"
        onPress={onStartNew}
        accessibilityHint="Crea un análisis nuevo con tus credenciales actuales"
      />
      <ScopeText variant="caption" tone="subtle">
        Un análisis nuevo no borra este: cada uno es una observación fechada con
        la evidencia que existía en ese momento.
      </ScopeText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg
  },
  block: {
    gap: spacing.md
  },
  results: {
    gap: spacing.md,
    marginTop: spacing.sm
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm
  },
  warningText: {
    color: colors.status.warning
  }
});

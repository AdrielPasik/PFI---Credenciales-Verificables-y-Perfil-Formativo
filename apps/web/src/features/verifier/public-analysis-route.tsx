'use client';

/**
 * Analisis contextual publico — la experiencia completa del verificador.
 *
 *   1. Objetivo   ->  2. Requisitos  ->  3. Análisis  ->  4. Resultado
 *
 * EL SERVIDOR ES LA AUTORIDAD DE REANUDACION. Al montar, si hay token de sesion
 * guardado se lee la sesion (y el resultado cuando ya produjo un analisis) y el
 * paso se DERIVA de eso. No existe un indice de wizard persistido: seria mentira
 * despues de una recarga.
 *
 * EJECUCION LARGA. `verification-execute` puede tardar minutos y el trabajo sigue
 * en el servidor aunque se pierda la respuesta. Por eso, apenas se dispara, la
 * UI entra en "procesando" y a partir de ahi la verdad se lee de
 * `verification-result` con el MISMO token. Perder la respuesta del POST nunca
 * crea otra solicitud.
 *
 * LO QUE ESTA PANTALLA NUNCA HACE: mostrar el token de sesion, ponerlo en la URL,
 * reconstruir estados epistemicos, inventar evidencia o nombrar al proveedor.
 */

import { LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { BrandMark } from '@/components/brand/brand-mark';
import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RequirementReviewItem } from '@/features/holder/objectives/requirement-review-item';
import {
  applyTextEdit,
  countCodePoints,
  createManualItem,
  mapReviewItemToRequirement
} from '@/features/holder/objectives/review-draft';
import { AnalysisResultView } from '@/features/verifier/analysis-result-view';
import {
  RESULT_POLL_INTERVAL_MS,
  failureCopy,
  publicErrorCopy,
  stepForResult,
  stepForSession,
  type AnalysisStep
} from '@/features/verifier/analysis-flow';
import {
  clearStoredRequestToken,
  readStoredRequestToken,
  storeRequestToken
} from '@/features/verifier/request-token-storage';
import {
  confirmVerificationRequirementsRequest,
  createVerificationRequestRequest,
  executeVerificationAnalysisRequest,
  getVerificationResultRequest,
  getVerificationSessionRequest,
  proposeVerificationRequirementsRequest
} from '@/lib/api/public-analysis-api';
import { getPublicProfileShareRequest } from '@/lib/api/profile-sharing-api';
import {
  OBJECTIVE_TYPES,
  OBJECTIVE_TYPE_LABELS,
  type ObjectiveTypeToken,
  type ReviewItem
} from '@/models/objectives';
import type {
  PublicAnalysisResultVM,
  PublicVerificationSessionVM
} from '@/models/public-analysis';
import type { PublicProfileShareVM } from '@/models/profile-sharing';

/** Tope publico de requisitos del backend. Confirmar mas se rechaza entero. */
const MAX_REQUIREMENTS = 12;
/** Techo del texto del objetivo en el endpoint anonimo. */
const MAX_OBJECTIVE_CODE_POINTS = 8_000;
const MAX_TITLE_LENGTH = 200;

interface RouteState {
  step: AnalysisStep | 'loading' | 'unavailable';
  profile: PublicProfileShareVM | null;
  session: PublicVerificationSessionVM | null;
  result: PublicAnalysisResultVM | null;
  message: string | null;
  fatalMessage: string | null;
}

export function PublicAnalysisRoute({ token }: { token: string }) {
  const [state, setState] = useState<RouteState>({
    step: 'loading',
    profile: null,
    session: null,
    result: null,
    message: null,
    fatalMessage: null
  });
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [objectiveType, setObjectiveType] = useState<ObjectiveTypeToken>('EMPLOYMENT');
  const [objectiveTitle, setObjectiveTitle] = useState('');
  const [rawObjectiveText, setRawObjectiveText] = useState('');

  /** Un solo disparo de ejecucion local a la vez. Higiene de UX y de costo. */
  const executing = useRef(false);

  const applyError = useCallback((error: unknown) => {
    const copy = publicErrorCopy(error);
    if (copy.sessionLost) {
      clearStoredRequestToken(token);
      setState((current) => ({
        ...current,
        step: 'objective',
        session: null,
        result: null,
        message: copy.message,
        fatalMessage: null
      }));
      return copy;
    }
    setState((current) =>
      copy.fatal
        ? { ...current, step: 'unavailable', fatalMessage: copy.message, message: null }
        : { ...current, message: copy.message }
    );
    return copy;
  }, [token]);

  /** Lee del servidor y deriva el paso. NUNCA se decide desde estado local. */
  const syncFromServer = useCallback(
    async (requestToken: string | null): Promise<void> => {
      if (requestToken === null) {
        setState((current) => ({ ...current, step: 'objective', session: null, result: null }));
        return;
      }
      const session = await getVerificationSessionRequest(token, requestToken);
      if (session.status !== 'consumed') {
        setState((current) => ({
          ...current,
          step: stepForSession(session),
          session,
          result: null
        }));
        if (session.proposal) setItems(itemsFromProposal(session.proposal.candidates));
        return;
      }
      const result = await getVerificationResultRequest(token, requestToken);
      setState((current) => ({ ...current, step: stepForResult(result), session, result }));
    },
    [token]
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const profile = await getPublicProfileShareRequest(token);
        if (!active) return;
        setState((current) => ({ ...current, profile }));

        const stored = readStoredRequestToken(token);
        if (stored === null && !profile.contextualVerificationEnabled) {
          setState((current) => ({
            ...current,
            step: 'unavailable',
            fatalMessage: 'Este perfil no tiene habilitado el análisis de trayectoria.'
          }));
          return;
        }
        await syncFromServer(stored);
      } catch (error) {
        if (active) applyError(error);
      }
    })();
    return () => {
      active = false;
    };
  }, [token, syncFromServer, applyError]);

  // --- sondeo del resultado ------------------------------------------------
  //
  // Solo mientras el analisis corre, y con una cadencia conservadora: el trabajo
  // dura minutos. Se corta al completar, al fallar, al perder el enlace o al
  // desmontar.
  useEffect(() => {
    if (state.step !== 'processing') return;
    const requestToken = readStoredRequestToken(token);
    if (requestToken === null) return;

    let active = true;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const result = await getVerificationResultRequest(token, requestToken);
          if (!active) return;
          setState((current) => ({ ...current, step: stepForResult(result), result }));
        } catch (error) {
          if (!active) return;
          const copy = applyError(error);
          // Enlace revocado o sesion perdida: dejar de sondear una autoridad que
          // ya no existe.
          if (copy.fatal || copy.sessionLost) clearInterval(timer);
        }
      })();
    }, RESULT_POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [state.step, token, applyError]);

  // --- acciones ------------------------------------------------------------

  const requestProposal = useCallback(
    async (requestToken: string) => {
      setBusy(true);
      try {
        const session = await proposeVerificationRequirementsRequest(token, requestToken);
        setState((current) => ({ ...current, session, step: stepForSession(session), message: null }));
        setItems(session.proposal ? itemsFromProposal(session.proposal.candidates) : []);
      } catch (error) {
        const copy = applyError(error);
        // Sin propuesta, la persona todavia puede escribir sus requisitos: no se
        // la deja en una pantalla vacía.
        if (!copy.fatal && items.length === 0) setItems([createManualItem()]);
      } finally {
        setBusy(false);
      }
    },
    [token, applyError, items.length]
  );

  const startSession = useCallback(async () => {
    const title = objectiveTitle.trim();
    if (rawObjectiveText.trim().length === 0) {
      setState((current) => ({ ...current, message: 'Escribí qué querés analizar.' }));
      return;
    }
    if (countCodePoints(rawObjectiveText) > MAX_OBJECTIVE_CODE_POINTS) {
      setState((current) => ({
        ...current,
        message: `El texto supera los ${MAX_OBJECTIVE_CODE_POINTS.toLocaleString('es-AR')} caracteres.`
      }));
      return;
    }
    if (countCodePoints(title) > MAX_TITLE_LENGTH) {
      setState((current) => ({ ...current, message: 'El título es demasiado largo.' }));
      return;
    }

    setBusy(true);
    setState((current) => ({ ...current, message: null }));
    try {
      const created = await createVerificationRequestRequest(token, {
        objectiveType,
        objectiveTitle: title.length > 0 ? title : null,
        rawObjectiveText
      });
      // El token reemplaza al anterior SOLO cuando el nuevo borrador existe.
      storeRequestToken(token, created.requestToken);
      setState((current) => ({ ...current, step: 'requirements', session: created.session }));
      setItems([]);
      await requestProposal(created.requestToken);
    } catch (error) {
      applyError(error);
    } finally {
      setBusy(false);
    }
  }, [token, objectiveType, objectiveTitle, rawObjectiveText, applyError, requestProposal]);

  const confirmRequirements = useCallback(async () => {
    const requestToken = readStoredRequestToken(token);
    if (requestToken === null) return;

    const filled = items.filter((item) => item.text.trim().length > 0);
    if (filled.length === 0) {
      setState((current) => ({ ...current, message: 'Dejá al menos un requisito.' }));
      return;
    }
    if (filled.length > MAX_REQUIREMENTS) {
      setState((current) => ({
        ...current,
        message: `Podés confirmar hasta ${MAX_REQUIREMENTS} requisitos.`
      }));
      return;
    }

    setBusy(true);
    try {
      const session = await confirmVerificationRequirementsRequest(token, requestToken, {
        // La MISMA regla de procedencia del holder, sin reimplementarla.
        requirements: filled.map(mapReviewItemToRequirement)
      });
      setState((current) => ({ ...current, session, step: stepForSession(session), message: null }));
    } catch (error) {
      applyError(error);
    } finally {
      setBusy(false);
    }
  }, [token, items, applyError]);

  const runAnalysis = useCallback(async () => {
    const requestToken = readStoredRequestToken(token);
    if (requestToken === null || executing.current) return;

    executing.current = true;
    setBusy(true);
    // Se entra a "procesando" ANTES de esperar la respuesta: si el POST se
    // pierde, la recuperacion ya esta en marcha por el sondeo del resultado.
    setState((current) => ({ ...current, step: 'processing', message: null }));
    try {
      const result = await executeVerificationAnalysisRequest(token, requestToken);
      setState((current) => ({ ...current, step: stepForResult(result), result }));
    } catch (error) {
      const copy = publicErrorCopy(error);
      if (copy.fatal || copy.sessionLost) {
        applyError(error);
      } else {
        // La respuesta se perdio o fue rechazada: NO se crea otra solicitud. El
        // estado real se lee del servidor con el mismo token.
        try {
          const result = await getVerificationResultRequest(token, requestToken);
          setState((current) => ({ ...current, step: stepForResult(result), result, message: null }));
        } catch (readError) {
          applyError(readError);
        }
      }
    } finally {
      executing.current = false;
      setBusy(false);
    }
  }, [token, applyError]);

  const startNewAnalysis = useCallback(() => {
    // El token viejo se conserva hasta que exista un borrador nuevo: si la
    // creacion falla, la sesion actual sigue siendo recuperable.
    setItems([]);
    setObjectiveTitle('');
    setRawObjectiveText('');
    setState((current) => ({
      ...current,
      step: 'objective',
      session: null,
      result: null,
      message: null
    }));
  }, []);

  // --- render --------------------------------------------------------------

  const contextualEnabled = state.profile?.contextualVerificationEnabled ?? false;
  const headerTitle = state.profile?.holderLabel ?? 'Perfil compartido';

  return (
    <main className="min-h-svh bg-canvas px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto grid w-full max-w-5xl gap-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <BrandMark descriptor="Análisis de trayectoria" lightLogo />
          <Button asChild size="sm" variant="secondary">
            <Link href={`/share/profile/${encodeURIComponent(token)}`}>Volver al perfil</Link>
          </Button>
        </header>

        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-strong sm:text-3xl">
            Analizar esta trayectoria frente a un objetivo
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-text-muted">
            Scope analiza únicamente las credenciales que {headerTitle} autorizó para esta función.
            Es un análisis de evidencia formativa: no puntúa personas ni decide por vos.
          </p>
        </div>

        {state.message ? (
          <FeedbackAlert variant="warning" title="Revisá esto">
            {state.message}
          </FeedbackAlert>
        ) : null}

        {state.step === 'loading' ? (
          <div className="flex min-h-40 items-center justify-center rounded-card border border-border-default bg-surface p-6 text-sm text-text-muted">
            <LoaderCircle aria-hidden="true" className="mr-2 size-5 animate-spin" />
            Cargando
          </div>
        ) : null}

        {state.step === 'unavailable' ? (
          <FeedbackAlert variant="error" title="Análisis no disponible">
            {state.fatalMessage ?? 'Este análisis no está disponible.'}
          </FeedbackAlert>
        ) : null}

        {state.step === 'objective' ? (
          <ObjectiveStep
            objectiveType={objectiveType}
            objectiveTitle={objectiveTitle}
            rawObjectiveText={rawObjectiveText}
            busy={busy}
            onObjectiveType={setObjectiveType}
            onObjectiveTitle={setObjectiveTitle}
            onRawObjectiveText={setRawObjectiveText}
            onSubmit={() => void startSession()}
          />
        ) : null}

        {state.step === 'requirements' ? (
          <RequirementsStep
            busy={busy}
            proposalInProgress={state.session?.proposalInProgress ?? false}
            items={items}
            focusKey={focusKey}
            onFocusHandled={() => setFocusKey(null)}
            onEdit={(localKey, text) =>
              setItems((current) =>
                current.map((item) => (item.localKey === localKey ? applyTextEdit(item, text) : item))
              )
            }
            onRemove={(localKey) =>
              setItems((current) => current.filter((item) => item.localKey !== localKey))
            }
            onMove={(localKey, direction) =>
              setItems((current) => moveItem(current, localKey, direction))
            }
            onAdd={() => {
              const item = createManualItem();
              setItems((current) => [...current, item]);
              setFocusKey(item.localKey);
            }}
            onConfirm={() => void confirmRequirements()}
          />
        ) : null}

        {state.step === 'ready' ? (
          <ReadyStep
            busy={busy}
            requirements={state.session?.confirmedRequirements ?? []}
            holderLabel={headerTitle}
            onRun={() => void runAnalysis()}
          />
        ) : null}

        {state.step === 'processing' ? <ProcessingStep /> : null}

        {state.step === 'completed' && state.result ? (
          <section aria-labelledby="analysis-result-title" className="grid gap-6">
            <h2 id="analysis-result-title" className="sr-only">
              Resultado del análisis
            </h2>
            <AnalysisResultView result={state.result} />
            {contextualEnabled ? (
              <div>
                <Button type="button" variant="secondary" onClick={startNewAnalysis}>
                  Iniciar un nuevo análisis
                </Button>
              </div>
            ) : null}
          </section>
        ) : null}

        {state.step === 'failed' && state.result?.failure ? (
          <FailureStep
            failure={state.result.failure}
            contextualEnabled={contextualEnabled}
            busy={busy}
            onRetry={() => void runAnalysis()}
            onStartNew={startNewAnalysis}
          />
        ) : null}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Pasos
// ---------------------------------------------------------------------------

function ObjectiveStep(props: {
  objectiveType: ObjectiveTypeToken;
  objectiveTitle: string;
  rawObjectiveText: string;
  busy: boolean;
  onObjectiveType: (value: ObjectiveTypeToken) => void;
  onObjectiveTitle: (value: string) => void;
  onRawObjectiveText: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader className="gap-1">
        <h2 className="text-lg font-semibold text-text-strong">¿Qué querés analizar?</h2>
        <p className="text-sm text-text-muted">
          Describí el objetivo con tus palabras. Después vas a poder revisar los requisitos antes de
          que se analice la evidencia.
        </p>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSubmit();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="objective-type">Tipo de objetivo</Label>
            <select
              id="objective-type"
              value={props.objectiveType}
              onChange={(event) => props.onObjectiveType(event.target.value as ObjectiveTypeToken)}
              className="h-11 w-full rounded-control border border-border-default bg-surface px-3 text-sm text-text-default focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:outline-none"
            >
              {OBJECTIVE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {OBJECTIVE_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="objective-title">Título (opcional)</Label>
            <Input
              id="objective-title"
              value={props.objectiveTitle}
              maxLength={MAX_TITLE_LENGTH}
              onChange={(event) => props.onObjectiveTitle(event.target.value)}
              placeholder="Analista de datos junior"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="objective-text">Objetivo</Label>
            <Textarea
              id="objective-text"
              value={props.rawObjectiveText}
              onChange={(event) => props.onRawObjectiveText(event.target.value)}
              rows={8}
              className="min-h-44 w-full"
              placeholder="Pegá o escribí el detalle del objetivo: qué conocimientos, prácticas o formación te interesa evaluar."
            />
            <p className="text-xs text-text-muted">
              {countCodePoints(props.rawObjectiveText).toLocaleString('es-AR')} de{' '}
              {MAX_OBJECTIVE_CODE_POINTS.toLocaleString('es-AR')} caracteres
            </p>
          </div>

          <div>
            <Button type="submit" disabled={props.busy}>
              {props.busy ? 'Preparando…' : 'Continuar'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function RequirementsStep(props: {
  busy: boolean;
  proposalInProgress: boolean;
  items: ReviewItem[];
  focusKey: string | null;
  onFocusHandled: () => void;
  onEdit: (localKey: string, text: string) => void;
  onRemove: (localKey: string) => void;
  onMove: (localKey: string, direction: -1 | 1) => void;
  onAdd: () => void;
  onConfirm: () => void;
}) {
  const filled = props.items.filter((item) => item.text.trim().length > 0).length;

  return (
    <section aria-labelledby="requirements-title" className="grid gap-4">
      <div>
        <h2 id="requirements-title" className="text-lg font-semibold text-text-strong">
          Revisá qué se va a evaluar
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">
          Scope propuso estos requisitos a partir de tu objetivo. Podés ajustarlos, eliminarlos,
          reordenarlos o agregar los tuyos antes del análisis.
        </p>
      </div>

      {props.proposalInProgress || (props.busy && props.items.length === 0) ? (
        <p
          aria-live="polite"
          className="flex items-center gap-2 rounded-card border border-border-default bg-surface p-4 text-sm text-text-muted"
        >
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          Estamos estructurando tu objetivo en requisitos concretos.
        </p>
      ) : null}

      <ul className="grid gap-3">
        {props.items.map((item, index) => (
          <RequirementReviewItem
            key={item.localKey}
            item={item}
            position={index + 1}
            total={props.items.length}
            shouldFocus={props.focusKey === item.localKey}
            onFocusHandled={props.onFocusHandled}
            onEdit={(text) => props.onEdit(item.localKey, text)}
            onRemove={() => props.onRemove(item.localKey)}
            onMove={(direction) => props.onMove(item.localKey, direction)}
            onShowInSource={() => undefined}
          />
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={props.onAdd}
          disabled={props.items.length >= MAX_REQUIREMENTS}
        >
          Agregar requisito
        </Button>
        <Button type="button" onClick={props.onConfirm} disabled={props.busy || filled === 0}>
          Confirmar requisitos
        </Button>
        {/*
          * DEFENSA, no decoracion. "34 de hasta 12 requisitos" se lee como un
          * estado valido con un numero grande, y no lo es: es imposible. El
          * backend ya no puede entregar una propuesta asi, y si alguna vez
          * llegara, aca se nombra el exceso en vez de maquillarlo de contador.
          */}
        {filled > MAX_REQUIREMENTS ? (
          <p role="status" className="text-xs font-semibold text-amber-900">
            Hay {filled} requisitos y el máximo es {MAX_REQUIREMENTS}. Eliminá{' '}
            {filled - MAX_REQUIREMENTS} para poder confirmar.
          </p>
        ) : (
          <p className="text-xs text-text-muted">
            {filled} de hasta {MAX_REQUIREMENTS} requisitos
          </p>
        )}
      </div>
    </section>
  );
}

function ReadyStep(props: {
  busy: boolean;
  requirements: string[];
  holderLabel: string;
  onRun: () => void;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader className="gap-1">
        <h2 className="text-lg font-semibold text-text-strong">Todo listo para analizar</h2>
        <p className="text-sm text-text-muted">
          Scope va a analizar la evidencia que {props.holderLabel} autorizó frente a los requisitos que
          confirmaste. Estos requisitos ya no pueden modificarse: para cambiarlos, iniciá un análisis
          nuevo.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ol className="grid gap-2">
          {props.requirements.map((requirement, index) => (
            <li
              key={`${index}-${requirement}`}
              className="rounded-control border border-border-default px-3 py-2 text-sm leading-6 text-text-default"
            >
              <span className="mr-2 text-xs font-semibold text-text-muted">#{index + 1}</span>
              {requirement}
            </li>
          ))}
        </ol>
        <div>
          <Button type="button" onClick={props.onRun} disabled={props.busy}>
            Analizar evidencia
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ProcessingStep() {
  return (
    <Card className="min-w-0">
      <CardContent className="grid gap-2 py-8 text-center">
        <p
          aria-live="polite"
          className="flex items-center justify-center gap-2 text-base font-medium text-text-strong"
        >
          <LoaderCircle aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" />
          Analizando la evidencia autorizada…
        </p>
        <p className="text-sm text-text-muted">
          Este proceso puede tardar unos minutos. Podés dejar esta página abierta.
        </p>
      </CardContent>
    </Card>
  );
}

function FailureStep(props: {
  failure: NonNullable<PublicAnalysisResultVM['failure']>;
  contextualEnabled: boolean;
  busy: boolean;
  onRetry: () => void;
  onStartNew: () => void;
}) {
  const copy = failureCopy(props.failure, props.contextualEnabled);
  return (
    <section className="grid gap-4">
      <FeedbackAlert variant="error" title={copy.title}>
        {copy.description}
      </FeedbackAlert>
      {copy.recovery === 'RETRY_SAME_ANALYSIS' ? (
        <div>
          <Button type="button" onClick={props.onRetry} disabled={props.busy}>
            Reintentar análisis
          </Button>
        </div>
      ) : null}
      {copy.recovery === 'START_NEW_ANALYSIS' ? (
        <div>
          <Button type="button" variant="secondary" onClick={props.onStartNew}>
            Iniciar un nuevo análisis
          </Button>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Utilidades locales
// ---------------------------------------------------------------------------

function itemsFromProposal(
  candidates: NonNullable<PublicVerificationSessionVM['proposal']>['candidates']
): ReviewItem[] {
  return candidates.map((candidate) => ({
    localKey: `candidate-${candidate.candidateId}`,
    candidateId: candidate.candidateId,
    text: candidate.proposedRequirementText,
    originalProposedText: candidate.proposedRequirementText,
    origin: 'PROPOSED',
    wasEverEdited: false,
    primaryExcerpt: candidate.primaryExcerpt,
    excerptRange: candidate.excerptRange,
    grounding: candidate.grounding,
    confirmableAsSourceDerived: candidate.confirmableAsSourceDerived,
    sourceSectionLabel: candidate.sourceSectionLabel,
    isExactDuplicate: candidate.isExactDuplicate
  }));
}

function moveItem(items: ReviewItem[], localKey: string, direction: -1 | 1): ReviewItem[] {
  const index = items.findIndex((item) => item.localKey === localKey);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

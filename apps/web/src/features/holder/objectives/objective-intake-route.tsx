'use client';

/**
 * Intake + revision de un objetivo — P2.3.
 *
 * UNA sola ruta con DOS fases. La propuesta es transitoria y no existe en el
 * servidor: si la revision tuviera URL propia, esa URL seria irrecuperable al
 * recargarla o compartirla, y habria que inventar un error para una direccion
 * legitima. Con una sola ruta, recargar vuelve al intake, que es honesto.
 *
 * El snapshot analizado y el borrador viven aca y mueren juntos.
 */

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { HolderBreadcrumbs } from '@/features/holder/holder-breadcrumbs';
import { ObjectiveSourceDialog } from '@/features/holder/objectives/objective-source-dialog';
import { RequirementReviewItem } from '@/features/holder/objectives/requirement-review-item';
import {
  buildCreateObjectiveBody,
  buildProposalRequestBody,
  countCodePoints,
  describeSelection,
  formatSectionLabel,
  isAlreadyInList,
  MAX_OBJECTIVE_CODE_POINTS,
  MAX_OBJECTIVE_REQUIREMENTS,
  summarizeReview,
  validateConfirm,
  validateIntake,
  type ConfirmValidationCode,
  type IntakeValidationCode
} from '@/features/holder/objectives/review-draft';
import { useObjectiveFlow } from '@/features/holder/objectives/use-objective-review-draft';
import {
  createObjectiveRequest,
  proposeObjectiveRequirementsRequest
} from '@/lib/api/objectives-api';
import {
  mapObjectiveCreateError,
  mapObjectiveProposalError
} from '@/lib/errors/objective-error-mapper';
import { useSession } from '@/lib/session/session-provider';
import {
  OBJECTIVE_TYPES,
  OBJECTIVE_TYPE_LABELS,
  type ObjectiveSourceRangeVM,
  type ObjectiveTypeToken,
  type ReviewItem
} from '@/models/objectives';

const INTAKE_MESSAGES: Record<IntakeValidationCode, string> = {
  OBJECTIVE_TYPE_REQUIRED: 'Elegi el tipo de objetivo.',
  TITLE_REQUIRED: 'Ponele un nombre al objetivo.',
  TITLE_TOO_LONG: 'El nombre del objetivo es demasiado largo.',
  TEXT_REQUIRED: 'Pega el texto del objetivo.',
  TEXT_TOO_MANY_CODE_POINTS:
    'El texto del objetivo es demasiado largo para analizarlo de una vez. Proba acortarlo sin perder la parte que describe los requisitos.',
  REQUEST_BODY_TOO_LARGE:
    'El contenido es demasiado largo para enviarlo completo. Acorta el texto del objetivo sin perder la parte que describe los requisitos.'
};

const CONFIRM_MESSAGES: Record<ConfirmValidationCode, string> = {
  NO_REQUIREMENTS: 'Agrega al menos un requisito para confirmar el objetivo.',
  TOO_MANY_REQUIREMENTS: `Un objetivo puede tener hasta ${MAX_OBJECTIVE_REQUIREMENTS} requisitos. Elimina los que no sean centrales para confirmarlo.`,
  BLANK_REQUIREMENT: 'Hay un requisito sin texto. Completalo o eliminalo.',
  REQUEST_BODY_TOO_LARGE:
    'El objetivo revisado quedo demasiado grande para confirmarlo. Volve a editar el objetivo y acorta el texto original antes de analizarlo nuevamente.'
};

const UNDO_WINDOW_MS = 8000;

export function ObjectiveIntakeRoute() {
  const router = useRouter();
  const { requestAuthenticated } = useSession();
  const { state, dispatch, actions } = useObjectiveFlow();

  // Identidad de peticion: una respuesta vieja que llega tarde NUNCA pisa el
  // estado actual. No alcanza con abortar, porque no toda capa de red honra la
  // senal.
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [sourceRange, setSourceRange] = useState<ObjectiveSourceRangeVM | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [liveMessage, setLiveMessage] = useState('');

  const reviewActive = state.phase === 'review' && state.draft !== null;

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    },
    []
  );

  // Recargar durante la revision pierde la propuesta: no hay borrador en
  // servidor y persistirla en el navegador crearia una copia de datos privados
  // que nadie pidio. El dialogo nativo cubre el caso real, que es el F5 sin
  // querer.
  useEffect(() => {
    if (!reviewActive) return undefined;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [reviewActive]);

  useEffect(() => {
    if (state.lastRemoved === null) return undefined;
    undoTimerRef.current = setTimeout(() => actions.clearUndo(), UNDO_WINDOW_MS);
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, [state.lastRemoved, actions]);

  const analyze = useCallback(async () => {
    if (state.analyzing) return;

    const validation = validateIntake(state.intake);
    if (validation !== null) {
      dispatch({ type: 'failLocally', message: INTAKE_MESSAGES[validation] });
      return;
    }

    const objectiveType = state.intake.objectiveType as ObjectiveTypeToken;
    const snapshot = {
      objectiveType,
      title: state.intake.title,
      // El texto EXACTO que se envia queda congelado aca. Desde este punto es la
      // unica autoridad: al confirmar no se relee del textarea.
      rawObjectiveText: state.intake.rawObjectiveText
    };

    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    dispatch({ type: 'analyzeStarted' });
    setLiveMessage('Identificando requisitos. Puede tardar hasta un minuto.');

    try {
      const proposal = await proposeObjectiveRequirementsRequest(
        requestAuthenticated,
        buildProposalRequestBody(snapshot),
        controller.signal
      );
      if (requestId !== requestIdRef.current) return;
      dispatch({ type: 'analyzeSucceeded', snapshot, proposal });
      setLiveMessage(
        proposal.omittedCandidates.length > 0
          ? `Se seleccionaron ${proposal.candidates.length} de ${proposal.candidates.length + proposal.omittedCandidates.length} requisitos identificados.`
          : `Se identificaron ${proposal.candidates.length} requisitos para revisar.`
      );
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      const mapped = mapObjectiveProposalError(error);
      dispatch({
        type: 'analyzeFailed',
        message: mapped.message,
        retryable: mapped.retryable
      });
      setLiveMessage('No se pudo analizar el objetivo.');
    }
  }, [dispatch, requestAuthenticated, state.analyzing, state.intake]);

  const confirm = useCallback(async () => {
    if (state.confirming || state.draft === null) return;

    const validation = validateConfirm(state.draft);
    if (validation !== null) {
      dispatch({
        type: 'failLocally',
        message: CONFIRM_MESSAGES[validation.code],
        localKey: validation.localKey
      });
      return;
    }

    dispatch({ type: 'confirmStarted' });
    try {
      const objective = await createObjectiveRequest(
        requestAuthenticated,
        buildCreateObjectiveBody(state.draft)
      );
      router.push(`/wallet/objectives/${objective.objectiveReference}`);
    } catch (error) {
      // El borrador queda intacto y la propuesta NO se vuelve a pedir.
      const mapped = mapObjectiveCreateError(error);
      dispatch({
        type: 'confirmFailed',
        message: mapped.message,
        retryable: mapped.retryable
      });
    }
  }, [dispatch, requestAuthenticated, router, state.confirming, state.draft]);

  const codePoints = countCodePoints(state.intake.rawObjectiveText);
  const nearLimit = codePoints > MAX_OBJECTIVE_CODE_POINTS * 0.8;

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-5xl gap-8">
      <HolderBreadcrumbs
        items={[
          { label: 'Mi perfil formativo', href: '/wallet' },
          { label: 'Objetivos', href: '/wallet/objectives' },
          { label: reviewActive ? 'Revisar requisitos' : 'Nuevo objetivo' }
        ]}
      />

      <p aria-live="polite" className="sr-only">
        {liveMessage}
      </p>

      {state.error ? (
        <FeedbackAlert variant="warning" title="No pudimos continuar">
          {state.error}
        </FeedbackAlert>
      ) : null}

      {state.phase === 'intake' ? (
        <IntakeForm
          state={state}
          onFieldChange={actions.setIntakeField}
          onAnalyze={() => void analyze()}
          codePoints={codePoints}
          nearLimit={nearLimit}
        />
      ) : null}

      {reviewActive && state.draft ? (
        <section aria-labelledby="requirement-review-title" className="mx-auto grid w-full max-w-5xl gap-6">
          <header className="grid gap-4 border-b border-border-default pb-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 max-w-2xl">
                <p className="text-sm font-semibold text-teal-700">
                  {OBJECTIVE_TYPE_LABELS[state.draft.snapshot.objectiveType]}
                </p>
                <h1
                  id="requirement-review-title"
                  className="mt-1 text-3xl font-bold tracking-tight text-text-strong"
                >
                  Revisa los requisitos
                </h1>
                <p className="mt-3 leading-7 text-text-muted">
                  Scope identificó estos requisitos a partir del texto del objetivo.
                  Revisalos, editalos o eliminá los que no correspondan. Vos decidís
                  cuáles quedan.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setSourceRange(null);
                    setSourceOpen(true);
                  }}
                >
                  Ver objetivo original
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setDiscardOpen(true)}
                >
                  Volver y editar
                </Button>
              </div>
            </div>
            <p className="text-sm text-text-muted">
              <span className="font-medium text-text-strong">
                {state.draft.snapshot.title}
              </span>
            </p>
          </header>

          {state.draft.unresolvedPassageCount > 0 ? (
            <FeedbackAlert variant="warning" title="Revisa el texto original">
              Hay {state.draft.unresolvedPassageCount} fragmentos del objetivo que no
              se convirtieron en requisitos. Revisa el texto original por si falta
              algo.
            </FeedbackAlert>
          ) : null}

          {describeSelection(state.draft, state.proposedCount) !== null ? (
            <FeedbackAlert variant="information" title="Hubo una selección">
              {describeSelection(state.draft, state.proposedCount)}
            </FeedbackAlert>
          ) : null}

          <p className="rounded-control border border-border-default bg-surface-muted px-4 py-3 text-sm text-text-muted">
            {summarizeReview(state.draft, state.proposedCount)}
          </p>

          {state.draft.items.length === 0 ? (
            <p className="rounded-card border border-border-default bg-surface p-6 text-sm text-text-muted">
              No identificamos requisitos en este objetivo. Podes agregarlos a mano.
            </p>
          ) : (
            <ul className="grid list-none gap-3">
              {state.draft.items.map((item, index) => (
                <RequirementReviewItem
                  key={item.localKey}
                  item={item}
                  position={index + 1}
                  total={state.draft!.items.length}
                  shouldFocus={state.focusRequestKey === item.localKey}
                  onFocusHandled={actions.focusHandled}
                  onEdit={(text) => actions.editItem(item.localKey, text)}
                  onRemove={() => {
                    actions.removeItem(item.localKey);
                    setLiveMessage(`Requisito ${index + 1} eliminado.`);
                  }}
                  onMove={(direction) => {
                    actions.moveItem(item.localKey, direction);
                    setLiveMessage(
                      `Requisito movido a la posicion ${index + 1 + direction} de ${state.draft!.items.length}.`
                    );
                  }}
                  onShowInSource={() => {
                    setSourceRange(item.excerptRange);
                    setSourceOpen(true);
                  }}
                />
              ))}
            </ul>
          )}

          {state.lastRemoved ? (
            <div className="flex items-center gap-3 rounded-control border border-border-default bg-surface-muted px-4 py-3 text-sm">
              <span className="text-text-muted">Requisito eliminado.</span>
              <button
                type="button"
                onClick={() => actions.undoRemove()}
                className="font-semibold text-brand-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
              >
                Deshacer
              </button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={actions.addManualItem}
              disabled={state.draft.items.length >= MAX_OBJECTIVE_REQUIREMENTS}
            >
              + Agregar requisito
            </Button>
            <p className="text-xs text-text-muted">
              {state.draft.items.length} de hasta {MAX_OBJECTIVE_REQUIREMENTS} requisitos
            </p>
          </div>

          {state.draft.omittedItems.length > 0 ? (
            <OmittedRequirements
              items={state.draft.omittedItems}
              selected={state.draft.items}
              full={state.draft.items.length >= MAX_OBJECTIVE_REQUIREMENTS}
              onUse={(localKey) => {
                actions.useOmittedItem(localKey);
                setLiveMessage('Requisito agregado al final de la lista.');
              }}
              onReplace={(omittedKey, targetKey) => {
                actions.replaceWithOmittedItem(omittedKey, targetKey);
                setLiveMessage('Requisito reemplazado. El anterior quedó entre los omitidos.');
              }}
            />
          ) : null}

          {state.draft.nonFormativeConditions.length > 0 ? (
            <NonFormativeConditions conditions={state.draft.nonFormativeConditions} />
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border-default pt-6">
            <p className="text-sm text-text-muted">Confirmá únicamente los requisitos que quieras conservar.</p>
            <Button type="button" onClick={() => void confirm()} disabled={state.confirming}>
              {state.confirming ? 'Confirmando...' : 'Confirmar objetivo'}
            </Button>
          </div>
        </section>
      ) : null}

      {sourceOpen && state.draft ? (
        <ObjectiveSourceDialog
          rawObjectiveText={state.draft.snapshot.rawObjectiveText}
          range={sourceRange}
          onClose={() => setSourceOpen(false)}
        />
      ) : null}

      {discardOpen ? (
        <DiscardDialog
          onCancel={() => setDiscardOpen(false)}
          onConfirm={() => {
            setDiscardOpen(false);
            actions.discardReview();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Los requisitos que la seleccion dejo afuera. Plegado por defecto: lo principal
 * es revisar los elegidos, pero nada queda escondido.
 */
function OmittedRequirements({
  items,
  selected,
  full,
  onUse,
  onReplace
}: {
  items: readonly ReviewItem[];
  selected: readonly ReviewItem[];
  full: boolean;
  onUse: (localKey: string) => void;
  onReplace: (omittedKey: string, targetKey: string) => void;
}) {
  const [replacing, setReplacing] = useState<string | null>(null);
  return (
    <details className="rounded-card border border-border-default bg-surface p-4">
      <summary className="cursor-pointer text-sm font-semibold text-text-strong">
        Requisitos que quedaron afuera ({items.length})
      </summary>
      <p className="mt-3 text-sm text-text-muted">
        {full
          ? `La lista ya tiene ${MAX_OBJECTIVE_REQUIREMENTS} requisitos: podés reemplazar uno por cualquiera de estos.`
          : 'Podés sumar cualquiera de estos a la lista de arriba.'}
      </p>
      <ul className="mt-3 grid list-none gap-2">
        {items.map((item) => {
          const section = formatSectionLabel(item.sourceSectionLabel);
          const duplicate = isAlreadyInList(selected, item);
          return (
            <li
              key={item.localKey}
              className="grid gap-2 rounded-control border border-border-default px-3 py-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-text-strong">{item.text}</p>
                  {section ? <p className="text-xs text-text-muted">{section}</p> : null}
                  {duplicate ? (
                    <p className="text-xs text-text-muted">Ya está en la lista.</p>
                  ) : null}
                </div>
                {full ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={duplicate}
                    aria-expanded={replacing === item.localKey}
                    onClick={() =>
                      setReplacing(replacing === item.localKey ? null : item.localKey)
                    }
                    aria-label={`Reemplazar un requisito por: ${item.text}`}
                  >
                    Reemplazar uno…
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={duplicate}
                    onClick={() => onUse(item.localKey)}
                    aria-label={`Usar este requisito: ${item.text}`}
                  >
                    Usar este requisito
                  </Button>
                )}
              </div>
              {full && replacing === item.localKey ? (
                <div className="grid gap-1">
                  <p className="text-xs text-text-muted">¿Cuál sale de la lista?</p>
                  {selected.map((target, index) => (
                    <button
                      key={target.localKey}
                      type="button"
                      onClick={() => {
                        onReplace(item.localKey, target.localKey);
                        setReplacing(null);
                      }}
                      className="rounded-control px-2 py-1 text-left text-sm text-brand-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
                    >
                      {`Reemplazar ${index + 1}. ${target.text || '(sin texto)'}`}
                    </button>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** Condiciones legitimas del aviso que no entran al analisis formativo. */
function NonFormativeConditions({ conditions }: { conditions: readonly string[] }) {
  return (
    <section
      aria-labelledby="non-formative-conditions-title"
      className="rounded-card border border-border-default bg-surface p-4"
    >
      <h2 id="non-formative-conditions-title" className="text-sm font-semibold text-text-strong">
        Condiciones del aviso que no se analizan con tu formación
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        Siguen siendo parte de la oportunidad, pero ninguna credencial las acredita. Si querés
        analizar alguna igual, agregala como requisito.
      </p>
      <ul className="mt-3 grid list-disc gap-1 pl-5 text-sm text-text-default">
        {conditions.map((condition, index) => (
          <li key={`${index}-${condition}`}>{condition}</li>
        ))}
      </ul>
    </section>
  );
}

function IntakeForm({
  state,
  onFieldChange,
  onAnalyze,
  codePoints,
  nearLimit
}: {
  state: ReturnType<typeof useObjectiveFlow>['state'];
  onFieldChange: (field: 'objectiveType' | 'title' | 'rawObjectiveText', value: string) => void;
  onAnalyze: () => void;
  codePoints: number;
  nearLimit: boolean;
}) {
  const disabled = state.analyzing;

  return (
    <section aria-labelledby="objective-intake-title" className="mx-auto grid w-full max-w-4xl gap-7">
      <header className="grid gap-3 border-b border-border-default pb-6">
        <p className="text-sm font-semibold text-teal-700">Objetivos</p>
        <h1
          id="objective-intake-title"
          className="text-3xl font-bold tracking-tight text-text-strong sm:text-4xl"
        >
          Analizar un objetivo
        </h1>
        <p className="max-w-2xl leading-7 text-text-muted">
          Pega el texto completo del objetivo. Scope va a identificar los requisitos
          que aparecen para que los revises antes de confirmarlos.
        </p>
      </header>

      <fieldset disabled={disabled} className="grid gap-3 rounded-card border border-border-default bg-surface p-5 sm:p-6">
        <legend className="text-sm font-semibold text-text-strong">
          Tipo de objetivo
        </legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {OBJECTIVE_TYPES.map((type) => (
            <label
              key={type}
              className="flex cursor-pointer items-center gap-3 rounded-control border border-border-default bg-surface px-4 py-3 text-sm transition hover:border-brand-600 has-[:checked]:border-brand-600 has-[:checked]:bg-surface-muted"
            >
              <input
                type="radio"
                name="objectiveType"
                value={type}
                checked={state.intake.objectiveType === type}
                onChange={() => onFieldChange('objectiveType', type)}
                className="size-4 accent-brand-900"
              />
              <span className="text-text-strong">{OBJECTIVE_TYPE_LABELS[type]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid max-w-2xl gap-2">
        <Label htmlFor="objective-title">Nombre del objetivo</Label>
        <Input
          id="objective-title"
          value={state.intake.title}
          onChange={(event) => onFieldChange('title', event.target.value)}
          disabled={disabled}
          maxLength={500}
          aria-describedby="objective-title-help"
        />
        <p id="objective-title-help" className="text-xs text-text-muted">
          Para reconocerlo despues. Ej.: &ldquo;Backend Engineer — Empresa X&rdquo;
        </p>
      </div>

      <div className="grid gap-2 rounded-card border border-border-default bg-surface p-5 sm:p-6">
        <Label htmlFor="objective-text">Texto del objetivo</Label>
        <Textarea
          id="objective-text"
          value={state.intake.rawObjectiveText}
          onChange={(event) => onFieldChange('rawObjectiveText', event.target.value)}
          disabled={disabled}
          rows={10}
          aria-describedby="objective-text-help"
          className="min-h-56"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p id="objective-text-help" className="text-xs text-text-muted">
            Pega la publicacion completa, tal como esta. No la resumas: el detalle
            importa.
          </p>
          {nearLimit ? (
            <p className="text-xs text-text-muted">
              {codePoints.toLocaleString('es-AR')} /{' '}
              {MAX_OBJECTIVE_CODE_POINTS.toLocaleString('es-AR')} caracteres
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 rounded-card border border-brand-700/15 bg-surface-muted p-5 sm:p-6">
        <div>
          <Button type="button" onClick={onAnalyze} disabled={disabled}>
            {disabled ? (
              <>
                <LoaderCircle aria-hidden="true" className="animate-spin" />
                Identificando requisitos...
              </>
            ) : (
              'Analizar objetivo'
            )}
          </Button>
        </div>
        {disabled ? (
          <p className="flex items-center gap-2 text-sm text-text-muted">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            Puede tardar hasta un minuto.
          </p>
        ) : null}
        <p className="text-xs text-text-subtle">
          Tu objetivo es privado. No se comparte ni se publica.
        </p>
      </div>
    </section>
  );
}

function DiscardDialog({
  onCancel,
  onConfirm
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="discard-review-title"
        className="w-full max-w-md rounded-card border border-border-default bg-surface p-6 shadow-lg"
      >
        <h2 id="discard-review-title" className="text-lg font-semibold text-text-strong">
          Descartar la revision?
        </h2>
        <p className="mt-2 text-sm leading-6 text-text-muted">
          Vas a perder los requisitos que revisaste.
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button ref={cancelRef} type="button" variant="secondary" onClick={onCancel}>
            Seguir revisando
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            Descartar
          </Button>
        </div>
      </div>
    </div>
  );
}

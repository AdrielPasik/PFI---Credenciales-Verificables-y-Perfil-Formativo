'use client';

import { Layers, Search } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  formatApprovalDriftStatus,
  formatChangedField,
  formatDestinationCompatibility,
  formatTemplateContentStatus
} from '@/lib/formatters/reusable-semantic-interpretation';
import { mapCredentialError } from '@/lib/errors/credential-error-mapper';
import type {
  AppliedReusableSemanticInterpretationVM,
  ApplyReusableSemanticInterpretationResultVM,
  CourseTemplateSummaryVM,
  CredentialFeedback,
  ReusableCredentialType,
  ReusableSemanticInterpretationCandidateVM
} from '@/models/credentials';

interface ReusableSemanticInterpretationSectionProps {
  credentialType: ReusableCredentialType;
  // 'issued' habilita el flujo completo (buscar/aplicar); 'revoked' muestra
  // solo la aplicacion historica en modo lectura (el backend permite leerla,
  // pero candidate/apply exigen issued -- nunca se ofrece esa accion aca).
  readOnly?: boolean;
  onLoadActiveApplication(): Promise<AppliedReusableSemanticInterpretationVM | null>;
  searchTemplates(
    query: string,
    signal: AbortSignal
  ): Promise<CourseTemplateSummaryVM[]>;
  onLoadCandidate(
    templateReference: string
  ): Promise<ReusableSemanticInterpretationCandidateVM>;
  onApply(command: {
    templateReference: string;
    approvalRevision: string;
    acknowledgeDestinationDrift?: boolean;
  }): Promise<ApplyReusableSemanticInterpretationResultVM>;
}

type ActiveState =
  | { kind: 'loading' }
  | { kind: 'loaded'; application: AppliedReusableSemanticInterpretationVM | null }
  | { kind: 'error'; feedback: CredentialFeedback };

type CandidateState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; candidate: ReusableSemanticInterpretationCandidateVM }
  | { kind: 'error'; feedback: CredentialFeedback };

type ApplyState =
  | { kind: 'idle' }
  | { kind: 'applying' }
  | { kind: 'success'; result: ApplyReusableSemanticInterpretationResultVM }
  | { kind: 'error'; feedback: CredentialFeedback };

const nounByType: Record<ReusableCredentialType, string> = {
  course: 'curso',
  certification: 'certificación'
};

// C4b.2-R: un template solo es ofrecible en el selector si ya tiene una
// interpretacion APROBADA para reutilizacion (C4a.1/C4a.2) -- nunca alcanza
// con que exista/haya existido un analisis asociado
// (lastSemanticAnalysisId), porque eso no implica revision/aprobacion.
// approvedSemanticSnapshotSummary es la senal de producto ya expuesta por
// el backend para esto (solo counts/flags allowlisted, nunca el snapshot
// completo) -- no se recrea ninguna otra invariante de aprobacion en el
// frontend (sourceCredentialId/approvedBy/pipelineVersion/etc. siguen
// siendo autoridad exclusiva de candidate/apply en el backend).
function isEligibleForReusableInterpretation(
  template: CourseTemplateSummaryVM
): boolean {
  return template.approvedSemanticSnapshotSummary !== null;
}

// C4b.2: aplicar a esta credencial una interpretacion semantica que el
// emisor YA reviso/aprobo para un contenido reutilizable (C4a.1/C4a.2).
// Distinto de SemanticApprovalSection (C5): esa seccion REVISA/APRUEBA una
// interpretacion para volverla reutilizable; esta APLICA una interpretacion
// que ya fue revisada. No afirma ni insinua que el perfil formativo del
// titular ya fue actualizado -- ese consumo pertenece a C5b.1.
export function ReusableSemanticInterpretationSection({
  credentialType,
  readOnly = false,
  onLoadActiveApplication,
  searchTemplates,
  onLoadCandidate,
  onApply
}: ReusableSemanticInterpretationSectionProps) {
  const [activeState, setActiveState] = useState<ActiveState>({ kind: 'loading' });
  const [selectedTemplate, setSelectedTemplate] =
    useState<CourseTemplateSummaryVM | null>(null);
  const [candidateState, setCandidateState] = useState<CandidateState>({
    kind: 'idle'
  });
  const [acknowledgeDrift, setAcknowledgeDrift] = useState(false);
  const [applyState, setApplyState] = useState<ApplyState>({ kind: 'idle' });
  // Persiste el resultado de la ultima aplicacion exitosa por separado de
  // applyState -- applyState se resetea al volver al selector, pero el
  // mensaje de resultado (idempotente/actualizada) debe seguir visible
  // hasta que el emisor elija otro contenido reutilizable.
  const [lastOutcome, setLastOutcome] =
    useState<ApplyReusableSemanticInterpretationResultVM | null>(null);
  const applyInFlight = useRef(false);
  const candidateRequestId = useRef(0);
  const checkboxId = useId();

  useEffect(() => {
    let active = true;

    onLoadActiveApplication()
      .then((application) => {
        if (active) {
          setActiveState({ kind: 'loaded', application });
        }
      })
      .catch((error) => {
        if (active) {
          setActiveState({
            kind: 'error',
            feedback: mapCredentialError(error, 'reusable-interpretation-read')
          });
        }
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nunca toca applyState -- el llamador decide si corresponde resetearlo.
  // El refetch tras un 409 (TOCTOU) depende de esto para no borrar el
  // mensaje de error recien mostrado antes de que el usuario lo vea.
  function loadCandidateFor(template: CourseTemplateSummaryVM) {
    const requestId = ++candidateRequestId.current;
    setCandidateState({ kind: 'loading' });
    setAcknowledgeDrift(false);

    onLoadCandidate(template.reference)
      .then((candidate) => {
        if (requestId === candidateRequestId.current) {
          setCandidateState({ kind: 'loaded', candidate });
        }
      })
      .catch((error) => {
        if (requestId === candidateRequestId.current) {
          setCandidateState({
            kind: 'error',
            feedback: mapCredentialError(error, 'reusable-interpretation-candidate')
          });
        }
      });
  }

  function selectTemplate(template: CourseTemplateSummaryVM) {
    setSelectedTemplate(template);
    setLastOutcome(null);
    setApplyState({ kind: 'idle' });
    loadCandidateFor(template);
  }

  function changeTemplate() {
    setSelectedTemplate(null);
    setCandidateState({ kind: 'idle' });
    setAcknowledgeDrift(false);
    setApplyState({ kind: 'idle' });
    setLastOutcome(null);
  }

  async function handleApply() {
    if (
      applyInFlight.current ||
      candidateState.kind !== 'loaded' ||
      !selectedTemplate
    ) {
      return;
    }

    const { candidate } = candidateState;

    if (candidate.destinationCompatibility === 'unknown') {
      return;
    }
    if (candidate.destinationCompatibility === 'modified' && !acknowledgeDrift) {
      return;
    }

    applyInFlight.current = true;
    setApplyState({ kind: 'applying' });

    try {
      const result = await onApply({
        templateReference: candidate.templateReference,
        approvalRevision: candidate.approvalRevision,
        acknowledgeDestinationDrift:
          candidate.destinationCompatibility === 'modified'
            ? acknowledgeDrift
            : undefined
      });

      setApplyState({ kind: 'success', result });
      setActiveState({ kind: 'loaded', application: result.application });
      setLastOutcome(result);
      // Deja disponible revisar/aplicar otra aprobacion despues (requisito
      // explicito): vuelve al selector en vez de dejar el candidato viejo
      // (ya aplicado) como si siguiera pendiente de accion.
      setSelectedTemplate(null);
      setCandidateState({ kind: 'idle' });
      setAcknowledgeDrift(false);
    } catch (error) {
      const feedback = mapCredentialError(error, 'reusable-interpretation-apply');
      setApplyState({ kind: 'error', feedback });

      // TOCTOU (409): nunca reintenta apply automaticamente. Invalida el
      // candidato anterior y vuelve a pedirlo para que el usuario revise la
      // version actual antes de confirmar de nuevo.
      if (feedback.code === 'conflict' && selectedTemplate) {
        loadCandidateFor(selectedTemplate);
      }
    } finally {
      applyInFlight.current = false;
    }
  }

  const disabledBySubmit = applyState.kind === 'applying';

  return (
    <Card
      className="overflow-hidden border-border-strong shadow-none"
      data-testid="reusable-semantic-interpretation-section"
    >
      <div aria-hidden="true" className="h-1 bg-teal-700" />
      <CardHeader className="gap-2 border-b border-border-default sm:p-8 sm:pb-6">
        <p className="flex items-center gap-2 text-sm font-semibold text-teal-700">
          <Layers aria-hidden="true" className="size-4" />
          Interpretación reutilizable
        </p>
        <h2 className="text-2xl font-bold tracking-tight text-text-strong">
          Interpretación revisada por el emisor
        </h2>
        <p className="leading-7 text-text-muted">
          Podés aplicar a esta credencial una interpretación que la
          institución ya revisó sobre un contenido reutilizable.
        </p>
      </CardHeader>
      <CardContent className="grid gap-6 sm:p-8 sm:pt-7">
        <ActiveApplicationSummary state={activeState} />

        {lastOutcome ? <ApplyOutcomeNotice outcome={lastOutcome} /> : null}

        {readOnly ? (
          <FeedbackAlert variant="information" title="Historial en modo lectura">
            Esta credencial ya no está emitida. La interpretación aplicada
            queda disponible para consulta, pero no pueden aplicarse nuevas
            interpretaciones.
          </FeedbackAlert>
        ) : (
          <>
            <TemplatePicker
              credentialType={credentialType}
              disabled={disabledBySubmit}
              selectedTemplate={selectedTemplate}
              onSelect={selectTemplate}
              onChangeSelection={changeTemplate}
              searchTemplates={searchTemplates}
            />

            {selectedTemplate ? (
              <CandidatePreview
                state={candidateState}
                applyState={applyState}
                acknowledgeDrift={acknowledgeDrift}
                onAcknowledgeDriftChange={setAcknowledgeDrift}
                onApply={() => void handleApply()}
                disabled={disabledBySubmit}
                checkboxId={checkboxId}
              />
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ActiveApplicationSummary({ state }: { state: ActiveState }) {
  if (state.kind === 'loading') {
    return (
      <p aria-live="polite" className="text-sm text-text-muted">
        Consultando interpretación aplicada…
      </p>
    );
  }

  if (state.kind === 'error') {
    return (
      <FeedbackAlert
        variant="warning"
        title="No pudimos consultar la interpretación aplicada"
      >
        {state.feedback.message}
      </FeedbackAlert>
    );
  }

  if (!state.application) {
    return (
      <div className="rounded-card border border-dashed border-border-strong bg-surface-muted p-5">
        <p className="font-semibold text-text-strong">
          No hay una interpretación revisada aplicada a esta credencial.
        </p>
        <p className="mt-1 text-sm leading-6 text-text-muted">
          Podés elegir un contenido reutilizable equivalente y aplicar la
          interpretación que la institución ya revisó para ese contenido.
        </p>
      </div>
    );
  }

  const application = state.application;

  return (
    <div
      className="rounded-card border border-teal-600/25 bg-teal-100 p-5"
      data-testid="reusable-interpretation-current-application"
    >
      <p className="text-xs font-bold tracking-wide text-teal-700 uppercase">
        Actualmente aplicada
      </p>
      <p className="mt-2 font-semibold text-text-strong">
        Interpretación revisada por el emisor aplicada
      </p>
      <dl className="mt-3 grid gap-2 text-sm text-text-muted sm:grid-cols-2">
        <div>
          <dt className="font-semibold text-text-default">Contenido reutilizable</dt>
          <dd>{application.templateTitle}</dd>
        </div>
        <div>
          <dt className="font-semibold text-text-default">Aplicada</dt>
          <dd>{application.appliedAtLabel}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-semibold text-text-default">Aplicada por</dt>
          <dd>{application.appliedByDisplayLabel}</dd>
        </div>
      </dl>
      <div className="mt-4 grid gap-2">
        <StatusLine text={formatApprovalDriftStatus(application.approvalDriftStatus)} />
        {application.templateContentStatus !== 'matches_approved_source' ? (
          <StatusLine
            text={formatTemplateContentStatus(application.templateContentStatus)}
          />
        ) : null}
        {application.destinationCompatibility !== 'compatible' ? (
          <StatusLine
            text={formatDestinationCompatibility(application.destinationCompatibility)}
          />
        ) : null}
      </div>
    </div>
  );
}

function TemplatePicker({
  credentialType,
  disabled,
  selectedTemplate,
  onSelect,
  onChangeSelection,
  searchTemplates
}: {
  credentialType: ReusableCredentialType;
  disabled: boolean;
  selectedTemplate: CourseTemplateSummaryVM | null;
  onSelect(template: CourseTemplateSummaryVM): void;
  onChangeSelection(): void;
  searchTemplates(
    query: string,
    signal: AbortSignal
  ): Promise<CourseTemplateSummaryVM[]>;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CourseTemplateSummaryVM[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [feedback, setFeedback] = useState<CredentialFeedback | null>(null);
  const requestId = useRef(0);
  const abortController = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      requestId.current += 1;
      abortController.current?.abort();
    },
    []
  );

  async function runSearch() {
    abortController.current?.abort();
    const controller = new AbortController();
    const request = ++requestId.current;
    abortController.current = controller;
    setLoading(true);
    setSearched(false);
    setFeedback(null);

    try {
      const found = await searchTemplates(query.trim(), controller.signal);

      if (request === requestId.current) {
        // C4b.2-R: nunca ofrecer como opcion un template que el backend ya
        // sabe que candidate va a rechazar. approvedSemanticSnapshotSummary
        // es la senal de producto de que existe una interpretacion APROBADA
        // presentable -- lastSemanticAnalysisId solo indica que hubo (o
        // hay) un analisis asociado, nunca que fue revisado/aprobado para
        // reutilizacion (C4a.1/C4a.2). El backend sigue siendo la autoridad
        // final en candidate/apply -- este filtro solo evita ofrecer una
        // opcion predeciblemente invalida con la informacion ya disponible
        // al listar.
        setResults(found.filter(isEligibleForReusableInterpretation));
        setSearched(true);
      }
    } catch (error) {
      if (request === requestId.current && !controller.signal.aborted) {
        setFeedback(mapCredentialError(error, 'template-search'));
      }
    } finally {
      if (request === requestId.current) {
        setLoading(false);
      }
    }
  }

  const noun = nounByType[credentialType];

  if (selectedTemplate) {
    return (
      <div className="grid gap-3">
        <div className="rounded-control border border-border-default bg-surface-muted p-4">
          <p className="text-xs font-semibold tracking-wide text-text-muted uppercase">
            Contenido reutilizable elegido
          </p>
          <p className="mt-1 font-semibold text-text-strong">
            {selectedTemplate.title}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="justify-self-start"
          disabled={disabled}
          onClick={onChangeSelection}
        >
          Elegir otro contenido reutilizable
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div>
        <h3 className="text-sm font-semibold text-text-strong">
          Elegí un contenido reutilizable
        </h3>
        <p className="mt-1 text-sm leading-6 text-text-muted">
          Buscá un {noun} guardado por este emisor para revisar si su
          interpretación aprobada es aplicable a esta credencial.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="grid gap-2">
          <Label htmlFor="reusable-interpretation-template-query">
            Buscar {noun} reutilizable
          </Label>
          <input
            id="reusable-interpretation-template-query"
            type="search"
            value={query}
            disabled={disabled}
            placeholder={`Título del ${noun}`}
            className="min-h-11 w-full rounded-control border border-border-strong bg-surface px-3 py-2 text-base text-text-strong shadow-xs outline-none transition-colors placeholder:text-text-subtle hover:border-brand-600 focus-visible:border-brand-600 focus-visible:ring-3 focus-visible:ring-focus-ring/25 disabled:cursor-not-allowed disabled:bg-surface-muted sm:text-sm"
            onChange={(event) => {
              setQuery(event.target.value);
              setFeedback(null);
            }}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={disabled || loading}
          onClick={() => void runSearch()}
        >
          <Search aria-hidden="true" />
          {loading ? 'Buscando…' : 'Buscar'}
        </Button>
      </div>

      <div aria-live="polite">
        {feedback ? (
          <FeedbackAlert
            variant="error"
            title="No pudimos buscar contenido reutilizable"
          >
            {feedback.message}
          </FeedbackAlert>
        ) : null}
        {!loading && !feedback && searched && results.length === 0 ? (
          <p className="text-sm leading-6 text-text-muted">
            No encontramos contenido reutilizable con una interpretación
            revisada disponible para aplicar. Primero revisá y aprobá una
            interpretación desde una credencial emitida.
          </p>
        ) : null}
      </div>

      {results.length > 0 ? (
        <ul
          aria-label="Resultados de contenido reutilizable"
          className="grid gap-2"
        >
          {results.map((template) => (
            <li key={template.reference}>
              <button
                type="button"
                disabled={disabled}
                className="flex w-full items-start justify-between gap-4 rounded-control border border-border-default bg-surface p-3 text-left transition-colors hover:border-teal-600 hover:bg-teal-100 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus-ring/25 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => onSelect(template)}
              >
                <span className="font-semibold text-text-strong">
                  {template.title}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CandidatePreview({
  state,
  applyState,
  acknowledgeDrift,
  onAcknowledgeDriftChange,
  onApply,
  disabled,
  checkboxId
}: {
  state: CandidateState;
  applyState: ApplyState;
  acknowledgeDrift: boolean;
  onAcknowledgeDriftChange(value: boolean): void;
  onApply(): void;
  disabled: boolean;
  checkboxId: string;
}) {
  if (state.kind === 'loading') {
    return (
      <p aria-live="polite" className="text-sm font-semibold text-teal-700">
        Consultando interpretación disponible…
      </p>
    );
  }

  if (state.kind === 'error') {
    return (
      <FeedbackAlert
        variant="error"
        title="No pudimos consultar esta interpretación"
      >
        {state.feedback.message}
      </FeedbackAlert>
    );
  }

  if (state.kind === 'idle') {
    return null;
  }

  const { candidate } = state;
  const isUnknown = candidate.destinationCompatibility === 'unknown';
  const isModified = candidate.destinationCompatibility === 'modified';
  const needsAcknowledgment = isModified && !acknowledgeDrift;
  const applyDisabled =
    disabled || isUnknown || needsAcknowledgment || applyState.kind === 'applying';

  return (
    <div className="grid gap-4 rounded-card border border-border-default bg-surface-muted p-5">
      <div>
        <p className="text-xs font-bold tracking-wide text-brand-700 uppercase">
          Interpretación disponible para aplicar
        </p>
        <p className="mt-2 font-semibold text-text-strong">
          {candidate.templateTitle}
        </p>
        <p className="mt-1 text-sm text-text-muted">
          Revisada por {candidate.approvedByDisplayLabel} · {candidate.approvedAtLabel}
        </p>
      </div>

      {candidate.approvalDriftStatus === 'different_approval_available' ? (
        <FeedbackAlert variant="information" title="Hay una aprobación distinta disponible">
          {formatApprovalDriftStatus(candidate.approvalDriftStatus)}
        </FeedbackAlert>
      ) : null}

      {candidate.templateContentStatus === 'differs_from_approved_source' ? (
        <FeedbackAlert variant="warning" title="El contenido reutilizable cambió">
          {formatTemplateContentStatus(candidate.templateContentStatus)}
        </FeedbackAlert>
      ) : null}
      {candidate.templateContentStatus === 'unknown' ? (
        <FeedbackAlert variant="information" title="No pudimos comparar el contenido de origen">
          {formatTemplateContentStatus(candidate.templateContentStatus)}
        </FeedbackAlert>
      ) : null}

      <DestinationCompatibilityNotice
        candidate={candidate}
        acknowledgeDrift={acknowledgeDrift}
        onAcknowledgeDriftChange={onAcknowledgeDriftChange}
        disabled={disabled}
        checkboxId={checkboxId}
      />

      {applyState.kind === 'error' ? (
        <FeedbackAlert variant="error" title="No pudimos aplicar esta interpretación">
          {applyState.feedback.message}
        </FeedbackAlert>
      ) : null}

      <div>
        <Button type="button" disabled={applyDisabled} onClick={onApply}>
          {applyState.kind === 'applying'
            ? 'Aplicando interpretación…'
            : 'Aplicar interpretación revisada'}
        </Button>
        {isUnknown ? (
          <p className="mt-2 text-sm text-text-muted">
            No podemos verificar la compatibilidad de esta interpretación con
            esta credencial, así que no puede aplicarse.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function DestinationCompatibilityNotice({
  candidate,
  acknowledgeDrift,
  onAcknowledgeDriftChange,
  disabled,
  checkboxId
}: {
  candidate: ReusableSemanticInterpretationCandidateVM;
  acknowledgeDrift: boolean;
  onAcknowledgeDriftChange(value: boolean): void;
  disabled: boolean;
  checkboxId: string;
}) {
  const { destinationCompatibility } = candidate;

  if (destinationCompatibility === 'compatible') {
    return (
      <p className="flex items-center gap-2 text-sm font-semibold text-status-valid">
        {formatDestinationCompatibility(destinationCompatibility)}
      </p>
    );
  }

  if (destinationCompatibility === 'unknown') {
    return (
      <FeedbackAlert
        variant="error"
        title="No pudimos verificar la compatibilidad"
      >
        {formatDestinationCompatibility(destinationCompatibility)}
      </FeedbackAlert>
    );
  }

  return (
    <div className="grid gap-3 rounded-control border border-status-warning/30 bg-surface p-4">
      <FeedbackAlert variant="warning" title="Esta credencial tiene diferencias">
        {formatDestinationCompatibility(destinationCompatibility)}
      </FeedbackAlert>
      {candidate.changedFields.length > 0 ? (
        <div>
          <p className="text-sm font-semibold text-text-strong">
            Campos con diferencias
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {candidate.changedFields.map((field) => (
              <Badge key={field} variant="outline">
                {formatChangedField(field)}
              </Badge>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex items-start gap-3">
        <input
          id={checkboxId}
          type="checkbox"
          checked={acknowledgeDrift}
          disabled={disabled}
          onChange={(event) => onAcknowledgeDriftChange(event.target.checked)}
          className="mt-0.5 size-4 rounded border-border-strong text-brand-900 focus-visible:ring-3 focus-visible:ring-focus-ring/25"
        />
        <Label htmlFor={checkboxId} className="leading-6">
          Entiendo que esta credencial tiene diferencias respecto del
          contenido de origen y quiero aplicar esta interpretación igualmente.
        </Label>
      </div>
    </div>
  );
}

function StatusLine({ text }: { text: string }) {
  return <p className="text-sm leading-6 text-text-default">{text}</p>;
}

// Traduce el resultado de apply a copy de producto -- nunca menciona
// "supersede" ni afirma que el perfil formativo ya se actualizo (eso es
// C5b.1, fuera de alcance de C4b.2).
function ApplyOutcomeNotice({
  outcome
}: {
  outcome: ApplyReusableSemanticInterpretationResultVM;
}) {
  if (!outcome.changed) {
    return (
      <FeedbackAlert variant="information" title="Esta interpretación ya estaba aplicada">
        No hicieron falta cambios: la interpretación revisada ya estaba
        aplicada a esta credencial.
      </FeedbackAlert>
    );
  }

  if (outcome.supersededPreviousApplication) {
    return (
      <FeedbackAlert variant="success" title="Se actualizó la interpretación aplicada a esta credencial">
        La nueva interpretación revisada quedó aplicada a esta credencial.
      </FeedbackAlert>
    );
  }

  return (
    <FeedbackAlert variant="success" title="Interpretación aplicada">
      La interpretación revisada por el emisor quedó aplicada a esta
      credencial.
    </FeedbackAlert>
  );
}

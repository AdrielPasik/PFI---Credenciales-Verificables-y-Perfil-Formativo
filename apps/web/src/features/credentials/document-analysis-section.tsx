import {
  BrainCircuit,
  CircleDashed,
  RefreshCw,
  RotateCcw,
  Sparkles
} from 'lucide-react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader
} from '@/components/ui/card';
import type { DocumentAnalysisState } from '@/features/credentials/use-issuer-document-analysis';
import type { IssuerAnalysisRunVM } from '@/models/analysis-runs';
import type {
  CredentialStatus,
  DocumentEvidenceVM
} from '@/models/credentials';

interface DocumentAnalysisSectionProps {
  credentialStatus: CredentialStatus;
  currentDocument: DocumentEvidenceVM | null;
  state: DocumentAnalysisState;
  onTrigger(): Promise<void>;
  onRefresh(): Promise<void>;
}

export function DocumentAnalysisSection({
  credentialStatus,
  currentDocument,
  state,
  onRefresh,
  onTrigger
}: DocumentAnalysisSectionProps) {
  const runActive =
    state.currentRun?.status === 'pending' ||
    state.currentRun?.status === 'running';
  const hasPdf =
    currentDocument?.kind === 'pdf' &&
    currentDocument.mimeType === 'application/pdf';
  const canTrigger =
    credentialStatus === 'draft' &&
    hasPdf &&
    !runActive &&
    state.latestStatus === 'ready' &&
    state.actionError === null;
  const triggerLabel = getTriggerLabel(state.currentRun);

  return (
    <section
      aria-labelledby="document-analysis-title"
      aria-busy={state.triggering}
      className="grid gap-6"
    >
      <Card className="overflow-hidden border-border-strong shadow-none">
        <div aria-hidden="true" className="h-1 bg-status-analysis" />
        <CardHeader className="gap-5 border-b border-border-default sm:flex-row sm:items-start sm:justify-between sm:p-8 sm:pb-6">
          <div className="max-w-3xl">
            <p className="flex items-center gap-2 text-sm font-semibold text-teal-700">
              <BrainCircuit aria-hidden="true" className="size-4" />
              Análisis formativo asistido
            </p>
            <h2
              id="document-analysis-title"
              className="mt-2 text-2xl font-bold tracking-tight text-text-strong"
            >
              Análisis inteligente del documento
            </h2>
            <p className="mt-2 leading-7 text-text-muted">
              Traza puede interpretar la evidencia documental para resumir
              áreas, habilidades y conceptos detectados.
            </p>
            <p className="mt-2 text-sm leading-6 text-text-muted">
              El resultado es asistido por IA y puede requerir revisión.
            </p>
          </div>

          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
            {state.currentRun ? <RunBadge run={state.currentRun} /> : null}
            {canTrigger ? (
              <Button
                type="button"
                disabled={state.triggering || state.refreshing}
                onClick={() => void onTrigger()}
              >
                {state.triggering ? (
                  <RefreshCw aria-hidden="true" className="animate-spin" />
                ) : state.currentRun ? (
                  <RotateCcw aria-hidden="true" />
                ) : (
                  <Sparkles aria-hidden="true" />
                )}
                {state.triggering ? 'Analizando documento' : triggerLabel}
              </Button>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="grid gap-6 pt-6 sm:p-8 sm:pt-7">
          <div aria-live="polite">
            {state.latestStatus === 'loading' ? (
              <AnalysisLoading label="Consultando último análisis" />
            ) : null}
            {state.triggering ? (
              <AnalysisLoading label="Traza está procesando la evidencia documental" />
            ) : null}
            {state.successMessage ? (
              <p className="text-sm font-semibold text-status-valid">
                {state.successMessage}
              </p>
            ) : null}
          </div>

          {state.latestError ? (
            <FeedbackAlert
              variant="error"
              title="No pudimos consultar el análisis"
            >
              {state.latestError}
            </FeedbackAlert>
          ) : null}

          {state.actionError ? (
            <FeedbackAlert
              variant="error"
              title="No pudimos iniciar el análisis"
            >
              {state.actionError}
            </FeedbackAlert>
          ) : null}

          {state.currentRun ? (
            <AnalysisRunSummary run={state.currentRun} />
          ) : state.latestStatus === 'ready' ? (
            <div className="rounded-card border border-dashed border-border-strong bg-surface-muted p-5">
              <p className="font-semibold text-text-strong">
                Todavía no hay análisis registrados.
              </p>
              <p className="mt-1 text-sm leading-6 text-text-muted">
                Cuando exista una ejecución, este espacio mostrará su estado y
                un resumen seguro del resultado.
              </p>
            </div>
          ) : null}

          <EligibilityNotice
            credentialStatus={credentialStatus}
            currentDocument={currentDocument}
            runActive={runActive}
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={
                state.refreshing ||
                state.triggering ||
                state.latestStatus === 'loading'
              }
              onClick={() => void onRefresh()}
            >
              <RefreshCw
                aria-hidden="true"
                className={state.refreshing ? 'animate-spin' : undefined}
              />
              {state.refreshing
                ? 'Actualizando estado'
                : 'Consultar último análisis'}
            </Button>
            <p className="text-sm text-text-muted">
              La actualización es manual; Traza no consulta el estado en
              segundo plano.
            </p>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function AnalysisRunSummary({ run }: { run: IssuerAnalysisRunVM }) {
  const semantic = run.semanticAnalysis;

  return (
    <div className="grid gap-6">
      <div>
        <p className="text-xs font-bold tracking-wider text-text-muted uppercase">
          Último análisis registrado
        </p>
        <h3 className="mt-2 text-lg font-semibold text-text-strong">
          {visualTitle(run)}
        </h3>
        <p className="mt-1 text-sm leading-6 text-text-muted">
          {visualDescription(run)}
        </p>
      </div>

      {run.status === 'failed' && run.errorMessage ? (
        <FeedbackAlert variant="error" title="Ejecución no completada">
          {run.errorMessage}
        </FeedbackAlert>
      ) : null}

      {run.status === 'completed' && semantic?.status === 'partial' ? (
        <FeedbackAlert variant="warning" title="Análisis parcial">
          El análisis finalizó, pero el resultado contiene cobertura limitada
          u observaciones que requieren revisión.
        </FeedbackAlert>
      ) : null}

      {run.status === 'completed' && !semantic ? (
        <FeedbackAlert
          variant="information"
          title="Análisis completado sin resumen disponible"
        >
          La ejecución terminó, pero no hay un resumen semántico disponible
          para mostrar.
        </FeedbackAlert>
      ) : null}

      {semantic ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Áreas detectadas" value={semantic.areasCount} />
            <Metric
              label="Habilidades detectadas"
              value={semantic.skillsCount}
            />
            <Metric
              label="Conceptos detectados"
              value={semantic.conceptsCount}
            />
          </div>

          <div className="rounded-card border border-border-default bg-surface-muted p-5">
            <p className="text-sm font-semibold text-text-strong">
              Confianza del análisis
            </p>
            <p className="mt-1 text-2xl font-bold text-brand-900">
              {semantic.confidenceLabel}
            </p>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-text-muted">
              La confianza describe la fiabilidad del análisis sobre la
              evidencia. No representa el nivel de dominio del titular.
            </p>
          </div>

          {semantic.qualityFlagLabels.length > 0 ? (
            <div>
              <p className="text-sm font-semibold text-text-strong">
                Observaciones de calidad
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {semantic.qualityFlagLabels.map((label, index) => (
                  <Badge
                    key={`${semantic.qualityFlags[index]}-${index}`}
                    variant="outline"
                    className="border-status-warning/30 bg-status-warning-soft text-status-warning"
                  >
                    {label}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          <p className="text-sm text-text-muted">
            Analizado: {semantic.analyzedAtLabel}
          </p>
        </>
      ) : null}

      <div className="grid gap-2 border-t border-border-default pt-5 text-sm text-text-muted sm:grid-cols-3">
        <p>Solicitado: {run.createdAtLabel}</p>
        <p>Iniciado: {run.startedAtLabel ?? 'No informado'}</p>
        <p>
          {run.failedAtLabel
            ? `Finalizado con error: ${run.failedAtLabel}`
            : `Completado: ${run.completedAtLabel ?? 'No informado'}`}
        </p>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card border border-border-default bg-surface p-5 shadow-xs">
      <p className="text-sm font-semibold text-text-muted">{label}</p>
      <p className="mt-2 text-3xl font-bold text-brand-900">{value}</p>
    </div>
  );
}

function EligibilityNotice({
  credentialStatus,
  currentDocument,
  runActive
}: {
  credentialStatus: CredentialStatus;
  currentDocument: DocumentEvidenceVM | null;
  runActive: boolean;
}) {
  if (credentialStatus !== 'draft') {
    return (
      <FeedbackAlert variant="information" title="Análisis en modo lectura">
        El análisis puede consultarse, pero solo se inicia nuevamente mientras
        la credencial está en borrador.
      </FeedbackAlert>
    );
  }

  if (runActive) {
    return (
      <FeedbackAlert variant="information" title="Ejecución en curso">
        Consultá el estado antes de iniciar una nueva ejecución.
      </FeedbackAlert>
    );
  }

  if (!currentDocument) {
    return (
      <FeedbackAlert variant="information" title="Falta evidencia PDF">
        Primero adjuntá una evidencia documental en formato PDF para iniciar el
        análisis.
      </FeedbackAlert>
    );
  }

  if (
    currentDocument.kind !== 'pdf' ||
    currentDocument.mimeType !== 'application/pdf'
  ) {
    return (
      <FeedbackAlert variant="warning" title="Formato no disponible">
        En esta etapa, el análisis inteligente admite únicamente evidencia
        documental en formato PDF.
      </FeedbackAlert>
    );
  }

  return null;
}

function RunBadge({ run }: { run: IssuerAnalysisRunVM }) {
  const partial =
    run.status === 'completed' && run.semanticAnalysis?.status === 'partial';
  const className = partial
    ? 'border-status-warning/30 bg-status-warning-soft text-status-warning'
    : run.status === 'failed'
      ? 'border-status-error/25 bg-status-error-soft text-status-error'
      : run.status === 'completed'
        ? 'border-status-analysis/25 bg-status-analysis-soft text-status-analysis'
        : 'border-border-strong bg-surface-muted text-text-default';

  return (
    <Badge variant="outline" className={className}>
      {run.status === 'running' || run.status === 'pending' ? (
        <CircleDashed aria-hidden="true" />
      ) : (
        <BrainCircuit aria-hidden="true" />
      )}
      {partial ? 'Análisis parcial' : run.statusLabel}
    </Badge>
  );
}

function AnalysisLoading({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 text-sm font-semibold text-teal-700">
      <RefreshCw aria-hidden="true" className="size-4 animate-spin" />
      {label}…
    </p>
  );
}

function getTriggerLabel(run: IssuerAnalysisRunVM | null) {
  if (!run) return 'Analizar documento';
  if (run.status === 'failed') return 'Reintentar análisis';
  if (run.status === 'canceled') return 'Iniciar nuevo análisis';
  return 'Volver a analizar';
}

function visualTitle(run: IssuerAnalysisRunVM) {
  if (run.status !== 'completed') return run.statusLabel;
  if (!run.semanticAnalysis) return 'Análisis completado sin resumen disponible';
  return run.semanticAnalysis.status === 'partial'
    ? 'Análisis parcial'
    : 'Análisis completado';
}

function visualDescription(run: IssuerAnalysisRunVM) {
  if (run.status === 'pending') {
    return 'La ejecución fue registrada y todavía no comenzó.';
  }
  if (run.status === 'running') {
    return 'Traza está procesando la evidencia documental.';
  }
  if (run.status === 'failed') {
    return 'La ejecución terminó sin producir un resultado disponible.';
  }
  if (run.status === 'canceled') {
    return 'La ejecución fue cancelada antes de finalizar.';
  }
  if (run.semanticAnalysis?.status === 'partial') {
    return 'El resultado contiene observaciones o cobertura limitada.';
  }
  return 'La ejecución terminó y el resumen asistido está disponible.';
}

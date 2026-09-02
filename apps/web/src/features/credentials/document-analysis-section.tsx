import {
  BrainCircuit,
  CircleDashed,
  RefreshCw
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
  CredentialType,
  DocumentEvidenceVM
} from '@/models/credentials';

interface DocumentAnalysisSectionProps {
  credentialStatus: CredentialStatus;
  credentialType?: CredentialType;
  currentDocument: DocumentEvidenceVM | null;
  state: DocumentAnalysisState;
  onRetry?(): Promise<void>;
}

export function DocumentAnalysisSection({
  credentialStatus,
  credentialType = 'academic_subject',
  currentDocument,
  state,
  onRetry
}: DocumentAnalysisSectionProps) {
  const hasPdf =
    currentDocument?.kind === 'pdf' &&
    currentDocument.mimeType === 'application/pdf';
  const usesDeclaredData =
    credentialType === 'course' || credentialType === 'certification';

  return (
    <section
      aria-labelledby="document-analysis-title"
      aria-busy={state.refreshing}
      className="grid gap-6"
    >
      <Card className="overflow-hidden border-border-strong shadow-none">
        <div aria-hidden="true" className="h-1 bg-status-analysis" />
        <CardHeader className="gap-5 border-b border-border-default sm:flex-row sm:items-start sm:justify-between sm:p-8 sm:pb-6">
          <div className="max-w-5xl">
            <p className="flex items-center gap-2 text-sm font-semibold text-teal-700">
              <BrainCircuit aria-hidden="true" className="size-4" />
              Análisis formativo asistido
            </p>
            <h2
              id="document-analysis-title"
              className="mt-2 text-2xl font-bold tracking-tight text-text-strong"
            >
              {usesDeclaredData
                ? 'Análisis inteligente de la credencial'
                : 'Análisis inteligente del documento'}
            </h2>
            <p className="mt-2 leading-7 text-text-muted">
              {usesDeclaredData
                ? 'Scope puede interpretar la información declarada de la credencial para resumir áreas, habilidades y conceptos detectados.'
                : 'Scope puede interpretar la evidencia documental para resumir áreas, habilidades y conceptos detectados.'}
            </p>
            <p className="mt-2 text-sm leading-6 text-text-muted">
              El resultado es asistido por IA y puede requerir revisión.
            </p>
          </div>

          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
            {state.currentRun ? <RunBadge run={state.currentRun} /> : null}
          </div>
        </CardHeader>

        <CardContent className="grid gap-6 pt-6 sm:p-8 sm:pt-7">
          <div aria-live="polite">
            {state.latestStatus === 'loading' ? (
              <AnalysisLoading label="Consultando último análisis" />
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
              title={
                credentialStatus === 'issued'
                  ? 'No pudimos consultar el estado del análisis'
                  : 'No pudimos consultar el análisis'
              }
            >
              {credentialStatus === 'issued'
                ? 'No pudimos consultar el estado del análisis. La credencial emitida sigue disponible.'
                : state.latestError}
            </FeedbackAlert>
          ) : null}

          {state.currentRun ? (
            <AnalysisRunSummary
              run={state.currentRun}
              credentialStatus={credentialStatus}
              onRetry={onRetry}
              retrying={state.triggering}
              retryError={state.actionError}
            />
          ) : state.latestStatus === 'ready' ? (
            <div className="rounded-card border border-dashed border-border-strong bg-surface-muted p-5">
              <p className="font-semibold text-text-strong">
                Interpretación asistida pendiente
              </p>
              <p className="mt-1 text-sm leading-6 text-text-muted">
                {credentialStatus === 'draft'
                  ? hasPdf
                    ? 'Scope generará el análisis automáticamente al emitir la credencial.'
                    : usesDeclaredData
                      ? 'El análisis asistido puede utilizar la información declarada de la credencial al emitir.'
                      : 'Adjuntá una evidencia PDF para habilitar el análisis automático al emitir.'
                  : 'Todavía no hay una interpretación asistida disponible para revisar.'}
              </p>
            </div>
          ) : null}

          <EligibilityNotice
            credentialStatus={credentialStatus}
            credentialType={credentialType}
            currentDocument={currentDocument}
          />
        </CardContent>
      </Card>
    </section>
  );
}

function AnalysisRunSummary({
  run,
  credentialStatus,
  onRetry,
  retrying = false,
  retryError = null
}: {
  run: IssuerAnalysisRunVM;
  credentialStatus: CredentialStatus;
  onRetry?(): Promise<void>;
  retrying?: boolean;
  retryError?: string | null;
}) {
  const semantic = run.semanticAnalysis;
  const canRetry =
    credentialStatus === 'draft' && run.trigger !== 'system' && Boolean(onRetry);

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

      {run.status === 'failed' ? (
        run.trigger === 'system' ? (
          <FeedbackAlert
            variant="warning"
            title="El análisis automático no pudo completarse"
          >
            La credencial sigue emitida y puede consultarse nuevamente más
            adelante.
          </FeedbackAlert>
        ) : (
          <div className="grid gap-3">
            <FeedbackAlert
              variant="error"
              title="No se pudo generar la interpretación asistida"
            >
              {canRetry
                ? (run.errorMessage ??
                  'Revisá los datos cargados e intentá nuevamente.')
                : 'Revisá los datos cargados o intentá emitir una nueva versión cuando corresponda.'}
            </FeedbackAlert>
            {retryError ? (
              <FeedbackAlert variant="error" title="No pudimos reintentar el análisis">
                {retryError}
              </FeedbackAlert>
            ) : null}
            {canRetry ? (
              <Button
                type="button"
                variant="secondary"
                className="w-fit"
                disabled={retrying}
                onClick={() => void onRetry?.()}
              >
                <RefreshCw
                  aria-hidden="true"
                  className={retrying ? 'animate-spin' : undefined}
                />
                {retrying ? 'Reintentando análisis' : 'Reintentar análisis'}
              </Button>
            ) : null}
          </div>
        )
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
  credentialType,
  currentDocument
}: {
  credentialStatus: CredentialStatus;
  credentialType?: CredentialType;
  currentDocument: DocumentEvidenceVM | null;
}) {
  const usesDeclaredData =
    credentialType === 'course' || credentialType === 'certification';
  if (credentialStatus !== 'draft') {
    return (
      <FeedbackAlert variant="information" title="Análisis en modo lectura">
        {usesDeclaredData
          ? 'El análisis puede consultarse en modo lectura. Scope puede intentar generarlo a partir de la información declarada disponible sin afectar la emisión.'
          : 'El análisis puede consultarse en modo lectura. Si había un PDF vigente al emitir, Scope intentó generar una ejecución automática sin afectar la emisión.'}
      </FeedbackAlert>
    );
  }

  if (usesDeclaredData && !currentDocument) {
    return null;
  }

  if (!currentDocument) {
    return (
      <FeedbackAlert
        variant="information"
        title="Sin PDF para análisis automático"
      >
        Sin un PDF vigente, la credencial puede emitirse, pero no se generará
        análisis documental automático.
      </FeedbackAlert>
    );
  }

  if (
    currentDocument.kind !== 'pdf' ||
    currentDocument.mimeType !== 'application/pdf'
  ) {
    if (usesDeclaredData) {
      return null;
    }
    return (
      <FeedbackAlert variant="warning" title="Formato no disponible">
        La evidencia documental está disponible como respaldo. El análisis
        automático actual requiere un PDF vigente.
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
    return run.inputMode === 'text'
      ? 'Scope está procesando la información declarada de la credencial.'
      : 'Scope está procesando la evidencia documental.';
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

'use client';

import { ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { mapCredentialError } from '@/lib/errors/credential-error-mapper';
import type {
  CourseTemplateSummaryVM,
  CredentialFeedback,
  SemanticApprovalSnapshotSummaryVM,
  TemplateSemanticApprovalCandidateVM
} from '@/models/credentials';

const dateFormatter = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'long',
  timeStyle: 'short'
});

interface SemanticApprovalSectionProps {
  template: CourseTemplateSummaryVM;
  onLoadCandidate(
    templateReference: string,
    semanticAnalysisReference: string
  ): Promise<TemplateSemanticApprovalCandidateVM>;
  onApprove(
    templateReference: string,
    semanticAnalysisReference: string
  ): Promise<CourseTemplateSummaryVM>;
}

type CandidateState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; candidate: TemplateSemanticApprovalCandidateVM }
  | { kind: 'unavailable'; feedback: CredentialFeedback };

type ApproveState =
  | { kind: 'idle' }
  | { kind: 'approving' }
  | { kind: 'success' }
  | { kind: 'error'; feedback: CredentialFeedback };

// C4a.2: revision/aprobacion de una interpretacion semantica ya generada
// como reutilizable del template. Nunca significa que la IA certifico el
// contenido, nunca modifica la credencial original, nunca crea una
// credencial nueva. Aprobar SIEMPRE requiere haber cargado primero el
// resumen candidato -- el boton solo existe cuando candidateState.kind es
// 'loaded'.
export function SemanticApprovalSection({
  template,
  onLoadCandidate,
  onApprove
}: SemanticApprovalSectionProps) {
  const [candidateState, setCandidateState] = useState<CandidateState>({
    kind: 'idle'
  });
  const [approveState, setApproveState] = useState<ApproveState>({
    kind: 'idle'
  });
  const requestInFlight = useRef(false);

  const alreadyApproved = template.approvedSemanticAnalysisId !== null;
  const semanticAnalysisReference = template.lastSemanticAnalysisId;
  const candidateRequestKey =
    !alreadyApproved && semanticAnalysisReference
      ? `${template.reference}:${semanticAnalysisReference}`
      : null;
  const [requestedCandidateKey, setRequestedCandidateKey] = useState<
    string | null
  >(null);

  // Ajuste de estado durante el render (patron recomendado por React) en
  // vez de llamar setState sincronicamente dentro del efecto de abajo --
  // evita el render en cascada que dispara esa regla de lint. Se dispara
  // cuando cambia el template/analisis candidato a revisar.
  if (candidateRequestKey !== requestedCandidateKey) {
    setRequestedCandidateKey(candidateRequestKey);
    if (candidateRequestKey) {
      setCandidateState({ kind: 'loading' });
    }
  }

  useEffect(() => {
    if (alreadyApproved || !semanticAnalysisReference) {
      return;
    }

    let active = true;

    onLoadCandidate(template.reference, semanticAnalysisReference)
      .then((candidate) => {
        if (active) {
          setCandidateState({ kind: 'loaded', candidate });
        }
      })
      .catch((error) => {
        if (active) {
          setCandidateState({
            kind: 'unavailable',
            feedback: mapCredentialError(error, 'semantic-approval-candidate')
          });
        }
      });

    return () => {
      active = false;
    };
  }, [alreadyApproved, onLoadCandidate, semanticAnalysisReference, template.reference]);

  async function handleApprove() {
    if (!semanticAnalysisReference || requestInFlight.current) {
      return;
    }

    requestInFlight.current = true;
    setApproveState({ kind: 'approving' });

    try {
      await onApprove(template.reference, semanticAnalysisReference);
      setApproveState({ kind: 'success' });
    } catch (error) {
      setApproveState({
        kind: 'error',
        feedback: mapCredentialError(
          error,
          'approve-reusable-template-analysis'
        )
      });
    } finally {
      requestInFlight.current = false;
    }
  }

  if (approveState.kind === 'success') {
    return (
      <ApprovedSemanticInterpretationCard
        template={template}
        title="Interpretación aprobada para reutilización."
      />
    );
  }

  if (alreadyApproved) {
    return (
      <ApprovedSemanticInterpretationCard
        template={template}
        title="Interpretación ya aprobada para reutilización."
      />
    );
  }

  if (!semanticAnalysisReference) {
    return (
      <Card
        className="border-border-strong shadow-none"
        data-testid="semantic-approval-section"
      >
        <SemanticApprovalHeader />
        <CardContent className="grid gap-4 pt-5">
          <p className="text-sm leading-6 text-text-muted">
            Contenido reutilizable guardado.
          </p>
          <FeedbackAlert variant="information">
            Este contenido reutilizable todavía no tiene una interpretación
            semántica asociada para aprobar.
          </FeedbackAlert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className="border-border-strong shadow-none"
      data-testid="semantic-approval-section"
    >
      <SemanticApprovalHeader />
      <CardContent className="grid gap-4 pt-5">
        <div aria-live="polite">
          {candidateState.kind === 'loading' ? (
            <p className="text-sm text-text-muted">
              Cargando resumen de interpretación...
            </p>
          ) : null}

          {candidateState.kind === 'unavailable' ? (
            <FeedbackAlert
              variant="warning"
              title="No pudimos cargar el resumen de la interpretación semántica"
            >
              {candidateState.feedback.message}
            </FeedbackAlert>
          ) : null}
        </div>

        {candidateState.kind === 'loaded' ? (
          <SemanticApprovalCandidateReview
            candidate={candidateState.candidate}
            approveState={approveState}
            onApprove={() => void handleApprove()}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function SemanticApprovalHeader() {
  return (
    <CardHeader className="flex-row items-center gap-3 border-b border-border-default">
      <ShieldCheck aria-hidden="true" className="size-5 text-teal-700" />
      <div>
        <h2 className="text-lg font-semibold text-text-strong">
          Interpretación semántica revisable
        </h2>
        <p className="mt-1 text-sm text-text-muted">
          Revisión y aprobación de la interpretación semántica reutilizable
          del catálogo de este emisor.
        </p>
      </div>
    </CardHeader>
  );
}

function SemanticApprovalCandidateReview({
  candidate,
  approveState,
  onApprove
}: {
  candidate: TemplateSemanticApprovalCandidateVM;
  approveState: ApproveState;
  onApprove(): void;
}) {
  return (
    <div className="grid gap-4">
      <SnapshotSummaryList summary={candidate.summary} />

      {candidate.pipelineVersion || candidate.taxonomyVersion ? (
        <ul className="grid gap-1 text-sm leading-6 text-text-muted">
          {candidate.pipelineVersion ? (
            <li>Pipeline: {candidate.pipelineVersion}</li>
          ) : null}
          {candidate.taxonomyVersion ? (
            <li>Taxonomía: {candidate.taxonomyVersion}</li>
          ) : null}
        </ul>
      ) : null}

      <ul className="grid gap-1 text-sm leading-6 text-text-muted">
        <li>
          La interpretación aprobada quedará asociada al contenido
          reutilizable de este emisor.
        </li>
        <li>No modifica la credencial original.</li>
        <li>No crea una nueva credencial.</li>
        <li>No implica que la IA certifique el contenido.</li>
        <li>Se guarda un resumen semántico saneado, sin evidencias crudas.</li>
      </ul>

      <p className="text-sm font-medium text-text-strong">
        Revisá este resumen antes de aprobarlo para reutilización.
      </p>

      {approveState.kind === 'error' ? (
        <FeedbackAlert
          variant="error"
          title="No pudimos aprobar la interpretación semántica"
        >
          {approveState.feedback.message}
        </FeedbackAlert>
      ) : null}

      <Button
        type="button"
        variant="secondary"
        className="w-fit"
        disabled={approveState.kind === 'approving'}
        onClick={onApprove}
      >
        {approveState.kind === 'approving'
          ? 'Aprobando…'
          : 'Aprobar interpretación para reutilización'}
      </Button>
    </div>
  );
}

function ApprovedSemanticInterpretationCard({
  template,
  title
}: {
  template: CourseTemplateSummaryVM;
  title: string;
}) {
  return (
    <Card
      className="border-border-strong shadow-none"
      data-testid="semantic-approval-section"
    >
      <SemanticApprovalHeader />
      <CardContent className="grid gap-4 pt-5">
        <FeedbackAlert variant="success" title={title}>
          No implica que la IA certifique el contenido. No modifica la
          credencial original. No crea una nueva credencial.
        </FeedbackAlert>

        <ApprovedSemanticMetadata template={template} />

        <Button type="button" variant="secondary" className="w-fit" disabled>
          Aprobar interpretación para reutilización
        </Button>
        <p className="text-sm leading-6 text-text-muted">
          Re-aprobar o revocar esta interpretación todavía no está disponible
          en este flujo.
        </p>
      </CardContent>
    </Card>
  );
}

function ApprovedSemanticMetadata({
  template
}: {
  template: CourseTemplateSummaryVM;
}) {
  return (
    <dl className="grid gap-2 text-sm leading-6 text-text-muted">
      {template.approvedSemanticApprovedAt ? (
        <div className="flex flex-wrap gap-2">
          <dt className="font-semibold text-text-strong">Aprobada el:</dt>
          <dd>
            {dateFormatter.format(new Date(template.approvedSemanticApprovedAt))}
          </dd>
        </div>
      ) : null}
      {template.approvedSemanticPipelineVersion ? (
        <div className="flex flex-wrap gap-2">
          <dt className="font-semibold text-text-strong">Pipeline:</dt>
          <dd>{template.approvedSemanticPipelineVersion}</dd>
        </div>
      ) : null}
      {template.approvedSemanticTaxonomyVersion ? (
        <div className="flex flex-wrap gap-2">
          <dt className="font-semibold text-text-strong">Taxonomía:</dt>
          <dd>{template.approvedSemanticTaxonomyVersion}</dd>
        </div>
      ) : null}
      {template.approvedSemanticSourceCredentialId ? (
        <div className="flex flex-wrap gap-2">
          <dt className="font-semibold text-text-strong">
            Credencial de origen:
          </dt>
          <dd>{template.approvedSemanticSourceCredentialId}</dd>
        </div>
      ) : null}
      {template.approvedSemanticSnapshotSummary ? (
        <SnapshotSummaryList
          summary={template.approvedSemanticSnapshotSummary}
        />
      ) : null}
    </dl>
  );
}

function SnapshotSummaryList({
  summary
}: {
  summary: SemanticApprovalSnapshotSummaryVM;
}) {
  return (
    <ul className="grid gap-1 text-sm leading-6 text-text-muted">
      <li>
        Estado del análisis:{' '}
        {summary.status === 'completed' ? 'Completo' : 'Parcial'}
      </li>
      <li>Áreas detectadas: {summary.areaCount}</li>
      <li>Habilidades detectadas: {summary.skillCount}</li>
      <li>Conceptos detectados: {summary.conceptCount}</li>
      <li>
        Distribución horaria:{' '}
        {summary.hasHoursDistribution ? 'Disponible' : 'No disponible'}
      </li>
      <li>Advertencias: {summary.warningCount}</li>
      <li>Quality flags: {summary.qualityFlagCount}</li>
    </ul>
  );
}

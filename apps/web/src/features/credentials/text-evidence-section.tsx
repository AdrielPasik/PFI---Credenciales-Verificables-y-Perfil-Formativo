'use client';

import {
  ChevronDown,
  ChevronUp,
  RefreshCw,
  RotateCcw,
  Save,
  TextQuote
} from 'lucide-react';
import {
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent
} from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  buildTextEvidencePreview,
  TEXT_EVIDENCE_CONTENT_MAX_CODE_POINTS,
  validateTextEvidenceDraft
} from '@/features/credentials/text-evidence';
import { mapCredentialError } from '@/lib/errors/credential-error-mapper';
import type {
  CredentialFeedback,
  CredentialStatus,
  TextEvidenceVM
} from '@/models/credentials';

interface TextEvidenceSectionProps {
  credentialStatus: CredentialStatus;
  currentText: TextEvidenceVM | null;
  onSubmit(command: {
    label: string | null;
    content: string;
  }): Promise<TextEvidenceVM>;
}

type SubmitFeedback =
  | { kind: 'success'; message: string }
  | { kind: 'error'; feedback: CredentialFeedback }
  | null;

const counterFormatter = new Intl.NumberFormat('es-AR');

export function TextEvidenceSection({
  credentialStatus,
  currentText,
  onSubmit
}: TextEvidenceSectionProps) {
  const [rawLabel, setRawLabel] = useState('');
  const [rawContent, setRawContent] = useState('');
  const [replacementMode, setReplacementMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<SubmitFeedback>(null);
  const submitInFlight = useRef(false);
  const isDraft = credentialStatus === 'draft';
  const formVisible = isDraft && (currentText === null || replacementMode);
  const validation = validateTextEvidenceDraft(rawContent, rawLabel);
  const showContentError =
    rawContent.length > 0 && validation.contentError !== null;
  const showLabelError =
    rawLabel.length > 0 && validation.labelError !== null;

  function updateLabel(event: ChangeEvent<HTMLInputElement>) {
    setRawLabel(event.target.value);
    setFeedback(null);
  }

  function updateContent(event: ChangeEvent<HTMLTextAreaElement>) {
    setRawContent(event.target.value);
    setFeedback(null);
  }

  function resetForm() {
    setRawLabel('');
    setRawContent('');
  }

  function startReplacement() {
    resetForm();
    setFeedback(null);
    setReplacementMode(true);
  }

  function cancelReplacement() {
    resetForm();
    setFeedback(null);
    setReplacementMode(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitInFlight.current || !validation.valid) {
      return;
    }

    submitInFlight.current = true;
    setSubmitting(true);
    setFeedback(null);

    try {
      await onSubmit(validation.normalizedSubmission);
      resetForm();
      setReplacementMode(false);
      setFeedback({
        kind: 'success',
        message: currentText
          ? 'La evidencia textual se reemplazó correctamente.'
          : 'La evidencia textual se guardó correctamente.'
      });
    } catch (caught) {
      setFeedback({
        kind: 'error',
        feedback: mapCredentialError(caught, 'text-evidence-submit')
      });
    } finally {
      submitInFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="text-evidence-title" className="grid gap-6">
      <div className="max-w-3xl">
        <p className="text-sm font-semibold text-teal-700">
          Fuente institucional
        </p>
        <h2
          id="text-evidence-title"
          className="mt-2 text-2xl font-bold tracking-tight text-text-strong"
        >
          Evidencia textual
        </h2>
        <p className="mt-2 leading-7 text-text-muted">
          La evidencia textual se conserva como fuente institucional. No
          modifica automáticamente los campos oficiales de la credencial.
        </p>
        <p className="mt-2 text-sm leading-6 text-text-muted">
          Más adelante podrá utilizarse para generar propuestas mediante IA,
          pero el emisor deberá revisarlas y confirmarlas.
        </p>
      </div>

      {feedback?.kind === 'success' ? (
        <FeedbackAlert variant="success" title="Evidencia textual actualizada">
          {feedback.message}
        </FeedbackAlert>
      ) : null}

      {feedback?.kind === 'error' ? (
        <FeedbackAlert
          variant="error"
          title="No pudimos guardar la evidencia textual"
        >
          {feedback.feedback.message}
        </FeedbackAlert>
      ) : null}

      {currentText ? (
        <CurrentTextEvidenceCard evidence={currentText} />
      ) : !isDraft ? (
        <Card className="border-border-strong bg-surface-muted shadow-none">
          <CardContent className="py-6">
            <p className="font-semibold text-text-strong">
              No hay evidencia textual registrada.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {isDraft && currentText && !replacementMode ? (
        <div>
          <Button type="button" variant="secondary" onClick={startReplacement}>
            <RotateCcw aria-hidden="true" />
            Reemplazar evidencia textual
          </Button>
        </div>
      ) : null}

      {formVisible ? (
        <Card className="border-border-strong bg-surface-muted shadow-none">
          <CardHeader>
            <p className="text-sm font-semibold text-brand-700">
              {currentText ? 'Reemplazo pendiente' : 'Nueva fuente'}
            </p>
            <h3 className="text-lg font-semibold text-text-strong">
              {currentText
                ? 'Preparar nueva evidencia textual'
                : 'Registrar evidencia textual'}
            </h3>
            <p className="text-sm leading-6 text-text-muted">
              {currentText
                ? 'Este texto pasará a ser la fuente vigente. La versión anterior se conservará en el historial institucional.'
                : 'Registrá una descripción oficial, un temario o contenido institucional que respalde esta credencial.'}
            </p>
          </CardHeader>
          <CardContent>
            <form noValidate className="grid gap-5" onSubmit={submit}>
              <TextEvidenceFields
                rawContent={rawContent}
                rawLabel={rawLabel}
                submitting={submitting}
                characterCount={validation.characterCount}
                contentError={showContentError ? validation.contentError : null}
                labelError={showLabelError ? validation.labelError : null}
                onContentChange={updateContent}
                onLabelChange={updateLabel}
              />

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p aria-live="polite" className="text-sm text-text-muted">
                  {submitting
                    ? 'Guardando evidencia textual…'
                    : 'El texto se normalizará únicamente al enviarlo.'}
                </p>
                <div className="flex flex-wrap gap-3">
                  {currentText ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={submitting}
                      onClick={cancelReplacement}
                    >
                      Cancelar reemplazo
                    </Button>
                  ) : null}
                  <Button
                    type="submit"
                    disabled={submitting || !validation.valid}
                  >
                    {submitting ? (
                      <RefreshCw aria-hidden="true" className="animate-spin" />
                    ) : currentText ? (
                      <RotateCcw aria-hidden="true" />
                    ) : (
                      <Save aria-hidden="true" />
                    )}
                    {submitting
                      ? 'Guardando evidencia'
                      : currentText
                        ? 'Confirmar reemplazo'
                        : 'Guardar evidencia textual'}
                  </Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {!isDraft ? (
        <FeedbackAlert
          variant="information"
          title="Evidencia textual en modo lectura"
        >
          La evidencia textual solo puede modificarse mientras la credencial
          está en borrador.
        </FeedbackAlert>
      ) : null}
    </section>
  );
}

function TextEvidenceFields({
  characterCount,
  contentError,
  labelError,
  onContentChange,
  onLabelChange,
  rawContent,
  rawLabel,
  submitting
}: {
  characterCount: number;
  contentError: string | null;
  labelError: string | null;
  onContentChange(event: ChangeEvent<HTMLTextAreaElement>): void;
  onLabelChange(event: ChangeEvent<HTMLInputElement>): void;
  rawContent: string;
  rawLabel: string;
  submitting: boolean;
}) {
  const labelHelpId = 'text-evidence-label-help';
  const labelErrorId = labelError ? 'text-evidence-label-error' : undefined;
  const contentHelpId = 'text-evidence-content-help';
  const contentCountId = 'text-evidence-content-count';
  const contentErrorId = contentError
    ? 'text-evidence-content-error'
    : undefined;

  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="text-evidence-label">
          Nombre de la fuente (opcional)
        </Label>
        <Input
          id="text-evidence-label"
          value={rawLabel}
          disabled={submitting}
          placeholder="Ej.: Temario institucional"
          aria-invalid={labelError ? true : undefined}
          aria-describedby={[labelHelpId, labelErrorId]
            .filter(Boolean)
            .join(' ')}
          onChange={onLabelChange}
        />
        <p id={labelHelpId} className="text-sm text-text-muted">
          Hasta 120 caracteres y en una sola línea.
        </p>
        {labelError ? (
          <p
            id={labelErrorId}
            role="alert"
            className="text-sm font-medium text-status-error"
          >
            {labelError}
          </p>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="text-evidence-content">Contenido de respaldo</Label>
        <Textarea
          id="text-evidence-content"
          value={rawContent}
          disabled={submitting}
          rows={10}
          placeholder="Pegá una descripción oficial, temario, programa o contenido institucional que sirva como fuente para esta credencial."
          aria-invalid={contentError ? true : undefined}
          aria-describedby={[contentHelpId, contentCountId, contentErrorId]
            .filter(Boolean)
            .join(' ')}
          onChange={onContentChange}
        />
        <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
          <p id={contentHelpId} className="text-text-muted">
            Se preservan los saltos y espacios internos.
          </p>
          <p
            id={contentCountId}
            className={
              characterCount > TEXT_EVIDENCE_CONTENT_MAX_CODE_POINTS
                ? 'font-semibold text-status-error'
                : 'text-text-muted'
            }
          >
            {counterFormatter.format(characterCount)} /{' '}
            {counterFormatter.format(
              TEXT_EVIDENCE_CONTENT_MAX_CODE_POINTS
            )}{' '}
            caracteres
          </p>
        </div>
        {contentError ? (
          <p
            id={contentErrorId}
            role="alert"
            className="text-sm font-medium text-status-error"
          >
            {contentError}
          </p>
        ) : null}
      </div>
    </>
  );
}

function CurrentTextEvidenceCard({
  evidence
}: {
  evidence: TextEvidenceVM;
}) {
  const [expanded, setExpanded] = useState(false);
  const preview = buildTextEvidencePreview(evidence.content);
  const visibleContent = expanded ? evidence.content : preview.text;

  return (
    <Card className="min-w-0 overflow-hidden border-border-strong shadow-none">
      <div aria-hidden="true" className="h-1 bg-teal-700" />
      <CardHeader className="gap-3 border-b border-border-default sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-teal-700">
            Fuente textual actual
          </p>
          <h3 className="mt-1 break-words text-lg font-semibold text-text-strong">
            {evidence.label ?? 'Fuente institucional sin nombre'}
          </h3>
        </div>
        <Badge variant="secondary">
          <TextQuote aria-hidden="true" />
          Texto vigente
        </Badge>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-6 pt-5 sm:pt-6">
        <div className="min-w-0 rounded-control border border-border-default bg-surface-muted p-4 sm:p-5">
          <p className="text-xs font-bold tracking-wider text-text-muted uppercase">
            Contenido de respaldo
          </p>
          <p
            aria-label="Contenido de la fuente textual"
            className="mt-3 min-w-0 whitespace-pre-wrap break-words leading-7 text-text-strong"
          >
            {visibleContent}
            {!expanded && preview.collapsed ? '…' : null}
          </p>
          {preview.collapsed ? (
            <Button
              type="button"
              variant="ghost"
              className="mt-3"
              aria-expanded={expanded}
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? (
                <ChevronUp aria-hidden="true" />
              ) : (
                <ChevronDown aria-hidden="true" />
              )}
              {expanded ? 'Ocultar texto' : 'Ver texto completo'}
            </Button>
          ) : null}
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          <TextEvidenceMetadata
            label="Extensión"
            value={evidence.characterCountLabel}
          />
          <TextEvidenceMetadata
            label="Fecha de registro"
            value={evidence.submittedAtLabel}
          />
          <div className="min-w-0">
            <p className="text-xs font-bold tracking-wider text-text-muted uppercase">
              SHA-256
            </p>
            <code
              title={evidence.sha256}
              className="mt-1 block break-all text-sm font-semibold text-text-strong"
            >
              {evidence.sha256Short}
            </code>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TextEvidenceMetadata({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-bold tracking-wider text-text-muted uppercase">
        {label}
      </p>
      <p className="mt-1 break-words font-semibold text-text-strong">
        {value}
      </p>
    </div>
  );
}

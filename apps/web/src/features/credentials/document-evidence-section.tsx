'use client';

import {
  FileImage,
  FileText,
  RefreshCw,
  RotateCcw,
  Upload
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
import {
  DOCUMENT_EVIDENCE_ACCEPT,
  validateDocumentEvidenceFile
} from '@/features/credentials/document-evidence-file';
import { mapCredentialError } from '@/lib/errors/credential-error-mapper';
import { formatDocumentSize } from '@/lib/formatters/document-evidence';
import type {
  CredentialFeedback,
  CredentialStatus,
  CredentialType,
  DocumentEvidenceVM
} from '@/models/credentials';

interface DocumentEvidenceSectionProps {
  credentialStatus: CredentialStatus;
  credentialType?: CredentialType;
  currentDocument: DocumentEvidenceVM | null;
  onUpload(file: File): Promise<DocumentEvidenceVM>;
}

type UploadFeedback =
  | { kind: 'success'; message: string }
  | { kind: 'error'; feedback: CredentialFeedback }
  | null;

export function DocumentEvidenceSection({
  credentialStatus,
  credentialType = 'academic_subject',
  currentDocument,
  onUpload
}: DocumentEvidenceSectionProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(
    null
  );
  const [replacementMode, setReplacementMode] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState<UploadFeedback>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadInFlight = useRef(false);
  const isDraft = credentialStatus === 'draft';
  const supportsDeclaredTextAnalysis =
    credentialType === 'course' || credentialType === 'certification';
  const uploadVisible =
    isDraft && (currentDocument === null || replacementMode);

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    const validation = validateDocumentEvidenceFile(file);

    setSelectedFile(file);
    setValidationError(validation.error);
    setFeedback(null);
  }

  function clearSelection() {
    setSelectedFile(null);
    setValidationError(null);

    if (inputRef.current) {
      inputRef.current.value = '';
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (uploadInFlight.current) {
      return;
    }

    const validation = validateDocumentEvidenceFile(selectedFile);
    setValidationError(validation.error);

    if (!validation.valid || !selectedFile) {
      return;
    }

    uploadInFlight.current = true;
    setUploading(true);
    setFeedback(null);

    try {
      await onUpload(selectedFile);
      clearSelection();
      setReplacementMode(false);
      setFeedback({
        kind: 'success',
        message: currentDocument
          ? 'La evidencia documental se reemplazó correctamente.'
          : 'La evidencia documental se cargó correctamente.'
      });
    } catch (caught) {
      setFeedback({
        kind: 'error',
        feedback: mapCredentialError(
          caught,
          'document-evidence-upload'
        )
      });
    } finally {
      uploadInFlight.current = false;
      setUploading(false);
    }
  }

  function startReplacement() {
    clearSelection();
    setFeedback(null);
    setReplacementMode(true);
  }

  function cancelReplacement() {
    clearSelection();
    setFeedback(null);
    setReplacementMode(false);
  }

  return (
    <section
      aria-labelledby="document-evidence-title"
      className="grid gap-6"
    >
      <div className="max-w-3xl">
        <h2
          id="document-evidence-title"
          className="mt-2 text-2xl font-bold tracking-tight text-text-strong"
        >
          Evidencia documental
        </h2>
        <p className="mt-2 leading-7 text-text-muted">
          {isDraft
            ? supportsDeclaredTextAnalysis
              ? 'Adjuntá un PDF institucional si esta formación cuenta con documentación de respaldo. Para cursos y certificaciones es opcional cuando ya completaste descripción, competencias o contenido adicional.'
              : 'La evidencia respalda el borrador. Si hay un PDF vigente, Traza intentará analizarlo automáticamente al emitir.'
            : 'Esta evidencia quedó asociada a la credencial emitida.'}
        </p>
      </div>

      {feedback?.kind === 'success' ? (
        <FeedbackAlert variant="success" title="Evidencia actualizada">
          {feedback.message}
        </FeedbackAlert>
      ) : null}

      {feedback?.kind === 'error' ? (
        <FeedbackAlert variant="error" title="No pudimos subir la evidencia">
          {feedback.feedback.message}
        </FeedbackAlert>
      ) : null}

      {currentDocument ? (
        <CurrentDocumentCard document={currentDocument} />
      ) : !isDraft ? (
        <Card className="border-border-strong bg-surface-muted shadow-none">
          <CardContent className="py-6">
            <p className="font-semibold text-text-strong">
              No hay evidencia documental registrada.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {isDraft && currentDocument && !replacementMode ? (
        <div>
          <Button type="button" variant="secondary" onClick={startReplacement}>
            <RotateCcw aria-hidden="true" />
            Reemplazar evidencia
          </Button>
        </div>
      ) : null}

      {uploadVisible ? (
        <DocumentUploadForm
          inputRef={inputRef}
          isReplacement={currentDocument !== null}
          selectedFile={selectedFile}
          uploading={uploading}
          validationError={validationError}
          onCancel={currentDocument ? cancelReplacement : undefined}
          onFileChange={selectFile}
          onSubmit={submit}
        />
      ) : null}

      {!isDraft ? (
        <FeedbackAlert variant="information" title="Evidencia en modo lectura">
          Las modificaciones de evidencia solo están disponibles mientras la
          credencial está en borrador.
        </FeedbackAlert>
      ) : null}
    </section>
  );
}

function CurrentDocumentCard({
  document
}: {
  document: DocumentEvidenceVM;
}) {
  const Icon = document.kind === 'pdf' ? FileText : FileImage;

  return (
    <Card className="overflow-hidden border-border-strong shadow-none">
      <div aria-hidden="true" className="h-1 bg-teal-700" />
      <CardHeader className="gap-3 border-b border-border-default sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-teal-700">
            Evidencia actual
          </p>
          <h3 className="mt-1 break-words text-lg font-semibold text-text-strong">
            {document.originalFileName}
          </h3>
        </div>
        <Badge variant="secondary">
          <Icon aria-hidden="true" />
          {documentFormatLabel(document.mimeType)}
        </Badge>
      </CardHeader>
      <CardContent className="grid gap-5 pt-5 sm:grid-cols-3 sm:pt-6">
        <DocumentMetadata label="Tamaño" value={document.sizeLabel} />
        <DocumentMetadata
          label="Fecha de carga"
          value={document.uploadedAtLabel}
        />
        <div className="min-w-0">
          <p className="text-xs font-bold tracking-wider text-text-muted uppercase">
            SHA-256
          </p>
          <code
            title={document.sha256}
            className="mt-1 block break-all text-sm font-semibold text-text-strong"
          >
            {document.sha256Short}
          </code>
        </div>
      </CardContent>
    </Card>
  );
}

function DocumentMetadata({ label, value }: { label: string; value: string }) {
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

function DocumentUploadForm({
  inputRef,
  isReplacement,
  onCancel,
  onFileChange,
  onSubmit,
  selectedFile,
  uploading,
  validationError
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  isReplacement: boolean;
  onCancel?: () => void;
  onFileChange(event: ChangeEvent<HTMLInputElement>): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  selectedFile: File | null;
  uploading: boolean;
  validationError: string | null;
}) {
  const instructionsId = 'document-evidence-file-instructions';
  const errorId = validationError
    ? 'document-evidence-file-error'
    : undefined;
  const describedBy = [instructionsId, errorId].filter(Boolean).join(' ');

  return (
    <Card className="border-border-strong bg-surface-muted shadow-none">
      <CardHeader>
        <p className="text-sm font-semibold text-brand-700">
          {isReplacement ? 'Selección pendiente' : 'Nuevo respaldo'}
        </p>
        <h3 className="text-lg font-semibold text-text-strong">
          {isReplacement
            ? 'Preparar nueva evidencia'
            : 'Adjuntar evidencia al borrador'}
        </h3>
        <p className="text-sm leading-6 text-text-muted">
          {isReplacement
            ? 'Este documento pasará a ser la evidencia vigente. La evidencia anterior se conservará en el historial institucional.'
            : 'Adjuntá un PDF, PNG o JPEG como respaldo documental del borrador.'}
        </p>
      </CardHeader>
      <CardContent>
        <form noValidate onSubmit={onSubmit} className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="document-evidence-file">
              Seleccionar archivo de evidencia
            </Label>
            <Input
              ref={inputRef}
              id="document-evidence-file"
              type="file"
              accept={DOCUMENT_EVIDENCE_ACCEPT}
              disabled={uploading}
              aria-invalid={validationError ? true : undefined}
              aria-describedby={describedBy}
              className="cursor-pointer file:mr-3 file:rounded-sm file:border-0 file:bg-brand-100 file:px-3 file:py-1 file:text-sm file:font-semibold file:text-brand-900"
              onChange={onFileChange}
            />
            <p
              id={instructionsId}
              className="text-sm leading-6 text-text-muted"
            >
              Formatos: PDF, PNG o JPEG · Tamaño máximo: 20 MB
            </p>
            {validationError ? (
              <p
                id={errorId}
                role="alert"
                className="text-sm font-medium text-status-error"
              >
                {validationError}
              </p>
            ) : null}
          </div>

          {selectedFile ? (
            <div className="rounded-control border border-border-default bg-surface p-4">
              <p className="text-xs font-bold tracking-wider text-text-muted uppercase">
                Archivo preparado
              </p>
              <p className="mt-1 break-words font-semibold text-text-strong">
                {selectedFile.name}
              </p>
              <p className="mt-1 text-sm text-text-muted">
                {formatDocumentSize(selectedFile.size)}
              </p>
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p aria-live="polite" className="text-sm text-text-muted">
              {uploading
                ? 'Subiendo evidencia…'
                : 'El backend verificará el formato real del archivo.'}
            </p>
            <div className="flex flex-wrap gap-3">
              {onCancel ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={uploading}
                  onClick={onCancel}
                >
                  Cancelar reemplazo
                </Button>
              ) : null}
              <Button
                type="submit"
                disabled={
                  uploading || !selectedFile || validationError !== null
                }
              >
                {uploading ? (
                  <RefreshCw aria-hidden="true" className="animate-spin" />
                ) : (
                  <Upload aria-hidden="true" />
                )}
                {uploading
                  ? 'Subiendo evidencia'
                  : isReplacement
                    ? 'Confirmar reemplazo'
                    : 'Subir evidencia'}
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function documentFormatLabel(mimeType: DocumentEvidenceVM['mimeType']) {
  if (mimeType === 'application/pdf') {
    return 'Documento PDF';
  }

  return mimeType === 'image/png' ? 'Imagen PNG' : 'Imagen JPEG';
}

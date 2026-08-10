'use client';

import {
  Building2,
  CalendarDays,
  FilePlus2,
  Landmark,
  Link2,
  Tags,
  UserRound
} from 'lucide-react';
import Link from 'next/link';
import {
  useEffect,
  useState
} from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { SessionLoadingState } from '@/components/feedback/session-loading-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { CredentialDraftEditorForm } from '@/features/credentials/credential-draft-editor-form';
import { CredentialIssuanceSection } from '@/features/credentials/credential-issuance-section';
import { DocumentAnalysisSection } from '@/features/credentials/document-analysis-section';
import { DocumentEvidenceSection } from '@/features/credentials/document-evidence-section';
import { TextEvidenceSection } from '@/features/credentials/text-evidence-section';
import {
  useIssuerDocumentAnalysis,
  type DocumentAnalysisState
} from '@/features/credentials/use-issuer-document-analysis';
import { IssuerRouteBoundary } from '@/features/issuer-context/issuer-route-boundary';
import {
  adaptAcademicProgramSearch,
  adaptCurriculumAcademicSubjectSearch,
  adaptDocumentEvidenceResponse,
  adaptIssuerCredentialDetail,
  adaptTextEvidenceResponse
} from '@/lib/adapters/credentials.adapter';
import {
  getIssuerCredentialRequest,
  issueIssuerCredentialRequest,
  patchIssuerCredentialDraftRequest,
  searchAcademicProgramsRequest,
  searchCurriculumAcademicSubjectsRequest,
  submitCredentialTextEvidenceRequest,
  uploadCredentialDocumentEvidenceRequest
} from '@/lib/api/credentials-api';
import { mapCredentialError } from '@/lib/errors/credential-error-mapper';
import { useSession } from '@/lib/session/session-provider';
import type {
  CredentialFeedback,
  AcademicProgramSearchItemVM,
  CurriculumAcademicSubjectSearchItemVM,
  DocumentEvidenceVM,
  IssuerCredentialDetailVM,
  TextEvidenceVM,
  UpdateIssuerCredentialDraftCommand
} from '@/models/credentials';
import type { IssuerMembershipSummaryVM } from '@/models/issuer-context';

const dateFormatter = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'long',
  timeStyle: 'short'
});

export function CredentialDetailRoute({
  credentialReference
}: {
  credentialReference: string;
}) {
  return (
    <IssuerRouteBoundary>
      {(membership) => (
        <CredentialDetailController
          credentialReference={credentialReference}
          membership={membership}
        />
      )}
    </IssuerRouteBoundary>
  );
}

export function CredentialDetailController({
  credentialReference,
  membership
}: {
  credentialReference: string;
  membership: IssuerMembershipSummaryVM;
}) {
  const { requestAuthenticated } = useSession();
  const documentAnalysis = useIssuerDocumentAnalysis({
    requestAuthenticated,
    issuerReference: membership.issuerReference,
    credentialReference
  });
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] =
    useState<IssuerCredentialDetailVM | null>(null);
  const [error, setError] = useState<CredentialFeedback | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadCredential() {
      setLoading(true);
      setError(null);

      try {
        const payload = await getIssuerCredentialRequest(
          requestAuthenticated,
          membership.issuerReference,
          credentialReference
        );
        const adapted = adaptIssuerCredentialDetail(payload);

        if (active) {
          setDetail(adapted);
        }
      } catch (caught) {
        if (active) {
          setDetail(null);
          setError(mapCredentialError(caught, 'detail'));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadCredential();

    return () => {
      active = false;
    };
  }, [
    credentialReference,
    membership.issuerReference,
    reloadKey,
    requestAuthenticated
  ]);

  if (loading) {
    return <SessionLoadingState label="Cargando borrador" />;
  }

  if (error || !detail) {
    return (
      <div className="mx-auto grid w-full max-w-2xl gap-5">
        <FeedbackAlert
          variant="error"
          title="No pudimos abrir la credencial"
        >
          {error?.message ??
            'No pudimos interpretar la credencial solicitada.'}
        </FeedbackAlert>
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="secondary">
            <Link href="/issuer">Volver al portal</Link>
          </Button>
          {error?.code !== 'forbidden' &&
          error?.code !== 'session_expired' ? (
            <Button
              type="button"
              onClick={() => setReloadKey((current) => current + 1)}
            >
              Intentar nuevamente
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  async function saveDraft(command: UpdateIssuerCredentialDraftCommand) {
    const payload = await patchIssuerCredentialDraftRequest(
      requestAuthenticated,
      command
    );
    const adapted = adaptIssuerCredentialDetail(payload);
    setDetail(adapted);
    return adapted;
  }

  async function reloadLatestDraft() {
    const payload = await getIssuerCredentialRequest(
      requestAuthenticated,
      membership.issuerReference,
      credentialReference
    );
    const adapted = adaptIssuerCredentialDetail(payload);
    setDetail(adapted);
    return adapted;
  }

  async function searchPrograms(
    query: string,
    signal: AbortSignal
  ): Promise<AcademicProgramSearchItemVM[]> {
    const payload = await searchAcademicProgramsRequest(
      requestAuthenticated,
      {
        issuerReference: membership.issuerReference,
        query,
        limit: 20,
        signal
      }
    );

    return adaptAcademicProgramSearch(payload);
  }

  async function searchSubjects(
    curriculumReference: string,
    query: string,
    signal: AbortSignal
  ): Promise<CurriculumAcademicSubjectSearchItemVM[]> {
    const payload = await searchCurriculumAcademicSubjectsRequest(
      requestAuthenticated,
      {
        issuerReference: membership.issuerReference,
        curriculumReference,
        query,
        limit: 20,
        signal
      }
    );

    return adaptCurriculumAcademicSubjectSearch(payload);
  }

  async function uploadDocumentEvidence(file: File) {
    const payload = await uploadCredentialDocumentEvidenceRequest(
      requestAuthenticated,
      {
        issuerReference: membership.issuerReference,
        credentialReference,
        file
      }
    );
    const uploaded = adaptDocumentEvidenceResponse(payload);

    setDetail((current) =>
      current
        ? {
            ...current,
            documentEvidence: { currentDocument: uploaded }
          }
        : current
    );

    return uploaded;
  }

  async function submitTextEvidence(command: {
    label: string | null;
    content: string;
  }) {
    const payload = await submitCredentialTextEvidenceRequest(
      requestAuthenticated,
      {
        issuerReference: membership.issuerReference,
        credentialReference,
        label: command.label,
        content: command.content
      }
    );
    const submitted = adaptTextEvidenceResponse(payload);

    setDetail((current) =>
      current
        ? {
            ...current,
            textEvidence: { currentText: submitted }
          }
        : current
    );

    return submitted;
  }

  async function issueCredential() {
    const issued = await issueIssuerCredentialRequest(
      requestAuthenticated,
      {
        issuerReference: membership.issuerReference,
        credentialReference
      }
    );

    setDetail(issued);
    await documentAnalysis.refresh();
    return issued;
  }

  return (
    <CredentialDetailView
      detail={detail}
      documentAnalysis={{
        state: documentAnalysis.state,
        onRefresh: documentAnalysis.refresh
      }}
      onUploadDocumentEvidence={uploadDocumentEvidence}
      onSubmitTextEvidence={submitTextEvidence}
      onIssue={issueCredential}
      draftEditor={{
        issuerReference: membership.issuerReference,
        onSave: saveDraft,
        onReloadLatest: reloadLatestDraft,
        searchPrograms,
        searchSubjects,
        onTerminalError: (feedback) => {
          setDetail(null);
          setError(feedback);
        }
      }}
    />
  );
}

export function CredentialDetailView({
  detail,
  documentAnalysis,
  draftEditor,
  onIssue = unavailableCredentialIssuance,
  onSubmitTextEvidence = unavailableTextEvidenceSubmission,
  onUploadDocumentEvidence
}: {
  detail: IssuerCredentialDetailVM;
  documentAnalysis?: {
    state: DocumentAnalysisState;
    onRefresh(): Promise<void>;
  };
  onUploadDocumentEvidence(file: File): Promise<DocumentEvidenceVM>;
  onIssue?(): Promise<IssuerCredentialDetailVM>;
  onSubmitTextEvidence?(command: {
    label: string | null;
    content: string;
  }): Promise<TextEvidenceVM>;
  draftEditor?: {
    issuerReference: string;
    onSave(
      command: UpdateIssuerCredentialDraftCommand
    ): Promise<IssuerCredentialDetailVM>;
    onReloadLatest(): Promise<IssuerCredentialDetailVM>;
    searchPrograms(
      query: string,
      signal: AbortSignal
    ): Promise<AcademicProgramSearchItemVM[]>;
    searchSubjects(
      curriculumReference: string,
      query: string,
      signal: AbortSignal
    ): Promise<CurriculumAcademicSubjectSearchItemVM[]>;
    onTerminalError(feedback: CredentialFeedback): void;
  };
}) {
  const isDraft = detail.status === 'draft';
  const createdAt = dateFormatter.format(new Date(detail.createdAt));
  const institutionMismatch = valuesDiffer(
    detail.issuer.displayName,
    detail.credentialSubject.institutionName
  );
  const achievementMismatch = valuesDiffer(
    detail.title,
    detail.credentialSubject.achievementName
  );

  return (
    <div className="grid gap-8">
      <header className="max-w-4xl">
        <Link
          href="/issuer"
          className="text-sm font-semibold text-brand-700 underline-offset-4 hover:underline"
        >
          Volver al portal
        </Link>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Badge
            variant="outline"
            className={
              isDraft
                ? 'border-status-draft/25 bg-status-draft-soft text-status-draft'
                : undefined
            }
          >
            {detail.statusLabel}
          </Badge>
          <span className="text-sm text-text-muted">
            Registro institucional
          </span>
        </div>
        <h1 className="mt-4 max-w-3xl text-3xl leading-tight font-bold tracking-tight text-text-strong sm:text-4xl">
          {detail.title}
        </h1>
        <p className="mt-4 max-w-2xl leading-7 text-text-muted">
          {isDraft
            ? 'Este borrador conserva los datos iniciales y todavía no fue emitido.'
            : 'Esta credencial ya no está en estado borrador. Las operaciones posteriores quedan fuera de este flujo.'}
        </p>
      </header>

      {!isDraft ? (
        <FeedbackAlert
          variant="information"
          title="Estado disponible en modo lectura"
        >
          Esta credencial está disponible en modo lectura. Las acciones para
          este estado todavía no están disponibles.
        </FeedbackAlert>
      ) : null}

      {institutionMismatch || achievementMismatch ? (
        <section aria-label="Advertencias de consistencia" className="grid gap-4">
          {institutionMismatch ? (
            <FeedbackAlert
              variant="warning"
              title="Revisá la institución del borrador"
            >
              <p>
                La institución registrada en el borrador no coincide con el
                contexto institucional actual.
              </p>
              <p className="mt-2">
                <span className="font-semibold">
                  Institución registrada en el borrador:
                </span>{' '}
                {detail.credentialSubject.institutionName}
              </p>
            </FeedbackAlert>
          ) : null}
          {achievementMismatch ? (
            <FeedbackAlert
              variant="warning"
              title="Revisá el nombre del logro"
            >
              <p>
                El nombre registrado en el borrador no coincide con el título
                principal de la credencial.
              </p>
              <p className="mt-2">
                <span className="font-semibold">
                  Nombre registrado en el borrador:
                </span>{' '}
                {detail.credentialSubject.achievementName}
              </p>
            </FeedbackAlert>
          ) : null}
        </section>
      ) : null}

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <Card className="overflow-hidden border-border-strong">
          <div aria-hidden="true" className="h-1 bg-brand-700" />
          <CardHeader className="gap-2 sm:p-8 sm:pb-6">
            <p className="text-sm font-semibold text-brand-700">
              Datos principales
            </p>
            <h2 className="text-xl font-semibold text-text-strong">
              Registro del logro
            </h2>
          </CardHeader>
          <CardContent className="grid gap-5 sm:px-8 sm:pb-8">
            <DetailRow
              icon={Tags}
              label="Tipo de credencial"
              value={detail.typeLabel}
            />
            <Separator />
            <DetailRow
              icon={Building2}
              label="Institución emisora"
              value={detail.issuer.displayName}
              description={
                detail.issuer.did ?? 'DID institucional no disponible'
              }
            />
            <Separator />
            <DetailRow
              icon={UserRound}
              label="Titular"
              value={detail.holder.displayLabel}
              description={holderDescription(detail.holder)}
            />
            <Separator />
            <DetailRow
              icon={CalendarDays}
              label="Creado"
              value={createdAt}
            />
          </CardContent>
        </Card>

        <aside aria-labelledby="draft-actions-title">
          <Card className="border-border-strong bg-surface-muted shadow-none">
            <CardHeader>
              <h2
                id="draft-actions-title"
                className="text-lg font-semibold text-text-strong"
              >
                Continuar en el portal
              </h2>
              <p className="text-sm leading-6 text-text-muted">
                Podés volver al contexto institucional o iniciar otro
                borrador.
              </p>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Button asChild>
                <Link href="/issuer/credentials/new">
                  <FilePlus2 aria-hidden="true" />
                  Crear otra credencial
                </Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href="/issuer">Volver al portal</Link>
              </Button>
            </CardContent>
          </Card>
        </aside>
      </div>

      {isDraft && draftEditor ? (
        <CredentialDraftEditorForm
          detail={detail}
          issuerReference={draftEditor.issuerReference}
          onSave={draftEditor.onSave}
          onReloadLatest={draftEditor.onReloadLatest}
          searchPrograms={draftEditor.searchPrograms}
          searchSubjects={draftEditor.searchSubjects}
          onTerminalError={draftEditor.onTerminalError}
        />
      ) : null}

      <CredentialIssuanceSection detail={detail} onIssue={onIssue} />

      {!isDraft && detail.type === 'course' ? (
        <CourseDeclaredDataCard subject={detail.credentialSubject} />
      ) : null}

      <section aria-labelledby="supporting-evidence-title" className="grid gap-8">
        <div className="max-w-3xl border-t border-border-default pt-8">
          <p className="text-sm font-semibold text-teal-700">Fuentes institucionales</p>
          <h2
            id="supporting-evidence-title"
            className="mt-2 text-2xl font-bold tracking-tight text-text-strong"
          >
            Evidencia de respaldo
          </h2>
          <p className="mt-2 leading-7 text-text-muted">
            Reuní las fuentes que respaldan el contenido de la credencial y consultá su análisis asistido.
          </p>
        </div>

        <DocumentEvidenceSection
          credentialStatus={detail.status}
          currentDocument={detail.documentEvidence.currentDocument}
          onUpload={onUploadDocumentEvidence}
        />

        <TextEvidenceSection
          credentialStatus={detail.status}
          currentText={detail.textEvidence.currentText}
          onSubmit={onSubmitTextEvidence}
        />

        {documentAnalysis ? (
          <DocumentAnalysisSection
            credentialStatus={detail.status}
            currentDocument={detail.documentEvidence.currentDocument}
            state={documentAnalysis.state}
            onRefresh={documentAnalysis.onRefresh}
          />
        ) : null}
      </section>
    </div>
  );
}

async function unavailableTextEvidenceSubmission(): Promise<TextEvidenceVM> {
  throw new Error('Text evidence submission is not available in this view.');
}

async function unavailableCredentialIssuance(): Promise<IssuerCredentialDetailVM> {
  throw new Error('Credential issuance is not available in this view.');
}

function valuesDiffer(
  authoritativeValue: string,
  draftValue: string | null
) {
  return (
    draftValue !== null &&
    authoritativeValue.trim() !== draftValue.trim()
  );
}

function holderDescription(holder: IssuerCredentialDetailVM['holder']) {
  const email = holder.email ?? 'Email no disponible';
  const did = holder.did ?? 'DID no disponible';

  return `${email} · ${did}`;
}

function CourseDeclaredDataCard({
  subject
}: {
  subject: IssuerCredentialDetailVM['credentialSubject'];
}) {
  const hasDeclaredData =
    subject.platformName !== null ||
    subject.modality !== null ||
    subject.externalUrl !== null ||
    subject.competencies.length > 0 ||
    subject.learningOutcomes.length > 0;

  if (!hasDeclaredData) {
    return null;
  }

  return (
    <Card className="border-border-strong shadow-none">
      <CardHeader className="flex-row items-center gap-3 border-b border-border-default">
        <Link2 aria-hidden="true" className="size-5 text-teal-700" />
        <div>
          <h2 className="text-lg font-semibold text-text-strong">
            Datos declarados del curso
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            Información declarada por la institución emisora. Modo lectura.
          </p>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 pt-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <OptionalDetailRow icon={Tags} label="Plataforma" value={subject.platformName} />
          <OptionalDetailRow icon={Tags} label="Modalidad" value={subject.modality} />
        </div>
        {subject.externalUrl ? (
          <div>
            <span className="flex items-center gap-2 text-sm font-semibold text-text-muted">
              <Link2 aria-hidden="true" className="size-4" />
              URL del curso o certificado
            </span>
            <a
              href={subject.externalUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 inline-block break-words font-semibold text-brand-700 underline underline-offset-4"
            >
              {subject.externalUrl}
            </a>
            <p className="mt-1 text-sm leading-5 text-text-muted">
              Enlace declarado por la institución emisora. No implica verificación oficial externa.
            </p>
          </div>
        ) : null}
        <TagList title="Competencias declaradas" items={subject.competencies} />
        <TagList title="Resultados de aprendizaje declarados" items={subject.learningOutcomes} />
      </CardContent>
    </Card>
  );
}

function OptionalDetailRow({
  icon,
  label,
  value
}: {
  icon: typeof Landmark;
  label: string;
  value: string | null;
}) {
  if (!value) {
    return null;
  }

  return <DetailRow icon={icon} label={label} value={value} />;
}

function TagList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div>
      <p className="text-sm font-semibold text-text-muted">{title}</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => (
          <li
            key={item}
            className="rounded-full border border-border-strong px-3 py-1 text-sm text-text-strong"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DetailRow({
  description,
  icon: Icon,
  label,
  value
}: {
  description?: string;
  icon: typeof Landmark;
  label: string;
  value: string;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6">
      <span className="flex items-center gap-2 text-sm font-semibold text-text-muted">
        <Icon aria-hidden="true" className="size-4" />
        {label}
      </span>
      <div className="min-w-0">
        <p className="break-words font-semibold text-text-strong">{value}</p>
        {description ? (
          <p className="mt-1 text-sm leading-5 text-text-muted">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

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
import { useSearchParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
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
import { ReusableSemanticInterpretationSection } from '@/features/credentials/reusable-semantic-interpretation-section';
import { ReusableTemplateIntentSection } from '@/features/credentials/reusable-template-intent-section';
import { SemanticApprovalSection } from '@/features/credentials/semantic-approval-section';
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
import {
  approveTemplateSemanticAnalysis,
  approveCredentialSemanticAnalysis,
  getCredentialSemanticApprovalCandidate,
  getTemplateSemanticApprovalCandidate,
  listCourseTemplates
} from '@/lib/api/course-templates-api';
import {
  applyReusableSemanticInterpretation,
  getReusableSemanticInterpretation,
  getReusableSemanticInterpretationCandidate
} from '@/lib/api/reusable-semantic-interpretation-api';
import { mapCredentialError } from '@/lib/errors/credential-error-mapper';
import { useSession } from '@/lib/session/session-provider';
import type {
  CredentialFeedback,
  AcademicProgramSearchItemVM,
  ApplyReusableSemanticInterpretationResultVM,
  AppliedReusableSemanticInterpretationVM,
  CourseTemplateSummaryVM,
  CurriculumAcademicSubjectSearchItemVM,
  DocumentEvidenceVM,
  IssuerCredentialDetailVM,
  ReusableSemanticInterpretationCandidateVM,
  TemplateSemanticApprovalCandidateVM,
  ReviewedSemanticInterpretationCommand,
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
  const searchParams = useSearchParams();
  // C3c fix: unica señal segura de que el PATCH best-effort que aplica un
  // template reutilizable falló después de crear el draft con éxito.
  // Nunca expone detalle del backend -- es solo un query param booleano.
  const templateApplyFailed = searchParams.get('templateApply') === 'failed';
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

  // C4a.2: busca de forma segura si esta credencial ya tiene un template
  // reutilizable (catalogo guardado en C3a/C3b/C3c). Reutiliza el mismo
  // listCourseTemplates de C3c en vez de un endpoint nuevo: filtra por
  // credentialType actual + search por titulo, y despues filtra
  // client-side por createdFromCredentialId === credentialReference (el
  // backend no expone ese filtro directamente). Nunca crea, guarda ni
  // modifica nada -- es un GET puro. Declarado antes de los early-return
  // de loading/error (reglas de hooks) y memoizado para que su identidad
  // se mantenga estable entre renders no relacionados (evidencia, PATCH,
  // emision) y el efecto de CredentialDetailView no vuelva a dispararse
  // innecesariamente.
  const findReusableTemplateForCredential = useCallback(async (): Promise<
    CourseTemplateSummaryVM | null
  > => {
    const credentialType = detail?.type;

    if (credentialType !== 'course' && credentialType !== 'certification') {
      return null;
    }

    const results = await listCourseTemplates(requestAuthenticated, {
      issuerReference: membership.issuerReference,
      credentialType,
      search: detail?.title ?? '',
      status: 'all'
    });

    return (
      results.find(
        (candidate) => candidate.createdFromCredentialId === credentialReference
      ) ?? null
    );
  }, [
    requestAuthenticated,
    membership.issuerReference,
    credentialReference,
    detail?.type,
    detail?.title
  ]);

  // C4a.2: resumen seguro de la SemanticAnalysis candidata, ANTES de
  // aprobarla. GET puro -- nunca crea, guarda ni modifica nada.
  const loadSemanticApprovalCandidate = useCallback(
    (
      templateReference: string,
      semanticAnalysisReference: string
    ): Promise<TemplateSemanticApprovalCandidateVM> =>
      getTemplateSemanticApprovalCandidate(requestAuthenticated, {
        issuerReference: membership.issuerReference,
        templateReference,
        semanticAnalysisReference
      }),
    [requestAuthenticated, membership.issuerReference]
  );

  // C4a.2: aprueba la interpretacion semantica candidata como reutilizable
  // del template. No modifica la credencial visible (no llama setDetail).
  const approveSemanticAnalysisForTemplate = useCallback(
    (
      templateReference: string,
      semanticAnalysisReference: string,
      review: ReviewedSemanticInterpretationCommand
    ): Promise<CourseTemplateSummaryVM> =>
      approveTemplateSemanticAnalysis(requestAuthenticated, {
        issuerReference: membership.issuerReference,
        templateReference,
        semanticAnalysisReference,
        review
      }),
    [requestAuthenticated, membership.issuerReference]
  );

  const loadCredentialSemanticApprovalCandidate = useCallback(
    (semanticAnalysisReference: string): Promise<TemplateSemanticApprovalCandidateVM> =>
      getCredentialSemanticApprovalCandidate(requestAuthenticated, {
        issuerReference: membership.issuerReference,
        credentialReference,
        semanticAnalysisReference
      }),
    [requestAuthenticated, membership.issuerReference, credentialReference]
  );

  const approveCredentialSemanticReview = useCallback(
    (semanticAnalysisReference: string, review: ReviewedSemanticInterpretationCommand) =>
      approveCredentialSemanticAnalysis(requestAuthenticated, {
        issuerReference: membership.issuerReference,
        credentialReference,
        semanticAnalysisReference,
        review
      }),
    [requestAuthenticated, membership.issuerReference, credentialReference]
  );

  // C4b.2: aplicar a esta credencial una interpretacion semantica ya
  // revisada por el emisor (C4a.1/C4a.2) sobre un contenido reutilizable
  // que el emisor elige explicitamente (sourceTemplateId sigue diferido).
  // Reutiliza listCourseTemplates de C3c/C4a.2 para el selector -- nunca
  // duplica la busqueda de templates.
  const loadReusableInterpretation = useCallback(
    (): Promise<AppliedReusableSemanticInterpretationVM | null> =>
      getReusableSemanticInterpretation(requestAuthenticated, {
        issuerReference: membership.issuerReference,
        credentialReference
      }),
    [requestAuthenticated, membership.issuerReference, credentialReference]
  );

  const searchReusableTemplatesForInterpretation = useCallback(
    (
      query: string,
      signal: AbortSignal
    ): Promise<CourseTemplateSummaryVM[]> => {
      const credentialType = detail?.type;

      if (credentialType !== 'course' && credentialType !== 'certification') {
        return Promise.resolve([]);
      }

      return listCourseTemplates(requestAuthenticated, {
        issuerReference: membership.issuerReference,
        credentialType,
        search: query,
        status: 'active',
        signal
      });
    },
    [requestAuthenticated, membership.issuerReference, detail?.type]
  );

  const loadReusableInterpretationCandidate = useCallback(
    (
      templateReference: string
    ): Promise<ReusableSemanticInterpretationCandidateVM> =>
      getReusableSemanticInterpretationCandidate(requestAuthenticated, {
        issuerReference: membership.issuerReference,
        credentialReference,
        templateReference
      }),
    [requestAuthenticated, membership.issuerReference, credentialReference]
  );

  const applyReusableInterpretation = useCallback(
    (command: {
      templateReference: string;
      approvalRevision: string;
      acknowledgeDestinationDrift?: boolean;
    }): Promise<ApplyReusableSemanticInterpretationResultVM> =>
      applyReusableSemanticInterpretation(requestAuthenticated, {
        issuerReference: membership.issuerReference,
        credentialReference,
        ...command
      }),
    [requestAuthenticated, membership.issuerReference, credentialReference]
  );

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
      // C4a.2: fuerza un remount completo si esta misma posicion del
      // arbol se reutiliza para otra credencial (Next.js App Router no
      // remonta automaticamente solo porque cambio el parametro dinamico
      // de la ruta) -- resetea reusableTemplate y el estado de busqueda
      // sin logica adicional.
      key={credentialReference}
      detail={detail}
      documentAnalysis={{
        state: documentAnalysis.state,
        onRetry: documentAnalysis.trigger
      }}
      onUploadDocumentEvidence={uploadDocumentEvidence}
      onSubmitTextEvidence={submitTextEvidence}
      onIssue={issueCredential}
      onFindReusableTemplate={findReusableTemplateForCredential}
      onLoadSemanticApprovalCandidate={loadSemanticApprovalCandidate}
      onApproveTemplateSemanticAnalysis={approveSemanticAnalysisForTemplate}
      onLoadCredentialSemanticApprovalCandidate={loadCredentialSemanticApprovalCandidate}
      onApproveCredentialSemanticAnalysis={approveCredentialSemanticReview}
      onLoadReusableInterpretation={loadReusableInterpretation}
      searchReusableTemplatesForInterpretation={searchReusableTemplatesForInterpretation}
      onLoadReusableInterpretationCandidate={loadReusableInterpretationCandidate}
      onApplyReusableInterpretation={applyReusableInterpretation}
      templateApplyFailed={templateApplyFailed}
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
  onFindReusableTemplate,
  onLoadSemanticApprovalCandidate = unavailableSemanticApprovalCandidate,
  onApproveTemplateSemanticAnalysis = unavailableApproveTemplateSemanticAnalysis,
  onLoadCredentialSemanticApprovalCandidate = unavailableSemanticApprovalCandidate,
  onApproveCredentialSemanticAnalysis = unavailableApproveCredentialSemanticAnalysis,
  onLoadReusableInterpretation = unavailableReusableInterpretationRead,
  searchReusableTemplatesForInterpretation = unavailableReusableTemplateSearch,
  onLoadReusableInterpretationCandidate = unavailableReusableInterpretationCandidate,
  onApplyReusableInterpretation = unavailableApplyReusableInterpretation,
  templateApplyFailed = false,
  onUploadDocumentEvidence
}: {
  detail: IssuerCredentialDetailVM;
  documentAnalysis?: {
    state: DocumentAnalysisState;
    onRetry(): Promise<void>;
  };
  onUploadDocumentEvidence(file: File): Promise<DocumentEvidenceVM>;
  onIssue?(): Promise<IssuerCredentialDetailVM>;
  onSubmitTextEvidence?(command: {
    label: string | null;
    content: string;
  }): Promise<TextEvidenceVM>;
  // Deprecated C3b injection point. Kept inert for test and integration
  // compatibility; C5 never invokes it because templates are persisted only
  // after semantic review approval.
  onSaveReusableTemplate?(): Promise<CourseTemplateSummaryVM>;
  // C4a.2: busqueda segura de un template ya existente para esta
  // credencial (relee al montar/recargar). Si se omite, o si resuelve
  // null, la seccion de aprobacion semantica no se muestra -- solo la de
  // guardar como reutilizable (C3b) sigue disponible.
  onFindReusableTemplate?(): Promise<CourseTemplateSummaryVM | null>;
  onLoadSemanticApprovalCandidate?(
    templateReference: string,
    semanticAnalysisReference: string
  ): Promise<TemplateSemanticApprovalCandidateVM>;
  onApproveTemplateSemanticAnalysis?(
    templateReference: string,
    semanticAnalysisReference: string,
    review: ReviewedSemanticInterpretationCommand
  ): Promise<CourseTemplateSummaryVM>;
  onLoadCredentialSemanticApprovalCandidate?(
    semanticAnalysisReference: string
  ): Promise<TemplateSemanticApprovalCandidateVM>;
  onApproveCredentialSemanticAnalysis?(
    semanticAnalysisReference: string,
    review: ReviewedSemanticInterpretationCommand
  ): Promise<CourseTemplateSummaryVM>;
  // C4b.2: aplicar una interpretacion semantica reutilizable ya revisada a
  // esta credencial. Distinto de C5 (revisar/aprobar): este flujo APLICA
  // una interpretacion que ya fue revisada. El template se elige
  // explicitamente (sourceTemplateId sigue diferido).
  onLoadReusableInterpretation?(): Promise<AppliedReusableSemanticInterpretationVM | null>;
  searchReusableTemplatesForInterpretation?(
    query: string,
    signal: AbortSignal
  ): Promise<CourseTemplateSummaryVM[]>;
  onLoadReusableInterpretationCandidate?(
    templateReference: string
  ): Promise<ReusableSemanticInterpretationCandidateVM>;
  onApplyReusableInterpretation?(command: {
    templateReference: string;
    approvalRevision: string;
    acknowledgeDestinationDrift?: boolean;
  }): Promise<ApplyReusableSemanticInterpretationResultVM>;
  // C3c fix: true cuando el draft se creo con exito pero el PATCH
  // best-effort que aplico los campos de un template reutilizable fallo.
  // Nunca bloquea nada -- solo dispara un aviso no-danger.
  templateApplyFailed?: boolean;
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
  // C4a.2: unica fuente de verdad para el template reutilizable conocido
  // de esta credencial -- se puebla por (1) guardado exitoso via C3b, (2)
  // busqueda automatica al montar/recargar, o (3) recuperacion tras un 409
  // duplicado. null significa "no se pudo determinar el template", que es
  // el mismo estado que "todavia no se guardo como reutilizable" a los
  // fines de esta pantalla (nunca se muestra aprobacion sin templateId).
  // Nota: CredentialDetailController monta este componente con
  // key={credentialReference} -- si el arbol se reutiliza para otra
  // credencial, React lo remonta por completo y este estado (incluido el
  // ref de abajo) se resetea solo, sin logica adicional aca.
  const [reusableTemplate, setReusableTemplate] =
    useState<CourseTemplateSummaryVM | null>(null);
  const lookupAttempted = useRef(false);

  useEffect(() => {
    if (detail.type !== 'course' && detail.type !== 'certification') {
      return;
    }
    if (detail.status === 'revoked') {
      return;
    }
    if (!onFindReusableTemplate) {
      return;
    }
    if (lookupAttempted.current) {
      return;
    }

    lookupAttempted.current = true;
    let active = true;

    onFindReusableTemplate()
      .then((found) => {
        if (active && found) {
          setReusableTemplate(found);
        }
      })
      .catch(() => {
        // Busqueda best-effort: si falla, se comporta igual que "no se
        // pudo determinar el template" -- solo queda disponible guardar
        // como reutilizable (C3b), nunca se rompe la pantalla.
      });

    return () => {
      active = false;
    };
  }, [detail.type, detail.status, onFindReusableTemplate]);

  async function handleApproveTemplateSemanticAnalysis(
    templateReference: string,
    semanticAnalysisReference: string,
    review: ReviewedSemanticInterpretationCommand
  ): Promise<CourseTemplateSummaryVM> {
    const approved = await onApproveTemplateSemanticAnalysis(
      templateReference,
      semanticAnalysisReference,
      review
    );
    setReusableTemplate(approved);
    return approved;
  }
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
    <div className="grid gap-10">
      <header className="max-w-5xl">
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
        <h1 className="mt-4 max-w-5xl text-3xl leading-tight font-bold tracking-tight text-text-strong sm:text-4xl">
          {detail.title}
        </h1>
        <p className="mt-4 max-w-4xl leading-7 text-text-muted">
          {isDraft
            ? 'Este borrador conserva los datos iniciales y todavía no fue emitido.'
            : 'Esta credencial ya no está en estado borrador. Las operaciones posteriores quedan fuera de este flujo.'}
        </p>
      </header>

      {isDraft && (detail.type === 'course' || detail.type === 'certification') ? <ReusableTemplateIntentSection /> : null}

      {templateApplyFailed ? (
        <FeedbackAlert
          variant="warning"
          title="El borrador se creó, pero no pudimos aplicar todos los datos del contenido reutilizable"
        >
          Podés completarlos manualmente en el editor.
        </FeedbackAlert>
      ) : null}

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

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem] xl:gap-10">
        <div className="grid gap-8 xl:gap-10">
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

          {!isDraft && detail.type === 'course' ? (
            <CourseDeclaredDataCard subject={detail.credentialSubject} />
          ) : null}

          <DocumentEvidenceSection
            credentialStatus={detail.status}
            credentialType={detail.type}
            currentDocument={detail.documentEvidence.currentDocument}
            onUpload={onUploadDocumentEvidence}
          />

          {detail.type !== 'course' && detail.type !== 'certification' ? (
            <TextEvidenceSection
              credentialStatus={detail.status}
              currentText={detail.textEvidence.currentText}
              onSubmit={onSubmitTextEvidence}
            />
          ) : null}

          {documentAnalysis ? (
            <DocumentAnalysisSection
              credentialStatus={detail.status}
              credentialType={detail.type}
              currentDocument={detail.documentEvidence.currentDocument}
              state={documentAnalysis.state}
              onRetry={documentAnalysis.onRetry}
            />
          ) : null}

          {(detail.type === 'course' || detail.type === 'certification') &&
          (detail.status === 'issued' || detail.status === 'revoked') ? (
            // C4b.2: convive con el analisis semantico y el contenido
            // reutilizable, en el flujo principal -- nunca en la sidebar
            // tecnica de emision/integridad (canonical hash, blockchain).
            // `revoked` sigue el mismo criterio permisivo que el backend
            // (GET .../reusable-semantic-interpretation): la aplicacion
            // historica sigue siendo legible, pero candidate/apply exigen
            // `issued` -- readOnly oculta esa accion sin ocultar el
            // historial.
            <ReusableSemanticInterpretationSection
              key={detail.credentialReference}
              credentialType={detail.type}
              readOnly={detail.status === 'revoked'}
              onLoadActiveApplication={onLoadReusableInterpretation}
              searchTemplates={searchReusableTemplatesForInterpretation}
              onLoadCandidate={onLoadReusableInterpretationCandidate}
              onApply={onApplyReusableInterpretation}
            />
          ) : null}
        </div>

        <aside aria-labelledby="draft-actions-title" className="grid gap-5 lg:sticky lg:top-8 lg:self-start">
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
          <CredentialIssuanceSection detail={detail} onIssue={onIssue} />
          {(detail.type === 'course' || detail.type === 'certification') && detail.status === 'issued' ? (
            <SemanticApprovalSection
              semanticAnalysisReference={documentAnalysis?.state.currentRun?.semanticAnalysis?.semanticAnalysisReference ?? reusableTemplate?.lastSemanticAnalysisId ?? null}
              approved={reusableTemplate?.approvedSemanticAnalysisId !== null && reusableTemplate?.approvedSemanticAnalysisId !== undefined}
              onLoadCandidate={(semanticAnalysisReference) => reusableTemplate
                ? onLoadSemanticApprovalCandidate(reusableTemplate.reference, semanticAnalysisReference)
                : onLoadCredentialSemanticApprovalCandidate(semanticAnalysisReference)}
              onApprove={async (semanticAnalysisReference, review) => {
                if (reusableTemplate) {
                  await handleApproveTemplateSemanticAnalysis(
                    reusableTemplate.reference,
                    semanticAnalysisReference,
                    review
                  );
                  return;
                }
                const approved = await onApproveCredentialSemanticAnalysis(semanticAnalysisReference, review);
                setReusableTemplate(approved);
              }}
            />
          ) : null}
        </aside>
      </div>
    </div>
  );
}

async function unavailableTextEvidenceSubmission(): Promise<TextEvidenceVM> {
  throw new Error('Text evidence submission is not available in this view.');
}

async function unavailableReusableInterpretationRead(): Promise<AppliedReusableSemanticInterpretationVM | null> {
  throw new Error(
    'Loading the applied reusable semantic interpretation is not available in this view.'
  );
}

async function unavailableReusableTemplateSearch(): Promise<CourseTemplateSummaryVM[]> {
  throw new Error(
    'Searching reusable templates for interpretation is not available in this view.'
  );
}

async function unavailableReusableInterpretationCandidate(): Promise<ReusableSemanticInterpretationCandidateVM> {
  throw new Error(
    'Loading a reusable semantic interpretation candidate is not available in this view.'
  );
}

async function unavailableApplyReusableInterpretation(): Promise<ApplyReusableSemanticInterpretationResultVM> {
  throw new Error(
    'Applying a reusable semantic interpretation is not available in this view.'
  );
}

async function unavailableCredentialIssuance(): Promise<IssuerCredentialDetailVM> {
  throw new Error('Credential issuance is not available in this view.');
}

async function unavailableSemanticApprovalCandidate(): Promise<TemplateSemanticApprovalCandidateVM> {
  throw new Error(
    'Loading a semantic approval candidate is not available in this view.'
  );
}

async function unavailableApproveCredentialSemanticAnalysis(): Promise<CourseTemplateSummaryVM> {
  throw new Error('Approving a credential semantic analysis is not available in this view.');
}

async function unavailableApproveTemplateSemanticAnalysis(): Promise<CourseTemplateSummaryVM> {
  throw new Error(
    'Approving a template semantic analysis is not available in this view.'
  );
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
    subject.modality !== null ||
    subject.externalUrl !== null ||
    subject.competencies.length > 0 ||
    subject.learningOutcomes.length > 0 ||
    // C4x: platformName ya no es un dato declarado "principal" (ver
    // institutional-textual-backing.ts y credential-draft-editor-form.tsx),
    // pero un valor legacy sigue contando para decidir si esta tarjeta
    // tiene algo que mostrar.
    subject.platformName !== null;

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
          <OptionalDetailRow icon={Tags} label="Modalidad" value={subject.modality} />
        </div>
        {subject.platformName ? (
          <p className="text-sm leading-5 text-text-muted">
            Plataforma declarada (dato legacy, solo lectura): {subject.platformName}
          </p>
        ) : null}
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
        <TagList title="Contenido e información adicional declarado" items={subject.learningOutcomes} />
      </CardContent>
    </Card>
  );
}

// C4x: para course/certification, la carga manual de "Contenido textual de
// respaldo" (TextEvidence) queda oculta -- era una tarjeta duplicada
// respecto a los datos declarados (descripcion/competencias/contenido
// adicional) que ya alimentan la interpretacion asistida. No se elimina el
// academic_subject/degree mantienen su flujo manual de TextEvidence; course y
// certification no muestran una fuente textual duplicada en el detalle.
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

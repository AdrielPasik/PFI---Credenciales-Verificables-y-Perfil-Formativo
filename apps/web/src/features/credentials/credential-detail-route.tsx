'use client';

import {
  Building2,
  CalendarDays,
  FilePlus2,
  Landmark,
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
import { IssuerRouteBoundary } from '@/features/issuer-context/issuer-route-boundary';
import { adaptIssuerCredentialDetail } from '@/lib/adapters/credentials.adapter';
import {
  getIssuerCredentialRequest,
  patchIssuerCredentialDraftRequest
} from '@/lib/api/credentials-api';
import { mapCredentialError } from '@/lib/errors/credential-error-mapper';
import { useSession } from '@/lib/session/session-provider';
import type {
  CredentialFeedback,
  IssuerCredentialDetailVM,
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

  return (
    <CredentialDetailView
      detail={detail}
      draftEditor={{
        issuerReference: membership.issuerReference,
        onSave: saveDraft,
        onReloadLatest: reloadLatestDraft,
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
  draftEditor
}: {
  detail: IssuerCredentialDetailVM;
  draftEditor?: {
    issuerReference: string;
    onSave(
      command: UpdateIssuerCredentialDraftCommand
    ): Promise<IssuerCredentialDetailVM>;
    onReloadLatest(): Promise<IssuerCredentialDetailVM>;
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
          onTerminalError={draftEditor.onTerminalError}
        />
      ) : null}
    </div>
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

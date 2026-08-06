'use client';

import {
  Fingerprint,
  Network,
  ShieldAlert
} from 'lucide-react';
import { useRef, useState } from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { mapCredentialError } from '@/lib/errors/credential-error-mapper';
import type {
  CredentialFeedback,
  IssuerCredentialDetailVM
} from '@/models/credentials';

interface CredentialIssuanceSectionProps {
  detail: IssuerCredentialDetailVM;
  onIssue(): Promise<IssuerCredentialDetailVM>;
}

export function CredentialIssuanceSection({
  detail,
  onIssue
}: CredentialIssuanceSectionProps) {
  const [confirming, setConfirming] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [feedback, setFeedback] = useState<CredentialFeedback | null>(null);
  const requestInFlight = useRef(false);

  async function confirmIssue() {
    if (requestInFlight.current) {
      return;
    }

    requestInFlight.current = true;
    setIssuing(true);
    setFeedback(null);

    try {
      await onIssue();
      setConfirming(false);
    } catch (error) {
      setFeedback(mapCredentialError(error, 'issue'));
    } finally {
      requestInFlight.current = false;
      setIssuing(false);
    }
  }

  return (
    <section aria-labelledby="credential-issuance-title">
      <Card className="overflow-hidden border-border-strong">
        <div aria-hidden="true" className="h-1 bg-teal-700" />
        <CardHeader className="gap-2 sm:p-8 sm:pb-6">
          <p className="text-sm font-semibold text-teal-700">
            Registro verificable
          </p>
          <h2
            id="credential-issuance-title"
            className="text-2xl font-bold tracking-tight text-text-strong"
          >
            Emisión de credencial
          </h2>
        </CardHeader>
        <CardContent className="grid gap-5 sm:px-8 sm:pb-8">
          {detail.status === 'draft' ? (
            <DraftIssuanceContent
              confirming={confirming}
              issuing={issuing}
              feedback={feedback}
              onCancel={() => {
                setConfirming(false);
                setFeedback(null);
              }}
              onConfirm={() => void confirmIssue()}
              onRequestConfirmation={() => {
                setConfirming(true);
                setFeedback(null);
              }}
            />
          ) : (
            <IssuedCredentialContent detail={detail} />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function DraftIssuanceContent({
  confirming,
  issuing,
  feedback,
  onCancel,
  onConfirm,
  onRequestConfirmation
}: {
  confirming: boolean;
  issuing: boolean;
  feedback: CredentialFeedback | null;
  onCancel(): void;
  onConfirm(): void;
  onRequestConfirmation(): void;
}) {
  return (
    <>
      <div className="grid gap-2 leading-7 text-text-muted">
        <p>La emisión genera una versión verificable de la credencial.</p>
        <p>
          Traza registra una huella de integridad para permitir verificaciones
          posteriores.
        </p>
        <p>Después de emitir, la credencial queda en modo lectura.</p>
      </div>

      {feedback ? (
        <FeedbackAlert variant="error" title="No pudimos emitir la credencial">
          {feedback.message}
        </FeedbackAlert>
      ) : null}

      {confirming ? (
        <div
          role="region"
          aria-labelledby="confirm-issuance-title"
          aria-live="polite"
          className="grid gap-4 rounded-card border border-status-warning/30 bg-status-warning-soft p-5"
        >
          <div>
            <h3
              id="confirm-issuance-title"
              className="font-semibold text-text-strong"
            >
              Confirmar emisión
            </h3>
            <p className="mt-2 text-sm leading-6 text-text-default">
              Después de emitir, la credencial quedará en modo lectura y se
              registrará una huella de integridad.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={issuing}
              onClick={onCancel}
            >
              Cancelar
            </Button>
            <Button type="button" disabled={issuing} onClick={onConfirm}>
              {issuing ? 'Emitiendo credencial…' : 'Emitir credencial'}
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" className="w-fit" onClick={onRequestConfirmation}>
          Emitir credencial
        </Button>
      )}
    </>
  );
}

function IssuedCredentialContent({
  detail
}: {
  detail: IssuerCredentialDetailVM;
}) {
  const revoked = detail.status === 'revoked';

  return (
    <div className="grid gap-6">
      <FeedbackAlert
        variant={revoked ? 'warning' : 'success'}
        title={revoked ? 'Credencial revocada' : 'Credencial emitida'}
      >
        {revoked
          ? 'La credencial fue revocada. La evidencia histórica se conserva para consulta.'
          : 'La credencial fue emitida y está disponible en modo lectura.'}
      </FeedbackAlert>

      <dl className="grid gap-4 sm:grid-cols-2">
        <IntegrityValue
          label="Fecha de emisión"
          value={detail.issuedAtLabel ?? 'No disponible'}
        />
        <IntegrityValue
          label="Versión de canonicalización"
          value={detail.canonicalizationVersion ?? 'No disponible'}
        />
        <IntegrityValue
          label="Huella canónica"
          value={detail.canonicalHashShort ?? 'No disponible'}
          technical
        />
      </dl>

      <Separator />

      <div className="grid gap-4">
        <div className="flex items-start gap-3">
          <Fingerprint aria-hidden="true" className="mt-0.5 size-5 text-teal-700" />
          <div>
            <h3 className="font-semibold text-text-strong">
              Evidencia de integridad
            </h3>
            <p className="mt-1 text-sm leading-6 text-text-muted">
              La blockchain registra evidencia de integridad de la credencial
              emitida. La validez académica depende del emisor.
            </p>
          </div>
        </div>

        {detail.blockchainEvidence ? (
          <BlockchainEvidence detail={detail} />
        ) : (
          <FeedbackAlert variant="information" title="Evidencia no disponible">
            La credencial fue emitida, pero no hay evidencia blockchain
            disponible para mostrar.
          </FeedbackAlert>
        )}
      </div>
    </div>
  );
}

function BlockchainEvidence({ detail }: { detail: IssuerCredentialDetailVM }) {
  const evidence = detail.blockchainEvidence;

  if (!evidence) {
    return null;
  }

  return (
    <div className="grid gap-4 rounded-card border border-border-default bg-surface-muted p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-semibold text-text-strong">
          <Network aria-hidden="true" className="size-4 text-brand-700" />
          Registro técnico
        </div>
        <Badge variant="secondary">{evidence.networkLabel}</Badge>
      </div>
      <dl className="grid gap-4 sm:grid-cols-2">
        <IntegrityValue label="Red" value={evidence.network} technical />
        <IntegrityValue label="Chain ID" value={String(evidence.chainId)} technical />
        <IntegrityValue label="Estado" value={evidence.statusLabel} />
        <IntegrityValue label="Registrada" value={evidence.registeredAtLabel} />
        <IntegrityValue label="Transacción" value={evidence.txHashShort} technical />
      </dl>
      {(evidence.networkLabel === 'Entorno técnico/demo') ? (
        <p className="flex items-start gap-2 text-sm leading-6 text-text-muted">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Este registro corresponde a un entorno técnico de demostración, no a
          una red pública productiva.
        </p>
      ) : null}
    </div>
  );
}

function IntegrityValue({
  label,
  technical = false,
  value
}: {
  label: string;
  technical?: boolean;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold tracking-wide text-text-muted uppercase">
        {label}
      </dt>
      <dd
        className={
          technical
            ? 'mt-1 break-all font-mono text-sm text-text-strong'
            : 'mt-1 break-words font-semibold text-text-strong'
        }
      >
        {value}
      </dd>
    </div>
  );
}

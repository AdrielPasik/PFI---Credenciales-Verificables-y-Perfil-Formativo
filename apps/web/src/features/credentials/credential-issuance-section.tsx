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
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { hasInstitutionalTextualBacking } from '@/features/credentials/institutional-textual-backing';
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
  const [withoutEvidenceConfirmed, setWithoutEvidenceConfirmed] =
    useState(false);
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
      <Card className="overflow-hidden border-border-strong shadow-sm">
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
              detail={detail}
              issuing={issuing}
              feedback={feedback}
              onCancel={() => {
                setConfirming(false);
                setFeedback(null);
                setWithoutEvidenceConfirmed(false);
              }}
              onConfirm={() => void confirmIssue()}
              onRequestConfirmation={() => {
                setConfirming(true);
                setFeedback(null);
                setWithoutEvidenceConfirmed(false);
              }}
              onWithoutEvidenceConfirmed={setWithoutEvidenceConfirmed}
              withoutEvidenceConfirmed={withoutEvidenceConfirmed}
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
  detail,
  issuing,
  feedback,
  onCancel,
  onConfirm,
  onRequestConfirmation,
  onWithoutEvidenceConfirmed,
  withoutEvidenceConfirmed
}: {
  confirming: boolean;
  detail: IssuerCredentialDetailVM;
  issuing: boolean;
  feedback: CredentialFeedback | null;
  onCancel(): void;
  onConfirm(): void;
  onRequestConfirmation(): void;
  onWithoutEvidenceConfirmed(value: boolean): void;
  withoutEvidenceConfirmed: boolean;
}) {
  const preparation = buildIssuancePreparation(detail);

  return (
    <>
      <div className="grid gap-2 leading-7 text-text-muted">
        <p>La emisión genera una versión verificable de la credencial.</p>
        <p>
          Scope registra una huella de integridad para permitir verificaciones
          posteriores.
        </p>
        <p>Después de emitir, la credencial queda en modo lectura.</p>
      </div>

      <IssuancePreparation preparation={preparation} detail={detail} />

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
            {preparation.hasPdf ? (
              <p className="mt-2 text-sm leading-6 text-text-default">
                Scope intentará generar automáticamente un análisis documental
                a partir del PDF vigente. La IA no bloquea la emisión.
              </p>
            ) : preparation.hasReusableTextSource ? (
              <p className="mt-2 text-sm leading-6 text-text-default">
                Scope intentará generar automáticamente un análisis asistido
                a partir de la información declarada disponible. La IA no
                bloquea la emisión.
              </p>
            ) : (
              <p className="mt-2 text-sm leading-6 text-text-default">
                No se generará análisis automático porque no hay una evidencia
                documental PDF vigente.
              </p>
            )}
          </div>
          {preparation.recommendations.length > 0 ? (
            <FeedbackAlert variant="warning" title="Datos recomendados pendientes">
              La credencial se emitirá con campos opcionales incompletos:
              {' '}
              {preparation.recommendations.join(', ')}.
            </FeedbackAlert>
          ) : null}
          {!preparation.hasSupportEvidence ? (
            <div className="grid gap-3 rounded-control border border-status-warning/30 bg-surface p-4">
              <p className="text-sm leading-6 text-text-default">
                {preparation.isReusableType
                  ? 'No se generará una interpretación asistida robusta porque hay poca información declarada.'
                  : 'No se generará análisis automático porque no hay evidencia de respaldo cargada.'}
              </p>
              <div className="flex items-start gap-3">
                <input
                  id="confirm-issuance-without-evidence"
                  type="checkbox"
                  checked={withoutEvidenceConfirmed}
                  disabled={issuing}
                  onChange={(event) =>
                    onWithoutEvidenceConfirmed(event.target.checked)
                  }
                  className="mt-0.5 size-4 rounded border-border-strong text-brand-900 focus-visible:ring-3 focus-visible:ring-focus-ring/25"
                />
                <Label
                  htmlFor="confirm-issuance-without-evidence"
                  className="leading-6"
                >
                  {preparation.isReusableType
                    ? 'Confirmo emitir esta credencial con información declarada insuficiente para la interpretación asistida.'
                    : 'Confirmo emitir esta credencial sin una fuente de respaldo cargada en Scope.'}
                </Label>
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={issuing}
              onClick={onCancel}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={issuing || (!preparation.hasSupportEvidence && !withoutEvidenceConfirmed)}
              onClick={onConfirm}
            >
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

function IssuancePreparation({
  detail,
  preparation
}: {
  detail: IssuerCredentialDetailVM;
  preparation: ReturnType<typeof buildIssuancePreparation>;
}) {
  const credentialReference = detail.academicCourse
    ? `${detail.academicCourse.code} · ${detail.academicCourse.name}`
    : detail.title;

  return (
    <div className="grid gap-5 rounded-card border border-border-default bg-surface-muted p-5 sm:p-6">
      <div>
        <p className="text-sm font-semibold text-brand-700">Preparación para emitir</p>
        <p className="mt-1 text-sm leading-6 text-text-muted">
          Revisá el estado actual antes de confirmar la emisión.
        </p>
      </div>
      <dl className="grid gap-3 text-sm">
        <PreparationItem label="Estado" value="Borrador listo para revisar" />
        <PreparationItem label="Tipo" value={detail.typeLabel} />
        <PreparationItem label="Titular" value={detail.holder.displayLabel} />
        <PreparationItem label="Logro o referencia académica" value={credentialReference} />
        <PreparationItem
          label="Evidencia de respaldo"
          value={preparation.evidenceLabel}
          tone={preparation.hasSupportEvidence ? 'complete' : 'warning'}
        />
        <PreparationItem
          label="Análisis automático"
          value={preparation.analysisLabel}
          tone={preparation.canAttemptAutomaticAnalysis ? 'complete' : 'warning'}
        />
      </dl>
      {preparation.hasSupportEvidence &&
      !preparation.hasPdf &&
      !preparation.isReusableType ? (
        <FeedbackAlert variant="information" title="Análisis documental pendiente">
          La credencial tiene una fuente de respaldo, pero el análisis
          automático actual requiere una evidencia documental PDF. El análisis
          textual queda pendiente para una iteración posterior.
        </FeedbackAlert>
      ) : null}
      {!preparation.hasSupportEvidence ? (
        <FeedbackAlert
          variant="warning"
          title={
            preparation.isReusableType
              ? 'Información insuficiente para la interpretación asistida'
              : 'Sin fuente de respaldo'
          }
        >
          {preparation.isReusableType
            ? 'Esta credencial tiene poca información declarada para la interpretación asistida. Podés completarla antes de emitir.'
            : 'Podés emitir solo después de confirmar explícitamente que la credencial quedará sin fuente de respaldo cargada en Scope.'}
        </FeedbackAlert>
      ) : null}
    </div>
  );
}

function PreparationItem({
  label,
  tone = 'default',
  value
}: {
  label: string;
  tone?: 'complete' | 'default' | 'warning';
  value: string;
}) {
  const toneClassName =
    tone === 'complete'
      ? 'text-status-analysis'
      : tone === 'warning'
        ? 'text-status-warning'
        : 'text-text-strong';

  return (
    <div>
      <dt className="text-xs font-semibold tracking-wide text-text-muted uppercase">
        {label}
      </dt>
      <dd className={`mt-1 font-semibold ${toneClassName}`}>{value}</dd>
    </div>
  );
}

function buildIssuancePreparation(detail: IssuerCredentialDetailVM) {
  const document = detail.documentEvidence.currentDocument;
  const hasPdf =
    document?.kind === 'pdf' && document.mimeType === 'application/pdf';
  const hasText = detail.textEvidence.currentText !== null;
  // C4x: "evidencia cargada" (documento/texto manual) es distinto de
  // "respaldo declarativo institucional" (descripcion/competencias/
  // contenido adicional para course/certification, ver
  // hasInstitutionalTextualBacking). hasUploadedEvidence conserva el
  // significado original de hasSupportEvidence -- se sigue usando para el
  // analisis automatico (evidenceLabel/analysisLabel, "Analisis documental
  // pendiente"), que solo tiene sentido si hay un documento/texto cargado.
  const hasUploadedEvidence = document !== null || hasText;
  const hasDeclarativeBacking = hasInstitutionalTextualBacking({
    type: detail.type,
    description: detail.description,
    credentialSubject: detail.credentialSubject
  });
  const isReusableType =
    detail.type === 'course' || detail.type === 'certification';
  // El warning/checkbox de "emitir sin respaldo" se basa en esta bandera
  // combinada: para course/certification, respaldo declarativo suficiente
  // cuenta igual que evidencia cargada -- nunca se afirma "sin respaldo"
  // cuando hay informacion declarada suficiente.
  const hasSupportEvidence = hasUploadedEvidence || hasDeclarativeBacking;
  const hasReusableTextSource =
    isReusableType && (hasText || hasDeclarativeBacking);
  const recommendations = buildOptionalFieldRecommendations(detail);

  return {
    hasPdf,
    hasSupportEvidence,
    hasUploadedEvidence,
    hasDeclarativeBacking,
    hasReusableTextSource,
    canAttemptAutomaticAnalysis: hasPdf || hasReusableTextSource,
    isReusableType,
    recommendations,
    evidenceLabel: hasPdf
      ? 'PDF vigente'
      : document
        ? 'Evidencia documental vigente'
        : hasText
          ? 'Evidencia textual vigente'
          : hasDeclarativeBacking
            ? 'Contenido declarado suficiente'
            : 'Pendiente de confirmación',
    analysisLabel: isReusableType
      ? hasPdf
        ? 'Se analizará el PDF al emitir'
        : hasReusableTextSource
          ? 'Se ejecutará al emitir con datos declarados'
          : 'Pendiente de información suficiente'
      : hasPdf
        ? 'Se intentará al emitir'
        : 'No disponible automáticamente'
  };
}

// These are preparation hints only. Each credential type owns its own list so
// academic fields can never leak into course/certification issuance copy.
function buildOptionalFieldRecommendations(
  detail: IssuerCredentialDetailVM
): string[] {
  const subject = detail.credentialSubject;
  const recommendations: string[] = [];
  const addWhenMissing = (value: string | null, label: string) => {
    if (!value) {
      recommendations.push(label);
    }
  };
  const addArrayWhenEmpty = (value: string[], label: string) => {
    if (value.length === 0) {
      recommendations.push(label);
    }
  };

  switch (detail.type) {
    case 'course':
      addWhenMissing(detail.description, 'descripción');
      addWhenMissing(detail.hours, 'horas oficiales declaradas');
      addWhenMissing(subject.modality, 'modalidad');
      addArrayWhenEmpty(subject.competencies, 'competencias');
      addArrayWhenEmpty(
        subject.learningOutcomes,
        'contenido e información adicional'
      );
      addWhenMissing(subject.externalUrl, 'URL del curso');
      break;
    case 'certification':
      addWhenMissing(detail.description, 'descripción');
      addWhenMissing(detail.hours, 'horas oficiales declaradas');
      addWhenMissing(subject.certificationCode, 'código de certificación');
      addWhenMissing(subject.expirationDate, 'fecha de vencimiento');
      addWhenMissing(subject.providerName, 'proveedor de la certificación');
      addWhenMissing(subject.level, 'nivel');
      addArrayWhenEmpty(subject.skills, 'habilidades');
      addArrayWhenEmpty(subject.competencies, 'competencias');
      break;
    case 'academic_subject':
      addWhenMissing(subject.completionDate, 'fecha de finalización');
      addWhenMissing(subject.academicPeriod, 'período académico');
      addWhenMissing(subject.grade, 'calificación');
      if (subject.skills.length === 0 && subject.competencies.length === 0) {
        recommendations.push('habilidades o competencias');
      }
      break;
    case 'degree':
      addWhenMissing(subject.completionDate, 'fecha de finalización');
      addWhenMissing(subject.programName, 'programa académico');
      break;
  }

  return recommendations;
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

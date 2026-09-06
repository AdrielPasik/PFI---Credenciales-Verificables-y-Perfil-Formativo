'use client';

import { ArrowLeft, BookOpenCheck, BrainCircuit, FileText, Fingerprint, Landmark } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ContractDiagnostic, useContractDebugEnabled } from '@/features/holder/contract-diagnostic';
import { HolderDeclaredTextList, HolderTaxonomyList } from '@/features/holder/holder-content-lists';
import { WalletRouteBoundary } from '@/features/holder/wallet-route-boundary';
import { getMyCredentialRequest } from '@/lib/api/holder-api';
import { ApiError, IncompatiblePayloadError, type IncompatiblePayloadDiagnostic } from '@/lib/errors/api-error';
import { useSession } from '@/lib/session/session-provider';
import type { HolderCredentialDetailVM } from '@/models/holder';
import { LoadingState } from './wallet-home-route';
import { PublicSharePanel } from './public-share-panel';

export function WalletCredentialDetailRoute() {
  return <WalletRouteBoundary><WalletCredentialDetailContent /></WalletRouteBoundary>;
}

interface HolderCredentialDetailError {
  title: string;
  message: string;
  retryable: boolean;
  diagnostic: IncompatiblePayloadDiagnostic | null;
}

export function WalletCredentialDetailContent() {
  const params = useParams<{ credentialId: string }>();
  const contractDebug = useContractDebugEnabled();
  const { requestAuthenticated } = useSession();
  const [detail, setDetail] = useState<HolderCredentialDetailVM | null>(null);
  const [error, setError] = useState<HolderCredentialDetailError | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    let active = true;
    const credentialReference = typeof params.credentialId === 'string' ? params.credentialId : '';
    void getMyCredentialRequest(requestAuthenticated, credentialReference)
      .then((value) => active && setDetail(value))
      .catch((requestError: unknown) => active && setError(mapCredentialDetailError(requestError)));
    return () => { active = false; };
  }, [params.credentialId, requestAuthenticated, requestVersion]);

  if (error) {
    return <section className="grid gap-5"><BackLink /><FeedbackAlert variant="error" title={error.title}>{error.message}{contractDebug && error.diagnostic ? <ContractDiagnostic diagnostic={error.diagnostic} /> : null}</FeedbackAlert>{error.retryable ? <Button type="button" className="w-fit" onClick={() => { setDetail(null); setError(null); setRequestVersion((version) => version + 1); }}>Reintentar</Button> : null}</section>;
  }
  if (!detail) return <LoadingState label="Cargando credencial" />;

  return <WalletCredentialDetailView detail={detail} />;
}

export function mapCredentialDetailError(error: unknown): HolderCredentialDetailError {
  if (error instanceof Error && error.message.includes('no es válida')) {
    return {
      title: 'No pudimos mostrar la credencial',
      message: 'La credencial solicitada no es válida.',
      retryable: false,
      diagnostic: null
    };
  }

  if (error instanceof IncompatiblePayloadError) {
    return {
      title: 'No pudimos cargar correctamente la información de esta credencial',
      message: 'Volvé a intentar en unos instantes.',
      retryable: true,
      diagnostic: error.diagnostic
    };
  }

  if (error instanceof ApiError) {
    if (error.status === 404) {
      return {
        title: 'No pudimos mostrar la credencial',
        message: 'No encontramos esta credencial en tu espacio personal.',
        retryable: false,
        diagnostic: null
      };
    }

    if (error.status === 403) {
      return {
        title: 'No pudimos mostrar la credencial',
        message: 'No tenés acceso a esta credencial.',
        retryable: false,
        diagnostic: null
      };
    }

    if (error.status === 401) {
      return {
        title: 'Tu sesión ya no está disponible',
        message: 'Volvé a iniciar sesión para consultar la credencial.',
        retryable: false,
        diagnostic: null
      };
    }
  }

  return {
    title: 'No pudimos cargar la credencial',
    message: 'Volvé a intentar en unos instantes.',
    retryable: true,
    diagnostic: null
  };
}

export function WalletCredentialDetailView({ detail }: { detail: HolderCredentialDetailVM }) {
  return <section className="grid min-w-0 gap-8 lg:gap-10" aria-labelledby="holder-credential-title">
    <BackLink />
    <PublicSharePanel title="Compartir credencial" sharePath={`/verify?credential=${encodeURIComponent(detail.credentialReference)}`} credentialReference={detail.credentialReference} description="Cualquier persona con este enlace podrá consultar la información pública verificable de esta credencial." />
    <Card className="min-w-0 overflow-hidden border-brand-700 shadow-sm"><div className={detail.status === 'revoked' ? 'h-1 bg-status-error' : 'h-1 bg-teal-700'} /><CardHeader className="gap-4 sm:p-8"><div className="flex flex-wrap items-center gap-2"><Badge variant={detail.status === 'revoked' ? 'outline' : 'secondary'}>{detail.statusLabel}</Badge><Badge variant="outline">{detail.typeLabel}</Badge></div><div className="min-w-0"><p className="text-sm font-semibold text-teal-700">Credencial formativa</p><h1 id="holder-credential-title" className="mt-1 break-words text-3xl font-bold tracking-tight text-text-strong">{detail.title}</h1><p className="mt-4 max-w-[var(--traza-holder-narrative-width)] leading-7 text-text-muted">Esta credencial fue emitida por la institución indicada. Scope permite consultar su integridad y su aporte formativo.</p></div></CardHeader></Card>
    {detail.status === 'revoked' ? <FeedbackAlert variant="warning" title="Esta credencial está revocada">{detail.revocationReason ?? 'La institución emisora registró esta credencial como revocada.'}</FeedbackAlert> : null}
    <Card className="min-w-0"><CardHeader className="flex-row items-center gap-3"><Landmark aria-hidden="true" className="size-5 shrink-0 text-teal-700" /><h2 className="min-w-0 text-lg font-semibold text-text-strong">Identidad de la credencial</h2></CardHeader><CardContent className="grid min-w-0 gap-4 text-sm sm:grid-cols-2"><ReadField label="Emitida por" value={detail.issuerName} /><ReadField label="DID institucional" value={detail.issuerDid ?? 'DID no disponible'} mono /><ReadField label="Titular" value={detail.holderLabel ?? detail.holderEmail ?? 'Titular asociado'} /><ReadField label="Fecha de emisión" value={detail.issuedAtLabel ?? 'No disponible'} /></CardContent></Card>
    <FormativeContribution detail={detail} />
    <Card className="min-w-0"><CardHeader className="flex-row items-center gap-3"><FileText aria-hidden="true" className="size-5 shrink-0 text-teal-700" /><div className="min-w-0"><h2 className="text-lg font-semibold text-text-strong">Fuentes de respaldo</h2><p className="mt-1 text-sm text-text-muted">La evidencia se muestra solo en modo lectura.</p></div></CardHeader><CardContent className="grid min-w-0 gap-4 sm:grid-cols-2">{detail.documentEvidence ? <div className="min-w-0 rounded-control bg-surface-muted p-4 text-sm"><p className="break-words font-semibold text-text-strong">{detail.documentEvidence.originalFileName}</p><p className="mt-2 break-words text-text-muted">{detail.documentEvidence.mimeType} · {detail.documentEvidence.sizeLabel}</p><p className="mt-2 break-all font-mono text-xs text-text-muted">Huella: {detail.documentEvidence.sha256Short}</p><p className="mt-2 text-text-muted">Cargada el {detail.documentEvidence.uploadedAtLabel}</p></div> : <EmptyReadOnly title="No hay documento disponible" text="No hay evidencia documental disponible para mostrar." />}{detail.textEvidence ? <div className="min-w-0 rounded-control bg-surface-muted p-4 text-sm"><p className="break-words font-semibold text-text-strong">{detail.textEvidence.label ?? 'Fuente textual'}</p><p className="mt-2 line-clamp-4 break-words leading-6 text-text-muted">{detail.textEvidence.preview}</p><p className="mt-2 break-all font-mono text-xs text-text-muted">Huella: {detail.textEvidence.sha256Short}</p><p className="mt-2 text-text-muted">Registrada el {detail.textEvidence.submittedAtLabel}</p></div> : <EmptyReadOnly title="No hay fuente textual disponible" text="No hay evidencia textual disponible para mostrar." />}</CardContent></Card>
    <IntegrityCard detail={detail} />
  </section>;
}

function IntegrityCard({ detail }: { detail: HolderCredentialDetailVM }) {
  return <Card className="min-w-0"><CardHeader className="flex-row items-center gap-3"><Fingerprint aria-hidden="true" className="size-5 shrink-0 text-teal-700" /><div className="min-w-0"><h2 className="text-lg font-semibold text-text-strong">Evidencia de integridad</h2><p className="mt-1 text-sm text-text-muted">Registro técnico de la credencial emitida.</p></div></CardHeader><CardContent className="grid min-w-0 gap-4 text-sm">{detail.integrity.canonicalHashShort ? <><ReadField label="Huella canónica" value={detail.integrity.canonicalHashShort} mono /><ReadField label="Versión de canonicalización" value={detail.integrity.canonicalizationVersion} /></> : null}{detail.integrity.records.length > 0 ? detail.integrity.records.map((record, index) => <div key={`${record.txHashShort}-${index}`} className="min-w-0 rounded-control bg-surface-muted p-4"><p className="break-words font-semibold text-text-strong">{record.networkLabel}</p><p className="mt-2 break-words text-text-muted">Red técnica {record.chainId} · {record.statusLabel}</p><p className="mt-2 break-all font-mono text-xs text-text-muted">Registro: {record.txHashShort}</p><p className="mt-2 text-text-muted">Registrado el {record.registeredAtLabel}</p></div>) : <p className="leading-6 text-text-muted">La credencial fue emitida, pero no hay evidencia técnica disponible para mostrar.</p>}<p className="text-xs leading-5 text-text-subtle">La evidencia de integridad registra datos técnicos de emisión. La validez académica depende de la institución emisora.</p></CardContent></Card>;
}

function FormativeContribution({ detail }: { detail: HolderCredentialDetailVM }) {
  const hasCourseDeclaredData = detail.type === 'course' && (
    detail.subject.platformName !== null ||
    detail.subject.modality !== null ||
    detail.subject.externalUrl !== null
  );

  return <Card className="min-w-0"><CardHeader className="flex-row items-center gap-3"><BookOpenCheck aria-hidden="true" className="size-5 shrink-0 text-teal-700" /><div className="min-w-0"><h2 className="text-lg font-semibold text-text-strong">Aporte formativo de esta credencial</h2><p className="mt-1 text-sm text-text-muted">Información emitida y, cuando existe, una interpretación asistida de su evidencia.</p></div></CardHeader><CardContent className="grid min-w-0 gap-6"><section className="min-w-0"><h3 className="text-sm font-semibold text-text-strong">Información emitida por la institución</h3><div className="mt-3 grid min-w-0 gap-4 sm:grid-cols-2"><ReadField label="Institución" value={detail.subject.institutionName ?? detail.issuerName} /><ReadField label="Programa o carrera" value={detail.subject.programName} /><ReadField label="Período académico" value={detail.subject.academicPeriod} /><ReadField label="Fecha de finalización" value={detail.subject.completionDate} /><ReadField label="Calificación" value={detail.subject.grade} /><ReadField label="Horas oficiales declaradas" value={detail.hoursLabel} /></div>{detail.description ? <p className="mt-4 max-w-[var(--traza-holder-narrative-width)] break-words text-sm leading-6 text-text-muted">{detail.description}</p> : null}<div className="mt-5 grid min-w-0 gap-5 lg:grid-cols-3"><HolderDeclaredTextList title="Habilidades declaradas" items={detail.subject.skills} /><HolderDeclaredTextList title="Competencias" items={detail.subject.competencies} /><HolderDeclaredTextList title="Resultados de aprendizaje" items={detail.subject.learningOutcomes} /></div></section>{hasCourseDeclaredData ? <CourseDeclaredDataSection subject={detail.subject} /> : null}{detail.analysis ? <section className="min-w-0 border-t border-border-default pt-5"><div className="flex min-w-0 items-start gap-3"><BrainCircuit aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-teal-700" /><div className="min-w-0"><h3 className="font-semibold text-text-strong">Interpretación asistida por IA</h3><p className="mt-1 text-sm text-text-muted">{detail.analysis.statusLabel} · {detail.analysis.analyzedAtLabel}</p></div></div><p className="mt-3 max-w-[var(--traza-holder-narrative-width)] break-words text-sm leading-6 text-text-muted">Este análisis organiza información detectada en la evidencia. No modifica ni reemplaza los datos emitidos por la institución.</p><div className="mt-4 grid min-w-0 gap-5 lg:grid-cols-3"><HolderTaxonomyList title="Áreas detectadas" items={detail.analysis.areas} /><HolderTaxonomyList title="Habilidades detectadas" items={detail.analysis.skills} /><HolderTaxonomyList title="Conceptos detectados" items={detail.analysis.concepts} /></div>{detail.analysis.confidenceLabel ? <p className="mt-4 text-sm text-text-muted">Confianza del análisis: {detail.analysis.confidenceLabel}.</p> : null}{detail.analysis.qualityFlags.length > 0 ? <p className="mt-2 break-words text-sm leading-6 text-text-muted">Observaciones: {detail.analysis.qualityFlags.join(', ')}.</p> : null}</section> : <section className="border-t border-border-default pt-5"><h3 className="font-semibold text-text-strong">Interpretación asistida por IA</h3><p className="mt-2 text-sm leading-6 text-text-muted">No hay análisis disponible para esta credencial.</p></section>}</CardContent></Card>;
}

function CourseDeclaredDataSection({ subject }: { subject: HolderCredentialDetailVM['subject'] }) {
  return <section className="min-w-0 border-t border-border-default pt-5">
    <h3 className="text-sm font-semibold text-text-strong">Información declarada del curso</h3>
    <p className="mt-1 text-sm text-text-muted">Estos datos fueron declarados por la institución emisora de la credencial.</p>
    <div className="mt-3 grid min-w-0 gap-4 sm:grid-cols-2">
      <ReadField label="Plataforma" value={subject.platformName} />
      <ReadField label="Modalidad" value={subject.modality} />
    </div>
    {subject.externalUrl ? (
      <div className="mt-4">
        <p className="text-xs font-semibold tracking-wide text-text-muted uppercase">URL del curso o certificado</p>
        <a
          href={subject.externalUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-1 inline-block break-words font-medium text-brand-700 underline underline-offset-4"
        >
          {subject.externalUrl}
        </a>
        <p className="mt-1 text-xs text-text-subtle">Enlace declarado por la institución emisora. No implica verificación oficial externa.</p>
      </div>
    ) : null}
  </section>;
}

function ReadField({ label, value, mono = false }: { label: string; value: string | null; mono?: boolean }) { if (!value) return null; return <div className="min-w-0"><p className="text-xs font-semibold tracking-wide text-text-muted uppercase">{label}</p><p className={`mt-1 min-w-0 text-text-strong ${mono ? 'break-all font-mono text-xs' : 'break-words font-medium'}`}>{value}</p></div>; }
function EmptyReadOnly({ title, text }: { title: string; text: string }) { return <div className="rounded-control border border-dashed border-border-strong p-4 text-sm"><p className="font-semibold text-text-strong">{title}</p><p className="mt-2 leading-6 text-text-muted">{text}</p></div>; }
function BackLink() { return <Button asChild variant="ghost" className="w-fit"><Link href="/wallet/credentials"><ArrowLeft aria-hidden="true" />Volver a mis credenciales</Link></Button>; }

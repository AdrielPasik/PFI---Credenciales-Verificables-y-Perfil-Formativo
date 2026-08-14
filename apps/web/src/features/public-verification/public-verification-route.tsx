'use client';

import { Fingerprint, Landmark, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useEffect, useRef, useState } from 'react';

import { BrandMark } from '@/components/brand/brand-mark';
import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getPublicCredentialVerificationRequest } from '@/lib/api/public-verification-api';
import { mapPublicVerificationError } from '@/lib/errors/public-verification-error-mapper';
import { normalizePublicCredentialReference } from '@/lib/public-verification/reference-normalization';
import type { PublicCredentialVerificationVM, PublicVerificationFeedback } from '@/models/public-verification';

type VerificationState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; verification: PublicCredentialVerificationVM }
  | { kind: 'error'; feedback: PublicVerificationFeedback };

export function PublicVerificationRoute() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryReference = searchParams.get('credential') ?? '';
  const [input, setInput] = useState(queryReference);
  const [state, setState] = useState<VerificationState>({ kind: 'idle' });
  const loadedReference = useRef<string | null>(null);

  async function verify(reference: string) {
    setState({ kind: 'loading' });
    try {
      const verification = await getPublicCredentialVerificationRequest(reference);
      setState({ kind: 'ready', verification });
    } catch (error) {
      setState({ kind: 'error', feedback: mapPublicVerificationError(error) });
    }
  }

  useEffect(() => {
    const reference = normalizePublicCredentialReference(queryReference);
    if (!reference || loadedReference.current === reference) return;

    loadedReference.current = reference;
    setInput(reference);
    void verify(reference);
  }, [queryReference]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reference = normalizePublicCredentialReference(input);
    if (!reference) {
      setState({ kind: 'error', feedback: { code: 'invalid_input', message: 'Revisá el código o enlace ingresado.' } });
      return;
    }

    loadedReference.current = reference;
    setInput(reference);
    router.replace(`/verify?credential=${encodeURIComponent(reference)}`);
    void verify(reference);
  }

  return <main className="min-h-svh bg-canvas px-4 py-6 sm:px-8 sm:py-10"><div className="mx-auto grid w-full max-w-4xl gap-8"><header className="flex flex-wrap items-center justify-between gap-4"><BrandMark descriptor="Verificación pública" /><Button asChild size="sm" variant="secondary"><Link href="/login">Volver a iniciar sesión</Link></Button></header><section className="grid gap-6" aria-labelledby="verify-title"><div className="max-w-2xl"><p className="text-sm font-semibold text-teal-700">Consulta pública</p><h1 id="verify-title" className="mt-2 text-3xl font-bold tracking-tight text-text-strong sm:text-4xl">Verificar una credencial</h1><p className="mt-3 leading-7 text-text-muted">Ingresá el código o enlace de una credencial emitida en Traza para consultar su estado de verificación.</p></div><Card className="border-border-strong shadow-sm"><CardContent className="pt-5 sm:p-6"><form className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={handleSubmit} noValidate><div className="grid gap-2"><Label htmlFor="public-credential-reference">Código o enlace de credencial</Label><Input id="public-credential-reference" value={input} onChange={(event) => setInput(event.target.value)} aria-describedby="public-credential-reference-help" placeholder="Pegá un código o enlace" autoComplete="off" disabled={state.kind === 'loading'} /><p id="public-credential-reference-help" className="text-sm text-text-muted">Solo se consulta el estado público de credenciales emitidas o revocadas.</p></div><Button type="submit" disabled={state.kind === 'loading'}>{state.kind === 'loading' ? 'Verificando...' : 'Verificar'}</Button></form></CardContent></Card>{state.kind === 'error' ? <FeedbackAlert variant="error" title="No pudimos verificar la credencial">{state.feedback.message}</FeedbackAlert> : null}{state.kind === 'ready' ? <PublicVerificationResult verification={state.verification} /> : null}</section></div></main>;
}

export function PublicVerificationResult({ verification }: { verification: PublicCredentialVerificationVM }) {
  const revoked = verification.status === 'revoked';
  const record = verification.integrity.latestBlockchainRecord;

  return <section className="grid gap-6" aria-live="polite" aria-labelledby="verification-result-title"><Card className={revoked ? 'border-status-warning' : 'border-teal-700'}><CardHeader className="gap-4 sm:p-7"><div className="flex flex-wrap items-center gap-2"><Badge variant={revoked ? 'outline' : 'secondary'}>{verification.statusLabel}</Badge><Badge variant="outline">{verification.typeLabel}</Badge></div><div><p className="text-sm font-semibold text-teal-700">Resultado de verificación</p><h2 id="verification-result-title" className="mt-1 text-2xl font-bold tracking-tight text-text-strong">{revoked ? 'Credencial revocada' : 'Credencial emitida'}</h2><p className="mt-3 max-w-3xl leading-7 text-text-muted">{verification.verification.summary}</p></div></CardHeader></Card>{revoked ? <FeedbackAlert variant="warning" title="Esta credencial no debe considerarse vigente">{verification.revocationReason ?? 'La credencial fue revocada por el emisor.'}</FeedbackAlert> : null}<div className="grid gap-6 lg:grid-cols-2"><Card><CardHeader className="flex-row items-center gap-3"><Landmark aria-hidden="true" className="size-5 text-teal-700" /><h3 className="text-lg font-semibold text-text-strong">Credencial e institución</h3></CardHeader><CardContent className="grid gap-4 text-sm"><ReadField label="Credencial" value={verification.title} /><ReadField label="Tipo" value={verification.typeLabel} /><ReadField label="Emisor" value={verification.issuerName} /><ReadField label="DID del emisor" value={verification.issuerDid ?? 'DID no disponible'} mono /><ReadField label="Fecha de emisión" value={verification.issuedAtLabel ?? 'No disponible'} />{revoked ? <ReadField label="Fecha de revocación" value={verification.revokedAtLabel ?? 'No disponible'} /> : null}</CardContent></Card><Card><CardHeader className="flex-row items-center gap-3"><UserRound aria-hidden="true" className="size-5 text-teal-700" /><h3 className="text-lg font-semibold text-text-strong">Titular asociado</h3></CardHeader><CardContent className="grid gap-4 text-sm"><ReadField label="Titular" value={verification.holderLabel ?? 'Información no disponible'} /><ReadField label="DID del titular" value={verification.holderDid ?? 'DID no disponible'} mono /></CardContent></Card></div><Card><CardHeader className="flex-row items-center gap-3"><Fingerprint aria-hidden="true" className="size-5 text-teal-700" /><div><h3 className="text-lg font-semibold text-text-strong">Evidencia de integridad</h3><p className="mt-1 text-sm text-text-muted">Registro técnico de emisión, sin consulta de blockchain en vivo.</p></div></CardHeader><CardContent className="grid gap-4 text-sm sm:grid-cols-2"><ReadField label="Huella canónica" value={verification.canonicalHashShort ?? 'No disponible'} mono /><ReadField label="Versión de canonicalización" value={verification.canonicalizationVersion ?? 'No disponible'} />{record ? <><ReadField label="Red" value={record.networkLabel} /><ReadField label="Cadena" value={String(record.chainId)} /><ReadField label="Registro técnico" value={record.txHashShort ?? 'No disponible'} mono /><ReadField label="Estado del registro" value={record.statusLabel} /><ReadField label="Registrado" value={record.registeredAtLabel ?? 'No disponible'} /></> : <p className="leading-6 text-text-muted sm:col-span-2">No hay evidencia técnica de registro disponible para mostrar.</p>}<p className="text-xs leading-5 text-text-subtle sm:col-span-2">La verificación confirma el estado técnico registrado por Traza. La validez académica o institucional depende del emisor.</p></CardContent></Card></section>;
}

function ReadField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><p className="text-xs font-semibold tracking-wide text-text-muted uppercase">{label}</p><p className={mono ? 'mt-1 break-all font-mono text-xs text-text-strong' : 'mt-1 leading-6 text-text-strong'}>{value}</p></div>;
}

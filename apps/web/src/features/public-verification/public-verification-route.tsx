'use client';

import { Fingerprint, Landmark } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useEffect, useRef, useState } from 'react';

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
      setState({ kind: 'ready', verification: await getPublicCredentialVerificationRequest(reference) });
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

  return (
    <main className="min-h-svh bg-canvas px-4 py-6 sm:px-8 sm:py-10 lg:py-12">
      <div className="mx-auto grid w-full max-w-6xl gap-10 lg:gap-14">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border-default pb-5 sm:pb-6">
          <BrandMark lightLogo descriptor="Verificación pública" />
          <Button asChild size="sm" variant="secondary">
            <Link href="/login">Volver a iniciar sesión</Link>
          </Button>
        </header>

        <section className="grid gap-8 lg:grid-cols-[minmax(15rem,0.72fr)_minmax(0,1.28fr)] lg:items-start lg:gap-12" aria-labelledby="verify-title">
          <div className="border-l-2 border-brand-accent py-1 pl-5 sm:pl-6">
            <p className="text-xs font-semibold tracking-[0.16em] text-teal-700 uppercase">Consulta pública</p>
            <h1 id="verify-title" className="mt-3 text-3xl leading-[1.1] font-bold tracking-[-0.04em] text-text-strong sm:text-4xl">
              Verificar una credencial
            </h1>
            <p className="mt-4 max-w-md leading-7 text-text-muted">
              Consultá el estado y la evidencia disponible de una credencial emitida en Scope.
            </p>
          </div>

          <Card className="overflow-hidden border-border-strong bg-surface shadow-lg shadow-brand-900/6">
            <div aria-hidden="true" className="h-1 bg-brand-accent" />
            <CardContent className="pt-5 sm:p-7">
              <form className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={handleSubmit} noValidate>
                <div className="grid gap-2">
                  <Label htmlFor="public-credential-reference">Código o enlace de credencial</Label>
                  <Input id="public-credential-reference" value={input} onChange={(event) => setInput(event.target.value)} aria-describedby="public-credential-reference-help" placeholder="Ej: enlace de verificación o código de credencial" autoComplete="off" disabled={state.kind === 'loading'} />
                  <p id="public-credential-reference-help" className="text-sm leading-6 text-text-muted">
                    Usá el enlace compartido por el titular o la institución emisora. La huella canónica se muestra después como evidencia técnica de integridad.
                  </p>
                </div>
                <Button type="submit" disabled={state.kind === 'loading'}>
                  {state.kind === 'loading' ? 'Verificando…' : 'Verificar credencial'}
                </Button>
              </form>
            </CardContent>
          </Card>

          {state.kind === 'error' ? <div className="lg:col-span-2"><FeedbackAlert variant="error" title="No pudimos verificar la credencial">{state.feedback.message}</FeedbackAlert></div> : null}
          {state.kind === 'ready' ? <div className="lg:col-span-2"><PublicVerificationResult verification={state.verification} /></div> : null}
        </section>
      </div>
    </main>
  );
}

export function PublicVerificationResult({ verification }: { verification: PublicCredentialVerificationVM }) {
  const revoked = verification.status === 'revoked';
  const record = verification.integrity.latestBlockchainRecord;
  const networkExplanation = record ? networkExplanationFor(record.networkLabel) : null;

  return <section className="grid gap-6" aria-live="polite" aria-labelledby="verification-result-title">
    <Card className={revoked ? 'border-status-warning shadow-sm' : 'overflow-hidden border-teal-700 shadow-sm'}>
      <CardHeader className="gap-4 sm:p-7">
        <div className="flex flex-wrap items-center gap-2"><Badge variant={revoked ? 'outline' : 'secondary'}>{verification.statusLabel}</Badge><Badge variant="outline">{verification.typeLabel}</Badge></div>
        <div><p className="text-sm font-semibold text-teal-700">Resultado de verificación</p><h2 id="verification-result-title" className="mt-1 text-2xl font-bold tracking-tight text-text-strong">{revoked ? 'Credencial revocada' : 'Credencial emitida'}</h2><p className="mt-3 max-w-3xl leading-7 text-text-muted">{verification.verification.summary}</p></div>
      </CardHeader>
    </Card>

    {revoked ? <FeedbackAlert variant="warning" title="Esta credencial no debe considerarse vigente">{verification.revocationReason ?? 'La credencial fue revocada por el emisor.'}</FeedbackAlert> : null}

    <Card className="min-w-0">
      <CardHeader className="flex-row items-center gap-3"><Landmark aria-hidden="true" className="size-5 text-teal-700" /><h3 className="text-lg font-semibold text-text-strong">Datos de la credencial</h3></CardHeader>
      <CardContent className="grid gap-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <ReadField label="Credencial" value={verification.title} />
        <ReadField label="Tipo" value={verification.typeLabel} />
        <ReadField label="Emisor" value={verification.issuerName} />
        <ReadField label="DID del emisor" value={verification.issuerDid ?? 'DID no disponible'} mono />
        <ReadField label="Titular" value={verification.holderLabel ?? 'Información no disponible'} />
        <ReadField label="DID del titular" value={verification.holderDid ?? 'DID no disponible'} mono />
        <ReadField label="Fecha de emisión" value={verification.issuedAtLabel ?? 'No disponible'} />
        {revoked ? <ReadField label="Fecha de revocación" value={verification.revokedAtLabel ?? 'No disponible'} /> : null}
      </CardContent>
    </Card>

    <Card className="min-w-0 border-border-default bg-surface-muted shadow-none">
      <CardHeader className="flex-row items-start gap-3">
        <Fingerprint aria-hidden="true" className="size-5 shrink-0 text-teal-700" />
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-text-strong">Evidencia técnica de integridad</h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-text-muted">La huella canónica es un identificador criptográfico calculado por Scope a partir de la versión emitida de la credencial. Si los datos emitidos cambian, la huella resultante también cambia.</p>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-text-muted">No es el código que se comparte para verificar. Para verificar se usa el enlace o la referencia de credencial.</p>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 text-sm sm:grid-cols-2">
        <ReadField label="Huella canónica" value={verification.canonicalHashShort ?? 'No disponible'} mono />
        <ReadField label="Versión de canonicalización" value={verification.canonicalizationVersion ?? 'No disponible'} />
        {record ? <>
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide text-text-muted uppercase">Red registrada</p>
            <p className="mt-1 font-semibold text-text-strong">{record.networkLabel}</p>
            {networkExplanation ? <p className="mt-1 text-sm text-text-muted">{networkExplanation}</p> : null}
          </div>
          <ReadField label="Estado del registro" value={record.statusLabel} />
          <ReadField label="Chain ID" value={String(record.chainId)} />
          <ReadField label="Registro técnico" value={record.txHashShort ?? 'No disponible'} mono />
          <ReadField label="Fecha de registro" value={record.registeredAtLabel ?? 'No disponible'} />
        </> : <p className="leading-6 text-text-muted sm:col-span-2">No hay un registro técnico de red disponible para mostrar.</p>}
        <p className="text-xs leading-5 text-text-subtle sm:col-span-2">El registro técnico conserva evidencia de integridad. La validez académica o institucional depende del emisor.</p>
      </CardContent>
    </Card>
  </section>;
}

function networkExplanationFor(networkLabel: string) {
  if (networkLabel === 'Entorno técnico/demo') {
    return 'Este registro corresponde a un entorno técnico de demostración.';
  }
  if (networkLabel === 'Testnet') {
    return 'Este registro corresponde a una red de pruebas.';
  }
  return null;
}

function ReadField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) { return <div className="min-w-0"><p className="text-xs font-semibold tracking-wide text-text-muted uppercase">{label}</p><p className={mono ? 'mt-1 break-all font-mono text-xs text-text-strong' : 'mt-1 break-words leading-6 text-text-strong'}>{value}</p></div>; }

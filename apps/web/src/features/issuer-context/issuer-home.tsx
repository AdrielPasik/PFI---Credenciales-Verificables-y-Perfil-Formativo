'use client';

import {
  Check,
  Copy,
  FilePlus2,
  Settings2,
  ShieldCheck
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { ShellBand } from '@/components/layout/shell-band';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { getIssuerTechnicalIdentityRequest } from '@/lib/api/issuer-technical-identity-api';
import { useSession } from '@/lib/session/session-provider';
import type { IssuerMembershipSummaryVM } from '@/models/issuer-context';
import type { IssuerTechnicalIdentityVM } from '@/models/issuer-technical-identity';

const ISSUANCE_STEPS = [
  { title: 'Titular', description: 'Confirmá la identidad de quien recibe la credencial.' },
  { title: 'Logro', description: 'Elegí el curso, la asignatura o el título que se acredita.' },
  { title: 'Evidencia', description: 'Sumá documentos o texto que respalden el logro.' },
  { title: 'Emisión', description: 'Firmá la credencial y anclá su evidencia de integridad.' }
] as const;

export function IssuerHome({
  membership
}: {
  membership: IssuerMembershipSummaryVM;
}) {
  const isAdmin = membership.role === 'admin';

  return (
    <>
      <ShellBand labelledBy="issuer-home-title">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.16em] text-teal-100 uppercase">
              Institución activa
            </p>
            <h1
              id="issuer-home-title"
              className="mt-2 max-w-4xl text-3xl leading-tight font-bold tracking-tight text-balance sm:text-4xl"
            >
              {membership.issuerName}
            </h1>
            <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2">
              <Badge variant="secondary">
                <ShieldCheck aria-hidden="true" />
                {membership.issuerAuthorizationLabel}
              </Badge>
              <Badge variant="outline" className="border-white/25 bg-transparent text-white">
                {membership.roleLabel}
              </Badge>
              <IssuerDid did={membership.issuerDid} />
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <Button asChild variant="inverseAction">
              <Link href="/issuer/credentials/new">
                <FilePlus2 aria-hidden="true" />
                Crear credencial
              </Link>
            </Button>
            {isAdmin ? (
              <Button asChild variant="inverse">
                <Link href="/issuer/configuracion-tecnica">
                  <Settings2 aria-hidden="true" />
                  {'Configuración técnica'}
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      </ShellBand>

      <div className="band-overlap grid items-start gap-5 lg:grid-cols-3 lg:gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="gap-1 pb-2 sm:pb-3">
            <p className="text-xs font-semibold tracking-wider text-accent uppercase">
              Cómo se emite
            </p>
            <h2 className="text-xl font-semibold text-text-strong">Flujo de una credencial</h2>
          </CardHeader>
          <CardContent>
            <ol className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              {ISSUANCE_STEPS.map((step, index) => (
                <li key={step.title} className="flex min-w-0 gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-7 shrink-0 items-center justify-center rounded-pill bg-accent-tint text-xs font-bold text-accent"
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-text-strong">{step.title}</p>
                    <p className="mt-0.5 text-sm leading-6 text-text-muted">{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <OperationalStatusCard
          issuerReference={membership.issuerReference}
          canViewTechnicalIdentity={isAdmin}
        />
      </div>
    </>
  );
}

function IssuerDid({ did }: { did: string | null }) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'selected'>('idle');
  const valueRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (copy === 'idle') return;
    const timer = window.setTimeout(() => setCopy('idle'), 2500);
    return () => window.clearTimeout(timer);
  }, [copy]);

  if (did === null) {
    return <span className="text-xs text-brand-100">DID no disponible</span>;
  }

  const value = did;
  async function copyDid() {
    try {
      await navigator.clipboard.writeText(value);
      setCopy('copied');
    } catch {
      // Sin permiso de portapapeles (politica del navegador): el DID queda
      // seleccionado para copiarlo a mano, y se avisa.
      const node = valueRef.current;
      const selection = window.getSelection();
      if (node && selection) {
        const range = document.createRange();
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      setCopy('selected');
    }
  }

  const label =
    copy === 'copied' ? 'DID copiado' : copy === 'selected' ? 'DID seleccionado para copiar' : 'Copiar DID';

  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-control border border-white/15 bg-white/5 py-0.5 pr-0.5 pl-2.5">
      <span className="sr-only">DID institucional: </span>
      <span ref={valueRef} className="min-w-0 truncate font-mono text-xs text-brand-100">{value}</span>
      <button
        type="button"
        onClick={() => void copyDid()}
        aria-label={label}
        title={label}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-[calc(var(--radius-control)-2px)] text-brand-100 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        {copy === 'copied' ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
      </button>
      <span role="status" className="sr-only">
        {copy === 'copied'
          ? 'DID copiado'
          : copy === 'selected'
            ? 'No se pudo copiar automáticamente. El DID quedó seleccionado para copiarlo.'
            : ''}
      </span>
    </span>
  );
}

type TechnicalIdentityState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: IssuerTechnicalIdentityVM }
  | { kind: 'error' };

const DID_STATUS: Record<
  NonNullable<IssuerTechnicalIdentityVM['technicalIdentity']>['status'],
  { label: string; tone: Tone }
> = {
  active: { label: 'Configurado', tone: 'valid' },
  unconfigured: { label: 'Sin configurar', tone: 'warning' },
  rotation_required: { label: 'Requiere rotación', tone: 'warning' },
  disabled: { label: 'Deshabilitado', tone: 'error' }
};

const WALLET_STATUS: Record<
  NonNullable<IssuerTechnicalIdentityVM['anchorSigner']>['status'],
  { label: string; tone: Tone }
> = {
  active: { label: 'Activa', tone: 'valid' },
  retired: { label: 'Retirada', tone: 'warning' },
  compromised: { label: 'Comprometida', tone: 'error' }
};

type Tone = 'valid' | 'warning' | 'error';

const TONE_CLASSES: Record<Tone, string> = {
  valid: 'border-transparent bg-status-valid-soft text-status-valid',
  warning: 'border-transparent bg-status-warning-soft text-status-warning',
  error: 'border-transparent bg-status-error-soft text-status-error'
};

/**
 * Estado de la identidad tecnica, leido del MISMO endpoint que la pantalla de
 * configuracion tecnica (`GET /issuers/:id/technical-identity`). Ese endpoint
 * solo responde a administradores del emisor: para otros roles no se consulta.
 */
function OperationalStatusCard({
  issuerReference,
  canViewTechnicalIdentity
}: {
  issuerReference: string;
  canViewTechnicalIdentity: boolean;
}) {
  const { requestAuthenticated } = useSession();
  const [state, setState] = useState<TechnicalIdentityState>({ kind: 'loading' });

  useEffect(() => {
    if (!canViewTechnicalIdentity) return;
    const controller = new AbortController();
    getIssuerTechnicalIdentityRequest(requestAuthenticated, issuerReference, {
      signal: controller.signal
    })
      .then((data) => setState({ kind: 'ready', data }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: 'error' });
      });
    return () => controller.abort();
    // `requestAuthenticated` cambia de identidad en cada render del provider;
    // la carga depende SOLO del issuer (igual que la configuracion tecnica).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issuerReference, canViewTechnicalIdentity]);

  return (
    <Card>
      <CardHeader className="gap-1 pb-2 sm:pb-3">
        <p className="text-xs font-semibold tracking-wider text-accent uppercase">
          Estado operativo
        </p>
        <h2 className="text-xl font-semibold text-text-strong">Identidad técnica</h2>
      </CardHeader>
      <CardContent className="text-sm">
        {!canViewTechnicalIdentity ? (
          <p className="leading-6 text-text-muted">
            La identidad técnica de la institución la gestiona un administrador.
          </p>
        ) : state.kind === 'loading' ? (
          <p role="status" className="leading-6 text-text-muted">
            Consultando la identidad técnica…
          </p>
        ) : state.kind === 'error' ? (
          <p role="alert" className="leading-6 text-text-muted">
            No se pudo consultar la identidad técnica.
          </p>
        ) : (
          <dl className="divide-y divide-border-default">
            <StatusRow
              label="DID"
              status={
                state.data.technicalIdentity
                  ? DID_STATUS[state.data.technicalIdentity.status]
                  : DID_STATUS.unconfigured
              }
            />
            <StatusRow
              label="Wallet"
              status={
                state.data.anchorSigner
                  ? WALLET_STATUS[state.data.anchorSigner.status]
                  : { label: 'Sin configurar', tone: 'warning' }
              }
            />
            <StatusRow
              label="Emisión"
              status={
                state.data.readyToIssue
                  ? { label: 'Lista para emitir', tone: 'valid' }
                  : { label: 'No lista para emitir', tone: 'warning' }
              }
            />
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function StatusRow({ label, status }: { label: string; status: { label: string; tone: Tone } }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-text-muted">{label}</dt>
      <dd>
        <Badge variant="outline" className={TONE_CLASSES[status.tone]}>
          {status.label}
        </Badge>
      </dd>
    </div>
  );
}

'use client';

import { ArrowRight, ChevronDown, FileCheck2, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { ShellBand } from '@/components/layout/shell-band';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ContractDiagnostic, useContractDebugEnabled } from '@/features/holder/contract-diagnostic';
import { HolderProfileCoverageNotice, HolderProfileDetails, HolderProfileEmptyPanel, HolderProfileIntro, HolderProfileMetrics } from '@/features/holder/holder-profile-panel';
import { ObjectiveEntryCard, type LatestObjectiveState } from '@/features/holder/objectives/objective-entry-card';
import { ProfileRebuildAction } from '@/features/holder/profile-rebuild-action';
import { ProfileShareAction } from '@/features/holder/profile-share-action';
import {
  ProfileShareManagement,
  SHARE_MANAGEMENT_SECTION_ID
} from '@/features/holder/profile-share-management';
import { getMyCredentialsRequest, getMyCurrentProfileRequest } from '@/lib/api/holder-api';
import { listMyObjectivesRequest } from '@/lib/api/objectives-api';
import { ApiError, IncompatiblePayloadError, type IncompatiblePayloadDiagnostic } from '@/lib/errors/api-error';
import { useSession } from '@/lib/session/session-provider';
import type { HolderCredentialListItemVM, HolderProfileVM } from '@/models/holder';

export type HolderProfileLoadState =
  | { status: 'loading' }
  | { status: 'ready'; profile: HolderProfileVM }
  | { status: 'empty' }
  | { status: 'error'; message: string; diagnostic?: IncompatiblePayloadDiagnostic | null };

export type HolderCredentialsLoadState =
  | { status: 'loading' }
  | { status: 'ready'; credentials: HolderCredentialListItemVM[] }
  | { status: 'error'; message: string };

export function WalletHomeRoute() {
  return <WalletHomeContent />;
}

export function WalletHomeContent() {
  const { requestAuthenticated, state: sessionState } = useSession();
  const contractDebug = useContractDebugEnabled();
  const [profileState, setProfileState] = useState<HolderProfileLoadState>({ status: 'loading' });
  const [credentialsState, setCredentialsState] = useState<HolderCredentialsLoadState>({ status: 'loading' });
  const [latestObjective, setLatestObjective] = useState<LatestObjectiveState>({ status: 'loading' });
  const [profileRequestVersion, setProfileRequestVersion] = useState(0);
  const holderName = sessionState.status === 'authenticated' ? sessionState.currentUser.displayLabel : null;

  useEffect(() => {
    let active = true;
    void getMyCredentialsRequest(requestAuthenticated)
      .then((credentials) => active && setCredentialsState({ status: 'ready', credentials }))
      .catch((error) => active && setCredentialsState({ status: 'error', message: messageFor(error) }));
    return () => { active = false; };
  }, [requestAuthenticated]);

  useEffect(() => {
    let active = true;
    void getMyCurrentProfileRequest(requestAuthenticated)
      .then((profile) => active && setProfileState(profile ? { status: 'ready', profile } : { status: 'empty' }))
      .catch((error) => active && setProfileState(profileErrorState(error)));
    return () => { active = false; };
  }, [profileRequestVersion, requestAuthenticated]);

  // El objetivo mas reciente sale de la misma lista que /wallet/objectives
  // (orden descendente). Si falla, la tarjeta de objetivos sigue sin ese dato.
  useEffect(() => {
    let active = true;
    void listMyObjectivesRequest(requestAuthenticated)
      .then((objectives) => active && setLatestObjective({ status: 'ready', objective: objectives[0] ?? null }))
      .catch(() => active && setLatestObjective({ status: 'unavailable' }));
    return () => { active = false; };
  }, [requestAuthenticated]);

  function refreshCurrentProfile() {
    setProfileState({ status: 'loading' });
    setProfileRequestVersion((version) => version + 1);
  }

  return (
    <WalletHomeView
      profileState={profileState}
      credentialsState={credentialsState}
      latestObjective={latestObjective}
      holderName={holderName}
      showProfileShare
      onRetryProfile={refreshCurrentProfile}
      onProfileRebuilt={refreshCurrentProfile}
      contractDebug={contractDebug}
    />
  );
}

/**
 * Inicio del titular.
 *
 * - Banda de bienvenida (en el shell, debajo del header): saludo, resumen del
 *   perfil, metricas y acciones principales.
 * - Debajo, montado sobre el borde de la banda: en escritorio, credenciales y
 *   trayectoria a la izquierda; objetivos y perfil publico a la derecha. En el
 *   DOM la columna de seguimiento va primero: en movil (una sola columna) el
 *   objetivo queda antes que el detalle extenso del perfil.
 */
export function WalletHomeView({ profileState, credentialsState, latestObjective, holderName = null, showProfileShare = false, contractDebug = false, onRetryProfile, onProfileRebuilt }: { profileState: HolderProfileLoadState; credentialsState: HolderCredentialsLoadState; latestObjective?: LatestObjectiveState; holderName?: string | null; showProfileShare?: boolean; contractDebug?: boolean; onRetryProfile?: () => void; onProfileRebuilt?: (profile: HolderProfileVM | null) => void }) {
  const credentials = credentialsState.status === 'ready' ? credentialsState.credentials : [];
  const issued = credentials.filter((credential) => credential.status === 'issued');
  const revoked = credentials.filter((credential) => credential.status === 'revoked');
  // P1.1: el fallback manual solo se ofrece en el self-view del holder
  // (showProfileShare) y solo cuando YA sabemos que tiene credenciales
  // issued -- nunca mientras credentialsState todavia esta cargando, y
  // nunca si el holder no tiene ninguna credencial (el empty state
  // orientado a "recibir tu primera credencial" alcanza en ese caso).
  const canOfferManualRebuild =
    showProfileShare && credentialsState.status === 'ready' && issued.length > 0;
  const rebuildAction = onProfileRebuilt ? (
    <ProfileRebuildAction onRebuilt={onProfileRebuilt} />
  ) : null;
  const firstName = greetingName(holderName);
  const profile = profileState.status === 'ready' ? profileState.profile : null;

  return (
    <>
      <ShellBand labelledBy="wallet-home-title">
        <div className="grid min-w-0 gap-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-12">
          <div className="grid min-w-0 gap-5">
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-[0.16em] text-teal-100 uppercase">{firstName ? 'Mi perfil formativo' : 'Espacio personal'}</p>
              <h1 id="wallet-home-title" className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">{firstName ? `Hola, ${firstName}` : 'Mi perfil formativo'}</h1>
            </div>
            {profile ? <HolderProfileIntro profile={profile} /> : <p className="max-w-[var(--traza-holder-narrative-width)] leading-7 text-brand-100/90">Una vista de tu trayectoria construida a partir de tus credenciales formativas y de los análisis disponibles en Scope.</p>}
            {profile ? <HolderProfileMetrics profile={profile} /> : null}
          </div>
          <div className="flex min-w-0 flex-wrap items-start gap-3 lg:justify-end">
            <Button asChild variant="inverseAction"><Link href="/wallet/objectives/new">Analizar un objetivo</Link></Button>
            {profile && showProfileShare ? <ProfileShareAction tone="inverse" /> : null}
            {profile && showProfileShare && onProfileRebuilt ? <div data-testid="profile-rebuild-header-action" className="min-w-0"><ProfileRebuildAction tone="inverse" onRebuilt={onProfileRebuilt} /></div> : null}
          </div>
        </div>
      </ShellBand>

      <div className="band-overlap grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,23rem)] lg:gap-8">
        <aside aria-label="Objetivos y perfil público" className="grid min-w-0 gap-6 lg:col-start-2 lg:row-start-1">
          <ObjectiveEntryCard latest={latestObjective} />
          {/* Administracion de enlaces: cerrado por defecto para no competir con el
              perfil, pero presente. Hasta esta version no habia NINGUNA forma de
              ver los enlaces abiertos ni de darlos de baja. */}
          {profile && showProfileShare ? (
            <details id={SHARE_MANAGEMENT_SECTION_ID} className="group min-w-0 rounded-card border border-border-default bg-surface shadow-card">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-semibold text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring sm:px-6">
                <span className="grid gap-0.5"><span className="text-xs font-semibold tracking-wider text-accent uppercase">Perfil público</span>Enlaces compartidos y permisos</span>
                <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-text-muted transition group-open:rotate-180" />
              </summary>
              <div className="border-t border-border-default px-5 py-5 sm:px-6">
                <ProfileShareManagement />
              </div>
            </details>
          ) : null}
        </aside>

        <div className="grid min-w-0 gap-8 lg:col-start-1 lg:row-start-1">
          {profileState.status === 'loading' ? <LoadingState label="Cargando tu perfil formativo" /> : null}
          {profile ? <HolderProfileCoverageNotice profile={profile} /> : null}
          {profileState.status === 'empty' ? <HolderProfileEmptyPanel action={canOfferManualRebuild ? rebuildAction : null} /> : null}
          {profileState.status === 'error' ? <div className="grid gap-4"><FeedbackAlert variant="warning" title="No pudimos cargar tu perfil formativo">Tus credenciales siguen disponibles. Podés volver a intentar ahora.{contractDebug && profileState.diagnostic ? <ContractDiagnostic diagnostic={profileState.diagnostic} /> : null}</FeedbackAlert><div className="flex flex-wrap gap-3">{onRetryProfile ? <Button type="button" variant="secondary" onClick={onRetryProfile}>Reintentar</Button> : null}{canOfferManualRebuild ? rebuildAction : null}</div></div> : null}

          <section aria-labelledby="wallet-credentials-title" className="min-w-0 rounded-card border border-border-default bg-surface p-5 shadow-card sm:p-6">
            <div className="flex min-w-0 flex-wrap items-end justify-between gap-4">
              <div className="min-w-0 max-w-2xl"><p className="text-xs font-semibold tracking-wider text-accent uppercase">Base de evidencia</p><h2 id="wallet-credentials-title" className="mt-1 text-xl font-semibold tracking-tight text-text-strong">Tus credenciales</h2>{credentialsState.status === 'ready' && credentials.length > 0 ? <p className="mt-1 text-sm text-text-muted">{issued.length} emitidas · {revoked.length} revocadas · {credentials.filter((credential) => credential.hasAnalysis).length} con análisis disponible</p> : null}</div>
              <Button asChild variant="secondary" size="sm"><Link href="/wallet/credentials">Ver todas <ArrowRight aria-hidden="true" /></Link></Button>
            </div>
            <div className="mt-4">
              {credentialsState.status === 'loading' ? <LoadingState label="Cargando credenciales" /> : null}
              {credentialsState.status === 'error' ? <FeedbackAlert variant="error" title="No pudimos cargar tus credenciales">{credentialsState.message}</FeedbackAlert> : null}
              {credentialsState.status === 'ready' && credentials.length === 0 ? <EmptyCredentials /> : null}
              {credentialsState.status === 'ready' && credentials.length > 0 ? <ul className="divide-y divide-border-default border-t border-border-default">{credentials.slice(0, RECENT_CREDENTIALS_LIMIT).map((credential) => <RecentCredentialRow key={credential.credentialReference} credential={credential} />)}</ul> : null}
            </div>
          </section>

          {profile ? <HolderProfileDetails profile={profile} /> : null}
        </div>
      </div>
    </>
  );
}

const RECENT_CREDENTIALS_LIMIT = 3;

function RecentCredentialRow({ credential }: { credential: HolderCredentialListItemVM }) {
  const revokedCredential = credential.status === 'revoked';
  return (
    <li>
      <Link
        href={`/wallet/credentials/${encodeURIComponent(credential.credentialReference)}`}
        className="flex min-w-0 items-center justify-between gap-3 rounded-control px-1 py-3 transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <span className="min-w-0">
          <span className="block truncate font-semibold text-text-strong">{credential.title}</span>
          <span className="block truncate text-sm text-text-muted">{credential.issuerName}{credential.issuedAtLabel ? ` · ${credential.issuedAtLabel}` : ''}</span>
        </span>
        <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
          <Badge variant="outline" className={revokedCredential ? 'border-transparent bg-status-revoked-soft text-status-revoked' : 'border-transparent bg-status-issued-soft text-status-issued'}>{credential.statusLabel}</Badge>
          {credential.hasAnalysis ? <Badge variant="outline" className="hidden border-transparent bg-status-analysis-soft text-status-analysis sm:inline-flex">Con análisis</Badge> : null}
        </span>
      </Link>
    </li>
  );
}

/** Primer nombre para el saludo; sin nombre (la etiqueta cae al email) no hay saludo. */
function greetingName(label: string | null) {
  if (!label || label.includes('@')) return null;
  const first = label.trim().split(/\s+/)[0];
  return first || null;
}

export function EmptyCredentials() { return <Card className="shadow-none"><CardHeader><span className="flex size-11 items-center justify-center rounded-control bg-surface-muted text-accent"><FileCheck2 aria-hidden="true" className="size-5" /></span><h2 className="text-xl font-semibold text-text-strong">Todavía no tenés credenciales formativas</h2></CardHeader><CardContent><p className="text-sm leading-6 text-text-muted">Cuando una institución emita una credencial a tu nombre, aparecerá en este espacio.</p></CardContent></Card>; }
export function LoadingState({ label }: { label: string }) { return <div className="flex min-h-32 items-center justify-center rounded-card border border-border-default bg-surface p-6 text-sm text-text-muted"><LoaderCircle aria-hidden="true" className="mr-2 size-5 animate-spin text-accent" />{label}</div>; }
function messageFor(error: unknown) { if (error instanceof IncompatiblePayloadError) return 'La información disponible no tiene el formato esperado. Intentá nuevamente más tarde.'; if (error instanceof ApiError && error.status === 404) return 'No encontramos información disponible para mostrar.'; return 'No pudimos completar la consulta. Intentá nuevamente más tarde.'; }
function profileErrorState(error: unknown): HolderProfileLoadState {
  return {
    status: 'error',
    message: messageFor(error),
    diagnostic: error instanceof IncompatiblePayloadError ? error.diagnostic : null
  };
}

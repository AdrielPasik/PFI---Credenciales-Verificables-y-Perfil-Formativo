'use client';

import { ArrowRight, FileCheck2, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { HolderCredentialCard } from '@/features/holder/holder-credential-card';
import { ContractDiagnostic, useContractDebugEnabled } from '@/features/holder/contract-diagnostic';
import { HolderProfileDetails, HolderProfileEmptyPanel, HolderProfileSummary } from '@/features/holder/holder-profile-panel';
import { ObjectiveEntryCard } from '@/features/holder/objectives/objective-entry-card';
import { ProfileRebuildAction } from '@/features/holder/profile-rebuild-action';
import { ProfileShareAction } from '@/features/holder/profile-share-action';
import { getMyCredentialsRequest, getMyCurrentProfileRequest } from '@/lib/api/holder-api';
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
  const { requestAuthenticated } = useSession();
  const contractDebug = useContractDebugEnabled();
  const [profileState, setProfileState] = useState<HolderProfileLoadState>({ status: 'loading' });
  const [credentialsState, setCredentialsState] = useState<HolderCredentialsLoadState>({ status: 'loading' });
  const [profileRequestVersion, setProfileRequestVersion] = useState(0);

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

  function refreshCurrentProfile() {
    setProfileState({ status: 'loading' });
    setProfileRequestVersion((version) => version + 1);
  }

  return (
    <WalletHomeView
      profileState={profileState}
      credentialsState={credentialsState}
      showProfileShare
      onRetryProfile={refreshCurrentProfile}
      onProfileRebuilt={refreshCurrentProfile}
      contractDebug={contractDebug}
    />
  );
}

export function WalletHomeView({ profileState, credentialsState, showProfileShare = false, contractDebug = false, onRetryProfile, onProfileRebuilt }: { profileState: HolderProfileLoadState; credentialsState: HolderCredentialsLoadState; showProfileShare?: boolean; contractDebug?: boolean; onRetryProfile?: () => void; onProfileRebuilt?: (profile: HolderProfileVM | null) => void }) {
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
  return (
    <div className="grid min-w-0 gap-10 lg:gap-12">
      <header className="grid min-w-0 gap-5 border-b border-border-default pb-7 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-end">
        <div className="order-0 min-w-0 max-w-[var(--traza-holder-narrative-width)] lg:col-start-1 lg:row-start-1">
          <p className="text-sm font-semibold text-teal-700">Espacio personal</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-text-strong sm:text-4xl">Mi perfil formativo</h1>
          <p className="mt-3 leading-7 text-text-muted">Una vista de tu trayectoria construida a partir de tus credenciales formativas y de los análisis disponibles en Scope.</p>
        </div>
        {profileState.status === 'ready' && showProfileShare ? <>{rebuildAction ? <div data-testid="profile-rebuild-header-action" className="order-2 min-w-0 lg:col-start-3 lg:row-start-1">{rebuildAction}</div> : null}<ProfileShareAction /></> : null}
      </header>
      {profileState.status === 'loading' ? <LoadingState label="Cargando tu perfil formativo" /> : null}
      {profileState.status === 'ready' ? <HolderProfileSummary profile={profileState.profile} /> : null}
      {profileState.status === 'empty' ? <HolderProfileEmptyPanel action={canOfferManualRebuild ? rebuildAction : null} /> : null}
      {profileState.status === 'error' ? <div className="grid gap-4"><FeedbackAlert variant="warning" title="No pudimos cargar tu perfil formativo">Tus credenciales siguen disponibles. Podés volver a intentar ahora.{contractDebug && profileState.diagnostic ? <ContractDiagnostic diagnostic={profileState.diagnostic} /> : null}</FeedbackAlert><div className="flex flex-wrap gap-3">{onRetryProfile ? <Button type="button" variant="secondary" onClick={onRetryProfile}>Reintentar</Button> : null}{canOfferManualRebuild ? rebuildAction : null}</div></div> : null}
      <ObjectiveEntryCard />
      <section aria-labelledby="wallet-credentials-title" className="grid min-w-0 gap-6 border-t border-border-default pt-8">
        <div className="flex min-w-0 flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 max-w-2xl"><p className="text-sm font-semibold text-teal-700">Base de evidencia</p><h2 id="wallet-credentials-title" className="mt-1 text-2xl font-bold tracking-tight text-text-strong">Tus credenciales</h2><p className="mt-2 text-sm leading-6 text-text-muted">Estas credenciales forman la base de evidencia de tu trayectoria.</p></div>
          <Button asChild variant="secondary"><Link href="/wallet/credentials">Ver todas <ArrowRight aria-hidden="true" /></Link></Button>
        </div>
        {credentialsState.status === 'loading' ? <LoadingState label="Cargando credenciales" /> : null}
        {credentialsState.status === 'error' ? <FeedbackAlert variant="error" title="No pudimos cargar tus credenciales">{credentialsState.message}</FeedbackAlert> : null}
        {credentialsState.status === 'ready' && credentials.length === 0 ? <EmptyCredentials /> : null}
        {credentialsState.status === 'ready' && credentials.length > 0 ? <><div className="grid min-w-0 gap-3 sm:grid-cols-3"><SummaryCard label="Emitidas" value={issued.length} /><SummaryCard label="Revocadas" value={revoked.length} /><SummaryCard label="Con análisis disponible" value={credentials.filter((credential) => credential.hasAnalysis).length} /></div><div className="grid min-w-0 gap-5 md:grid-cols-2">{credentials.slice(0, 2).map((credential) => <HolderCredentialCard key={credential.credentialReference} credential={credential} />)}</div></> : null}
      </section>
      {profileState.status === 'ready' ? <HolderProfileDetails profile={profileState.profile} /> : null}
    </div>
  );
}

export function EmptyCredentials() { return <Card><CardHeader><span className="flex size-11 items-center justify-center rounded-control bg-surface-muted text-teal-700"><FileCheck2 aria-hidden="true" className="size-5" /></span><h2 className="text-xl font-semibold text-text-strong">Todavía no tenés credenciales formativas</h2></CardHeader><CardContent><p className="text-sm leading-6 text-text-muted">Cuando una institución emita una credencial a tu nombre, aparecerá en este espacio.</p></CardContent></Card>; }
export function LoadingState({ label }: { label: string }) { return <div className="flex min-h-32 items-center justify-center rounded-card border border-border-default bg-surface p-6 text-sm text-text-muted"><LoaderCircle aria-hidden="true" className="mr-2 size-5 animate-spin text-teal-700" />{label}</div>; }
function SummaryCard({ label, value }: { label: string; value: number }) { return <Card className="border-border-strong"><CardContent className="pt-5 sm:pt-6"><p className="text-2xl font-bold text-text-strong">{value}</p><p className="mt-1 text-sm text-text-muted">{label}</p></CardContent></Card>; }
function messageFor(error: unknown) { if (error instanceof IncompatiblePayloadError) return 'La información disponible no tiene el formato esperado. Intentá nuevamente más tarde.'; if (error instanceof ApiError && error.status === 404) return 'No encontramos información disponible para mostrar.'; return 'No pudimos completar la consulta. Intentá nuevamente más tarde.'; }
function profileErrorState(error: unknown): HolderProfileLoadState {
  return {
    status: 'error',
    message: messageFor(error),
    diagnostic: error instanceof IncompatiblePayloadError ? error.diagnostic : null
  };
}

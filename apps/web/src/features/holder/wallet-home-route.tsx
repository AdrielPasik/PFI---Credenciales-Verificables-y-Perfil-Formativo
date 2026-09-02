'use client';

import { ArrowRight, FileCheck2, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { HolderCredentialCard } from '@/features/holder/holder-credential-card';
import { HolderProfileEmptyPanel, HolderProfilePanel } from '@/features/holder/holder-profile-panel';
import { ProfileRebuildAction } from '@/features/holder/profile-rebuild-action';
import { ProfileShareAction } from '@/features/holder/profile-share-action';
import { WalletRouteBoundary } from '@/features/holder/wallet-route-boundary';
import { getMyCredentialsRequest, getMyCurrentProfileRequest } from '@/lib/api/holder-api';
import { ApiError, IncompatiblePayloadError } from '@/lib/errors/api-error';
import { useSession } from '@/lib/session/session-provider';
import type { HolderCredentialListItemVM, HolderProfileVM } from '@/models/holder';

export type HolderProfileLoadState =
  | { status: 'loading' }
  | { status: 'ready'; profile: HolderProfileVM }
  | { status: 'empty' }
  | { status: 'error'; message: string };

export type HolderCredentialsLoadState =
  | { status: 'loading' }
  | { status: 'ready'; credentials: HolderCredentialListItemVM[] }
  | { status: 'error'; message: string };

export function WalletHomeRoute() {
  return <WalletRouteBoundary><WalletHomeContent /></WalletRouteBoundary>;
}

function WalletHomeContent() {
  const { requestAuthenticated } = useSession();
  const [profileState, setProfileState] = useState<HolderProfileLoadState>({ status: 'loading' });
  const [credentialsState, setCredentialsState] = useState<HolderCredentialsLoadState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    void getMyCredentialsRequest(requestAuthenticated)
      .then((credentials) => active && setCredentialsState({ status: 'ready', credentials }))
      .catch((error) => active && setCredentialsState({ status: 'error', message: messageFor(error) }));
    void getMyCurrentProfileRequest(requestAuthenticated)
      .then((profile) => active && setProfileState(profile ? { status: 'ready', profile } : { status: 'empty' }))
      .catch((error) => active && setProfileState({ status: 'error', message: messageFor(error) }));
    return () => { active = false; };
  }, [requestAuthenticated]);

  function handleProfileRebuilt(profile: HolderProfileVM | null) {
    setProfileState(profile ? { status: 'ready', profile } : { status: 'empty' });
  }

  return (
    <WalletHomeView
      profileState={profileState}
      credentialsState={credentialsState}
      showProfileShare
      onProfileRebuilt={handleProfileRebuilt}
    />
  );
}

export function WalletHomeView({ profileState, credentialsState, showProfileShare = false, onProfileRebuilt }: { profileState: HolderProfileLoadState; credentialsState: HolderCredentialsLoadState; showProfileShare?: boolean; onProfileRebuilt?: (profile: HolderProfileVM | null) => void }) {
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
  return <div className="grid gap-10"><header className="max-w-3xl"><p className="text-sm font-semibold text-teal-700">Espacio personal</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-text-strong sm:text-4xl">Mi perfil formativo</h1><p className="mt-3 max-w-2xl leading-7 text-text-muted">Una vista de tu trayectoria construida a partir de tus credenciales formativas y de los análisis disponibles en Scope.</p></header>{profileState.status === 'loading' ? <LoadingState label="Cargando tu perfil formativo" /> : null}{profileState.status === 'ready' ? <>{showProfileShare ? <div className="flex flex-wrap gap-3"><ProfileShareAction />{rebuildAction}</div> : null}<HolderProfilePanel profile={profileState.profile} /></> : null}{profileState.status === 'empty' ? <HolderProfileEmptyPanel action={canOfferManualRebuild ? rebuildAction : null} /> : null}{profileState.status === 'error' ? <FeedbackAlert variant="warning" title="No pudimos cargar tu perfil formativo">Tus credenciales siguen disponibles. Podés volver a intentar más tarde.</FeedbackAlert> : null}<section aria-labelledby="wallet-credentials-title" className="grid gap-6"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold text-teal-700">Tu biblioteca</p><h2 id="wallet-credentials-title" className="mt-1 text-2xl font-bold tracking-tight text-text-strong">Tus credenciales</h2><p className="mt-2 text-sm leading-6 text-text-muted">Consultá las credenciales formativas disponibles en tu espacio personal.</p></div><Button asChild variant="secondary"><Link href="/wallet/credentials">Ver todas <ArrowRight aria-hidden="true" /></Link></Button></div>{credentialsState.status === 'loading' ? <LoadingState label="Cargando credenciales" /> : null}{credentialsState.status === 'error' ? <FeedbackAlert variant="error" title="No pudimos cargar tus credenciales">{credentialsState.message}</FeedbackAlert> : null}{credentialsState.status === 'ready' && credentials.length === 0 ? <EmptyCredentials /> : null}{credentialsState.status === 'ready' && credentials.length > 0 ? <><div className="grid gap-3 sm:grid-cols-3"><SummaryCard label="Emitidas" value={issued.length} /><SummaryCard label="Revocadas" value={revoked.length} /><SummaryCard label="Con análisis disponible" value={credentials.filter((credential) => credential.hasAnalysis).length} /></div><div className="grid gap-5 md:grid-cols-2">{credentials.slice(0, 2).map((credential) => <HolderCredentialCard key={credential.credentialReference} credential={credential} />)}</div></> : null}</section></div>;
}

export function EmptyCredentials() { return <Card><CardHeader><span className="flex size-11 items-center justify-center rounded-control bg-surface-muted text-teal-700"><FileCheck2 aria-hidden="true" className="size-5" /></span><h2 className="text-xl font-semibold text-text-strong">Todavía no tenés credenciales formativas</h2></CardHeader><CardContent><p className="text-sm leading-6 text-text-muted">Cuando una institución emita una credencial a tu nombre, aparecerá en este espacio.</p></CardContent></Card>; }
export function LoadingState({ label }: { label: string }) { return <div className="flex min-h-32 items-center justify-center rounded-card border border-border-default bg-surface p-6 text-sm text-text-muted"><LoaderCircle aria-hidden="true" className="mr-2 size-5 animate-spin text-teal-700" />{label}</div>; }
function SummaryCard({ label, value }: { label: string; value: number }) { return <Card className="border-border-strong"><CardContent className="pt-5 sm:pt-6"><p className="text-2xl font-bold text-text-strong">{value}</p><p className="mt-1 text-sm text-text-muted">{label}</p></CardContent></Card>; }
function messageFor(error: unknown) { if (error instanceof IncompatiblePayloadError) return 'La información disponible no tiene el formato esperado. Intentá nuevamente más tarde.'; if (error instanceof ApiError && error.status === 404) return 'No encontramos información disponible para mostrar.'; return 'No pudimos completar la consulta. Intentá nuevamente más tarde.'; }

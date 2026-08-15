'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { Button } from '@/components/ui/button';
import { HolderCredentialCard } from '@/features/holder/holder-credential-card';
import { EmptyCredentials, LoadingState } from '@/features/holder/wallet-home-route';
import { WalletRouteBoundary } from '@/features/holder/wallet-route-boundary';
import { getMyCredentialsRequest } from '@/lib/api/holder-api';
import { useSession } from '@/lib/session/session-provider';
import type { HolderCredentialListItemVM } from '@/models/holder';

export function WalletCredentialsRoute() {
  return <WalletRouteBoundary><WalletCredentialsContent /></WalletRouteBoundary>;
}

function WalletCredentialsContent() {
  const { requestAuthenticated } = useSession();
  const [credentials, setCredentials] = useState<HolderCredentialListItemVM[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void getMyCredentialsRequest(requestAuthenticated).then((value) => active && setCredentials(value)).catch(() => active && setError('No pudimos cargar tus credenciales. Intentá nuevamente más tarde.'));
    return () => { active = false; };
  }, [requestAuthenticated]);
  return <section className="grid gap-8" aria-labelledby="holder-credentials-title"><Button asChild variant="ghost" className="w-fit"><Link href="/wallet"><ArrowLeft aria-hidden="true" />Volver al perfil</Link></Button><div className="max-w-3xl"><p className="text-sm font-semibold text-teal-700">Credenciales de respaldo</p><h1 id="holder-credentials-title" className="mt-1 text-3xl font-bold tracking-tight text-text-strong">Mis credenciales</h1><p className="mt-3 max-w-2xl leading-7 text-text-muted">Consultá las credenciales que respaldan tu trayectoria formativa.</p></div>{error ? <FeedbackAlert variant="error" title="No pudimos cargar tus credenciales">{error}</FeedbackAlert> : null}{credentials === null && !error ? <LoadingState label="Cargando credenciales" /> : null}{credentials?.length === 0 ? <EmptyCredentials /> : null}{credentials && credentials.length > 0 ? <div className="grid gap-5 md:grid-cols-2">{credentials.map((credential) => <HolderCredentialCard key={credential.credentialReference} credential={credential} />)}</div> : null}</section>;
}

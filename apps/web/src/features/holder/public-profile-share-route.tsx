'use client';

import { BookOpenCheck, Landmark, LoaderCircle, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { BrandMark } from '@/components/brand/brand-mark';
import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { getPublicProfileShareRequest } from '@/lib/api/profile-sharing-api';
import type { PublicProfileShareVM } from '@/models/profile-sharing';

export function PublicProfileShareRoute({ token }: { token: string }) {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'ready'; profile: PublicProfileShareVM } | { kind: 'error' }>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    void getPublicProfileShareRequest(token)
      .then((profile) => active && setState({ kind: 'ready', profile }))
      .catch(() => active && setState({ kind: 'error' }));
    return () => { active = false; };
  }, [token]);

  return <main className="min-h-svh bg-canvas px-4 py-6 sm:px-8 sm:py-10"><div className="mx-auto grid w-full max-w-7xl gap-8"><header className="flex flex-wrap items-center justify-between gap-4"><BrandMark descriptor="Perfil compartido" /><Button asChild size="sm" variant="secondary"><Link href="/login">Volver a iniciar sesión</Link></Button></header>{state.kind === 'loading' ? <div className="flex min-h-40 items-center justify-center rounded-card border border-border-default bg-surface p-6 text-sm text-text-muted"><LoaderCircle aria-hidden="true" className="mr-2 size-5 animate-spin" />Cargando perfil compartido</div> : null}{state.kind === 'error' ? <FeedbackAlert variant="error" title="Perfil no disponible">No encontramos un perfil compartido disponible.</FeedbackAlert> : null}{state.kind === 'ready' ? <PublicProfileView profile={state.profile} /> : null}</div></main>;
}

function PublicProfileView({ profile }: { profile: PublicProfileShareVM }) {
  const metrics: Array<{ label: string; value: string }> = [
    { label: 'Credenciales incluidas', value: String(profile.credentialsCount) },
    ...(profile.totalOfficialHoursLabel ? [{ label: 'Horas oficiales', value: profile.totalOfficialHoursLabel }] : [])
  ];

  return <section className="grid gap-8" aria-labelledby="shared-profile-title">
    <Card className="min-w-0 border-brand-700 bg-brand-900 text-white">
      <CardHeader className="gap-4 sm:p-8">
        <div className="flex items-center gap-3"><UserRound aria-hidden="true" className="size-5 text-teal-100" /><p className="text-sm font-semibold text-teal-100">Perfil formativo compartido</p></div>
        <h1 id="shared-profile-title" className="break-words text-3xl font-bold tracking-tight sm:text-4xl">{profile.holderLabel ?? 'Perfil formativo'}</h1>
        {profile.narrative ? <p className="max-w-3xl leading-7 text-brand-100">{profile.narrative}</p> : <p className="leading-7 text-brand-100">Este perfil reúne información resumida de credenciales emitidas en Traza.</p>}
        <dl className="flex flex-wrap gap-x-8 gap-y-3 pt-1">{metrics.map((metric) => <div key={metric.label}><dt className="text-xs font-semibold tracking-wide text-teal-100 uppercase">{metric.label}</dt><dd className="mt-1 text-lg font-bold text-white">{metric.value}</dd></div>)}</dl>
        <p className="max-w-3xl text-sm leading-6 text-brand-100">Esta es una vista pública resumida. No incluye email ni evidencias crudas.</p>
      </CardHeader>
    </Card>

    <div className="grid gap-5 lg:grid-cols-3">
      <LabelList title="Áreas principales" items={profile.areas.map((area) => area.estimatedHoursLabel ? `${area.label} · ${area.estimatedHoursLabel}` : area.label)} />
      <LabelList title="Habilidades principales" items={profile.skills} />
      <LabelList title="Conceptos relevantes" items={profile.concepts} />
    </div>

    <Card className="min-w-0">
      <CardHeader className="flex-row items-center gap-3"><Landmark aria-hidden="true" className="size-5 text-teal-700" /><div><h2 className="text-lg font-semibold text-text-strong">Credenciales que respaldan este perfil</h2><p className="mt-1 text-sm text-text-muted">Se muestran hasta 10 credenciales emitidas vinculadas con este perfil.</p></div></CardHeader>
      <CardContent className="min-w-0">
        {profile.credentials.length > 0 ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {profile.credentials.map((credential) => <div key={credential.credentialReference} className="grid min-w-0 gap-3 rounded-control border border-border-default p-4">
            <div className="min-w-0">
              <p className="break-words font-semibold text-text-strong">{credential.title}</p>
              <p className="mt-1 break-words text-sm text-text-muted">{credential.typeLabel} · {credential.issuerName}{credential.issuedAtLabel ? ` · ${credential.issuedAtLabel}` : ''}</p>
            </div>
            <Button asChild size="sm" variant="secondary" className="w-fit"><Link href={`/verify?credential=${encodeURIComponent(credential.credentialReference)}`}>Ver credencial</Link></Button>
          </div>)}
        </div> : <p className="text-sm text-text-muted">No hay credenciales emitidas disponibles para mostrar.</p>}
      </CardContent>
    </Card>
  </section>;
}

function LabelList({ title, items }: { title: string; items: string[] }) {
  return <Card className="min-w-0">
    <CardHeader className="flex-row items-center gap-3 pb-4"><BookOpenCheck aria-hidden="true" className="size-5 text-teal-700" /><h2 className="text-lg font-semibold text-text-strong">{title}</h2></CardHeader>
    <CardContent className="min-w-0">{items.length > 0 ? <ul className="flex flex-wrap gap-2">{items.map((item) => <li key={item} className="max-w-full"><Badge variant="outline" className="max-w-full whitespace-normal break-words text-left">{item}</Badge></li>)}</ul> : <p className="text-sm text-text-muted">No hay información disponible.</p>}</CardContent>
  </Card>;
}

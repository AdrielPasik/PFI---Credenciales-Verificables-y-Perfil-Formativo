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

  return <main className="min-h-svh bg-canvas px-4 py-6 sm:px-8 sm:py-10"><div className="mx-auto grid w-full max-w-4xl gap-8"><header className="flex flex-wrap items-center justify-between gap-4"><BrandMark descriptor="Perfil compartido" /><Button asChild size="sm" variant="secondary"><Link href="/login">Volver a iniciar sesión</Link></Button></header>{state.kind === 'loading' ? <div className="flex min-h-40 items-center justify-center rounded-card border border-border-default bg-surface p-6 text-sm text-text-muted"><LoaderCircle aria-hidden="true" className="mr-2 size-5 animate-spin" />Cargando perfil compartido</div> : null}{state.kind === 'error' ? <FeedbackAlert variant="error" title="Perfil no disponible">No encontramos un perfil compartido disponible.</FeedbackAlert> : null}{state.kind === 'ready' ? <PublicProfileView profile={state.profile} /> : null}</div></main>;
}

function PublicProfileView({ profile }: { profile: PublicProfileShareVM }) {
  return <section className="grid gap-6" aria-labelledby="shared-profile-title"><Card className="border-brand-700 bg-brand-900 text-white"><CardHeader className="gap-4 sm:p-8"><div className="flex items-center gap-3"><UserRound aria-hidden="true" className="size-5 text-teal-100" /><p className="text-sm font-semibold text-teal-100">Perfil formativo compartido</p></div><h1 id="shared-profile-title" className="text-3xl font-bold tracking-tight">{profile.holderLabel ?? 'Perfil formativo'}</h1>{profile.narrative ? <p className="max-w-3xl leading-7 text-brand-100">{profile.narrative}</p> : <p className="leading-7 text-brand-100">Este perfil reúne información resumida de credenciales emitidas en Traza.</p>}{profile.totalOfficialHoursLabel ? <p className="text-sm text-brand-100">{profile.totalOfficialHoursLabel}</p> : null}</CardHeader></Card><div className="grid gap-5 md:grid-cols-3"><LabelList title="Áreas principales" items={profile.areas.map((area) => area.estimatedHoursLabel ? `${area.label} · ${area.estimatedHoursLabel}` : area.label)} /><LabelList title="Habilidades principales" items={profile.skills} /><LabelList title="Conceptos relevantes" items={profile.concepts} /></div><Card><CardHeader className="flex-row items-center gap-3"><Landmark aria-hidden="true" className="size-5 text-teal-700" /><div><h2 className="text-lg font-semibold text-text-strong">Credenciales de respaldo</h2><p className="mt-1 text-sm text-text-muted">Se muestran hasta 10 credenciales emitidas vinculadas con este perfil.</p></div></CardHeader><CardContent className="grid gap-3">{profile.credentials.map((credential) => <div key={credential.credentialReference} className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border-default p-4"><div><p className="font-semibold text-text-strong">{credential.title}</p><p className="mt-1 text-sm text-text-muted">{credential.typeLabel} · {credential.issuerName}{credential.issuedAtLabel ? ` · ${credential.issuedAtLabel}` : ''}</p></div><Button asChild size="sm" variant="secondary"><Link href={`/verify?credential=${encodeURIComponent(credential.credentialReference)}`}>Ver credencial</Link></Button></div>)}{profile.credentials.length === 0 ? <p className="text-sm text-text-muted">No hay credenciales emitidas disponibles para mostrar.</p> : null}</CardContent></Card><p className="text-sm leading-6 text-text-muted">Esta vista resume información pública del perfil. No incluye email, evidencias crudas ni artefactos de análisis.</p></section>;
}

function LabelList({ title, items }: { title: string; items: string[] }) { return <Card><CardHeader className="flex-row items-center gap-3 pb-4"><BookOpenCheck aria-hidden="true" className="size-5 text-teal-700" /><h2 className="text-lg font-semibold text-text-strong">{title}</h2></CardHeader><CardContent>{items.length > 0 ? <ul className="flex flex-wrap gap-2">{items.map((item) => <li key={item}><Badge variant="outline">{item}</Badge></li>)}</ul> : <p className="text-sm text-text-muted">No hay información disponible.</p>}</CardContent></Card>; }

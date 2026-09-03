import {
  FilePlus2,
  Fingerprint,
  Landmark,
  ShieldCheck
} from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { IssuerMembershipSummaryVM } from '@/models/issuer-context';

export function IssuerHome({
  membership
}: {
  membership: IssuerMembershipSummaryVM;
}) {
  return (
    <div className="grid items-stretch gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)] xl:gap-8">
      <section
        aria-labelledby="issuer-home-title"
        className="relative overflow-hidden rounded-[1.5rem] border border-brand-700 bg-brand-900 p-6 text-white shadow-md sm:p-8 lg:p-10"
      >
        <div aria-hidden="true" className="absolute -top-24 -right-20 size-72 rounded-full border border-white/10" />
        <div aria-hidden="true" className="absolute top-20 right-16 size-28 rounded-full bg-teal-600/20 blur-2xl" />
        <p className="relative text-sm font-semibold text-teal-100">Portal del emisor</p>
        <h1
          id="issuer-home-title"
          className="relative mt-3 max-w-3xl text-3xl leading-tight font-bold tracking-tight sm:text-5xl"
        >
          {'Gestion\u00e1 las credenciales de '}
          {membership.issuerName}
        </h1>
        <p className="relative mt-5 max-w-2xl leading-7 text-brand-100/80">
          {'Cre\u00e1, complet\u00e1 y emit\u00ed credenciales desde la instituci\u00f3n activa.'}
        </p>

        <div className="relative mt-10 grid gap-5 border-t border-white/15 pt-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                <ShieldCheck aria-hidden="true" />
                {membership.issuerAuthorizationLabel}
              </Badge>
              <Badge variant="outline" className="border-white/25 bg-transparent text-white">
                {membership.roleLabel}
              </Badge>
            </div>
            <span className="mt-6 flex items-center gap-2 text-sm font-semibold text-teal-100">
              <Landmark aria-hidden="true" className="size-4" />
              {'Instituci\u00f3n activa'}
            </span>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">
              {membership.issuerName}
            </h2>
          </div>
          <div className="flex min-w-0 items-start gap-3 rounded-control border border-white/10 bg-white/5 p-4 text-brand-100/80 sm:max-w-72">
            <Fingerprint aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-teal-100" />
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-wide uppercase">DID institucional</p>
              <p className="mt-1 break-words font-mono text-xs leading-5">
                {membership.issuerDid ?? 'DID no disponible'}
              </p>
            </div>
          </div>
        </div>
      </section>

      <aside aria-labelledby="next-capability-title" className="flex">
        <Card className="flex w-full flex-col overflow-hidden rounded-[1.5rem] border-border-strong bg-surface shadow-sm">
          <div aria-hidden="true" className="h-1 bg-teal-600" />
          <CardHeader className="gap-5 sm:p-8">
            <div>
              <p className="text-xs font-semibold tracking-wider text-teal-700 uppercase">
                Flujo operativo
              </p>
              <h2
                id="next-capability-title"
                className="mt-2 text-xl font-semibold text-text-strong"
              >
                Nueva credencial
              </h2>
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="flex flex-1 flex-col pt-6 sm:px-8 sm:pb-8">
            <p className="text-sm leading-6 text-text-muted">
              {'Inici\u00e1 una credencial para registrar la formaci\u00f3n emitida por tu instituci\u00f3n.'}
            </p>
            <Button asChild className="mt-8 w-full">
              <Link href="/issuer/credentials/new">
                <FilePlus2 aria-hidden="true" />
                Crear credencial
              </Link>
            </Button>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

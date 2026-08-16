import {
  FilePlus2,
  Fingerprint,
  Landmark,
  Route,
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
    <div className="grid items-stretch gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem] xl:gap-10">
      <section
        aria-labelledby="issuer-home-title"
        className="relative overflow-hidden rounded-card border border-border-default bg-surface p-6 shadow-sm sm:p-8"
      >
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-teal-700" />
        <p className="text-sm font-semibold text-teal-700">Portal del emisor</p>
        <h1
          id="issuer-home-title"
          className="mt-2 max-w-5xl text-3xl leading-tight font-bold tracking-tight text-text-strong sm:text-4xl"
        >
          {'Gestion\u00e1 las credenciales de '}
          {membership.issuerName}
        </h1>
        <p className="mt-4 max-w-4xl leading-7 text-text-muted">
          {'Cre\u00e1, complet\u00e1 y emit\u00ed credenciales desde la instituci\u00f3n activa.'}
        </p>

        <Card className="mt-8 overflow-hidden border-border-strong bg-surface-muted shadow-xs">
          <CardHeader className="gap-4 sm:p-7 sm:pb-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                <ShieldCheck aria-hidden="true" />
                {membership.issuerAuthorizationLabel}
              </Badge>
              <Badge variant="outline">{membership.roleLabel}</Badge>
            </div>
            <div>
              <span className="flex items-center gap-2 text-sm font-semibold text-teal-700">
                <Landmark aria-hidden="true" className="size-4" />
                {'Instituci\u00f3n activa'}
              </span>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-text-strong">
                {membership.issuerName}
              </h2>
            </div>
          </CardHeader>
          <CardContent className="border-t border-border-default pt-5 sm:px-7 sm:pb-6">
            <div className="flex min-w-0 items-start gap-3 text-text-muted">
              <Fingerprint aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-semibold tracking-wide uppercase">
                  Identificador institucional
                </p>
                <p className="mt-1 break-words font-mono text-xs leading-5">
                  {membership.issuerDid ?? 'DID no disponible'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <aside aria-labelledby="next-capability-title" className="flex">
        <Card className="flex w-full flex-col overflow-hidden border-0 bg-brand-900 text-white shadow-md">
          <div aria-hidden="true" className="h-1 bg-teal-600" />
          <CardHeader className="gap-4">
            <span
              aria-hidden="true"
              className="flex size-11 items-center justify-center rounded-control border border-white/15 bg-white/5 text-teal-100"
            >
              <Route className="size-5" />
            </span>
            <div>
              <p className="text-xs font-semibold tracking-wider text-teal-100 uppercase">
                Flujo operativo
              </p>
              <h2
                id="next-capability-title"
                className="mt-2 text-xl font-semibold"
              >
                Nueva credencial
              </h2>
            </div>
          </CardHeader>
          <Separator className="bg-white/10" />
          <CardContent className="flex flex-1 flex-col pt-5">
            <p className="text-sm leading-6 text-brand-100/80">
              {'Inici\u00e1 una credencial para registrar la formaci\u00f3n emitida por tu instituci\u00f3n.'}
            </p>
            <Button asChild variant="secondary" className="mt-8 w-full">
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

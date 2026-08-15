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
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1.45fr)_minmax(19rem,0.55fr)]">
      <section aria-labelledby="issuer-home-title">
        <p className="text-sm font-semibold text-teal-700">
          Portal del emisor
        </p>
        <h1
          id="issuer-home-title"
          className="mt-2 max-w-3xl text-3xl leading-tight font-bold tracking-tight text-text-strong sm:text-4xl"
        >
          {'Gestion\u00e1 las credenciales de '}{membership.issuerName}
        </h1>
        <p className="mt-4 max-w-2xl leading-7 text-text-muted">
          {'Cre\u00e1, complet\u00e1 y emit\u00ed credenciales desde la instituci\u00f3n activa.'}
        </p>

        <Card className="mt-8 overflow-hidden border-border-strong">
          <div aria-hidden="true" className="h-1 bg-teal-700" />
          <CardHeader className="gap-4 sm:p-8">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                <ShieldCheck aria-hidden="true" />
                {membership.issuerAuthorizationLabel}
              </Badge>
              <Badge variant="outline">{membership.roleLabel}</Badge>
            </div>
            <h2 className="text-xl font-semibold text-text-strong">
              {'Instituci\u00f3n activa'}
            </h2>
          </CardHeader>
          <CardContent className="grid gap-5 sm:px-8 sm:pb-8">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
              <div className="rounded-control bg-surface-muted p-5">
                <span className="flex items-center gap-2 text-sm font-semibold text-text-muted">
                  <Landmark aria-hidden="true" className="size-4" />
                  Institución
                </span>
                <p className="mt-2 font-semibold text-text-strong">
                  {membership.issuerName}
                </p>
              </div>
              <div className="rounded-control border border-border-default bg-surface p-5">
                <span className="flex items-center gap-2 text-xs font-semibold tracking-wide text-text-muted uppercase">
                  <Fingerprint aria-hidden="true" className="size-4" />
                  Identificador institucional
                </span>
                <p className="mt-2 break-words font-mono text-xs leading-5 text-text-muted">
                  {membership.issuerDid ?? 'DID no disponible'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <aside aria-labelledby="next-capability-title">
        <Card className="overflow-hidden border-brand-700 bg-brand-900 text-white shadow-md lg:mt-2">
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
          <CardContent className="pt-5">
            <p className="text-sm leading-6 text-brand-100/80">
              {'Inici\u00e1 una credencial para registrar la formaci\u00f3n emitida por tu instituci\u00f3n.'}
            </p>
            <Button asChild variant="secondary" className="mt-6 w-full">
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

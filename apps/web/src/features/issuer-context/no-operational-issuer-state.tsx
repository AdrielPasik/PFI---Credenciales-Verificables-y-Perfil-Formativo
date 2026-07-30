import {
  Building2,
  CircleOff,
  Fingerprint,
  UserRoundCheck
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  deriveNonOperationalIssuerReason,
  type IssuerMembershipSummaryVM
} from '@/models/issuer-context';

export function NoOperationalIssuerState({
  memberships
}: {
  memberships: IssuerMembershipSummaryVM[];
}) {
  return (
    <section className="mx-auto w-full max-w-3xl" aria-labelledby="access-title">
      <Card className="overflow-hidden border-border-strong">
        <div aria-hidden="true" className="h-1 bg-amber-600" />
        <CardHeader className="gap-4 sm:p-8">
          <span
            aria-hidden="true"
            className="flex size-12 items-center justify-center rounded-control bg-brand-100 text-brand-700"
          >
            <UserRoundCheck className="size-6" />
          </span>
          <div>
            <p className="text-sm font-semibold text-teal-700">
              Cuenta autenticada
            </p>
            <h1
              id="access-title"
              className="mt-2 text-3xl leading-tight font-bold tracking-tight text-text-strong"
            >
              No tenés un portal emisor operativo
            </h1>
            <p className="mt-4 max-w-2xl leading-7 text-text-muted">
              La sesión es válida, pero actualmente no hay una institución
              autorizada en la que tu rol permita operar. La experiencia
              personal y la Wallet todavía no están disponibles en esta
              versión.
            </p>
          </div>
        </CardHeader>

        {memberships.length > 0 ? (
          <>
            <Separator />
            <CardContent className="pt-6 sm:px-8 sm:pb-8">
              <h2 className="font-semibold text-text-strong">
                Contextos institucionales conocidos
              </h2>
              <ul className="mt-4 grid gap-3">
                {memberships.map((membership) => {
                  const reason =
                    deriveNonOperationalIssuerReason(membership);

                  return (
                    <li
                      key={membership.issuerReference}
                      className="rounded-control border border-border-default bg-surface-muted p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Building2
                          aria-hidden="true"
                          className="size-4 text-brand-700"
                        />
                        <span className="font-semibold text-text-strong">
                          {membership.issuerName}
                        </span>
                        {reason ? (
                          <Badge variant="outline">
                            <CircleOff aria-hidden="true" />
                            {reason.label}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-text-muted">
                        <span>Rol: {membership.roleLabel}</span>
                        <span>
                          Estado institucional:{' '}
                          {membership.issuerAuthorizationLabel}
                        </span>
                        <span className="inline-flex min-w-0 items-center gap-1.5">
                          <Fingerprint aria-hidden="true" className="size-4" />
                          {membership.issuerDid ?? 'DID no disponible'}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </>
        ) : null}
      </Card>
    </section>
  );
}

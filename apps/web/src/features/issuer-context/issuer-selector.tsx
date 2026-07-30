'use client';

import { Building2, Fingerprint, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { IssuerMembershipSummaryVM } from '@/models/issuer-context';

interface IssuerSelectorProps {
  memberships: IssuerMembershipSummaryVM[];
  onSelect(issuerReference: string): void;
}

export function IssuerSelector({
  memberships,
  onSelect
}: IssuerSelectorProps) {
  const [selectedIssuerReference, setSelectedIssuerReference] =
    useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (selectedIssuerReference) {
      onSelect(selectedIssuerReference);
    }
  }

  return (
    <section className="mx-auto w-full max-w-3xl" aria-labelledby="context-title">
      <p className="text-sm font-semibold text-teal-700">
        Contexto institucional
      </p>
      <h1
        id="context-title"
        className="mt-2 text-3xl leading-tight font-bold tracking-tight text-text-strong sm:text-4xl"
      >
        Elegí la institución con la que vas a operar
      </h1>
      <p className="mt-4 max-w-2xl leading-7 text-text-muted">
        Tu cuenta tiene más de un contexto emisor autorizado. Esta selección
        define el portal activo durante la sesión.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 grid gap-5">
        <fieldset className="grid gap-3">
          <legend className="sr-only">Instituciones disponibles</legend>
          {memberships.map((membership) => {
            const checked =
              selectedIssuerReference === membership.issuerReference;

            return (
              <label
                key={membership.issuerReference}
                className={cn(
                  'group grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-4 rounded-card border bg-surface p-5 shadow-xs transition-colors',
                  'hover:border-brand-600 focus-within:border-brand-600 focus-within:ring-3 focus-within:ring-focus-ring/20',
                  checked
                    ? 'border-brand-700'
                    : 'border-border-default'
                )}
              >
                <input
                  type="radio"
                  name="issuer-context"
                  value={membership.issuerReference}
                  checked={checked}
                  onChange={() =>
                    setSelectedIssuerReference(
                      membership.issuerReference
                    )
                  }
                  className="mt-1 size-5 accent-[var(--traza-teal-700)]"
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <Building2
                      aria-hidden="true"
                      className="size-5 text-brand-700"
                    />
                    <span className="font-semibold text-text-strong">
                      {membership.issuerName}
                    </span>
                    <Badge variant="secondary">
                      <ShieldCheck aria-hidden="true" />
                      {membership.issuerAuthorizationLabel}
                    </Badge>
                  </span>
                  <span className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-text-muted">
                    <span>Rol: {membership.roleLabel}</span>
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <Fingerprint aria-hidden="true" className="size-4" />
                      <span className="truncate">
                        {membership.issuerDid ?? 'DID no disponible'}
                      </span>
                    </span>
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <Button
          type="submit"
          size="lg"
          disabled={!selectedIssuerReference}
          className="justify-self-start"
        >
          Continuar al portal
        </Button>
      </form>
    </section>
  );
}

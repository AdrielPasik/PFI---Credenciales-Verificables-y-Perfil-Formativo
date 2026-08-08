import { ArrowUpRight, BrainCircuit, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { HolderCredentialListItemVM } from '@/models/holder';

export function HolderCredentialCard({ credential }: { credential: HolderCredentialListItemVM }) {
  return (
    <Card className="group overflow-hidden transition-colors hover:border-brand-600">
      <div className={credential.status === 'revoked' ? 'h-1 bg-status-error' : 'h-1 bg-teal-700'} />
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge variant={credential.status === 'revoked' ? 'outline' : 'secondary'}>
            {credential.statusLabel}
          </Badge>
          <span className="text-xs font-semibold text-text-muted">{credential.typeLabel}</span>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-text-strong">{credential.title}</h2>
          <p className="mt-1 text-sm text-text-muted">Emitida por {credential.issuerName}</p>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-text-muted">
          {credential.issuedAtLabel ? <span>{credential.issuedAtLabel}</span> : null}
          {credential.hasIntegrityEvidence ? <span className="inline-flex items-center gap-1.5"><ShieldCheck aria-hidden="true" className="size-4 text-teal-700" />Evidencia de integridad</span> : null}
          {credential.hasAnalysis ? <span className="inline-flex items-center gap-1.5"><BrainCircuit aria-hidden="true" className="size-4 text-teal-700" />Análisis disponible</span> : null}
        </div>
        <Link
          href={`/wallet/credentials/${encodeURIComponent(credential.credentialReference)}`}
          className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-brand-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus-ring/30"
        >
          Ver credencial <ArrowUpRight aria-hidden="true" className="size-4" />
        </Link>
      </CardContent>
    </Card>
  );
}

'use client';

import { useSyncExternalStore } from 'react';

import type { IncompatiblePayloadDiagnostic } from '@/lib/errors/api-error';

export function useContractDebugEnabled() {
  return useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get('contractDebug') === '1',
    () => false
  );
}

export function ContractDiagnostic({
  diagnostic
}: {
  diagnostic: IncompatiblePayloadDiagnostic;
}) {
  return (
    <div className="mt-3 border-t border-border-default pt-3 text-xs text-text-subtle">
      <p className="font-semibold text-text-muted">Diagnóstico de contrato</p>
      <dl className="mt-2 grid gap-1 font-mono">
        <div><dt className="inline">Campo: </dt><dd className="inline">{diagnostic.path}</dd></div>
        <div><dt className="inline">Esperado: </dt><dd className="inline">{diagnostic.expected}</dd></div>
        <div><dt className="inline">Recibido: </dt><dd className="inline">{diagnostic.actualCategory}</dd></div>
      </dl>
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { SessionErrorState } from '@/components/feedback/session-error-state';
import { SessionLoadingState } from '@/components/feedback/session-loading-state';
import { IssuerShell } from '@/components/layout/issuer-shell';
import {
  listTechnicalAdminMemberships,
  resolveTechnicalIssuer
} from '@/features/issuer-technical-identity/technical-admin-memberships';
import { useSession } from '@/lib/session/session-provider';
import type { IssuerMembershipSummaryVM } from '@/models/issuer-context';

/**
 * Boundary ESPECIFICO de la configuracion tecnica -- S8c9.
 *
 * Exige sesion autenticada y al menos una membership ACTIVA con rol ADMIN. No
 * exige que el issuer este autorizado. Todo lo operativo sigue pasando por
 * `IssuerRouteBoundary`, que NO se toca.
 *
 * - NO muta el issuer operativo global: no llama a `selectIssuer` ni a
 *   `clearSelectedIssuer`, y la seleccion de esta pagina es estado LOCAL.
 * - El issuer elegido sale SIEMPRE del conjunto de candidatos vigente; una
 *   seleccion local que deja de ser elegible se descarta.
 * - No decide "sin acceso" mientras la sesion todavia esta resolviendo.
 *
 * ES SOLO UX: el backend vuelve a exigir la membership exacta en cada request.
 */
interface TechnicalConfigurationRouteBoundaryProps {
  children: (membership: IssuerMembershipSummaryVM) => ReactNode;
}

export function TechnicalConfigurationRouteBoundary({
  children
}: TechnicalConfigurationRouteBoundaryProps) {
  const router = useRouter();
  const { logout, retry, state } = useSession();
  const [localSelectionReference, setLocalSelectionReference] = useState<
    string | null
  >(null);

  const candidates =
    state.status === 'authenticated'
      ? listTechnicalAdminMemberships(state.issuerContext.issuerContexts)
      : [];
  const globalSelectedReference =
    state.status === 'authenticated'
      ? (state.issuerContext.selectedIssuer?.issuerReference ?? null)
      : null;
  const resolution = resolveTechnicalIssuer({
    candidates,
    localSelectionReference,
    globalSelectedReference
  });

  // Una seleccion local que dejo de ser elegible se DESCARTA.
  const localStillEligible =
    localSelectionReference === null ||
    candidates.some(
      (candidate) => candidate.issuerReference === localSelectionReference
    );

  // Ajuste en render (patron de React para derivar estado): si el candidato
  // deja de ser elegible la seleccion se descarta ya, sin un render
  // intermedio con un id obsoleto, y no puede "resucitar" mas tarde.
  if (!localStillEligible) {
    setLocalSelectionReference(null);
  }

  useEffect(() => {
    if (state.status === 'unauthenticated' || state.status === 'expired') {
      router.replace('/login');
      return;
    }

    // Solo con la sesion RESUELTA se puede concluir que no hay acceso.
    if (state.status === 'authenticated' && resolution.kind === 'none') {
      router.replace('/');
    }
  }, [router, state.status, resolution.kind]);

  function handleLogout() {
    logout();
    router.replace('/login');
  }

  if (
    state.status === 'booting' ||
    state.status === 'authenticating' ||
    state.status === 'resolving-context' ||
    state.status === 'unauthenticated' ||
    state.status === 'expired'
  ) {
    return <SessionLoadingState />;
  }

  if (state.status === 'recoverable-error') {
    return (
      <div className="flex min-h-svh bg-canvas px-4 py-12 sm:px-6">
        <SessionErrorState
          feedback={state.error}
          onRetry={() => void retry()}
          onLogout={handleLogout}
        />
      </div>
    );
  }

  if (resolution.kind === 'none') {
    return <SessionLoadingState label="Resolviendo contexto institucional" />;
  }

  const selected =
    resolution.kind === 'selected' ? resolution.membership : null;

  return (
    <IssuerShell
      label={state.currentUser.displayLabel}
      issuerName={selected ? selected.issuerName : 'Seleccioná una institución'}
      // NO se afirma "Institucion activa": este issuer puede no estar
      // autorizado. Se muestra su estado administrativo real.
      contextBadge={
        selected
          ? `Configuración técnica · ${selected.issuerAuthorizationLabel}`
          : 'Configuración técnica'
      }
      // "Cambiar institucion" cambia el contexto OPERATIVO global; esta pagina
      // no lo toca.
      canChangeIssuer={false}
      isPlatformAdmin={state.currentUser.isPlatformAdmin}
      onChangeIssuer={() => undefined}
      onLogout={handleLogout}
    >
      {candidates.length > 1 ? (
        <div className="mb-6 max-w-md">
          <label
            htmlFor="technical-issuer-selector"
            className="text-sm font-semibold text-text-strong"
          >
            {'Institución'}
          </label>
          <select
            id="technical-issuer-selector"
            className="mt-2 w-full rounded-control border border-border-default bg-surface px-3 py-2 text-sm"
            value={selected?.issuerReference ?? ''}
            onChange={(event) =>
              setLocalSelectionReference(event.target.value || null)
            }
          >
            {selected ? null : (
              <option value="">{'Seleccioná una institución'}</option>
            )}
            {candidates.map((candidate) => (
              <option
                key={candidate.issuerReference}
                value={candidate.issuerReference}
              >
                {candidate.issuerName}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {selected ? (
        <div key={selected.issuerReference}>{children(selected)}</div>
      ) : null}
    </IssuerShell>
  );
}

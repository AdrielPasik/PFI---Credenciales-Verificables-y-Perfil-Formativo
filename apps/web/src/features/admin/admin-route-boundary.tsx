'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { SessionErrorState } from '@/components/feedback/session-error-state';
import { SessionLoadingState } from '@/components/feedback/session-loading-state';
import { AdminShell } from '@/components/layout/admin-shell';
import { useSession } from '@/lib/session/session-provider';

/**
 * Frontera de /admin -- slice S6a.
 *
 * MISMA FORMA QUE `WalletRouteBoundary` / `IssuerRouteBoundary`: un efecto que
 * redirige, los estados de sesion que no pueden renderizar contenido, el
 * `SessionErrorState` recuperable, y el shell alrededor de los hijos.
 *
 * ESTO ES UX, NO SEGURIDAD. Ocultar /admin no protege nada: la autoridad real
 * es `AuthGuard` + `PlatformAdminGuard`, server-side, que releen la tabla
 * `PlatformAdmin` en CADA request. Alguien que escriba /admin a mano y burle
 * este componente no obtiene un solo dato: los dos GET administrativos
 * responden 403. Lo que este boundary evita es ofrecerle a una persona una
 * superficie que no va a funcionar.
 *
 * DEPENDE DE EXACTAMENTE DOS COSAS:
 *
 *   1. sesion autenticada;
 *   2. `currentUser.isPlatformAdmin === true`.
 *
 * Y DE NADA MAS. En particular NO lee `issuerContext.kind`, ni
 * `selectedIssuer`, ni `IssuerMembership`, ni `role`, ni
 * `issuerAuthorizationStatus`, ni `onboardingIntent`. Esa independencia es el
 * punto: `PlatformAdmin` es una capacidad GLOBAL de Scope y
 * `IssuerMembership` es una capacidad INSTITUCIONAL, y son planos separados en
 * el backend desde S1. Un PlatformAdmin con cero memberships, con una, o con
 * varias sin seleccionar, entra igual -- sin que nadie lo obligue a elegir una
 * institucion primero, y sin pasar por `ContextRouter`.
 *
 * `isPlatformAdmin` viene YA ADAPTADO por `adaptCurrentUserResponse`
 * (`payload.platformAdmin === true`, fail-closed). Este componente no vuelve a
 * leer el payload crudo, y no infiere la capacidad por email, por memberships,
 * por rol admin ni por intencion de onboarding.
 */
export function AdminRouteBoundary({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { logout, retry, state } = useSession();

  const authenticatedWithoutCapability =
    state.status === 'authenticated' && state.currentUser.isPlatformAdmin !== true;

  useEffect(() => {
    if (state.status === 'unauthenticated' || state.status === 'expired') {
      router.replace('/login');
      return;
    }

    // Sin la capacidad de plataforma, de vuelta a la raiz: `ContextRouter`
    // resuelve ahi a donde corresponde que aterrice esta persona. No se le
    // muestra una pantalla de "acceso denegado" porque /admin no deberia
    // haberle sido ofrecida nunca -- el entry point solo aparece para
    // PlatformAdmins.
    if (authenticatedWithoutCapability) {
      router.replace('/');
    }
  }, [authenticatedWithoutCapability, router, state]);

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

  // El redirect de arriba corre en un efecto, asi que este render puede
  // ocurrir una vez antes de que se complete. NO se renderiza la superficie
  // administrativa mientras eso pasa.
  if (authenticatedWithoutCapability) {
    return <SessionLoadingState label="Abriendo tu espacio" />;
  }

  return (
    <AdminShell
      label={state.currentUser.displayLabel}
      onLogout={handleLogout}
    >
      {children}
    </AdminShell>
  );
}

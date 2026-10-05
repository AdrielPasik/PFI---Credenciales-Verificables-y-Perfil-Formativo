'use client';

import { ArrowRight, Building2, LoaderCircle, Mail, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { SessionErrorState } from '@/components/feedback/session-error-state';
import { SessionLoadingState } from '@/components/feedback/session-loading-state';
import { WalletShell } from '@/components/layout/wallet-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useSession } from '@/lib/session/session-provider';

/**
 * Acceso institucional pendiente -- O1.
 *
 * A donde aterriza alguien que en el signup eligio "trabajar con una
 * institucion" y todavia no tiene ninguna IssuerMembership operativa.
 *
 * LO QUE EL COPY NO AFIRMA, porque nada de eso existe hoy: que una institucion
 * verifico a esta persona, que hay una solicitud recibida, que alguien esta
 * revisando algo, que existe un workflow de aprobacion, o que hubo una
 * invitacion. La unica cosa verdadera es que la cuenta existe y que el acceso
 * institucional lo habilita Scope asociandola a una organizacion.
 *
 * NO BLOQUEA LA CAPACIDAD PERSONAL. El enlace al espacio personal es
 * deliberado: "holder" no es un tipo de cuenta y haber elegido la intencion
 * institucional no quita nada. Una misma persona puede tener espacio personal,
 * memberships y PlatformAdmin a la vez.
 *
 * SIN POLLING, SIN WEBSOCKET, SIN TIMER. "Revisar de nuevo" llama al `retry()`
 * que ya existe en el SessionProvider, que reejecuta `GET /auth/me` y rederiva
 * el contexto institucional. Es el unico mecanismo de transicion disponible sin
 * inventar infraestructura nueva, y alcanza: cuando un Platform Admin cree la
 * membership, el proximo retry la trae y el boundary saca a la persona de aca.
 */
export function InstitutionalAccessPendingRoute() {
  return (
    <InstitutionalAccessPendingBoundary>
      {({ email, onRecheck, isRechecking }) => (
        <InstitutionalAccessPendingView
          email={email}
          isRechecking={isRechecking}
          onRecheck={onRecheck}
        />
      )}
    </InstitutionalAccessPendingBoundary>
  );
}

interface PendingBoundaryRenderProps {
  email: string;
  isRechecking: boolean;
  onRecheck: () => void;
}

/**
 * Boundary, con la misma forma que `WalletRouteBoundary` e
 * `IssuerRouteBoundary`.
 *
 * Exige UNICAMENTE sesion autenticada -- no crea ninguna autorizacion nueva. Y
 * no deja a nadie atrapado:
 *
 *   - si aparece una membership operativa  -> `/` (el ContextRouter la manda a
 *     /issuer, preservando la precedencia en un solo lugar);
 *   - si el intent ya no es `institutional` -> `/` (que resuelve a /wallet).
 *
 * Redirigir a `/` y no directo a `/issuer` es deliberado: la precedencia de
 * routing vive en el ContextRouter y no se duplica aca.
 */
export function InstitutionalAccessPendingBoundary({
  children
}: {
  children: (props: PendingBoundaryRenderProps) => ReactNode;
}) {
  const router = useRouter();
  const { logout, retry, state } = useSession();
  const [isRechecking, setIsRechecking] = useState(false);

  useEffect(() => {
    if (state.status === 'unauthenticated' || state.status === 'expired') {
      router.replace('/login');
      return;
    }

    if (state.status !== 'authenticated') {
      return;
    }

    // Ya tiene contexto institucional operativo, o ya no espera uno: en
    // cualquiera de los dos casos esta pantalla dejo de corresponder.
    if (
      state.issuerContext.kind !== 'none' ||
      state.currentUser.onboardingIntent !== 'institutional'
    ) {
      router.replace('/');
    }
  }, [router, state]);

  function handleLogout() {
    logout();
    router.replace('/login');
  }

  async function handleRecheck() {
    setIsRechecking(true);
    try {
      await retry();
    } finally {
      setIsRechecking(false);
    }
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

  return (
    <WalletShell
      label={state.currentUser.displayLabel}
      // S6a: sin esto, un PlatformAdmin con intencion institucional y CERO
      // memberships aterriza aca y no tendria ningun camino visible a /admin.
      // Es el unico cambio de S6a en esta ruta: no se toca su routing ni su
      // copy.
      isPlatformAdmin={state.currentUser.isPlatformAdmin}
      onLogout={handleLogout}
    >
      {children({
        email: state.currentUser.email,
        isRechecking,
        onRecheck: () => void handleRecheck()
      })}
    </WalletShell>
  );
}

export function InstitutionalAccessPendingView({
  email,
  isRechecking,
  onRecheck
}: PendingBoundaryRenderProps) {
  return (
    <section
      className="mx-auto w-full max-w-2xl"
      aria-labelledby="institutional-access-pending-title"
    >
      <Card className="overflow-hidden border-border-strong">
        <div aria-hidden="true" className="h-1 bg-amber-600" />
        <CardHeader className="gap-4 sm:p-8">
          <span
            aria-hidden="true"
            className="flex size-12 items-center justify-center rounded-control bg-brand-100 text-brand-700"
          >
            <Building2 className="size-6" />
          </span>
          <div>
            <p className="text-sm font-semibold text-teal-700">
              Tu cuenta ya está creada
            </p>
            <h1
              id="institutional-access-pending-title"
              className="mt-2 text-3xl leading-tight font-bold tracking-tight text-text-strong"
            >
              Acceso institucional pendiente
            </h1>
            <p className="mt-4 max-w-xl leading-7 text-text-muted">
              Para trabajar con una institución, Scope debe asociar tu cuenta a
              esa organización. Cuando el acceso haya sido habilitado, vas a
              poder ingresar al portal institucional.
            </p>
          </div>
          <p className="inline-flex min-w-0 items-center gap-2 text-sm text-text-muted">
            <Mail aria-hidden="true" className="size-4 shrink-0" />
            <span className="truncate">{email}</span>
          </p>
        </CardHeader>

        <Separator />

        <CardContent className="grid gap-3 pt-6 sm:px-8 sm:pb-8 sm:grid-flow-col sm:justify-start">
          <Button onClick={onRecheck} disabled={isRechecking}>
            {isRechecking ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <RefreshCw aria-hidden="true" />
            )}
            {isRechecking ? 'Revisando' : 'Revisar de nuevo'}
          </Button>
          {/* Deliberado: la intencion institucional no quita la capacidad
              personal. */}
          <Button asChild variant="ghost">
            <Link href="/wallet">
              Ir a mi espacio personal
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}

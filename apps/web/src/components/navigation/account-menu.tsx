import { ArrowLeft, LogOut, RefreshCw, Settings } from 'lucide-react';
import Link from 'next/link';

import { AppearanceControl } from '@/components/navigation/appearance-control';
import { Button } from '@/components/ui/button';
import {
  adminHrefFrom,
  type AdminEntry,
  type AdminReturnDestination
} from '@/features/admin/admin-entry';
import { requestLeave } from '@/lib/navigation/use-leave-guard';

interface AccountMenuProps {
  // A1.1: displayLabel (nombre humano si esta disponible, con fallback a
  // email) -- nunca un identificador tecnico. Renombrado desde `email`
  // porque este slot ahora puede mostrar el nombre del titular.
  label: string;
  canChangeIssuer?: boolean;
  /**
   * S6a: unico punto de descubrimiento de /admin en la UI.
   *
   * Recibe `currentUser.isPlatformAdmin` tal cual, ya adaptado por
   * `adaptCurrentUserResponse`. NUNCA se infiere la capacidad de plataforma
   * por email, por `IssuerMembership`, por rol admin ni por
   * `onboardingIntent`: solo este booleano.
   *
   * ES SOLO UX. Ocultar el enlace no protege nada -- la autoridad es
   * `AuthGuard` + `PlatformAdminGuard`, server-side, en cada request. Lo que
   * evita es ofrecer una superficie que no va a funcionar.
   *
   * No se mezcla con "Cambiar institucion": ese boton pertenece al plano
   * INSTITUCIONAL (`IssuerMembership`) y este enlace al plano de PLATAFORMA.
   * Son capacidades distintas y pueden darse en cualquier combinacion.
   */
  isPlatformAdmin?: boolean;
  /**
   * Desde que espacio se ofrece el enlace a Administracion: viaja como
   * `?from=` para que Administracion sepa a donde volver (ver `admin-entry`).
   */
  adminEntry?: AdminEntry;
  /** Solo en Administracion: regreso al espacio de origen. */
  returnDestination?: AdminReturnDestination;
  onChangeIssuer?: () => void;
  onLogout: () => void;
  inverse?: boolean;
}

export function AccountMenu({
  adminEntry = 'wallet',
  canChangeIssuer = false,
  isPlatformAdmin = false,
  label,
  returnDestination,
  inverse = false,
  onChangeIssuer,
  onLogout
}: AccountMenuProps) {
  return (
    // En pantallas angostas el nombre ocupa su propia fila y las acciones van
    // debajo, alineadas al inicio, sin recortar el nombre ni desbordar.
    <div className="flex w-full min-w-0 flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end">
      <span
        className={
          inverse
            ? 'min-w-0 basis-full truncate text-sm text-brand-100 sm:max-w-64 sm:basis-auto'
            : 'min-w-0 basis-full truncate text-sm text-text-muted sm:max-w-64 sm:basis-auto'
        }
      >
        {label}
      </span>
      {returnDestination ? (
        <Button
          asChild
          variant={inverse ? 'inverse' : 'ghost'}
          size="sm"
          className="shrink-0"
        >
          <Link href={returnDestination.href}>
            <ArrowLeft aria-hidden="true" />
            {returnDestination.label}
          </Link>
        </Button>
      ) : null}
      {isPlatformAdmin ? (
        <Button
          asChild
          variant={inverse ? 'inverse' : 'ghost'}
          size="sm"
          className="shrink-0"
        >
          <Link href={adminHrefFrom(adminEntry)}>
            <Settings aria-hidden="true" />
            Administración de plataforma
          </Link>
        </Button>
      ) : null}
      {canChangeIssuer ? (
        <Button
          variant={inverse ? 'inverse' : 'ghost'}
          size="sm"
          className="shrink-0"
          // Cambiar de institucion abandona la pantalla: si hay un formulario
          // con cambios sin guardar, primero se confirma.
          onClick={() => onChangeIssuer && requestLeave(onChangeIssuer)}
        >
          <RefreshCw aria-hidden="true" />
          Cambiar institución
        </Button>
      ) : null}
      <AppearanceControl tone={inverse ? 'inverse' : 'default'} />
      {/* En pantallas angostas queda como icono (44 px) con el mismo nombre
          accesible, para que el header no desborde. */}
      <Button
        variant={inverse ? 'inverse' : 'ghost'}
        size="sm"
        className="shrink-0 max-sm:size-11 max-sm:px-0"
        title="Cerrar sesión"
        onClick={() => requestLeave(onLogout)}
      >
        <LogOut aria-hidden="true" />
        <span className="max-sm:sr-only">Cerrar sesión</span>
      </Button>
    </div>
  );
}

import { LogOut, RefreshCw, Settings } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

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
  onChangeIssuer?: () => void;
  onLogout: () => void;
  inverse?: boolean;
}

export function AccountMenu({
  canChangeIssuer = false,
  isPlatformAdmin = false,
  label,
  inverse = false,
  onChangeIssuer,
  onLogout
}: AccountMenuProps) {
  return (
    <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
      <span
        className={
          inverse
            ? 'min-w-0 flex-1 truncate text-sm text-brand-100 sm:max-w-64 sm:flex-none'
            : 'min-w-0 flex-1 truncate text-sm text-text-muted sm:max-w-64 sm:flex-none'
        }
      >
        {label}
      </span>
      {isPlatformAdmin ? (
        <Button
          asChild
          variant={inverse ? 'secondary' : 'ghost'}
          size="sm"
          className="shrink-0"
        >
          <Link href="/admin">
            <Settings aria-hidden="true" />
            Administración de plataforma
          </Link>
        </Button>
      ) : null}
      {canChangeIssuer ? (
        <Button
          variant={inverse ? 'secondary' : 'ghost'}
          size="sm"
          className="shrink-0"
          onClick={onChangeIssuer}
        >
          <RefreshCw aria-hidden="true" />
          Cambiar institución
        </Button>
      ) : null}
      <Button
        variant={inverse ? 'secondary' : 'ghost'}
        size="sm"
        className="shrink-0"
        onClick={onLogout}
      >
        <LogOut aria-hidden="true" />
        Cerrar sesión
      </Button>
    </div>
  );
}

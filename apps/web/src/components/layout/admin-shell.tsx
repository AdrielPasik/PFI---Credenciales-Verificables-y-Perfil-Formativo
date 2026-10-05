import type { ReactNode } from 'react';

import { BrandMark } from '@/components/brand/brand-mark';
import { AccountMenu } from '@/components/navigation/account-menu';

interface AdminShellProps {
  children: ReactNode;
  label: string;
  onLogout: () => void;
}

/**
 * Shell del PLANO DE PLATAFORMA -- slice S6a.
 *
 * Cuarto shell del repo, con la misma estructura que los tres existentes
 * (skip-link + header con `BrandMark` + `AccountMenu` + `main`), y con un
 * descriptor propio para que nadie confunda esta superficie con el portal de
 * una institucion.
 *
 * NO LLEVA NADA INSTITUCIONAL: ni nombre de issuer activo, ni "Cambiar
 * institucion". Un PlatformAdmin opera aca sin tener ninguna
 * `IssuerMembership`, y el shell no debe sugerir lo contrario.
 *
 * Tampoco repite el acceso a "Administracion de plataforma" en el
 * `AccountMenu`: ya estamos dentro. Por eso no pasa `isPlatformAdmin`.
 *
 * Ancho `max-w-[90rem]`, igual que `IssuerShell`: es una superficie de
 * tablas/listado, no de lectura narrativa.
 */
export function AdminShell({ children, label, onLogout }: AdminShellProps) {
  return (
    <div className="flex min-h-svh flex-col bg-surface-muted/55">
      <a
        href="#admin-main-content"
        className="fixed top-3 left-3 z-50 -translate-y-20 rounded-control bg-white px-4 py-3 font-semibold text-brand-900 shadow-sm transition-transform focus:translate-y-0"
      >
        Saltar al contenido
      </a>

      <header className="border-b border-brand-700 bg-brand-900 text-white shadow-sm">
        <div className="mx-auto flex min-h-20 w-full min-w-0 max-w-[90rem] flex-col justify-center gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <BrandMark
            authenticatedDark
            tone="inverse"
            descriptor="Administración de plataforma"
          />
          <AccountMenu label={label} onLogout={onLogout} inverse />
        </div>
      </header>

      <main
        id="admin-main-content"
        className="mx-auto w-full min-w-0 max-w-[90rem] flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12"
      >
        {children}
      </main>
    </div>
  );
}

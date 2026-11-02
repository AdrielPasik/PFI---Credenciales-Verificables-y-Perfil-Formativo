'use client';

import type { ReactNode } from 'react';

import { BrandHomeLink } from '@/components/brand/brand-home-link';
import { BrandMark } from '@/components/brand/brand-mark';
import { ShellBandProvider, useShellBandSlot } from '@/components/layout/shell-band';
import { AccountMenu } from '@/components/navigation/account-menu';
import { Badge } from '@/components/ui/badge';

interface IssuerShellProps {
  children: ReactNode;
  label: string;
  issuerName: string;
  canChangeIssuer: boolean;
  /** S6a: ver `AccountMenuProps.isPlatformAdmin`. Solo se pasa a traves. */
  isPlatformAdmin?: boolean;
  onChangeIssuer: () => void;
  onLogout: () => void;
  /**
   * S8c9: rotulo del contexto. Por defecto es "Institución activa", que es
   * lo que afirman las paginas OPERATIVAS (el boundary operativo solo las
   * renderiza para un issuer autorizado). La configuracion tecnica tambien
   * la ve un issuer NO autorizado, asi que pasa un rotulo propio en vez de
   * afirmar un estado operativo que puede ser falso.
   */
  contextBadge?: string;
}

export function IssuerShell({
  canChangeIssuer,
  children,
  isPlatformAdmin = false,
  label,
  issuerName,
  contextBadge = 'Institución activa',
  onChangeIssuer,
  onLogout
}: IssuerShellProps) {
  const band = useShellBandSlot('mx-auto w-full max-w-[90rem] px-4 sm:px-6 lg:px-8');

  return (
    <div className="shell-root flex min-h-svh flex-col">
      <a
        href="#issuer-main-content"
        className="fixed top-3 left-3 z-50 -translate-y-20 rounded-control bg-surface px-4 py-3 font-semibold text-text-strong shadow-sm transition-transform focus:translate-y-0"
      >
        Saltar al contenido
      </a>

      <header className="ambient-header border-b border-inverse-border bg-inverse text-white shadow-sm">
        <div className="mx-auto w-full max-w-[90rem] px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <BrandHomeLink href="/issuer" label="Scope: ir al panel del emisor">
              <BrandMark
                authenticatedDark
                tone="inverse"
                descriptor="Portal del emisor"
              />
            </BrandHomeLink>
            <AccountMenu
              label={label}
              adminEntry="issuer"
              canChangeIssuer={canChangeIssuer}
              isPlatformAdmin={isPlatformAdmin}
              onChangeIssuer={onChangeIssuer}
              onLogout={onLogout}
              inverse
            />
          </div>
          {/* Se oculta en la pantalla con banda: ahi la institucion ya es el titulo. */}
          <div className="shell-context-row mt-4 flex min-w-0 flex-wrap items-center gap-3 border-t border-white/10 pt-4">
            <Badge variant="secondary">{contextBadge}</Badge>
            <span className="min-w-0 text-sm font-semibold text-brand-100 sm:truncate">
              {issuerName}
            </span>
          </div>
        </div>
      </header>

      {band.slot}
      <main
        id="issuer-main-content"
        className="mx-auto w-full max-w-[90rem] flex-1 px-4 py-8 [--shell-pt:2rem] sm:px-6 sm:py-10 sm:[--shell-pt:2.5rem] lg:px-8 lg:py-12 lg:[--shell-pt:3rem]"
      >
        <ShellBandProvider value={band.target}>{children}</ShellBandProvider>
      </main>
    </div>
  );
}

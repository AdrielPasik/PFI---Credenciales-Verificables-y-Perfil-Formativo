import type { ReactNode } from 'react';

import { BrandHomeLink } from '@/components/brand/brand-home-link';
import { BrandMark } from '@/components/brand/brand-mark';
import { AccountMenu } from '@/components/navigation/account-menu';
import type { AdminEntry } from '@/features/admin/admin-entry';

interface WalletShellProps {
  children: ReactNode;
  label: string;
  /** S6a: ver `AccountMenuProps.isPlatformAdmin`. Solo se pasa a traves. */
  isPlatformAdmin?: boolean;
  /** Raiz del espacio a la que lleva la marca; `null` si la pantalla ya es la raiz. */
  homeHref?: string | null;
  adminEntry?: AdminEntry;
  onLogout: () => void;
}

export function WalletShell({
  adminEntry = 'wallet',
  children,
  homeHref = '/wallet',
  isPlatformAdmin = false,
  label,
  onLogout
}: WalletShellProps) {
  return (
    <div className="flex min-h-svh flex-col bg-canvas">
      <a
        href="#wallet-main-content"
        className="fixed top-3 left-3 z-50 -translate-y-20 rounded-control bg-surface px-4 py-3 font-semibold text-text-strong shadow-sm transition-transform focus:translate-y-0"
      >
        Saltar al contenido
      </a>
      <header className="border-b border-inverse-border bg-inverse text-white">
        <div className="mx-auto flex min-h-20 w-full min-w-0 max-w-[var(--traza-holder-canvas-width)] flex-col justify-center gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <BrandHomeLink href={homeHref} label="Scope: ir a mi espacio personal">
            <BrandMark
              authenticatedDark
              tone="inverse"
              descriptor="Espacio personal"
            />
          </BrandHomeLink>
          <AccountMenu
            label={label}
            adminEntry={adminEntry}
            isPlatformAdmin={isPlatformAdmin}
            onLogout={onLogout}
            inverse
          />
        </div>
      </header>
      <main
        id="wallet-main-content"
        className="mx-auto w-full min-w-0 max-w-[var(--traza-holder-canvas-width)] flex-1 px-4 py-8 sm:px-6 sm:py-11 lg:px-8"
      >
        {children}
      </main>
    </div>
  );
}

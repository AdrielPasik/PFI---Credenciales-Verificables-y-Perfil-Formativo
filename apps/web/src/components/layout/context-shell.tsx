import type { ReactNode } from 'react';

import { BrandMark } from '@/components/brand/brand-mark';
import { AccountMenu } from '@/components/navigation/account-menu';

interface ContextShellProps {
  children: ReactNode;
  label: string;
  onLogout: () => void;
}

export function ContextShell({
  children,
  label,
  onLogout
}: ContextShellProps) {
  return (
    <div className="flex min-h-svh flex-col bg-canvas">
      <a
        href="#main-content"
        className="fixed top-3 left-3 z-50 -translate-y-20 rounded-control bg-brand-900 px-4 py-3 font-semibold text-white shadow-sm transition-transform focus:translate-y-0"
      >
        Saltar al contenido
      </a>
      <header className="border-b border-brand-700 bg-brand-900 text-white">
        <div className="mx-auto flex min-h-20 w-full max-w-[var(--traza-reading-width)] flex-col justify-center gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <BrandMark
            authenticatedDark
            tone="inverse"
            descriptor="Contexto de acceso"
          />
          <AccountMenu label={label} onLogout={onLogout} inverse />
        </div>
      </header>
      <main
        id="main-content"
        className="mx-auto flex w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12 lg:px-8"
      >
        {children}
      </main>
    </div>
  );
}

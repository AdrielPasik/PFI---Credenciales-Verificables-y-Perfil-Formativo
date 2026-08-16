import type { ReactNode } from 'react';

import { BrandMark } from '@/components/brand/brand-mark';
import { AccountMenu } from '@/components/navigation/account-menu';

interface WalletShellProps {
  children: ReactNode;
  label: string;
  onLogout: () => void;
}

export function WalletShell({ children, label, onLogout }: WalletShellProps) {
  return (
    <div className="flex min-h-svh flex-col bg-canvas">
      <a
        href="#wallet-main-content"
        className="fixed top-3 left-3 z-50 -translate-y-20 rounded-control bg-white px-4 py-3 font-semibold text-brand-900 shadow-sm transition-transform focus:translate-y-0"
      >
        Saltar al contenido
      </a>
      <header className="border-b border-brand-700 bg-brand-900 text-white">
        <div className="mx-auto flex min-h-20 w-full max-w-[var(--traza-reading-width)] flex-col justify-center gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <BrandMark tone="inverse" descriptor="Espacio personal" />
          <AccountMenu label={label} onLogout={onLogout} inverse />
        </div>
      </header>
      <main
        id="wallet-main-content"
        className="mx-auto w-full max-w-[var(--traza-reading-width)] flex-1 px-4 py-7 sm:px-6 sm:py-10 lg:px-8"
      >
        {children}
      </main>
    </div>
  );
}

import type { ReactNode } from 'react';

import { BrandMark } from '@/components/brand/brand-mark';
import { AccountMenu } from '@/components/navigation/account-menu';
import { Badge } from '@/components/ui/badge';

interface IssuerShellProps {
  children: ReactNode;
  label: string;
  issuerName: string;
  canChangeIssuer: boolean;
  onChangeIssuer: () => void;
  onLogout: () => void;
}

export function IssuerShell({
  canChangeIssuer,
  children,
  label,
  issuerName,
  onChangeIssuer,
  onLogout
}: IssuerShellProps) {
  return (
    <div className="flex min-h-svh flex-col bg-canvas">
      <a
        href="#issuer-main-content"
        className="fixed top-3 left-3 z-50 -translate-y-20 rounded-control bg-white px-4 py-3 font-semibold text-brand-900 shadow-sm transition-transform focus:translate-y-0"
      >
        Saltar al contenido
      </a>

      <header className="border-b border-brand-700 bg-brand-900 text-white">
        <div className="mx-auto w-full max-w-[var(--traza-issuer-reading-width)] px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <BrandMark
              authenticatedDark
              tone="inverse"
              descriptor="Portal del emisor"
            />
            <AccountMenu
              label={label}
              canChangeIssuer={canChangeIssuer}
              onChangeIssuer={onChangeIssuer}
              onLogout={onLogout}
              inverse
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
            <Badge variant="secondary">{'Instituci\u00f3n activa'}</Badge>
            <span className="min-w-0 text-sm font-semibold sm:truncate">
              {issuerName}
            </span>
          </div>
        </div>
      </header>

      <main
        id="issuer-main-content"
        className="mx-auto w-full max-w-[var(--traza-issuer-reading-width)] flex-1 px-4 py-8 sm:px-6 sm:py-12 lg:px-8"
      >
        {children}
      </main>
    </div>
  );
}

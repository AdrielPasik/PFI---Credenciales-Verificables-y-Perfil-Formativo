import type { ReactNode } from 'react';

import { BrandMark } from '@/components/brand/brand-mark';
import { Badge } from '@/components/ui/badge';

interface FoundationLandingShellProps {
  children: ReactNode;
}

export function FoundationLandingShell({
  children
}: FoundationLandingShellProps) {
  return (
    <div className="flex min-h-svh flex-col bg-canvas">
      <a
        href="#main-content"
        className="fixed top-3 left-3 z-50 -translate-y-20 rounded-control bg-brand-900 px-4 py-3 font-semibold text-white shadow-sm transition-transform focus:translate-y-0"
      >
        Saltar al contenido
      </a>

      <header className="border-b border-border-default bg-surface">
        <div className="mx-auto flex min-h-16 w-full max-w-[var(--traza-reading-width)] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <BrandMark descriptor="Identidad temporal" />
          <Badge variant="outline">UI foundation v0.1</Badge>
        </div>
      </header>

      <main
        id="main-content"
        className="mx-auto flex w-full max-w-[var(--traza-reading-width)] flex-1 px-4 sm:px-6 lg:px-8"
      >
        {children}
      </main>

      <footer className="border-t border-border-default bg-surface">
        <div className="mx-auto flex w-full max-w-[var(--traza-reading-width)] flex-col gap-1 px-4 py-6 text-sm text-text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <span>Traza</span>
          <span>Credenciales verificables y perfil formativo</span>
        </div>
      </footer>
    </div>
  );
}

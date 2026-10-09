import type { ReactNode } from 'react';

import { BrandMark } from '@/components/brand/brand-mark';
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
  return (
    <div className="flex min-h-svh flex-col bg-surface-muted/55">
      <a
        href="#issuer-main-content"
        className="fixed top-3 left-3 z-50 -translate-y-20 rounded-control bg-white px-4 py-3 font-semibold text-brand-900 shadow-sm transition-transform focus:translate-y-0"
      >
        Saltar al contenido
      </a>

      <header className="border-b border-brand-700 bg-brand-900 text-white shadow-sm">
        <div className="mx-auto w-full max-w-[90rem] px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 border-b border-white/10 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <BrandMark
              authenticatedDark
              tone="inverse"
              descriptor="Portal del emisor"
            />
            <AccountMenu
              label={label}
              canChangeIssuer={canChangeIssuer}
              isPlatformAdmin={isPlatformAdmin}
              onChangeIssuer={onChangeIssuer}
              onLogout={onLogout}
              inverse
            />
          </div>
          <div className="mt-4 flex min-w-0 flex-wrap items-center gap-3">
            <Badge variant="secondary">{contextBadge}</Badge>
            <span className="min-w-0 text-sm font-semibold text-brand-100 sm:truncate">
              {issuerName}
            </span>
          </div>
        </div>
      </header>

      <main
        id="issuer-main-content"
        className="mx-auto w-full max-w-[90rem] flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12"
      >
        {children}
      </main>
    </div>
  );
}

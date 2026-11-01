import Link from 'next/link';
import type { ReactNode } from 'react';

import { BrandMark } from '@/components/brand/brand-mark';
import { Button } from '@/components/ui/button';

/**
 * Pantalla para cuando no hay nada que mostrar (404, error inesperado).
 *
 * Siempre ofrece una salida: "Ir al inicio de Scope" lleva a `/`, que ya resuelve
 * el destino segun la sesion (iniciar sesion, espacio personal o panel del
 * emisor). No muestra detalles tecnicos del error.
 */
export function DeadEndPage({
  title,
  description,
  extraAction
}: {
  title: string;
  description: string;
  extraAction?: ReactNode;
}) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-canvas px-4 py-10">
      <div className="grid w-full max-w-lg gap-6 rounded-card border border-border-default bg-surface p-6 shadow-sm sm:p-8">
        <BrandMark lightLogo />
        <div className="grid gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-text-strong">{title}</h1>
          <p className="leading-7 text-text-muted">{description}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {extraAction}
          <Button asChild variant={extraAction ? 'secondary' : 'default'}>
            <Link href="/">Ir al inicio de Scope</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}

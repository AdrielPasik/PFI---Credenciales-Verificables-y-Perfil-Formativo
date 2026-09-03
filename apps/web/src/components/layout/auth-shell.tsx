import Image from 'next/image';
import type { ReactNode } from 'react';

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh bg-canvas lg:grid lg:grid-cols-[minmax(26rem,0.9fr)_minmax(34rem,1.1fr)]">
      <main className="order-1 flex min-h-svh items-center justify-center bg-surface-muted px-4 py-8 sm:px-8 sm:py-12 lg:order-2 lg:px-12 lg:py-16">
        <div className="w-full max-w-xl">{children}</div>
      </main>

      <aside className="order-2 border-t border-white/10 bg-brand-900 text-white lg:order-1 lg:border-t-0 lg:border-r lg:border-white/10">
        <div className="mx-auto flex min-h-[23rem] max-w-xl flex-col justify-between px-5 py-8 sm:min-h-[25rem] sm:px-8 sm:py-10 lg:min-h-svh lg:px-12 lg:py-12">
          <Image
            alt="Scope"
            className="size-28 object-contain sm:size-32"
            height={1254}
            priority
            src="/brand/Logo%20Scope%20Invertido.png"
            width={1254}
          />

          <div className="py-8 sm:py-10 lg:py-14">
            <p className="text-xs font-semibold tracking-[0.18em] text-brand-100/80 uppercase">
              Formación, evidencia y contexto
            </p>
            <h1
              aria-label="Credenciales verificables. Trayectorias que se entienden."
              className="mt-4 max-w-xl text-3xl leading-[1.1] font-bold tracking-[-0.04em] text-balance sm:text-4xl lg:text-5xl"
            >
              <span className="block">Credenciales verificables.</span>
              <span className="block">Trayectorias que se entienden.</span>
            </h1>
            <p className="mt-5 max-w-md text-base leading-7 text-brand-100/80">
              Scope reúne credenciales, evidencia y análisis formativo para
              construir perfiles más claros, confiables y verificables.
            </p>
          </div>

          <p className="border-t border-white/15 pt-5 text-xs leading-5 font-medium text-brand-100/75">
            Una nueva forma de entender tu trayectoria.
          </p>
        </div>
      </aside>
    </div>
  );
}

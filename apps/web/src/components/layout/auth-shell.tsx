import Image from 'next/image';
import { BadgeCheck, Route, SearchCheck } from 'lucide-react';
import type { ReactNode } from 'react';

const productPrinciples = [
  {
    icon: BadgeCheck,
    title: 'Credenciales confiables',
    description: 'Información emitida por instituciones y respaldada por evidencia.'
  },
  {
    icon: Route,
    title: 'Perfil formativo',
    description: 'Áreas, habilidades y conceptos organizados a partir de la trayectoria.'
  },
  {
    icon: SearchCheck,
    title: 'Verificación simple',
    description: 'Información clara para titulares, emisores y verificadores.'
  }
];

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh bg-canvas lg:grid lg:grid-cols-[minmax(23rem,0.88fr)_minmax(32rem,1.12fr)]">
      <aside className="relative overflow-hidden bg-surface text-text-strong">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-surface"
        />
        <div
          aria-hidden="true"
          className="absolute -right-28 -bottom-32 size-96 rounded-pill border border-brand-accent/20"
        />
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 bottom-8 h-72 w-[32rem] text-brand-accent opacity-20"
          fill="none"
          viewBox="0 0 512 288"
        >
          <path d="M8 248C104 214 99 80 222 97c80 11 69 122 176 78 35-14 62-51 106-63" stroke="currentColor" strokeWidth="2" />
          <circle cx="102" cy="184" r="8" fill="currentColor" />
          <circle cx="222" cy="97" r="10" fill="currentColor" />
          <circle cx="398" cy="175" r="8" fill="currentColor" />
        </svg>

        <div className="relative mx-auto flex h-full max-w-xl flex-col px-5 py-5 sm:px-8 sm:py-7 lg:min-h-svh lg:px-12 lg:py-10">
          <Image
            alt="Traza"
            className="h-auto w-44"
            height={1254}
            priority
            src="/brand/traza-logo.png"
            width={1254}
          />

          <div className="py-8 lg:my-auto lg:py-16">
            <p className="text-sm font-semibold tracking-widest text-teal-700 uppercase">
              Credenciales y trayectoria
            </p>
            <h1
              aria-label="Credenciales verificables. Trayectorias que se entienden."
              className="mt-4 max-w-xl text-3xl leading-[1.12] font-bold tracking-tight text-balance text-text-strong sm:text-4xl lg:text-[2.75rem]"
            >
              <span className="block">Credenciales verificables.</span>
              <span className="block">Trayectorias que se entienden.</span>
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-text-muted">
              Traza reúne credenciales, evidencia y análisis formativo para
              construir perfiles más claros, confiables y verificables.
            </p>
            <ul className="mt-10 hidden gap-5 lg:grid">
              {productPrinciples.map((principle) => {
                const Icon = principle.icon;

                return (
                  <li
                    key={principle.title}
                    className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3"
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-10 items-center justify-center rounded-control border border-brand-accent/25 bg-brand-accent/10 text-brand-accent shadow-xs"
                    >
                      <Icon className="size-5" />
                    </span>
                    <div>
                      <p className="font-semibold">{principle.title}</p>
                      <p className="mt-0.5 text-sm leading-6 text-text-muted">
                        {principle.description}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <p className="text-xs leading-5 font-medium text-brand-accent">
            Credenciales verificables para trayectorias formativas confiables.
          </p>
        </div>
      </aside>

      <main className="flex min-h-[calc(100svh-18.5rem)] items-center justify-center bg-brand-900 px-4 py-8 sm:min-h-[calc(100svh-21rem)] sm:px-8 sm:py-10 lg:min-h-svh lg:px-12">
        <div className="w-full max-w-lg">{children}</div>
      </main>
    </div>
  );
}

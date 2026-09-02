import Image from 'next/image';
import { BadgeCheck, BookOpenCheck, SearchCheck } from 'lucide-react';
import type { ReactNode } from 'react';

const productPrinciples = [
  {
    icon: BadgeCheck,
    title: 'Credenciales confiables',
    description: 'Información emitida por instituciones y respaldada por evidencia.'
  },
  {
    icon: BookOpenCheck,
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
    <div className="min-h-svh bg-canvas lg:grid lg:grid-cols-[minmax(23rem,0.9fr)_minmax(34rem,1.1fr)]">
      <aside className="bg-surface text-text-strong">
        <div className="relative mx-auto flex h-full max-w-xl flex-col px-5 py-5 sm:px-8 sm:py-7 lg:min-h-svh lg:px-12 lg:py-10">
          <Image
            alt="Scope"
            className="size-24 object-contain sm:size-28"
            height={1254}
            priority
            src="/brand/Logo%20Scope%202.png"
            width={1254}
          />

          <div className="py-8 sm:py-10 lg:my-auto lg:py-12">
            <p className="text-sm font-semibold tracking-widest text-teal-700 uppercase">
              Credenciales y trayectoria
            </p>
            <h1
              aria-label="Credenciales verificables. Trayectorias que se entienden."
              className="mt-4 max-w-xl text-3xl leading-[1.12] font-bold tracking-tight text-balance text-text-strong sm:text-4xl lg:text-5xl"
            >
              <span className="block">Credenciales verificables.</span>
              <span className="block">Trayectorias que se entienden.</span>
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-text-muted">
              Scope reúne credenciales, evidencia y análisis formativo para
              construir perfiles más claros, confiables y verificables.
            </p>
            <ul className="mt-8 hidden gap-5 lg:grid">
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
            Una nueva forma de entender tu trayectoria.
          </p>
        </div>
      </aside>

      <main className="flex min-h-[calc(100svh-18.5rem)] items-center justify-center bg-brand-900 px-4 py-8 sm:min-h-[calc(100svh-21rem)] sm:px-8 sm:py-10 lg:min-h-svh lg:px-12">
        <div className="w-full max-w-lg">{children}</div>
      </main>
    </div>
  );
}

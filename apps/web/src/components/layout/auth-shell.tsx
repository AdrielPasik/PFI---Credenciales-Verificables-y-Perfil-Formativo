import { KeyRound, Route, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

import { BrandMark } from '@/components/brand/brand-mark';

const trustPrinciples = [
  {
    icon: ShieldCheck,
    title: 'Autoridad institucional',
    description: 'Cada operación depende de permisos y contexto verificados.'
  },
  {
    icon: Route,
    title: 'Trayectoria comprensible',
    description: 'La evidencia técnica se traduce en información clara.'
  },
  {
    icon: KeyRound,
    title: 'Acceso controlado',
    description: 'La sesión define qué experiencia corresponde a cada cuenta.'
  }
];

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh bg-canvas lg:grid lg:grid-cols-[minmax(22rem,0.9fr)_minmax(30rem,1.1fr)]">
      <aside className="relative overflow-hidden bg-brand-900 text-white">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-linear-to-br from-brand-900 via-brand-900 to-brand-700"
        />
        <div
          aria-hidden="true"
          className="absolute -right-24 -bottom-24 size-80 rounded-pill border border-teal-600/30"
        />
        <div
          aria-hidden="true"
          className="absolute right-14 bottom-20 size-3 rounded-pill bg-amber-600"
        />

        <div className="relative mx-auto flex h-full max-w-2xl flex-col px-5 py-6 sm:px-8 lg:min-h-svh lg:px-12 lg:py-10">
          <BrandMark
            tone="inverse"
            descriptor="Identidad temporal"
          />

          <div className="my-auto hidden py-16 lg:block">
            <p className="text-sm font-semibold tracking-widest text-teal-100 uppercase">
              Credenciales y trayectoria
            </p>
            <h2 className="mt-5 max-w-xl text-4xl leading-tight font-bold tracking-tight text-balance">
              Confianza institucional, expresada con claridad.
            </h2>
            <p className="mt-5 max-w-lg text-base leading-7 text-brand-100/80">
              Traza conecta emisión, evidencia y perfil formativo sin trasladar
              la complejidad técnica a las personas.
            </p>

            <ul className="mt-12 grid gap-6">
              {trustPrinciples.map((principle) => {
                const Icon = principle.icon;

                return (
                  <li
                    key={principle.title}
                    className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-4"
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-11 items-center justify-center rounded-control border border-white/15 bg-white/5 text-teal-100"
                    >
                      <Icon className="size-5" />
                    </span>
                    <div>
                      <h3 className="font-semibold">{principle.title}</h3>
                      <p className="mt-1 text-sm leading-6 text-brand-100/75">
                        {principle.description}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <p className="hidden text-xs leading-5 text-brand-100/60 lg:block">
            Credenciales verificables para trayectorias formativas confiables.
          </p>
        </div>
      </aside>

      <main className="flex min-h-[calc(100svh-5.5rem)] items-center justify-center px-4 py-10 sm:px-8 lg:min-h-svh lg:px-12">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}

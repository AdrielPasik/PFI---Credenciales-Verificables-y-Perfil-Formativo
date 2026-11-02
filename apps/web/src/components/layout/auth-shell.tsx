import { BadgeCheck, Share2, ShieldCheck, type LucideIcon } from 'lucide-react';
import Image from 'next/image';
import type { ReactNode } from 'react';

import { AmbientLight } from '@/components/layout/shell-band';
import { AppearanceControl } from '@/components/navigation/appearance-control';

const VALUE_POINTS: ReadonlyArray<{ icon: LucideIcon; label: string }> = [
  { icon: BadgeCheck, label: 'Credenciales emitidas por instituciones' },
  { icon: ShieldCheck, label: 'Evidencia de integridad verificable' },
  { icon: Share2, label: 'Un perfil formativo que podés compartir' }
];

/**
 * Autenticacion (login, registro, recuperacion): fondo ambiental a pantalla
 * completa, identidad de Scope a la izquierda y el formulario a la derecha,
 * SIEMPRE sobre una tarjeta opaca: ningun efecto queda detras de los campos.
 *
 * En movil la marca se compacta arriba del formulario y los puntos de valor
 * se ocultan, para que el formulario quede a la vista.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="ambient-surface min-h-svh text-white">
      <AmbientLight />
      <AppearanceControl tone="inverse" className="absolute top-4 right-4 z-10 sm:top-6 sm:right-8" />

      <div className="mx-auto grid min-h-svh w-full max-w-6xl content-center gap-8 px-4 pt-20 pb-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(26rem,32rem)] lg:items-center lg:gap-16 lg:px-12 lg:py-16">
        <aside className="grid min-w-0 gap-5 lg:gap-0">
          <Image
            alt="Scope"
            className="size-16 object-contain sm:size-20 lg:size-28"
            height={112}
            priority
            src="/brand/Logo%20Scope%20Invertido.png"
            width={112}
          />

          <div className="lg:py-12">
            <p className="hidden text-xs font-semibold tracking-[0.18em] text-teal-100 uppercase sm:block">
              Formación, evidencia y contexto
            </p>
            <h1
              aria-label="Credenciales verificables. Trayectorias que se entienden."
              className="max-w-xl text-2xl leading-[1.15] font-bold tracking-[-0.03em] text-balance sm:mt-4 sm:text-4xl lg:text-5xl lg:leading-[1.08] lg:tracking-[-0.04em]"
            >
              <span className="block">Credenciales verificables.</span>
              <span className="block">Trayectorias que se entienden.</span>
            </h1>
            <p className="mt-5 hidden max-w-md text-base leading-7 text-brand-100/90 lg:block">
              Scope reúne credenciales, evidencia y análisis formativo para
              construir perfiles más claros, confiables y verificables.
            </p>
            <ul className="mt-8 hidden gap-3 lg:grid" aria-label="Qué ofrece Scope">
              {VALUE_POINTS.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-3 text-sm text-brand-100">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-control border border-white/15 bg-white/5 text-teal-100">
                    <Icon aria-hidden="true" className="size-4" />
                  </span>
                  {label}
                </li>
              ))}
            </ul>
          </div>

          <p className="hidden border-t border-white/15 pt-5 text-xs leading-5 font-medium text-brand-100/90 lg:block">
            Una nueva forma de entender tu trayectoria.
          </p>
        </aside>

        <main className="w-full min-w-0 max-w-xl justify-self-center text-text-default lg:max-w-none">
          {children}
        </main>
      </div>
    </div>
  );
}

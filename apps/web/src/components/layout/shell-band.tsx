'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils';

/**
 * Banda de bienvenida: la pantalla raiz de un espacio (inicio del titular,
 * inicio del emisor) extiende el header con su propia banda ambiental, a todo
 * el ancho y pegada al header.
 *
 * El contenido de la banda depende de la pantalla (saludo, metricas,
 * acciones), pero su lugar esta en el shell, FUERA del `main` con ancho
 * maximo. El shell reserva un slot debajo del header y la pantalla lo llena con
 * `ShellBand` via portal. El slot se registra con un callback ref: React aplica
 * esa actualizacion antes de pintar, asi que la banda no aparece "tarde".
 *
 * Fuera de un shell (tests, composiciones aisladas) la banda se dibuja en el
 * lugar, para que la pantalla siga completa.
 */

interface ShellBandTarget {
  node: HTMLElement | null;
  /** Ancho y margenes del contenido del shell, para alinear la banda. */
  containerClassName: string;
}

const ShellBandContext = createContext<ShellBandTarget | undefined>(undefined);

export function useShellBandSlot(containerClassName: string) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  return {
    slot: <div data-shell-band="" ref={setNode} />,
    target: { node, containerClassName }
  };
}

export const ShellBandProvider = ShellBandContext.Provider;

/** Capa de luz ambiental animada de una `.ambient-surface`. Decorativa. */
export function AmbientLight() {
  return <span aria-hidden="true" className="ambient-light" />;
}

export function ShellBand({
  children,
  labelledBy
}: {
  children: ReactNode;
  labelledBy: string;
}) {
  const target = useContext(ShellBandContext);

  const band = (
    <section aria-labelledby={labelledBy} className="ambient-surface text-white">
      <AmbientLight />
      <div
        className={cn(
          target?.containerClassName ?? 'w-full px-4 sm:px-6 lg:px-8',
          'pt-8 pb-14 sm:pt-10 sm:pb-16'
        )}
      >
        {children}
      </div>
    </section>
  );

  if (target === undefined) return band;
  if (target.node === null) return null;
  return createPortal(band, target.node);
}

'use client';

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

import { AuthShell } from '@/components/layout/auth-shell';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

/**
 * Marco comun de las pantallas de recuperacion: el mismo `AuthShell`, la misma
 * `Card` con barra de acento, el mismo encabezado (sobretitulo, h2, descripcion) y
 * los mismos espaciados que el login. No introduce ningun estilo nuevo.
 */
export function RecoveryCard({
  kicker,
  title,
  description,
  titleRef,
  children
}: {
  kicker: string;
  title: string;
  description?: ReactNode;
  /** El titulo recibe el foco al cambiar de estado, para que se anuncie. */
  titleRef?: RefObject<HTMLHeadingElement | null>;
  children?: ReactNode;
}) {
  return (
    <AuthShell>
      <Card className="overflow-hidden border-border-strong bg-surface shadow-lg shadow-brand-900/8">
        <div aria-hidden="true" className="h-1 bg-brand-accent" />
        <CardHeader className="gap-3 pb-5 sm:p-9 sm:pb-6">
          <p className="text-xs font-semibold tracking-[0.16em] text-teal-700 uppercase">
            {kicker}
          </p>
          <h2
            ref={titleRef}
            tabIndex={-1}
            className="text-3xl leading-tight font-bold tracking-[-0.035em] text-text-strong outline-none sm:text-[2rem]"
          >
            {title}
          </h2>
          {description ? (
            <p className="max-w-md text-sm leading-6 text-text-muted">
              {description}
            </p>
          ) : null}
        </CardHeader>
        {children ? (
          <CardContent className="pt-2 sm:px-9 sm:pb-9">{children}</CardContent>
        ) : null}
      </Card>
    </AuthShell>
  );
}

/**
 * Mueve el foco al titulo cuando cambia `key`, salvo en el primer montaje (donde el
 * foco lo gestiona el campo inicial, o ninguno). Asi un lector de pantalla anuncia
 * el nuevo estado -- exito, enlace invalido, confirmacion -- en vez de quedarse
 * sobre un elemento que ya no existe.
 */
export function useFocusTitleOnChange(key: string) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const previous = useRef<string | null>(null);

  useEffect(() => {
    if (previous.current !== null && previous.current !== key) {
      titleRef.current?.focus();
    }
    previous.current = key;
  }, [key]);

  return titleRef;
}

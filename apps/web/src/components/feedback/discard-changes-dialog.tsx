'use client';

import { useEffect, useId, useRef } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Confirmacion para abandonar un formulario con cambios sin guardar.
 *
 * Es el dialogo que ya usaba la revision de objetivos, generalizado: el foco
 * inicial va a la opcion SEGURA (quedarse) y Escape tambien se queda. Descartar
 * es siempre una decision explicita.
 */
export function DiscardChangesDialog({
  title,
  description,
  stayLabel,
  discardLabel,
  onStay,
  onDiscard
}: {
  title: string;
  description: string;
  stayLabel: string;
  discardLabel: string;
  onStay: () => void;
  onDiscard: () => void;
}) {
  const stayRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    stayRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onStay();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onStay]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-md rounded-card border border-border-default bg-surface p-6 shadow-lg"
      >
        <h2 id={titleId} className="text-lg font-semibold text-text-strong">
          {title}
        </h2>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-text-muted">
          {description}
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button ref={stayRef} type="button" variant="secondary" onClick={onStay}>
            {stayLabel}
          </Button>
          <Button type="button" variant="destructive" onClick={onDiscard}>
            {discardLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

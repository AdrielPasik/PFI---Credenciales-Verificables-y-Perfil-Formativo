'use client';

/**
 * Objetivo original con el fragmento resaltado — P2.3.
 *
 * El recorte es por CODE POINTS, no con `slice`. El smoke real de P2.2 lo dejo
 * demostrado: en un objetivo con un emoji fuera del BMP, interpretar los offsets
 * como unidades UTF-16 devuelve texto distinto y el resaltado se corre.
 *
 * No se muestran offsets, ni el estado de anclaje crudo, ni nada del proveedor.
 */

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

import { splitAroundRange } from '@/features/holder/objectives/review-draft';
import type { ObjectiveSourceRangeVM } from '@/models/objectives';

interface ObjectiveSourceDialogProps {
  rawObjectiveText: string;
  range: ObjectiveSourceRangeVM | null;
  onClose: () => void;
}

export function ObjectiveSourceDialog({
  rawObjectiveText,
  range,
  onClose
}: ObjectiveSourceDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const highlightRef = useRef<HTMLElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Se recuerda QUIEN abrio el dialogo para devolverle el foco al cerrar. En
    // una lista de 17 requisitos, perder la posicion deja al teclado sin
    // referencia y obliga a recorrerla entera de nuevo.
    const trigger = document.activeElement as HTMLElement | null;

    closeRef.current?.focus();
    // Opcional a proposito: no todos los entornos de render lo implementan, y
    // desplazar es una comodidad, no parte del contrato del dialogo.
    highlightRef.current?.scrollIntoView?.({ block: 'center' });

    return () => {
      // `isConnected` porque el disparador puede haber desaparecido del DOM
      // mientras el dialogo estaba abierto; enfocar un nodo suelto no hace nada
      // util y deja el foco en el limbo.
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || containerRef.current === null) return;

      // Trampa de foco: el dialogo es modal, asi que tabular no puede sacar al
      // teclado hacia la pagina de atras.
      const focusable = containerRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const segments =
    range === null
      ? null
      : splitAroundRange(rawObjectiveText, range.start, range.end);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="objective-source-dialog-title"
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-card border border-border-default bg-surface shadow-lg"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border-default p-5">
          <h2
            id="objective-source-dialog-title"
            className="text-lg font-semibold text-text-strong"
          >
            Objetivo original
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar el objetivo original"
            className="rounded-control p-1 text-text-muted transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-text-default">
            {segments === null ? (
              rawObjectiveText
            ) : (
              <>
                {segments.before}
                <mark
                  ref={highlightRef}
                  className="rounded-sm bg-amber-100 px-0.5 font-medium text-text-strong"
                >
                  {segments.highlighted}
                </mark>
                {segments.after}
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

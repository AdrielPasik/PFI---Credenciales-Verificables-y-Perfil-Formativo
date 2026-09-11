'use client';

/**
 * Un requisito en revision — P2.3.
 *
 * Densidad: con 17-20 items la lista es larga, asi que el textarea domina y todo
 * lo demas es una linea. Sin tarjetas pesadas, sin iconos decorativos.
 *
 * Lo que NUNCA se renderiza: candidateId, charStart, charEnd, el enum de
 * anclaje, la version de schema, nada del proveedor.
 */

import { useEffect, useRef } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';

import { Textarea } from '@/components/ui/textarea';
import { formatSectionLabel } from '@/features/holder/objectives/review-draft';
import type { ReviewItem } from '@/models/objectives';

interface RequirementReviewItemProps {
  item: ReviewItem;
  position: number;
  total: number;
  shouldFocus: boolean;
  onFocusHandled: () => void;
  onEdit: (text: string) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  onShowInSource: () => void;
}

export function RequirementReviewItem({
  item,
  position,
  total,
  shouldFocus,
  onFocusHandled,
  onEdit,
  onRemove,
  onMove,
  onShowInSource
}: RequirementReviewItemProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sectionLabel = formatSectionLabel(item.sourceSectionLabel);
  const isBlank = item.text.trim().length === 0;

  useEffect(() => {
    if (!shouldFocus) return;
    textareaRef.current?.focus();
    onFocusHandled();
  }, [shouldFocus, onFocusHandled]);

  const originLabel = item.origin === 'MANUAL' ? 'Agregado por vos' : 'Del objetivo';

  return (
    <li className="grid gap-3 border-b border-border-default py-5 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-text-strong">{position}.</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={position === 1}
            aria-label={`Subir requisito ${position}`}
            className="rounded-control p-2 text-text-muted transition hover:bg-surface-muted disabled:opacity-30 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
          >
            <ArrowUp aria-hidden="true" className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={position === total}
            aria-label={`Bajar requisito ${position}`}
            className="rounded-control p-2 text-text-muted transition hover:bg-surface-muted disabled:opacity-30 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
          >
            <ArrowDown aria-hidden="true" className="size-4" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Eliminar requisito ${position}`}
            className="rounded-control p-2 text-text-muted transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      </div>

      <Textarea
        ref={textareaRef}
        value={item.text}
        onChange={(event) => onEdit(event.target.value)}
        rows={2}
        aria-label={`Requisito ${position}`}
        aria-invalid={isBlank || undefined}
        aria-describedby={isBlank ? `${item.localKey}-blank` : undefined}
        className="min-h-16 w-full"
      />
      {isBlank ? (
        <p id={`${item.localKey}-blank`} className="text-xs text-status-error">
          Escribi el requisito o elimina esta fila.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
        <span>{originLabel}</span>
        {item.wasEverEdited ? <span aria-label="Editado">· Editado</span> : null}
        {item.isExactDuplicate ? <span>· Repetido</span> : null}
      </div>

      {item.grounding === 'UNIQUE' && item.primaryExcerpt !== null ? (
        <details>
          <summary className="w-fit cursor-pointer list-none text-xs font-medium text-brand-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">
            Ver fragmento del objetivo
          </summary>
          <div className="mt-2 rounded-control border-l-2 border-teal-700 bg-surface-muted px-3 py-2">
            {sectionLabel ? (
              <p className="text-xs font-medium text-text-muted">
                En el objetivo, seccion &ldquo;{sectionLabel}&rdquo;
              </p>
            ) : null}
            <p className="mt-1 whitespace-pre-wrap break-words text-sm italic leading-6 text-text-default">
              {item.primaryExcerpt}
            </p>
            <button
              type="button"
              onClick={onShowInSource}
              className="mt-2 text-xs font-medium text-brand-700 underline underline-offset-2 transition hover:text-brand-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
            >
              Ver en el objetivo completo
            </button>
          </div>
        </details>
      ) : null}

      {item.grounding === 'AMBIGUOUS' ? (
        <p className="text-xs text-amber-800">
          Esta frase aparece varias veces en el objetivo.
        </p>
      ) : null}
      {item.grounding === 'NOT_FOUND' ? (
        <p className="text-xs text-amber-800">
          No pudimos ubicar la frase exacta en el objetivo. Revisalo con atencion.
        </p>
      ) : null}
    </li>
  );
}

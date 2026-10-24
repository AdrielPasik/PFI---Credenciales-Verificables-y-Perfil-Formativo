'use client';

import { ChevronDown, ChevronUp, FileText, TextQuote } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/**
 * Fuentes de respaldo (opcional).
 *
 * Presenta las fuentes independientes de una credencial -- el documento y la
 * fuente textual -- de forma compacta: las fuentes ya guardadas se ven siempre,
 * y los formularios para agregar o reemplazar quedan PLEGADOS hasta que el
 * emisor decide usarlos.
 *
 * Plegado no es desmontado. Cada composer sigue montado y solo se oculta con
 * `hidden`, asi que lo que el emisor ya escribio o el archivo que ya eligio
 * sobreviven a abrir y cerrar el panel. Cuando un panel cerrado conserva algo
 * sin guardar (o un error), el boton lo dice: un estado de guardado nunca queda
 * escondido detras de un pliegue.
 *
 * Este componente no persiste nada ni conoce el dominio: no hay estado de
 * navegacion guardado y abrir un panel no escribe nada.
 */

export type EvidenceSourceKind = 'document' | 'text';

interface EvidenceWorkspaceProps {
  canComposeDocument: boolean;
  canComposeText: boolean;
  documentComposer: ReactNode;
  documentCurrent: ReactNode;
  /** Hay un documento vigente: el boton pasa de "Agregar" a "Cambiar". */
  hasDocument: boolean;
  /** Hay una fuente textual vigente. */
  hasText: boolean;
  /** Orden de prioridad que aplica a cursos y certificaciones. */
  sourcePriority?: ReactNode;
  /** Bajada de la seccion, segun el tipo de credencial. */
  description: ReactNode;
  textComposer: ReactNode;
  textCurrent: ReactNode;
  /** Algo sin guardar o con error dentro del composer documental. */
  documentNeedsAttention?: boolean;
  /** Algo sin guardar o con error dentro del composer textual. */
  textNeedsAttention?: boolean;
}

export function EvidenceWorkspace({
  canComposeDocument,
  canComposeText,
  description,
  documentComposer,
  documentCurrent,
  documentNeedsAttention = false,
  hasDocument,
  hasText,
  sourcePriority,
  textComposer,
  textCurrent,
  textNeedsAttention = false
}: EvidenceWorkspaceProps) {
  const [open, setOpen] = useState<Record<EvidenceSourceKind, boolean>>({
    document: false,
    text: false
  });
  const documentPanelId = useId();
  const textPanelId = useId();
  const hasCurrentEvidence =
    Boolean(documentCurrent) || Boolean(textCurrent);
  const canCompose = canComposeDocument || canComposeText;

  function toggle(kind: EvidenceSourceKind) {
    setOpen((current) => ({ ...current, [kind]: !current[kind] }));
  }

  return (
    <section
      aria-labelledby="supporting-evidence-title"
      className="grid gap-5 border-t border-border-default pt-8 sm:pt-10"
    >
      <header className="max-w-3xl">
        <div className="flex flex-wrap items-center gap-3">
          <h2
            id="supporting-evidence-title"
            className="text-2xl font-bold tracking-tight text-text-strong"
          >
            Fuentes de respaldo
          </h2>
          <Badge variant="outline">Opcional</Badge>
        </div>
        <p className="mt-2 leading-7 text-text-muted">{description}</p>
        {sourcePriority ? (
          <div className="mt-3 text-sm leading-6 text-text-muted">
            {sourcePriority}
          </div>
        ) : null}
      </header>

      {hasCurrentEvidence ? (
        <div className="grid gap-4">
          <h3 className="text-sm font-semibold text-text-strong">
            Fuentes cargadas
          </h3>
          <div className="grid gap-4 xl:grid-cols-2">
            {documentCurrent}
            {textCurrent}
          </div>
        </div>
      ) : canCompose ? (
        <p className="text-sm text-text-muted">Sin fuentes cargadas.</p>
      ) : null}

      {canCompose ? (
        <div className="grid gap-4">
          <div
            role="group"
            aria-label="Agregar fuentes de respaldo"
            className="flex flex-wrap items-start gap-3"
          >
            {canComposeDocument ? (
              <SourceToggle
                controls={documentPanelId}
                expanded={open.document}
                icon={<FileText aria-hidden="true" />}
                label={hasDocument ? 'Cambiar documento' : 'Agregar documento'}
                needsAttention={documentNeedsAttention}
                onToggle={() => toggle('document')}
              />
            ) : null}
            {canComposeText ? (
              <SourceToggle
                controls={textPanelId}
                expanded={open.text}
                icon={<TextQuote aria-hidden="true" />}
                label={
                  hasText
                    ? 'Cambiar fuente textual'
                    : 'Agregar fuente textual'
                }
                needsAttention={textNeedsAttention}
                onToggle={() => toggle('text')}
              />
            ) : null}
          </div>

          {/* `hidden` y no desmontar: el texto o el archivo sin guardar de un
              panel cerrado tienen que sobrevivir. */}
          {canComposeDocument ? (
            <div id={documentPanelId} hidden={!open.document}>
              {documentComposer}
            </div>
          ) : null}
          {canComposeText ? (
            <div id={textPanelId} hidden={!open.text}>
              {textComposer}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function SourceToggle({
  controls,
  expanded,
  icon,
  label,
  needsAttention,
  onToggle
}: {
  controls: string;
  expanded: boolean;
  icon: ReactNode;
  label: string;
  needsAttention: boolean;
  onToggle(): void;
}) {
  const Chevron = expanded ? ChevronUp : ChevronDown;

  return (
    <div className="grid gap-1">
      <Button
        type="button"
        variant="secondary"
        aria-expanded={expanded}
        aria-controls={controls}
        onClick={onToggle}
      >
        {icon}
        {label}
        <Chevron aria-hidden="true" />
      </Button>
      {needsAttention && !expanded ? (
        <p role="status" className="text-xs font-semibold text-status-warning">
          Tenés cambios sin guardar
        </p>
      ) : null}
    </div>
  );
}

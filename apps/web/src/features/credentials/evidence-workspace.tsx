'use client';

import { useState, type ReactNode } from 'react';

type EvidenceComposerMode = 'document' | 'text' | 'both';

interface EvidenceWorkspaceProps {
  canComposeDocument: boolean;
  canComposeText: boolean;
  documentComposer: ReactNode;
  documentCurrent: ReactNode;
  textComposer: ReactNode;
  textCurrent: ReactNode;
}

export function EvidenceWorkspace({
  canComposeDocument,
  canComposeText,
  documentComposer,
  documentCurrent,
  textComposer,
  textCurrent
}: EvidenceWorkspaceProps) {
  const [mode, setMode] = useState<EvidenceComposerMode>('both');
  const canChooseComposer = canComposeDocument && canComposeText;
  const hasCurrentEvidence = Boolean(documentCurrent) || Boolean(textCurrent);
  const showDocumentComposer =
    canComposeDocument && (!canChooseComposer || mode !== 'text');
  const showTextComposer =
    canComposeText && (!canChooseComposer || mode !== 'document');

  return (
    <section
      aria-labelledby="supporting-evidence-title"
      className="grid gap-6 border-t border-border-default pt-8 sm:pt-10"
    >
      <header className="max-w-3xl">
        <p className="text-sm font-semibold text-brand-700">
          Fuentes institucionales
        </p>
        <h2
          id="supporting-evidence-title"
          className="mt-2 text-2xl font-bold tracking-tight text-text-strong"
        >
          Evidencia de respaldo
        </h2>
        <p className="mt-2 leading-7 text-text-muted">
          La evidencia aporta las fuentes institucionales que respaldan esta
          credencial.
        </p>
      </header>

      {hasCurrentEvidence ? (
        <div className="grid gap-4">
          <h3 className="text-sm font-semibold text-text-strong">
            Evidencia actual
          </h3>
          <div className="grid gap-4 xl:grid-cols-2">
            {documentCurrent}
            {textCurrent}
          </div>
        </div>
      ) : null}

      {canComposeDocument || canComposeText ? (
        <div className="grid gap-5 border-t border-border-default pt-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-text-strong">
                Agregar o actualizar evidencia
              </h3>
              <p className="mt-1 text-sm leading-6 text-text-muted">
                Elegí la fuente que querés trabajar. Esta selección no cambia
                la evidencia ya registrada.
              </p>
            </div>
            {canChooseComposer ? (
              <fieldset className="shrink-0">
                <legend className="sr-only">
                  Tipo de evidencia para agregar o actualizar
                </legend>
                <div className="inline-flex flex-wrap rounded-control border border-border-default bg-surface-muted p-1">
                  <EvidenceModeOption
                    checked={mode === 'document'}
                    id="evidence-composer-document"
                    label="Documental"
                    onChange={() => setMode('document')}
                  />
                  <EvidenceModeOption
                    checked={mode === 'text'}
                    id="evidence-composer-text"
                    label="Textual"
                    onChange={() => setMode('text')}
                  />
                  <EvidenceModeOption
                    checked={mode === 'both'}
                    id="evidence-composer-both"
                    label="Ambas"
                    onChange={() => setMode('both')}
                  />
                </div>
              </fieldset>
            ) : null}
          </div>

          <div
            className={
              mode === 'both' && canChooseComposer
                ? 'grid gap-5 xl:grid-cols-2 xl:items-start'
                : 'grid gap-5'
            }
          >
            {canComposeDocument ? (
              <div hidden={!showDocumentComposer}>{documentComposer}</div>
            ) : null}
            {canComposeText ? (
              <div hidden={!showTextComposer}>{textComposer}</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function EvidenceModeOption({
  checked,
  id,
  label,
  onChange
}: {
  checked: boolean;
  id: string;
  label: string;
  onChange(): void;
}) {
  return (
    <label
      className={
        checked
          ? 'cursor-pointer rounded-sm bg-brand-900 px-3 py-2 text-sm font-semibold text-white shadow-xs'
          : 'cursor-pointer rounded-sm px-3 py-2 text-sm font-semibold text-text-muted hover:bg-surface hover:text-text-strong'
      }
      htmlFor={id}
    >
      <input
        checked={checked}
        className="sr-only"
        id={id}
        name="evidence-composer-mode"
        type="radio"
        value={id}
        onChange={onChange}
      />
      {label}
    </label>
  );
}

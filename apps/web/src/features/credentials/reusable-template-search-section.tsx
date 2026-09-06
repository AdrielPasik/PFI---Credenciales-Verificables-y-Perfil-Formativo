'use client';

import { BookmarkPlus, ChevronDown, RotateCcw, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { mapCredentialError } from '@/lib/errors/credential-error-mapper';
import type {
  CourseTemplateSummaryVM,
  CredentialFeedback,
  ReusableCredentialType
} from '@/models/credentials';

interface ReusableTemplateSearchSectionProps {
  credentialType: ReusableCredentialType;
  disabled: boolean;
  appliedTemplate: CourseTemplateSummaryVM | null;
  onApply(template: CourseTemplateSummaryVM): void;
  onClearApplied(): void;
  searchTemplates(
    query: string,
    signal: AbortSignal
  ): Promise<CourseTemplateSummaryVM[]>;
}

const nounByType: Record<ReusableCredentialType, string> = {
  course: 'curso',
  certification: 'certificación'
};

// C3c: seleccionar un template SOLO precarga campos editables -- nunca
// crea una credencial, nunca guarda nada, nunca dispara IA, nunca copia
// SemanticAnalysis ni interpretacion aprobada (eso queda para C4).
export function ReusableTemplateSearchSection({
  credentialType,
  disabled,
  appliedTemplate,
  onApply,
  onClearApplied,
  searchTemplates
}: ReusableTemplateSearchSectionProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CourseTemplateSummaryVM[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [feedback, setFeedback] = useState<CredentialFeedback | null>(null);
  const [previewTemplate, setPreviewTemplate] =
    useState<CourseTemplateSummaryVM | null>(null);
  const [expanded, setExpanded] = useState(false);
  const requestId = useRef(0);
  const abortController = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      requestId.current += 1;
      abortController.current?.abort();
    },
    []
  );

  async function runSearch() {
    abortController.current?.abort();
    const controller = new AbortController();
    const request = ++requestId.current;
    abortController.current = controller;
    setLoading(true);
    setSearched(false);
    setFeedback(null);

    try {
      const found = await searchTemplates(query.trim(), controller.signal);

      if (request === requestId.current) {
        setResults(found);
        setSearched(true);
      }
    } catch (error) {
      if (request === requestId.current && !controller.signal.aborted) {
        setFeedback(mapCredentialError(error, 'template-search'));
      }
    } finally {
      if (request === requestId.current) {
        setLoading(false);
      }
    }
  }

  function confirmApply() {
    if (!previewTemplate) {
      return;
    }

    onApply(previewTemplate);
    setPreviewTemplate(null);
    setResults([]);
    setSearched(false);
    setQuery('');
    setExpanded(false);
  }

  function changeSelection() {
    onClearApplied();
    setPreviewTemplate(null);
    setExpanded(true);
  }

  const noun = nounByType[credentialType];

  return (
    <section
      aria-labelledby="reusable-content-title"
      className="grid max-w-4xl gap-4 border-t border-border-default pt-5"
    >
      {appliedTemplate ? (
        <div className="flex flex-col gap-3 rounded-control border border-border-default bg-surface-muted px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3
              id="reusable-content-title"
              className="text-xs font-semibold tracking-wide text-text-muted uppercase"
            >
              Contenido reutilizable
            </h3>
            <p className="mt-1 truncate font-semibold text-text-strong">
              {appliedTemplate.title}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="self-start sm:self-auto"
            disabled={disabled}
            onClick={changeSelection}
          >
            <RotateCcw aria-hidden="true" />
            Cambiar
          </Button>
        </div>
      ) : (
        <>
          <button
            type="button"
            aria-controls="reusable-content-search"
            aria-expanded={expanded}
            className="flex w-fit items-center gap-3 rounded-control px-1 py-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-focus-ring/25"
            disabled={disabled}
            onClick={() => setExpanded((current) => !current)}
          >
            <BookmarkPlus aria-hidden="true" className="size-5 text-teal-700" />
            <span>
              <span
                id="reusable-content-title"
                className="block font-semibold text-text-strong"
              >
                Usar contenido reutilizable
              </span>
              <span className="mt-0.5 block text-sm text-text-muted">
                Precargá datos desde un curso o certificación guardados.
              </span>
            </span>
            <ChevronDown
              aria-hidden="true"
              className={expanded ? 'size-4 rotate-180' : 'size-4'}
            />
          </button>

          <div
            id="reusable-content-search"
            aria-label="Buscador de contenido reutilizable"
            hidden={!expanded}
            className="grid gap-4"
          >
            {previewTemplate ? (
              <div className="grid gap-3">
                <div className="rounded-control border border-teal-600/25 bg-teal-100 p-4">
                  <p className="text-xs font-bold tracking-wide text-teal-700 uppercase">
                    Vista previa
                  </p>
                  <p className="mt-2 font-semibold text-text-strong">
                    {previewTemplate.title}
                  </p>
                  {previewTemplate.description ? (
                    <p className="mt-1 text-sm leading-6 text-text-muted">
                      {previewTemplate.description}
                    </p>
                  ) : null}
                  <TemplatePreviewMeta template={previewTemplate} />
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button type="button" disabled={disabled} onClick={confirmApply}>
                    Usar este contenido
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={disabled}
                    onClick={() => setPreviewTemplate(null)}
                  >
                    Elegir otro
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid gap-3">
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <div className="grid gap-2">
                    <Label htmlFor="reusable-template-query">
                      Buscar {noun} reutilizable
                    </Label>
                    <input
                      id="reusable-template-query"
                      type="search"
                      value={query}
                      disabled={disabled}
                      placeholder={`Título o plataforma del ${noun}`}
                      className="min-h-11 w-full rounded-control border border-border-strong bg-surface px-3 py-2 text-base text-text-strong shadow-xs outline-none transition-colors placeholder:text-text-subtle hover:border-brand-600 focus-visible:border-brand-600 focus-visible:ring-3 focus-visible:ring-focus-ring/25 disabled:cursor-not-allowed disabled:bg-surface-muted sm:text-sm"
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setFeedback(null);
                      }}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={disabled || loading}
                    onClick={() => void runSearch()}
                  >
                    <Search aria-hidden="true" />
                    {loading ? 'Buscando…' : 'Buscar'}
                  </Button>
                </div>

                <div aria-live="polite">
                  {feedback ? (
                    <FeedbackAlert
                      variant="error"
                      title="No pudimos buscar contenido reutilizable"
                    >
                      {feedback.message}
                    </FeedbackAlert>
                  ) : null}
                  {!loading && !feedback && searched && results.length === 0 ? (
                    <p className="text-sm text-text-muted">
                      No hay contenido reutilizable para este tipo todavía.
                    </p>
                  ) : null}
                </div>

                {results.length > 0 ? (
                  <ul aria-label="Resultados de contenido reutilizable" className="grid gap-2">
                    {results.map((template) => (
                      <li key={template.reference}>
                        <button
                          type="button"
                          disabled={disabled}
                          className="flex w-full items-start justify-between gap-4 rounded-control border border-border-default bg-surface p-3 text-left transition-colors hover:border-teal-600 hover:bg-teal-100 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus-ring/25 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => setPreviewTemplate(template)}
                        >
                          <span className="font-semibold text-text-strong">
                            {template.title}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function TemplatePreviewMeta({
  template
}: {
  template: CourseTemplateSummaryVM;
}) {
  const items: string[] = [];

  if (template.hours) {
    items.push(`${template.hours} horas`);
  }
  if (template.credentialType === 'course' && template.modality) {
    items.push(template.modality);
  }
  if (template.credentialType === 'course' && template.platformName) {
    items.push(template.platformName);
  }
  if (
    template.credentialType === 'certification' &&
    template.providerName
  ) {
    items.push(template.providerName);
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <p className="mt-2 text-sm text-text-muted">{items.join(' · ')}</p>
  );
}

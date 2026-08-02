import { Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { CurriculumAcademicSubjectSearchItemVM } from '@/models/credentials';

interface CurriculumSubjectSearchFieldProps {
  disabled: boolean;
  error: string | null;
  loading: boolean;
  onQueryChange(value: string): void;
  onSearch(): void;
  onSelect(subject: CurriculumAcademicSubjectSearchItemVM): void;
  query: string;
  results: CurriculumAcademicSubjectSearchItemVM[];
  searched: boolean;
}

export function CurriculumSubjectSearchField({
  disabled,
  error,
  loading,
  onQueryChange,
  onSearch,
  onSelect,
  query,
  results,
  searched
}: CurriculumSubjectSearchFieldProps) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="grid gap-2">
          <Label htmlFor="curriculum-subject-query">
            Buscar materia de la carrera
          </Label>
          <input
            id="curriculum-subject-query"
            type="search"
            value={query}
            disabled={disabled}
            placeholder="Nombre o código de materia"
            className="min-h-11 w-full rounded-control border border-border-strong bg-surface px-3 py-2 text-base text-text-strong shadow-xs outline-none transition-colors placeholder:text-text-subtle hover:border-brand-600 focus-visible:border-brand-600 focus-visible:ring-3 focus-visible:ring-focus-ring/25 disabled:cursor-not-allowed disabled:bg-surface-muted sm:text-sm"
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </div>
        <Button type="button" variant="secondary" disabled={disabled || query.trim().length === 0} onClick={onSearch}>
          <Search aria-hidden="true" />
          {loading ? 'Buscando…' : 'Buscar materia'}
        </Button>
      </div>

      <div aria-live="polite">
        {error ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-status-error/30 bg-status-error-soft p-3 text-sm text-status-error">
            <p>{error}</p>
            <Button type="button" size="sm" variant="secondary" onClick={onSearch}>
              Reintentar
            </Button>
          </div>
        ) : null}
        {!loading && !error && searched && results.length === 0 ? (
          <p className="text-sm text-text-muted">
            No hay materias para mostrar en esta currícula.
          </p>
        ) : null}
      </div>

      {results.length > 0 ? (
        <ul aria-label="Resultados de materias" className="grid gap-2">
          {results.map((subject) => (
            <li key={subject.academicCourseReference}>
              <button
                type="button"
                disabled={disabled}
                className="flex w-full items-start justify-between gap-4 rounded-control border border-border-default bg-surface p-3 text-left transition-colors hover:border-teal-600 hover:bg-teal-100 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus-ring/25 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => onSelect(subject)}
              >
                <span className="font-semibold text-text-strong">{subject.name}</span>
                <span className="shrink-0 text-sm font-semibold text-text-muted">{subject.code}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

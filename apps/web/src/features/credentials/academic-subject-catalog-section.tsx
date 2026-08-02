'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { AcademicProgramSearchField } from '@/features/credentials/academic-program-search-field';
import { CurriculumSubjectSearchField } from '@/features/credentials/curriculum-subject-search-field';
import { SelectedAcademicSubjectCard } from '@/features/credentials/selected-academic-subject-card';
import type {
  AcademicProgramSearchItemVM,
  CurriculumAcademicSubjectSearchItemVM,
  IssuerCredentialDetailVM
} from '@/models/credentials';

export interface AcademicSubjectCatalogSearchHandlers {
  searchPrograms(query: string, signal: AbortSignal): Promise<AcademicProgramSearchItemVM[]>;
  searchSubjects(curriculumReference: string, query: string, signal: AbortSignal): Promise<CurriculumAcademicSubjectSearchItemVM[]>;
}

interface AcademicSubjectCatalogSectionProps extends AcademicSubjectCatalogSearchHandlers {
  disabled: boolean;
  onPendingSelectionChange(selection: CurriculumAcademicSubjectSearchItemVM | null): void;
  pendingSelection: CurriculumAcademicSubjectSearchItemVM | null;
  persistedSelection: IssuerCredentialDetailVM['academicCourse'];
}

const catalogError = 'No pudimos consultar el catálogo. Intentá nuevamente.';

export function AcademicSubjectCatalogSection({
  disabled,
  onPendingSelectionChange,
  pendingSelection,
  persistedSelection,
  searchPrograms,
  searchSubjects
}: AcademicSubjectCatalogSectionProps) {
  const [programQuery, setProgramQuery] = useState('');
  const [programResults, setProgramResults] = useState<AcademicProgramSearchItemVM[]>([]);
  const [programError, setProgramError] = useState<string | null>(null);
  const [programLoading, setProgramLoading] = useState(false);
  const [programSearched, setProgramSearched] = useState(false);
  const [selectedProgram, setSelectedProgram] = useState<AcademicProgramSearchItemVM | null>(
    persistedSelection?.program ?? null
  );
  const [subjectQuery, setSubjectQuery] = useState('');
  const [subjectResults, setSubjectResults] = useState<CurriculumAcademicSubjectSearchItemVM[]>([]);
  const [subjectError, setSubjectError] = useState<string | null>(null);
  const [subjectLoading, setSubjectLoading] = useState(false);
  const [subjectSearched, setSubjectSearched] = useState(false);
  const programRequest = useRef(0);
  const subjectRequest = useRef(0);
  const programAbort = useRef<AbortController | null>(null);
  const subjectAbort = useRef<AbortController | null>(null);

  useEffect(() => () => {
    programRequest.current += 1;
    subjectRequest.current += 1;
    programAbort.current?.abort();
    subjectAbort.current?.abort();
  }, []);

  async function runProgramSearch() {
    const query = programQuery.trim();
    if (!query) return;

    programAbort.current?.abort();
    const controller = new AbortController();
    programAbort.current = controller;
    const request = ++programRequest.current;
    setProgramLoading(true);
    setProgramSearched(false);
    setProgramError(null);

    try {
      const results = await searchPrograms(query, controller.signal);
      if (request === programRequest.current) {
        setProgramResults(results);
        setProgramSearched(true);
      }
    } catch {
      if (request === programRequest.current) setProgramError(catalogError);
    } finally {
      if (request === programRequest.current) setProgramLoading(false);
    }
  }

  function selectProgram(program: AcademicProgramSearchItemVM) {
    subjectAbort.current?.abort();
    subjectRequest.current += 1;
    setSelectedProgram(program);
    setSubjectQuery('');
    setSubjectResults([]);
    setSubjectError(null);
    setSubjectLoading(false);
    setSubjectSearched(false);
    onPendingSelectionChange(null);
  }

  function clearSelectedProgram() {
    subjectAbort.current?.abort();
    subjectRequest.current += 1;
    setSelectedProgram(null);
    setProgramQuery('');
    setProgramResults([]);
    setProgramError(null);
    setProgramLoading(false);
    setProgramSearched(false);
    setSubjectQuery('');
    setSubjectResults([]);
    setSubjectError(null);
    setSubjectLoading(false);
    setSubjectSearched(false);
    onPendingSelectionChange(null);
  }

  async function runSubjectSearch() {
    const query = subjectQuery.trim();
    if (!selectedProgram || !query) return;

    subjectAbort.current?.abort();
    const controller = new AbortController();
    subjectAbort.current = controller;
    const request = ++subjectRequest.current;
    setSubjectLoading(true);
    setSubjectSearched(false);
    setSubjectError(null);

    try {
      const results = await searchSubjects(selectedProgram.curriculumReference, query, controller.signal);
      if (request === subjectRequest.current) {
        setSubjectResults(results);
        setSubjectSearched(true);
      }
    } catch {
      if (request === subjectRequest.current) setSubjectError(catalogError);
    } finally {
      if (request === subjectRequest.current) setSubjectLoading(false);
    }
  }

  return (
    <Card className="overflow-hidden border-border-strong shadow-none">
      <div aria-hidden="true" className="h-1 bg-teal-700" />
      <CardHeader className="border-b border-border-default">
        <p className="text-sm font-semibold text-teal-700">Catálogo institucional</p>
        <h3 className="text-lg font-semibold text-text-strong">Asignatura oficial</h3>
        <p className="max-w-3xl text-sm leading-6 text-text-muted">
          La selección de catálogo identifica la asignatura oficial. La aprobación se completa con los datos del logro del titular.
        </p>
      </CardHeader>
      <CardContent className="grid gap-6 pt-5 sm:pt-6">
        {persistedSelection ? (
          <div className="grid gap-3">
            <p className="text-sm font-semibold text-text-strong">Selección actualmente persistida</p>
            {persistedSelection.program === null ? (
              <FeedbackAlert variant="warning" title="Contexto curricular no disponible">
                La asignatura está seleccionada sin contexto curricular.
              </FeedbackAlert>
            ) : null}
            <SelectedAcademicSubjectCard
              code={persistedSelection.code}
              description={persistedSelection.description}
              hours={persistedSelection.hours}
              name={persistedSelection.name}
              programName={persistedSelection.program?.programName ?? null}
              state="persisted"
            />
          </div>
        ) : (
          <FeedbackAlert variant="information" title="Seleccioná una asignatura oficial">
            Seleccioná una asignatura oficial para completar el borrador académico.
          </FeedbackAlert>
        )}

        {pendingSelection ? (
          <div className="grid gap-3" aria-live="polite">
            <p className="text-sm font-semibold text-text-strong">Cambio preparado para guardar</p>
            <SelectedAcademicSubjectCard
              code={pendingSelection.code}
              description={pendingSelection.description}
              hours={pendingSelection.hours}
              name={pendingSelection.name}
              programName={pendingSelection.programName}
              state="pending"
            />
          </div>
        ) : null}

        <div className="grid gap-5 rounded-card border border-border-default bg-surface-muted p-4 sm:p-5">
          <div>
            <p className="text-xs font-bold tracking-wide text-brand-700 uppercase">Paso 1</p>
            <AcademicProgramSearchField
              disabled={disabled}
              error={programError}
              loading={programLoading}
              query={programQuery}
              results={programResults}
              searched={programSearched}
              onQueryChange={(value) => {
                programAbort.current?.abort();
                programRequest.current += 1;
                setProgramQuery(value);
                setProgramError(null);
                setProgramLoading(false);
                setProgramResults([]);
                setProgramSearched(false);
              }}
              onSearch={() => void runProgramSearch()}
              onSelect={selectProgram}
            />
          </div>

          {selectedProgram ? (
            <div className="grid gap-4 border-t border-border-default pt-5">
              <div className="flex flex-col gap-3 rounded-control border border-teal-600/25 bg-teal-100 p-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-bold tracking-wide text-teal-700 uppercase">Carrera elegida para buscar</p>
                  <p className="mt-1 font-semibold text-text-strong">{selectedProgram.programName}</p>
                  <p className="mt-1 text-sm text-text-muted">Código {selectedProgram.programCode}</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={disabled}
                  onClick={clearSelectedProgram}
                >
                  <X aria-hidden="true" />
                  Cambiar carrera
                </Button>
              </div>
              <div>
                <p className="mb-3 text-xs font-bold tracking-wide text-brand-700 uppercase">Paso 2</p>
                <CurriculumSubjectSearchField
                  disabled={disabled}
                  error={subjectError}
                  loading={subjectLoading}
                  query={subjectQuery}
                  results={subjectResults}
                  searched={subjectSearched}
                  onQueryChange={(value) => {
                    subjectAbort.current?.abort();
                    subjectRequest.current += 1;
                    setSubjectQuery(value);
                    setSubjectError(null);
                    setSubjectLoading(false);
                    setSubjectResults([]);
                    setSubjectSearched(false);
                  }}
                  onSearch={() => void runSubjectSearch()}
                  onSelect={onPendingSelectionChange}
                />
              </div>
              {!pendingSelection ? (
                <p className="text-sm text-text-muted">Seleccioná una materia de esta carrera antes de guardar el cambio curricular.</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

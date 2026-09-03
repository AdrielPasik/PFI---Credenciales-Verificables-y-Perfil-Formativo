'use client';

import { RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { Button } from '@/components/ui/button';
import { AcademicProgramSearchField } from '@/features/credentials/academic-program-search-field';
import type { AcademicSubjectCatalogSearchHandlers } from '@/features/credentials/academic-subject-catalog-section';
import { CurriculumSubjectSearchField } from '@/features/credentials/curriculum-subject-search-field';
import { SelectedAcademicSubjectCard } from '@/features/credentials/selected-academic-subject-card';
import type {
  AcademicProgramSearchItemVM,
  CurriculumAcademicSubjectSearchItemVM
} from '@/models/credentials';

interface AcademicSubjectCreationCatalogSectionProps
  extends AcademicSubjectCatalogSearchHandlers {
  disabled: boolean;
  onProgramChange(program: AcademicProgramSearchItemVM | null): void;
  onSubjectChange(
    subject: CurriculumAcademicSubjectSearchItemVM | null
  ): void;
  selectedProgram: AcademicProgramSearchItemVM | null;
  selectedSubject: CurriculumAcademicSubjectSearchItemVM | null;
}

const catalogError =
  'No pudimos consultar el catálogo. Intentá nuevamente.';

export function AcademicSubjectCreationCatalogSection({
  disabled,
  onProgramChange,
  onSubjectChange,
  searchPrograms,
  searchSubjects,
  selectedProgram,
  selectedSubject
}: AcademicSubjectCreationCatalogSectionProps) {
  const [programQuery, setProgramQuery] = useState('');
  const [programResults, setProgramResults] = useState<
    AcademicProgramSearchItemVM[]
  >([]);
  const [programError, setProgramError] = useState<string | null>(null);
  const [programLoading, setProgramLoading] = useState(false);
  const [programSearched, setProgramSearched] = useState(false);
  const [subjectQuery, setSubjectQuery] = useState('');
  const [subjectResults, setSubjectResults] = useState<
    CurriculumAcademicSubjectSearchItemVM[]
  >([]);
  const [subjectError, setSubjectError] = useState<string | null>(null);
  const [subjectLoading, setSubjectLoading] = useState(false);
  const [subjectSearched, setSubjectSearched] = useState(false);
  const programRequest = useRef(0);
  const subjectRequest = useRef(0);
  const programAbort = useRef<AbortController | null>(null);
  const subjectAbort = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      programRequest.current += 1;
      subjectRequest.current += 1;
      programAbort.current?.abort();
      subjectAbort.current?.abort();
    },
    []
  );

  function resetSubjectSearch() {
    subjectAbort.current?.abort();
    subjectRequest.current += 1;
    setSubjectQuery('');
    setSubjectResults([]);
    setSubjectError(null);
    setSubjectLoading(false);
    setSubjectSearched(false);
    onSubjectChange(null);
  }

  async function runProgramSearch() {
    const query = programQuery.trim();

    if (!query) {
      return;
    }

    programAbort.current?.abort();
    const controller = new AbortController();
    const request = ++programRequest.current;
    programAbort.current = controller;
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
      if (request === programRequest.current && !controller.signal.aborted) {
        setProgramError(catalogError);
      }
    } finally {
      if (request === programRequest.current) {
        setProgramLoading(false);
      }
    }
  }

  function selectProgram(program: AcademicProgramSearchItemVM) {
    resetSubjectSearch();
    setProgramQuery('');
    setProgramResults([]);
    setProgramError(null);
    setProgramLoading(false);
    setProgramSearched(false);
    onProgramChange(program);
  }

  function changeProgram() {
    programAbort.current?.abort();
    programRequest.current += 1;
    resetSubjectSearch();
    setProgramQuery('');
    setProgramResults([]);
    setProgramError(null);
    setProgramLoading(false);
    setProgramSearched(false);
    onProgramChange(null);
  }

  async function runSubjectSearch() {
    const query = subjectQuery.trim();

    if (!selectedProgram || !query) {
      return;
    }

    subjectAbort.current?.abort();
    const controller = new AbortController();
    const request = ++subjectRequest.current;
    subjectAbort.current = controller;
    setSubjectLoading(true);
    setSubjectSearched(false);
    setSubjectError(null);

    try {
      const results = await searchSubjects(
        selectedProgram.curriculumReference,
        query,
        controller.signal
      );

      if (request === subjectRequest.current) {
        setSubjectResults(results);
        setSubjectSearched(true);
      }
    } catch {
      if (request === subjectRequest.current && !controller.signal.aborted) {
        setSubjectError(catalogError);
      }
    } finally {
      if (request === subjectRequest.current) {
        setSubjectLoading(false);
      }
    }
  }

  function selectSubject(subject: CurriculumAcademicSubjectSearchItemVM) {
    setSubjectQuery('');
    setSubjectResults([]);
    setSubjectError(null);
    setSubjectSearched(false);
    onSubjectChange(subject);
  }

  return (
    <section
      aria-labelledby="academic-subject-creation-title"
      className="grid gap-5 border-t border-border-default pt-6"
    >
      <div>
        <p className="text-sm font-semibold text-teal-700">Paso 3</p>
        <h3
          id="academic-subject-creation-title"
          className="mt-1 text-lg font-semibold text-text-strong"
        >
          Asignatura oficial
        </h3>
        <p className="max-w-3xl text-sm leading-6 text-text-muted">
          Buscá primero la carrera o plan y luego una materia dentro de esa
          currícula.
        </p>
      </div>
      <div className="grid gap-5">
          {!selectedProgram ? (
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
          ) : (
            <div className="grid gap-5">
              <div className="flex flex-col gap-3 rounded-control border border-teal-600/25 bg-teal-100 p-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-bold tracking-wide text-teal-700 uppercase">
                    Carrera seleccionada
                  </p>
                  <p className="mt-1 font-semibold text-text-strong">
                    {selectedProgram.programName}
                  </p>
                  <p className="mt-1 text-sm text-text-muted">
                    Código {selectedProgram.programCode}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={disabled}
                  onClick={changeProgram}
                >
                  <X aria-hidden="true" />
                  Cambiar carrera
                </Button>
              </div>

              {!selectedSubject ? (
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
                  onSelect={selectSubject}
                />
              ) : (
                <div className="grid gap-3" aria-live="polite">
                  <SelectedAcademicSubjectCard
                    code={selectedSubject.code}
                    description={selectedSubject.description}
                    hours={selectedSubject.hours}
                    name={selectedSubject.name}
                    programCode={selectedProgram.programCode}
                    programName={selectedProgram.programName}
                    state="creation"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="justify-self-start"
                    disabled={disabled}
                    onClick={resetSubjectSearch}
                  >
                    <RotateCcw aria-hidden="true" />
                    Cambiar materia
                  </Button>
                </div>
              )}
            </div>
          )}
      </div>

      <FeedbackAlert
        variant="information"
        title="Selección preparada para crear"
      >
        La selección de catálogo identifica la asignatura oficial. Los datos
        de aprobación se completan después en el borrador.
      </FeedbackAlert>
    </section>
  );
}

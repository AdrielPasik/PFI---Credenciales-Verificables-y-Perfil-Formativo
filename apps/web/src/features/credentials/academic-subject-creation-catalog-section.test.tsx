import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AcademicSubjectCreationCatalogSection } from '@/features/credentials/academic-subject-creation-catalog-section';
import type {
  AcademicProgramSearchItemVM,
  CurriculumAcademicSubjectSearchItemVM
} from '@/models/credentials';

const programA: AcademicProgramSearchItemVM = {
  programReference: 'program-reference-a',
  programCode: '1621',
  programName: 'Ingeniería en Informática',
  curriculumReference: 'curriculum-reference-a',
  curriculumCode: '2026'
};

const programB: AcademicProgramSearchItemVM = {
  programReference: 'program-reference-b',
  programCode: '3824',
  programName: 'Ingeniería Electromecánica',
  curriculumReference: 'curriculum-reference-b',
  curriculumCode: '2026'
};

const subjectA: CurriculumAcademicSubjectSearchItemVM = {
  academicCourseReference: 'course-reference-a',
  code: '3.4.213',
  name: 'Ingeniería de Datos II',
  description: null,
  hours: null,
  programReference: programA.programReference,
  programCode: programA.programCode,
  programName: programA.programName,
  curriculumReference: programA.curriculumReference,
  curriculumCode: programA.curriculumCode
};

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function renderCreationCatalog(options?: {
  searchPrograms?: (
    query: string,
    signal: AbortSignal
  ) => Promise<AcademicProgramSearchItemVM[]>;
  searchSubjects?: (
    curriculumReference: string,
    query: string,
    signal: AbortSignal
  ) => Promise<CurriculumAcademicSubjectSearchItemVM[]>;
}) {
  function ControlledCatalog() {
    const [program, setProgram] =
      useState<AcademicProgramSearchItemVM | null>(null);
    const [subject, setSubject] =
      useState<CurriculumAcademicSubjectSearchItemVM | null>(null);

    return (
      <AcademicSubjectCreationCatalogSection
        disabled={false}
        selectedProgram={program}
        selectedSubject={subject}
        searchPrograms={
          options?.searchPrograms ?? vi.fn().mockResolvedValue([programA])
        }
        searchSubjects={
          options?.searchSubjects ?? vi.fn().mockResolvedValue([subjectA])
        }
        onProgramChange={setProgram}
        onSubjectChange={setSubject}
      />
    );
  }

  render(<ControlledCatalog />);
}

async function selectProgramAndSubject() {
  fireEvent.change(
    screen.getByLabelText('Buscar carrera o plan académico'),
    { target: { value: 'informatica' } }
  );
  fireEvent.click(screen.getByRole('button', { name: 'Buscar carrera' }));
  fireEvent.click(
    await screen.findByRole('button', {
      name: /Ingeniería en Informática/
    })
  );
  fireEvent.change(screen.getByLabelText('Buscar materia de la carrera'), {
    target: { value: 'datos' }
  });
  fireEvent.click(screen.getByRole('button', { name: 'Buscar materia' }));
  fireEvent.click(
    await screen.findByRole('button', { name: /Ingeniería de Datos II/ })
  );
}

describe('AcademicSubjectCreationCatalogSection', () => {
  it('selects a program and subject without presenting a persisted state', async () => {
    renderCreationCatalog();

    await selectProgramAndSubject();

    expect(screen.getByText('Materia seleccionada')).toBeTruthy();
    expect(screen.getAllByText('Ingeniería de Datos II').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText('No disponible en el catálogo')
    ).toHaveLength(2);
    expect(document.body.textContent).not.toContain('Selección guardada');
    expect(document.body.textContent).not.toContain('course-reference-a');
    expect(document.body.textContent).not.toContain('curriculum-reference-a');
  });

  it('changes programs by clearing the subject and its search state', async () => {
    renderCreationCatalog();
    await selectProgramAndSubject();

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar carrera' }));

    expect(screen.queryByText('Materia seleccionada')).toBeNull();
    expect(screen.queryByText('Ingeniería de Datos II')).toBeNull();
    expect(
      screen.getByLabelText('Buscar carrera o plan académico')
    ).toBeTruthy();
    expect(
      screen.queryByLabelText('Buscar materia de la carrera')
    ).toBeNull();
  });

  it('ignores an older subject response after changing programs', async () => {
    const oldSubjects = deferred<CurriculumAcademicSubjectSearchItemVM[]>();
    renderCreationCatalog({
      searchPrograms: vi.fn().mockResolvedValue([programA, programB]),
      searchSubjects: vi.fn().mockReturnValue(oldSubjects.promise)
    });

    fireEvent.change(
      screen.getByLabelText('Buscar carrera o plan académico'),
      { target: { value: 'ingenieria' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Buscar carrera' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: /Ingeniería en Informática/
      })
    );
    fireEvent.change(screen.getByLabelText('Buscar materia de la carrera'), {
      target: { value: 'datos' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar materia' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar carrera' }));

    await act(async () => oldSubjects.resolve([subjectA]));

    expect(screen.queryByText(subjectA.name)).toBeNull();
    expect(
      screen.queryByLabelText('Buscar materia de la carrera')
    ).toBeNull();
  });

  it('keeps catalog errors local and supports retry', async () => {
    const searchPrograms = vi
      .fn()
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce([programA]);
    renderCreationCatalog({ searchPrograms });

    fireEvent.change(
      screen.getByLabelText('Buscar carrera o plan académico'),
      { target: { value: 'informatica' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Buscar carrera' }));
    expect(
      await screen.findByText(/No pudimos consultar el catálogo/)
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(
      await screen.findByRole('button', {
        name: /Ingeniería en Informática/
      })
    ).toBeTruthy();
    expect(searchPrograms).toHaveBeenCalledTimes(2);
  });
});

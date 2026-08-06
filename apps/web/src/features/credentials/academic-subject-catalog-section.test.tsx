import {
  act,
  fireEvent,
  render,
  screen
} from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AcademicSubjectCatalogSection } from '@/features/credentials/academic-subject-catalog-section';
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

const subject: CurriculumAcademicSubjectSearchItemVM = {
  academicCourseReference: 'academic-course-reference',
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

const subjectB: CurriculumAcademicSubjectSearchItemVM = {
  ...subject,
  academicCourseReference: 'academic-course-reference-b',
  code: '4.2.100',
  name: 'Mecánica Aplicada',
  programReference: programB.programReference,
  programCode: programB.programCode,
  programName: programB.programName,
  curriculumReference: programB.curriculumReference,
  curriculumCode: programB.curriculumCode
};

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

function renderCatalog(options?: {
  persistedSelection?: Parameters<
    typeof AcademicSubjectCatalogSection
  >[0]['persistedSelection'];
  searchPrograms?: Parameters<
    typeof AcademicSubjectCatalogSection
  >[0]['searchPrograms'];
  searchSubjects?: Parameters<
    typeof AcademicSubjectCatalogSection
  >[0]['searchSubjects'];
}) {
  const onPendingSelectionChange = vi.fn();
  render(
    <AcademicSubjectCatalogSection
      disabled={false}
      persistedSelection={options?.persistedSelection ?? null}
      pendingSelection={null}
      searchPrograms={
        options?.searchPrograms ?? vi.fn().mockResolvedValue([programA])
      }
      searchSubjects={
        options?.searchSubjects ?? vi.fn().mockResolvedValue([subject])
      }
      onPendingSelectionChange={onPendingSelectionChange}
    />
  );

  return { onPendingSelectionChange };
}

describe('AcademicSubjectCatalogSection', () => {
  it('shows a persisted flat selection without inventing a program', () => {
    renderCatalog({
      persistedSelection: {
        academicCourseReference: 'flat-reference',
        code: '1.1.1',
        name: 'Asignatura histórica',
        description: null,
        hours: null,
        program: null
      }
    });

    expect(
      screen.getByText(
        'La asignatura está seleccionada sin contexto curricular.'
      )
    ).toBeTruthy();
    expect(screen.getByText('Asignatura histórica')).toBeTruthy();
    expect(screen.queryByLabelText('Buscar carrera o plan académico')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cambiar carrera' })).toBeTruthy();
    expect(document.body.textContent).not.toContain('flat-reference');
  });

  it('presents the persisted reference before revealing either catalog search', () => {
    renderCatalog({
      persistedSelection: {
        academicCourseReference: subject.academicCourseReference,
        code: subject.code,
        name: subject.name,
        description: subject.description,
        hours: subject.hours,
        program: programA
      }
    });

    expect(screen.getByText('Referencia académica oficial')).toBeTruthy();
    expect(screen.getByText('Asignatura seleccionada')).toBeTruthy();
    expect(screen.getByText('Carrera seleccionada')).toBeTruthy();
    expect(screen.queryByLabelText('Buscar carrera o plan académico')).toBeNull();
    expect(screen.queryByLabelText('Buscar materia de la carrera')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar asignatura' }));

    expect(screen.getByLabelText('Buscar materia de la carrera')).toBeTruthy();
    expect(screen.queryByLabelText('Buscar carrera o plan académico')).toBeNull();
    expect(document.body.textContent).not.toMatch(
      /guardar en base|crear curso reutilizable|agregar al catálogo/i
    );
  });

  it('ignores an older program response when a newer search finishes first', async () => {
    const oldSearch = deferred<AcademicProgramSearchItemVM[]>();
    const newSearch = deferred<AcademicProgramSearchItemVM[]>();
    const searchPrograms = vi.fn((query: string) =>
      query === 'anterior' ? oldSearch.promise : newSearch.promise
    );
    renderCatalog({ searchPrograms });

    const input = screen.getByLabelText('Buscar carrera o plan académico');
    fireEvent.change(input, { target: { value: 'anterior' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar carrera' }));
    fireEvent.change(input, { target: { value: 'actual' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar carrera' }));

    await act(async () => newSearch.resolve([programB]));
    expect(await screen.findByText(programB.programName)).toBeTruthy();

    await act(async () => oldSearch.resolve([programA]));
    expect(screen.queryByText(programA.programName)).toBeNull();
  });

  it('invalidates an in-flight subject search when the selected program changes', async () => {
    const oldSubjects = deferred<CurriculumAcademicSubjectSearchItemVM[]>();
    const { onPendingSelectionChange } = renderCatalog({
      searchPrograms: vi.fn().mockResolvedValue([programA, programB]),
      searchSubjects: vi.fn().mockReturnValue(oldSubjects.promise)
    });

    fireEvent.change(screen.getByLabelText('Buscar carrera o plan académico'), {
      target: { value: 'Ingeniería' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar carrera' }));
    await screen.findByText(programA.programName);
    fireEvent.click(screen.getByText(programA.programName));
    fireEvent.change(screen.getByLabelText('Buscar materia de la carrera'), {
      target: { value: 'Datos' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar materia' }));

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar carrera' }));
    fireEvent.change(screen.getByLabelText('Buscar carrera o plan académico'), {
      target: { value: 'Ingeniería' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar carrera' }));
    fireEvent.click(await screen.findByText(programB.programName));
    await act(async () => oldSubjects.resolve([subject]));

    expect(screen.queryByText(subject.name)).toBeNull();
    expect(
      (screen.getByLabelText('Buscar materia de la carrera') as HTMLInputElement)
        .value
    ).toBe('');
    expect(onPendingSelectionChange).toHaveBeenLastCalledWith(null);
  });

  it('keeps catalog errors local and allows an explicit retry', async () => {
    const searchPrograms = vi
      .fn()
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce([programA]);
    renderCatalog({ searchPrograms });

    fireEvent.change(screen.getByLabelText('Buscar carrera o plan académico'), {
      target: { value: '1621' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar carrera' }));

    expect(await screen.findByText(/No pudimos consultar el catálogo/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText(programA.programName)).toBeTruthy();
    expect(searchPrograms).toHaveBeenCalledTimes(2);
  });

  it('emits a pending subject without presenting it as persisted', async () => {
    const { onPendingSelectionChange } = renderCatalog();

    fireEvent.change(screen.getByLabelText('Buscar carrera o plan académico'), {
      target: { value: '1621' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar carrera' }));
    fireEvent.click(await screen.findByText(programA.programName));
    fireEvent.change(screen.getByLabelText('Buscar materia de la carrera'), {
      target: { value: 'Datos' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar materia' }));
    fireEvent.click(await screen.findByText(subject.name));

    expect(onPendingSelectionChange).toHaveBeenLastCalledWith(subject);
    expect(screen.queryByText('Selección guardada')).toBeNull();
  });

  it('changes programs without mutating the persisted snapshot or accepting stale subjects', async () => {
    const oldSubjects = deferred<CurriculumAcademicSubjectSearchItemVM[]>();
    const staleSubject = {
      ...subject,
      academicCourseReference: 'stale-course-reference',
      name: 'Respuesta anterior'
    };
    const searchPrograms = vi.fn().mockResolvedValue([programB]);
    const searchSubjects = vi
      .fn()
      .mockReturnValueOnce(oldSubjects.promise)
      .mockResolvedValueOnce([subjectB]);

    function ControlledCatalog() {
      const [pendingSelection, setPendingSelection] = useState<
        CurriculumAcademicSubjectSearchItemVM | null
      >(subject);

      return (
        <AcademicSubjectCatalogSection
          disabled={false}
          persistedSelection={{
            academicCourseReference: subject.academicCourseReference,
            code: subject.code,
            name: subject.name,
            description: subject.description,
            hours: subject.hours,
            program: programA
          }}
          pendingSelection={pendingSelection}
          searchPrograms={searchPrograms}
          searchSubjects={searchSubjects}
          onPendingSelectionChange={setPendingSelection}
        />
      );
    }

    render(<ControlledCatalog />);
    fireEvent.change(screen.getByLabelText('Buscar materia de la carrera'), {
      target: { value: 'anterior' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar materia' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar carrera' }));

    expect(screen.queryByText('Selección pendiente')).toBeNull();
    expect(screen.getByText('Asignatura seleccionada')).toBeTruthy();
    expect(screen.getByText(subject.name)).toBeTruthy();
    expect(screen.queryByLabelText('Buscar materia de la carrera')).toBeNull();

    await act(async () => oldSubjects.resolve([staleSubject]));
    expect(screen.queryByText(staleSubject.name)).toBeNull();

    fireEvent.change(screen.getByLabelText('Buscar carrera o plan académico'), {
      target: { value: '3824' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar carrera' }));
    fireEvent.click(await screen.findByText(programB.programName));
    fireEvent.change(screen.getByLabelText('Buscar materia de la carrera'), {
      target: { value: 'Mecánica' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar materia' }));
    fireEvent.click(await screen.findByText(subjectB.name));

    expect(screen.getByText('Selección pendiente')).toBeTruthy();
    expect(screen.getAllByText(subjectB.name).length).toBeGreaterThan(0);
    expect(screen.getByText(subject.name)).toBeTruthy();
  });
});

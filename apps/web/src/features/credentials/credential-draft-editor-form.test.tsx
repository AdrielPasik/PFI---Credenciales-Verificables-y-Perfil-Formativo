import {
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CredentialDraftEditorForm } from '@/features/credentials/credential-draft-editor-form';
import { ApiError } from '@/lib/errors/api-error';
import type {
  AcademicProgramSearchItemVM,
  CredentialFeedback,
  CredentialType,
  CurriculumAcademicSubjectSearchItemVM,
  IssuerCredentialDetailVM,
  UpdateIssuerCredentialDraftCommand
} from '@/models/credentials';

type SaveDraft = (
  command: UpdateIssuerCredentialDraftCommand
) => Promise<IssuerCredentialDetailVM>;
type ReloadDraft = () => Promise<IssuerCredentialDetailVM>;
type HandleTerminalError = (feedback: CredentialFeedback) => void;
type SearchPrograms = (
  query: string,
  signal: AbortSignal
) => Promise<AcademicProgramSearchItemVM[]>;
type SearchSubjects = (
  curriculumReference: string,
  query: string,
  signal: AbortSignal
) => Promise<CurriculumAcademicSubjectSearchItemVM[]>;

const program: AcademicProgramSearchItemVM = {
  programReference: 'program-reference',
  programCode: '1621',
  programName: 'Ingeniería en Informática',
  curriculumReference: 'curriculum-reference',
  curriculumCode: '2026'
};

const catalogSubject: CurriculumAcademicSubjectSearchItemVM = {
  academicCourseReference: 'academic-course-reference',
  code: '3.4.213',
  name: 'Ingeniería de Datos II',
  description: null,
  hours: null,
  programReference: program.programReference,
  programCode: program.programCode,
  programName: program.programName,
  curriculumReference: program.curriculumReference,
  curriculumCode: program.curriculumCode
};

function detailFixture(
  type: CredentialType = 'course',
  subjectOverrides: Partial<
    IssuerCredentialDetailVM['credentialSubject']
  > = {}
): IssuerCredentialDetailVM {
  return {
    credentialReference: 'credential-internal-reference',
    title: 'Arquitectura de Software',
    description: 'Descripción inicial',
    hours: '24.00',
    type,
    typeLabel: 'Tipo de prueba',
    status: 'draft',
    statusLabel: 'Borrador',
    issuedAt: null,
    issuedAtLabel: null,
    canonicalHash: null,
    canonicalHashShort: null,
    canonicalizationVersion: null,
    blockchainEvidence: null,
    issuer: {
      displayName: 'Universidad Seleccionada',
      did: null
    },
    credentialSubject: {
      achievementName: 'Arquitectura de Software',
      institutionName: 'Universidad Seleccionada',
      completionDate: null,
      academicPeriod: null,
      programName: null,
      grade: null,
      providerName: null,
      platformName: null,
      modality: null,
      level: null,
      certificationCode: null,
      expirationDate: null,
      externalUrl: null,
      skills: [],
      competencies: [],
      learningOutcomes: [],
      ...subjectOverrides
    },
    holder: {
      displayLabel: 'Demo Holder',
      email: 'holder@example.com',
      did: null
    },
    academicCourse: null,
    documentEvidence: { currentDocument: null },
    textEvidence: { currentText: null },
    createdAt: '2026-07-30T12:00:00.000Z',
    updatedAt: '2026-07-30T13:00:00.000Z'
  };
}

function renderEditor(options?: {
  detail?: IssuerCredentialDetailVM;
  onReloadLatest?: ReloadDraft;
  onSave?: SaveDraft;
  onTerminalError?: HandleTerminalError;
  searchPrograms?: SearchPrograms;
  searchSubjects?: SearchSubjects;
}) {
  const detail = options?.detail ?? detailFixture();
  const onSave =
    options?.onSave ?? vi.fn<SaveDraft>().mockResolvedValue(detail);
  const onReloadLatest =
    options?.onReloadLatest ??
    vi.fn<ReloadDraft>().mockResolvedValue(detail);
  const onTerminalError =
    options?.onTerminalError ?? vi.fn<HandleTerminalError>();
  const searchPrograms =
    options?.searchPrograms ??
    vi.fn<SearchPrograms>().mockResolvedValue([]);
  const searchSubjects =
    options?.searchSubjects ??
    vi.fn<SearchSubjects>().mockResolvedValue([]);

  render(
    <CredentialDraftEditorForm
      detail={detail}
      issuerReference="issuer-internal-reference"
      onSave={onSave}
      onReloadLatest={onReloadLatest}
      onTerminalError={onTerminalError}
      searchPrograms={searchPrograms}
      searchSubjects={searchSubjects}
    />
  );

  return {
    detail,
    onReloadLatest,
    onSave,
    onTerminalError,
    searchPrograms,
    searchSubjects
  };
}

function academicDetailWithCatalog(
  subjectOverrides: Partial<
    IssuerCredentialDetailVM['credentialSubject']
  > = {}
) {
  const detail = detailFixture('academic_subject', subjectOverrides);
  detail.academicCourse = {
    academicCourseReference: catalogSubject.academicCourseReference,
    code: catalogSubject.code,
    name: catalogSubject.name,
    description: catalogSubject.description,
    hours: catalogSubject.hours,
    program
  };
  return detail;
}

async function selectCatalogSubject() {
  fireEvent.change(screen.getByLabelText('Buscar carrera o plan académico'), {
    target: { value: '1621' }
  });
  fireEvent.click(screen.getByRole('button', { name: 'Buscar carrera' }));
  fireEvent.click(await screen.findByText(program.programName));
  fireEvent.change(screen.getByLabelText('Buscar materia de la carrera'), {
    target: { value: 'Datos' }
  });
  fireEvent.click(screen.getByRole('button', { name: 'Buscar materia' }));
  fireEvent.click(await screen.findByText(catalogSubject.name));
}

describe('CredentialDraftEditorForm', () => {
  it('renders common and course fields with an initially disabled save', () => {
    renderEditor();

    expect(screen.getByLabelText('Tipo de credencial')).toBeTruthy();
    expect(screen.getByLabelText('Nombre del logro')).toBeTruthy();
    expect(screen.getByLabelText('Descripción')).toBeTruthy();
    expect(screen.getByLabelText('Horas')).toBeTruthy();
    expect(screen.getByLabelText('Fecha de finalización')).toBeTruthy();
    expect(screen.getByLabelText('Proveedor')).toBeTruthy();
    expect(screen.getByLabelText('Plataforma')).toBeTruthy();
    expect(screen.getByLabelText('Modalidad')).toBeTruthy();
    expect(screen.getByLabelText('Nivel')).toBeTruthy();
    expect(screen.getByLabelText('Skills')).toBeTruthy();
    expect(screen.getByLabelText('Competencias')).toBeTruthy();
    expect(screen.getByLabelText('Resultados de aprendizaje')).toBeTruthy();
    expect(
      (screen.getByRole('button', {
        name: 'Guardar cambios'
      }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(document.body.textContent).not.toMatch(
      /readiness|emitir|pdf|blockchain|análisis ia/i
    );
    expect(document.body.textContent).not.toContain(
      'credential-internal-reference'
    );
    expect(document.body.textContent).not.toContain(
      'issuer-internal-reference'
    );
  });

  it.each([
    ['academic_subject', 'Fecha de aprobación (opcional)', 'Año académico (opcional)'],
    ['course', 'Fecha de finalización', 'Plataforma'],
    ['certification', 'Fecha de obtención', 'Código de certificación'],
    ['degree', 'Fecha de graduación', 'Programa o carrera']
  ] as const)(
    'renders the controlled fields for %s',
    (type, dateLabel, specificLabel) => {
      renderEditor({ detail: detailFixture(type) });

      expect(screen.getByLabelText(dateLabel)).toBeTruthy();
      expect(screen.getByLabelText(specificLabel)).toBeTruthy();
    }
  );

  it('shows a course-specific label and declared-data copy for externalUrl', () => {
    renderEditor({ detail: detailFixture('course') });

    expect(screen.getByLabelText('URL del curso o certificado')).toBeTruthy();
    expect(
      screen.getByText(
        'Enlace declarado por la institución emisora. No implica verificación oficial externa.'
      )
    ).toBeTruthy();
  });

  it('uses a generic externalUrl label for certification', () => {
    renderEditor({ detail: detailFixture('certification') });

    expect(screen.getByLabelText('URL de validación')).toBeTruthy();
  });

  it('uses the curricular selector and only approved achievement fields for academic subjects', () => {
    renderEditor({ detail: detailFixture('academic_subject') });

    expect(screen.getByText('Referencia académica oficial')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Datos de aprobación' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Competencias y habilidades' })).toBeTruthy();
    expect(screen.getByLabelText('Fecha de aprobación (opcional)')).toBeTruthy();
    expect(screen.getByLabelText('Año académico (opcional)')).toBeTruthy();
    expect(screen.getByLabelText('Período (opcional)')).toBeTruthy();
    expect(screen.getByLabelText('Calificación (opcional)')).toBeTruthy();
    expect(screen.getByLabelText('Habilidades técnicas (opcional)')).toBeTruthy();
    expect(screen.getByLabelText('Competencias formativas (opcional)')).toBeTruthy();
    expect(
      screen.getByText(
        'Una entrada por línea. Ejemplos: SQL, Python, modelado de datos.'
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Una entrada por línea. Ejemplos: diseñar soluciones, resolver problemas, comunicar decisiones.'
      )
    ).toBeTruthy();
    expect(screen.queryByLabelText('Nombre del logro')).toBeNull();
    expect(screen.queryByLabelText('Descripción')).toBeNull();
    expect(screen.queryByLabelText('Horas')).toBeNull();
    expect(screen.queryByLabelText('Programa o carrera')).toBeNull();
    expect(screen.queryByLabelText('Resultados de aprendizaje')).toBeNull();
  });

  it('reconstructs the persisted curriculum context from the detail response', () => {
    const detail = detailFixture('academic_subject');
    detail.academicCourse = {
      academicCourseReference: catalogSubject.academicCourseReference,
      code: catalogSubject.code,
      name: catalogSubject.name,
      description: null,
      hours: null,
      program
    };

    renderEditor({ detail });

    expect(screen.getByText('Selección guardada')).toBeTruthy();
    expect(screen.getAllByText(program.programName).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Buscar materia de la carrera')).toBeNull();
    expect(screen.queryByLabelText('Buscar carrera o plan académico')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar asignatura' }));
    expect(screen.getByLabelText('Buscar materia de la carrera')).toBeTruthy();
    expect(document.body.textContent).not.toContain(
      catalogSubject.academicCourseReference
    );
    expect(document.body.textContent).not.toContain(
      program.curriculumReference
    );
  });

  it('saves a pending curricular selection with approval data and adopts the response snapshot', async () => {
    const detail = detailFixture('academic_subject');
    const saved: IssuerCredentialDetailVM = {
      ...detail,
      title: catalogSubject.name,
      description: null,
      hours: null,
      updatedAt: '2026-07-30T14:00:00.000Z',
      academicCourse: {
        academicCourseReference: catalogSubject.academicCourseReference,
        code: catalogSubject.code,
        name: catalogSubject.name,
        description: null,
        hours: null,
        program
      },
      credentialSubject: {
        ...detail.credentialSubject,
        achievementName: catalogSubject.name,
        programName: program.programName,
        completionDate: '2026-07-30',
        grade: '9',
        skills: ['Datos']
      }
    };
    const onSave = vi.fn<SaveDraft>().mockResolvedValue(saved);
    renderEditor({
      detail,
      onSave,
      searchPrograms: vi.fn().mockResolvedValue([program]),
      searchSubjects: vi.fn().mockResolvedValue([catalogSubject])
    });

    await selectCatalogSubject();
    expect(await screen.findByText('Selección pendiente')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Fecha de aprobación (opcional)'), {
      target: { value: '2026-07-30' }
    });
    fireEvent.change(screen.getByLabelText('Calificación (opcional)'), {
      target: { value: '9' }
    });
    fireEvent.change(screen.getByLabelText('Habilidades técnicas (opcional)'), {
      target: { value: 'Datos' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const command = onSave.mock.calls[0]?.[0];
    expect(command).toEqual({
      issuerReference: 'issuer-internal-reference',
      credentialReference: 'credential-internal-reference',
      expectedUpdatedAt: '2026-07-30T13:00:00.000Z',
      academicCourseReference: 'academic-course-reference',
      curriculumReference: 'curriculum-reference',
      completionDate: '2026-07-30',
      grade: '9',
      skills: ['Datos']
    });
    expect(command).not.toHaveProperty('achievementName');
    expect(command).not.toHaveProperty('description');
    expect(command).not.toHaveProperty('hours');
    expect(command).not.toHaveProperty('programName');
    expect(await screen.findByText('Selección guardada')).toBeTruthy();
    expect(screen.queryByText('Selección pendiente')).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Guardar cambios' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it('keeps the form state when a catalog search fails', async () => {
    renderEditor({
      detail: detailFixture('academic_subject'),
      searchPrograms: vi.fn().mockRejectedValue(new Error('unavailable'))
    });

    fireEvent.change(screen.getByLabelText('Calificación (opcional)'), {
      target: { value: '8' }
    });
    fireEvent.change(screen.getByLabelText('Buscar carrera o plan académico'), {
      target: { value: '1621' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar carrera' }));

    expect(await screen.findByText(/No pudimos consultar el catálogo/)).toBeTruthy();
    expect((screen.getByLabelText('Calificación (opcional)') as HTMLInputElement).value).toBe('8');
  });

  it('sanitizes academic grade input and blocks values outside the v0 range', () => {
    const onSave = vi.fn();
    renderEditor({ detail: academicDetailWithCatalog(), onSave });

    const grade = screen.getByLabelText('Calificación (opcional)');
    fireEvent.change(grade, { target: { value: '-8' } });
    expect((grade as HTMLInputElement).value).toBe('8');

    fireEvent.change(grade, { target: { value: '+8' } });
    expect((grade as HTMLInputElement).value).toBe('8');

    fireEvent.change(grade, { target: { value: 'abc8.5xyz' } });
    expect((grade as HTMLInputElement).value).toBe('8.5');

    fireEvent.change(grade, { target: { value: '8e2' } });
    expect((grade as HTMLInputElement).value).toBe('82');

    fireEvent.change(grade, { target: { value: '11' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(
      screen.getByText(
        'Ingresá una calificación entre 0 y 10 con hasta dos decimales.'
      )
    ).toBeTruthy();
    expect(document.activeElement).toBe(grade);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('builds and reconstructs a structured academic period', async () => {
    const detail = academicDetailWithCatalog();
    const saved = academicDetailWithCatalog({ academicPeriod: '2026-2' });
    saved.updatedAt = '2026-07-30T14:00:00.000Z';
    const onSave = vi.fn<SaveDraft>().mockResolvedValue(saved);
    renderEditor({ detail, onSave });

    const year = screen.getByLabelText('Año académico (opcional)');
    fireEvent.change(year, { target: { value: '20a26' } });
    expect((year as HTMLInputElement).value).toBe('2026');
    fireEvent.change(screen.getByLabelText('Período (opcional)'), {
      target: { value: '2' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      academicPeriod: '2026-2'
    });
    expect(
      (screen.getByLabelText('Año académico (opcional)') as HTMLInputElement)
        .value
    ).toBe('2026');
    expect(
      (screen.getByLabelText('Período (opcional)') as HTMLSelectElement).value
    ).toBe('2');
  });

  it('requires both academic period parts and sends null when both are cleared', async () => {
    const detail = academicDetailWithCatalog({ academicPeriod: '2026-1' });
    const onSave = vi.fn<SaveDraft>().mockResolvedValue(
      academicDetailWithCatalog({ academicPeriod: null })
    );
    renderEditor({ detail, onSave });

    const year = screen.getByLabelText('Año académico (opcional)');
    const term = screen.getByLabelText('Período (opcional)');
    fireEvent.change(term, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(
      screen.getByText(
        'Completá el año de cuatro dígitos y el período académico.'
      )
    ).toBeTruthy();
    expect(document.activeElement).toBe(year);
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(year, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ academicPeriod: null });
  });

  it('preserves a pending catalog selection after a 409 response', async () => {
    const onSave = vi
      .fn<SaveDraft>()
      .mockRejectedValue(new ApiError('conflict', 'http', 409));
    renderEditor({
      detail: detailFixture('academic_subject'),
      onSave,
      searchPrograms: vi.fn().mockResolvedValue([program]),
      searchSubjects: vi.fn().mockResolvedValue([catalogSubject])
    });

    await selectCatalogSubject();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(
      await screen.findByText('Este borrador fue actualizado desde otra sesión.')
    ).toBeTruthy();
    expect(screen.getByText('Selección pendiente')).toBeTruthy();
    expect(screen.getAllByText(catalogSubject.name).length).toBeGreaterThan(0);
  });

  it('removes catalog linkage when changing type and requires a new selection on return', async () => {
    const academicDetail = detailFixture('academic_subject');
    academicDetail.academicCourse = {
      academicCourseReference: catalogSubject.academicCourseReference,
      code: catalogSubject.code,
      name: catalogSubject.name,
      description: null,
      hours: null,
      program
    };
    const savedCourse: IssuerCredentialDetailVM = {
      ...academicDetail,
      type: 'course',
      typeLabel: 'Curso',
      academicCourse: null,
      updatedAt: '2026-07-30T14:00:00.000Z'
    };
    const onSave = vi.fn<SaveDraft>().mockResolvedValue(savedCourse);
    renderEditor({ detail: academicDetail, onSave });

    fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
      target: { value: 'course' }
    });
    expect(
      screen.getByText(/quitará la vinculación con la asignatura oficial/i)
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar tipo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0]?.[0]).toEqual({
      issuerReference: 'issuer-internal-reference',
      credentialReference: 'credential-internal-reference',
      expectedUpdatedAt: '2026-07-30T13:00:00.000Z',
      type: 'course'
    });

    fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
      target: { value: 'academic_subject' }
    });
    expect(
      await screen.findByText(
        'Seleccioná una asignatura oficial para completar el borrador académico.'
      )
    ).toBeTruthy();
    expect(screen.queryByText('Selección guardada')).toBeNull();
  });

  it('changes type directly when there is no incompatible populated data', () => {
    renderEditor();

    fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
      target: { value: 'certification' }
    });

    expect(screen.queryByText('Revisá el cambio de tipo')).toBeNull();
    expect(screen.getByLabelText('Código de certificación')).toBeTruthy();
    expect(screen.queryByLabelText('Plataforma')).toBeNull();
    expect(
      (screen.getByRole('button', {
        name: 'Guardar cambios'
      }) as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it('asks before clearing incompatible data and does not patch automatically', () => {
    const onSave = vi.fn();
    renderEditor({
      detail: detailFixture('course', {
        platformName: 'Campus Virtual',
        learningOutcomes: ['Documentar decisiones']
      }),
      onSave
    });

    fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
      target: { value: 'certification' }
    });

    expect(screen.getByText('Revisá el cambio de tipo')).toBeTruthy();
    expect(
      (screen.getByLabelText('Tipo de credencial') as HTMLSelectElement)
        .value
    ).toBe('course');
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar tipo' }));

    expect(
      (screen.getByLabelText('Tipo de credencial') as HTMLSelectElement)
        .value
    ).toBe('certification');
    expect(screen.queryByLabelText('Plataforma')).toBeNull();
    expect(screen.queryByLabelText('Resultados de aprendizaje')).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('cancels a pending type change without clearing values', () => {
    renderEditor({
      detail: detailFixture('course', { platformName: 'Campus Virtual' })
    });

    fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
      target: { value: 'certification' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(
      (screen.getByLabelText('Tipo de credencial') as HTMLSelectElement)
        .value
    ).toBe('course');
    expect(
      (screen.getByLabelText('Plataforma') as HTMLInputElement).value
    ).toBe('Campus Virtual');
  });

  it('saves a sparse command with the last accepted updatedAt and resets dirty state', async () => {
    const detail = detailFixture();
    const saved = {
      ...detail,
      title: 'Arquitectura Aplicada',
      updatedAt: '2026-07-30T14:00:00.000Z',
      credentialSubject: {
        ...detail.credentialSubject,
        achievementName: 'Arquitectura Aplicada'
      }
    };
    const onSave = vi.fn().mockResolvedValue(saved);
    renderEditor({ detail, onSave });

    fireEvent.change(screen.getByLabelText('Nombre del logro'), {
      target: { value: 'Arquitectura Aplicada' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith({
      issuerReference: 'issuer-internal-reference',
      credentialReference: 'credential-internal-reference',
      expectedUpdatedAt: '2026-07-30T13:00:00.000Z',
      achievementName: 'Arquitectura Aplicada'
    });
    expect(await screen.findByText('Cambios guardados')).toBeTruthy();
    expect(
      (screen.getByLabelText('Nombre del logro') as HTMLInputElement).value
    ).toBe('Arquitectura Aplicada');
    expect(
      (screen.getByRole('button', {
        name: 'Guardar cambios'
      }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('prevents duplicate submits while a save is pending', async () => {
    const onSave = vi.fn().mockReturnValue(new Promise(() => undefined));
    renderEditor({ onSave });

    fireEvent.change(screen.getByLabelText('Descripción'), {
      target: { value: 'Descripción actualizada' }
    });
    const saveButton = screen.getByRole('button', {
      name: 'Guardar cambios'
    });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(
      (screen.getByRole('button', {
        name: 'Guardando…'
      }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('keeps edited values on a 400 response', async () => {
    const onSave = vi
      .fn()
      .mockRejectedValue(new ApiError('upstream detail', 'http', 400));
    renderEditor({ onSave });

    fireEvent.change(screen.getByLabelText('Descripción'), {
      target: { value: 'Descripción local' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(
      await screen.findByText('Revisá los datos del borrador e intentá nuevamente.')
    ).toBeTruthy();
    expect(
      (screen.getByLabelText('Descripción') as HTMLTextAreaElement).value
    ).toBe('Descripción local');
  });

  it('preserves local changes on 409 and reloads only after explicit confirmation', async () => {
    const detail = detailFixture();
    const latest = {
      ...detail,
      description: 'Versión guardada por otra sesión',
      updatedAt: '2026-07-30T15:00:00.000Z'
    };
    const onSave = vi
      .fn()
      .mockRejectedValue(new ApiError('conflict', 'http', 409));
    const onReloadLatest = vi.fn().mockResolvedValue(latest);
    renderEditor({ detail, onReloadLatest, onSave });

    fireEvent.change(screen.getByLabelText('Descripción'), {
      target: { value: 'Mi versión local' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(
      await screen.findByText('Este borrador fue actualizado desde otra sesión.')
    ).toBeTruthy();
    expect(
      (screen.getByLabelText('Descripción') as HTMLTextAreaElement).value
    ).toBe('Mi versión local');
    expect(onReloadLatest).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', { name: 'Recargar última versión' })
    );

    await waitFor(() => expect(onReloadLatest).toHaveBeenCalledOnce());
    expect(
      (screen.getByLabelText('Descripción') as HTMLTextAreaElement).value
    ).toBe('Versión guardada por otra sesión');
  });

  it('moves terminal authorization errors out of the partial editor', async () => {
    const onSave = vi
      .fn()
      .mockRejectedValue(new ApiError('forbidden', 'http', 403));
    const onTerminalError = vi.fn();
    renderEditor({ onSave, onTerminalError });

    fireEvent.change(screen.getByLabelText('Descripción'), {
      target: { value: 'Cambio local' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(onTerminalError).toHaveBeenCalledOnce());
    expect(onTerminalError).toHaveBeenCalledWith({
      code: 'forbidden',
      message: 'No tenés permisos para operar con esta institución.'
    });
  });

  it('focuses the first invalid common field and never submits it', () => {
    const onSave = vi.fn();
    renderEditor({ onSave });

    fireEvent.change(screen.getByLabelText('Nombre del logro'), {
      target: { value: ' ' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(document.activeElement).toBe(
      screen.getByLabelText('Nombre del logro')
    );
    expect(screen.getByText('Ingresá el nombre del logro.')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });
});

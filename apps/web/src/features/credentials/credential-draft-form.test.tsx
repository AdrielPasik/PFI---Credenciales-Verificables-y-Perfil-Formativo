import {
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CredentialDraftForm } from '@/features/credentials/credential-draft-form';
import { ApiError } from '@/lib/errors/api-error';
import type {
  AcademicProgramSearchItemVM,
  CourseTemplateSummaryVM,
  CredentialDraftFormSubmission,
  CurriculumAcademicSubjectSearchItemVM,
  HolderSummaryVM,
  ReusableCredentialType
} from '@/models/credentials';

const holder = {
  holderReference: 'holder-internal-reference',
  email: 'holder@example.com',
  did: 'did:example:holder',
  displayLabel: 'Titular Demo'
};

const program: AcademicProgramSearchItemVM = {
  programReference: 'program-internal-reference',
  programCode: '1621',
  programName: 'Ingeniería en Informática',
  curriculumReference: 'curriculum-internal-reference',
  curriculumCode: '2026'
};

const subject: CurriculumAcademicSubjectSearchItemVM = {
  academicCourseReference: 'course-internal-reference',
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

function courseTemplateFixture(
  overrides: Partial<CourseTemplateSummaryVM> = {}
): CourseTemplateSummaryVM {
  return {
    reference: 'template-1',
    credentialType: 'course',
    title: 'Curso de Python',
    description: 'Introducción a Python',
    hours: '22.00',
    modality: 'Online',
    platformName: null,
    externalUrl: null,
    certificationCode: null,
    expirationDate: null,
    providerName: null,
    level: null,
    skills: [],
    competencies: ['Programación'],
    learningOutcomes: ['Escribir scripts básicos'],
    status: 'active',
    createdFromCredentialId: 'credential-origin',
    lastSemanticAnalysisId: 'analysis-origin',
    approvedSemanticAnalysisId: null,
    approvedSemanticApprovedAt: null,
    approvedSemanticPipelineVersion: null,
    approvedSemanticTaxonomyVersion: null,
    approvedSemanticSourceCredentialId: null,
    approvedSemanticSnapshotSummary: null,
    createdAt: '2026-08-11T09:00:00.000Z',
    updatedAt: '2026-08-11T09:00:00.000Z',
    ...overrides
  };
}

function renderForm(options?: {
  issuerDid?: string | null;
  onResolveHolder?: (email: string) => Promise<HolderSummaryVM>;
  onCreateDraft?: (input: CredentialDraftFormSubmission) => Promise<void>;
  searchPrograms?: (
    query: string,
    signal: AbortSignal
  ) => Promise<AcademicProgramSearchItemVM[]>;
  searchSubjects?: (
    curriculumReference: string,
    query: string,
    signal: AbortSignal
  ) => Promise<CurriculumAcademicSubjectSearchItemVM[]>;
  searchReusableTemplates?: (
    credentialType: ReusableCredentialType,
    query: string,
    signal: AbortSignal
  ) => Promise<CourseTemplateSummaryVM[]>;
}) {
  const onResolveHolder =
    options?.onResolveHolder ?? vi.fn().mockResolvedValue(holder);
  const onCreateDraft =
    options?.onCreateDraft ?? vi.fn().mockResolvedValue(undefined);

  render(
    <CredentialDraftForm
      issuerDid={options?.issuerDid ?? 'did:example:issuer-demo'}
      issuerName="Universidad Contextual"
      onResolveHolder={onResolveHolder}
      onCreateDraft={onCreateDraft}
      searchPrograms={
        options?.searchPrograms ?? vi.fn().mockResolvedValue([program])
      }
      searchSubjects={
        options?.searchSubjects ?? vi.fn().mockResolvedValue([subject])
      }
      searchReusableTemplates={options?.searchReusableTemplates}
    />
  );

  return { onResolveHolder, onCreateDraft };
}

async function applyTemplateViaSearch(template: CourseTemplateSummaryVM) {
  fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
  fireEvent.click(await screen.findByRole('button', { name: template.title }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Usar este contenido' })
  );
}

async function resolveVisibleHolder() {
  fireEvent.change(screen.getByLabelText('Email del titular'), {
    target: { value: ' holder@example.com ' }
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Buscar titular' })
  );
  await screen.findByText('Titular Demo');
}

async function selectAcademicCurriculum() {
  fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
    target: { value: 'academic_subject' }
  });
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

describe('CredentialDraftForm', () => {
  it('shows the four closed credential types with no initial selection', () => {
    renderForm();

    const select = screen.getByLabelText(
      'Tipo de credencial'
    ) as HTMLSelectElement;

    expect(select.value).toBe('');
    expect(
      Array.from(select.options).map((option) => option.textContent)
    ).toEqual([
      'Seleccioná un tipo',
      'Curso',
      'Certificación',
      'Asignatura académica',
      'Título académico'
    ]);
  });

  it('requires a valid email and focuses the field', () => {
    const { onResolveHolder } = renderForm();
    const email = screen.getByLabelText('Email del titular');

    fireEvent.click(
      screen.getByRole('button', { name: 'Buscar titular' })
    );

    expect(
      screen.getByText('Ingresá el correo electrónico del titular.')
    ).toBeTruthy();
    expect(email).toBe(document.activeElement);
    expect(onResolveHolder).not.toHaveBeenCalled();

    fireEvent.change(email, { target: { value: 'invalid-email' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'Buscar titular' })
    );
    expect(
      screen.getByText('Ingresá un correo electrónico válido.')
    ).toBeTruthy();
    expect(onResolveHolder).not.toHaveBeenCalled();
  });

  it('normalizes email and shows only the safe holder summary', async () => {
    const { onResolveHolder } = renderForm({
      onResolveHolder: vi.fn().mockResolvedValue({
        ...holder,
        did: null
      })
    });

    fireEvent.change(screen.getByLabelText('Email del titular'), {
      target: { value: ' HOLDER@EXAMPLE.COM ' }
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Buscar titular' })
    );

    await waitFor(() => {
      expect(onResolveHolder).toHaveBeenCalledWith('holder@example.com');
    });
    expect(await screen.findByText('Titular Demo')).toBeTruthy();
    expect(screen.getByText('holder@example.com')).toBeTruthy();
    expect(screen.getByText('DID no disponible')).toBeTruthy();
    expect(document.body.textContent).not.toContain(
      'holder-internal-reference'
    );
  });

  it('clears a previous resolution when changing holder', async () => {
    renderForm();
    await resolveVisibleHolder();

    fireEvent.click(
      screen.getByRole('button', { name: 'Cambiar titular' })
    );

    expect(screen.queryByText('Titular Demo')).toBeNull();
    await waitFor(() => {
      expect(screen.getByLabelText('Email del titular')).toBe(
        document.activeElement
      );
    });
  });

  it('shows the issuer context as read-only information', () => {
    renderForm();

    expect(screen.getByText('Universidad Contextual')).toBeTruthy();
    expect(screen.getByText('Definida por tu sesión')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Contexto bloqueado');
    expect(
      screen.queryByRole('textbox', { name: /institución/i })
    ).toBeNull();
  });

  it('requires type and achievement, focusing each invalid field', async () => {
    const { onCreateDraft } = renderForm();
    const submit = screen.getByRole('button', {
      name: 'Crear borrador'
    }) as HTMLButtonElement;

    expect(submit.disabled).toBe(true);
    await resolveVisibleHolder();
    expect(submit.disabled).toBe(false);

    fireEvent.click(submit);
    expect(
      screen.getByText('Seleccioná un tipo de credencial.')
    ).toBeTruthy();
    expect(screen.getByLabelText('Tipo de credencial')).toBe(
      document.activeElement
    );
    expect(onCreateDraft).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
      target: { value: 'course' }
    });
    fireEvent.click(submit);
    expect(screen.getByText('Ingresá el nombre del logro.')).toBeTruthy();
    expect(screen.getByLabelText('Nombre del logro')).toBe(
      document.activeElement
    );
    expect(onCreateDraft).not.toHaveBeenCalled();
  });

  it('submits normalized achievement data with the resolved holder', async () => {
    const { onCreateDraft } = renderForm();
    await resolveVisibleHolder();

    fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
      target: { value: 'course' }
    });
    fireEvent.change(screen.getByLabelText('Nombre del logro'), {
      target: { value: '  Arquitectura   de Software  ' }
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Crear borrador' })
    );

    await waitFor(() => {
      expect(onCreateDraft).toHaveBeenCalledWith({
        achievementName: 'Arquitectura de Software',
        credentialType: 'course',
        holder
      });
    });
    expect(document.body.textContent).not.toContain(
      'holder-internal-reference'
    );
  });

  it('prevents duplicate draft submissions', async () => {
    const onCreateDraft = vi.fn(
      () => new Promise<void>(() => undefined)
    );
    renderForm({ onCreateDraft });
    await resolveVisibleHolder();

    fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
      target: { value: 'certification' }
    });
    fireEvent.change(screen.getByLabelText('Nombre del logro'), {
      target: { value: 'Arquitectura de Software' }
    });
    const submit = screen.getByRole('button', {
      name: 'Crear borrador'
    });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(onCreateDraft).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: 'Creando borrador' })
    ).toBeTruthy();
  });

  it('creates academic subjects from a complete local curriculum selection', async () => {
    const { onCreateDraft } = renderForm();
    await resolveVisibleHolder();

    fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
      target: { value: 'academic_subject' }
    });
    const submit = screen.getByRole('button', {
      name: 'Crear borrador'
    }) as HTMLButtonElement;

    expect(screen.queryByLabelText('Nombre del logro')).toBeNull();
    expect(submit.disabled).toBe(true);
    await selectAcademicCurriculum();

    expect(submit.disabled).toBe(false);
    expect(screen.getByText('Resumen antes de crear')).toBeTruthy();
    expect(screen.getAllByText(program.programName).length).toBeGreaterThan(0);
    expect(screen.getAllByText(subject.name).length).toBeGreaterThan(0);
    expect(screen.getAllByText('No disponible en el catálogo')).toHaveLength(
      4
    );
    fireEvent.click(submit);

    await waitFor(() => {
      expect(onCreateDraft).toHaveBeenCalledWith({
        credentialType: 'academic_subject',
        holder,
        program,
        subject
      });
    });
    expect(document.body.textContent).not.toContain(
      subject.academicCourseReference
    );
    expect(document.body.textContent).not.toContain(
      program.curriculumReference
    );
  });

  it('clears curriculum state when changing type and preserves the holder', async () => {
    renderForm();
    await resolveVisibleHolder();
    await selectAcademicCurriculum();

    fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
      target: { value: 'course' }
    });

    expect(screen.getAllByText('Titular Demo').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Nombre del logro')).toBeTruthy();
    expect(screen.queryByText('Materia seleccionada')).toBeNull();

    fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
      target: { value: 'academic_subject' }
    });

    expect(
      screen.getByLabelText('Buscar carrera o plan académico')
    ).toBeTruthy();
    expect(screen.queryByText(subject.name)).toBeNull();
    expect(
      (screen.getByRole('button', {
        name: 'Crear borrador'
      }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('preserves holder and curriculum selection after a create error', async () => {
    renderForm({
      onCreateDraft: vi
        .fn()
        .mockRejectedValue(new ApiError('rejected', 'http', 400))
    });
    await resolveVisibleHolder();
    await selectAcademicCurriculum();
    fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }));

    expect(
      await screen.findByText(
        'Revisá los datos del borrador e intentá nuevamente.'
      )
    ).toBeTruthy();
    expect(screen.getAllByText('Titular Demo').length).toBeGreaterThan(0);
    expect(screen.getAllByText(subject.name).length).toBeGreaterThan(0);
    expect(screen.getByText('Materia seleccionada')).toBeTruthy();
  });

  it('keeps the resolved holder when a catalog search fails', async () => {
    renderForm({
      searchPrograms: vi.fn().mockRejectedValue(new Error('unavailable'))
    });
    await resolveVisibleHolder();
    fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
      target: { value: 'academic_subject' }
    });
    fireEvent.change(
      screen.getByLabelText('Buscar carrera o plan académico'),
      { target: { value: 'informatica' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Buscar carrera' }));

    expect(
      await screen.findByText(/No pudimos consultar el catálogo/)
    ).toBeTruthy();
    expect(screen.getByText('Titular Demo')).toBeTruthy();
  });

  it('renders the uniform safe 404 without offering user creation', async () => {
    renderForm({
      onResolveHolder: vi
        .fn()
        .mockRejectedValue(new ApiError('private detail', 'http', 404))
    });

    fireEvent.change(screen.getByLabelText('Email del titular'), {
      target: { value: 'missing@example.com' }
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Buscar titular' })
    );

    expect(
      await screen.findByText(
        'No encontramos un titular disponible con ese correo. Verificá el email o consultá con la institución.'
      )
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain('private detail');
    expect(document.body.textContent).not.toContain('Crear usuario');
  });

  // ---------------------------------------------------------------------
  // C4x: reutilizacion atomica de templates -- tipo y nombre bloqueados
  // mientras haya un template aplicado.
  // ---------------------------------------------------------------------
  describe('atomic reusable template application', () => {
    it('locks credentialType after applying a course template', async () => {
      const template = courseTemplateFixture();
      renderForm({
        searchReusableTemplates: vi.fn().mockResolvedValue([template])
      });
      await resolveVisibleHolder();
      fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
        target: { value: 'course' }
      });

      await applyTemplateViaSearch(template);

      expect(
        (screen.getByLabelText('Tipo de credencial') as HTMLSelectElement)
          .disabled
      ).toBe(true);
    });

    it('locks credentialType after applying a certification template', async () => {
      const template = courseTemplateFixture({
        reference: 'template-cert-1',
        credentialType: 'certification',
        title: 'Certificación AWS'
      });
      renderForm({
        searchReusableTemplates: vi.fn().mockResolvedValue([template])
      });
      await resolveVisibleHolder();
      fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
        target: { value: 'certification' }
      });

      await applyTemplateViaSearch(template);

      expect(
        (screen.getByLabelText('Tipo de credencial') as HTMLSelectElement)
          .disabled
      ).toBe(true);
    });

    it('locks achievementName after applying a template', async () => {
      const template = courseTemplateFixture();
      renderForm({
        searchReusableTemplates: vi.fn().mockResolvedValue([template])
      });
      await resolveVisibleHolder();
      fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
        target: { value: 'course' }
      });

      await applyTemplateViaSearch(template);

      const name = screen.getByLabelText(
        'Nombre del logro'
      ) as HTMLInputElement;
      expect(name.disabled).toBe(true);
      expect(name.value).toBe(template.title);
    });

    it('unlocks credentialType and achievementName after removing the applied template', async () => {
      const template = courseTemplateFixture();
      renderForm({
        searchReusableTemplates: vi.fn().mockResolvedValue([template])
      });
      await resolveVisibleHolder();
      fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
        target: { value: 'course' }
      });
      await applyTemplateViaSearch(template);

      fireEvent.click(
        screen.getByRole('button', { name: 'Quitar contenido reutilizable' })
      );

      expect(
        (screen.getByLabelText('Tipo de credencial') as HTMLSelectElement)
          .disabled
      ).toBe(false);
      expect(
        (screen.getByLabelText('Nombre del logro') as HTMLInputElement)
          .disabled
      ).toBe(false);
    });

    it('does not allow changing course to certification while a template is applied', async () => {
      const template = courseTemplateFixture();
      renderForm({
        searchReusableTemplates: vi.fn().mockResolvedValue([template])
      });
      await resolveVisibleHolder();
      fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
        target: { value: 'course' }
      });
      await applyTemplateViaSearch(template);

      // Simula un intento de cambio (ej. un test o extension disparando el
      // evento aunque el <select> este disabled) -- el handler debe
      // rechazarlo igual, no solo el atributo disabled.
      fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
        target: { value: 'certification' }
      });

      expect(
        (screen.getByLabelText('Tipo de credencial') as HTMLSelectElement)
          .value
      ).toBe('course');
      // El template sigue aplicado (no se invalido por el intento fallido).
      expect(screen.getByText(template.title)).toBeTruthy();
    });

    it('does not allow editing achievementName while a template is applied', async () => {
      const template = courseTemplateFixture();
      renderForm({
        searchReusableTemplates: vi.fn().mockResolvedValue([template])
      });
      await resolveVisibleHolder();
      fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
        target: { value: 'course' }
      });
      await applyTemplateViaSearch(template);

      fireEvent.change(screen.getByLabelText('Nombre del logro'), {
        target: { value: 'Otro nombre distinto' }
      });

      expect(
        (screen.getByLabelText('Nombre del logro') as HTMLInputElement).value
      ).toBe(template.title);
    });

    it('creates the draft with the applied template and never sends a templateId', async () => {
      const template = courseTemplateFixture();
      const onCreateDraft = vi.fn().mockResolvedValue(undefined);
      renderForm({
        onCreateDraft,
        searchReusableTemplates: vi.fn().mockResolvedValue([template])
      });
      await resolveVisibleHolder();
      fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
        target: { value: 'course' }
      });
      await applyTemplateViaSearch(template);

      fireEvent.click(
        screen.getByRole('button', { name: 'Crear borrador' })
      );

      await waitFor(() => {
        expect(onCreateDraft).toHaveBeenCalledWith({
          achievementName: template.title,
          credentialType: 'course',
          holder,
          appliedTemplate: template
        });
      });

      // La submission solo tiene estas 4 claves -- nunca un templateId
      // suelto ni un campo de IA/SemanticAnalysis propio del draft nuevo
      // (appliedTemplate es el VM completo del template, sin alterar).
      expect(Object.keys(onCreateDraft.mock.calls[0][0]).sort()).toEqual(
        ['achievementName', 'appliedTemplate', 'credentialType', 'holder'].sort()
      );
      expect(onCreateDraft.mock.calls[0][0]).not.toHaveProperty('templateId');
    });
  });
});

it('limits a non-UADE issuer to course and certification', () => {
  renderForm({ issuerDid: 'did:example:course-platform-issuer-demo' });

  expect(
    Array.from(
      (screen.getByLabelText('Tipo de credencial') as HTMLSelectElement)
        .options
    ).map((option) => option.textContent)
  ).toEqual(['Seleccioná un tipo', 'Curso', 'Certificación']);
  expect(screen.queryByText('Asignatura académica')).toBeNull();
  expect(screen.queryByText('Título académico')).toBeNull();
});

import {
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewCredentialController } from '@/features/credentials/new-credential-route';

const routeMocks = vi.hoisted(() => ({
  replace: vi.fn()
}));

const sessionMocks = vi.hoisted(() => ({
  requestAuthenticated: vi.fn()
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: routeMocks.replace
  })
}));

vi.mock('@/lib/session/session-provider', () => ({
  useSession: () => ({
    requestAuthenticated: sessionMocks.requestAuthenticated
  })
}));

const membership = {
  issuerReference: 'issuer-selected-reference',
  issuerName: 'Universidad Seleccionada',
  issuerDid: 'did:example:issuer-demo',
  issuerAuthorizationStatus: 'authorized' as const,
  issuerAuthorizationLabel: 'Autorizada',
  role: 'admin' as const,
  roleLabel: 'Administrador',
  status: 'active' as const,
  operational: true
};

describe('NewCredentialController', () => {
  beforeEach(() => {
    routeMocks.replace.mockReset();
    sessionMocks.requestAuthenticated.mockReset();
  });

  it('uses the selected issuer, resolved holder and redirects to real detail', async () => {
    sessionMocks.requestAuthenticated
      .mockResolvedValueOnce({
        id: 'holder-internal-reference',
        email: 'holder@example.com',
        did: null,
        displayLabel: 'Titular Demo',
        status: 'active'
      })
      .mockResolvedValueOnce({
        id: 'credential-internal-reference',
        issuerId: 'issuer-selected-reference',
        subjectUserId: 'holder-internal-reference',
        title: 'Arquitectura de Software',
        type: 'course',
        sourceType: 'manual_issuer',
        status: 'draft',
        createdAt: '2026-07-30T12:00:00.000Z',
        updatedAt: '2026-07-30T12:00:00.000Z',
        credentialSubject: {
          achievement_name: 'Arquitectura de Software',
          institution_name: 'Universidad Seleccionada'
        }
      });

    render(<NewCredentialController membership={membership} />);

    fireEvent.change(screen.getByLabelText('Email del titular'), {
      target: { value: 'holder@example.com' }
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Buscar titular' })
    );
    await screen.findByText('Titular Demo');

    fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
      target: { value: 'course' }
    });
    fireEvent.change(screen.getByLabelText('Nombre del logro'), {
      target: { value: 'Arquitectura de Software' }
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Crear borrador' })
    );

    await waitFor(() => {
      expect(routeMocks.replace).toHaveBeenCalledWith(
        '/issuer/credentials/credential-internal-reference'
      );
    });
    expect(sessionMocks.requestAuthenticated.mock.calls).toEqual([
      [
        '/issuers/issuer-selected-reference/holders/resolve',
        {
          method: 'POST',
          body: { email: 'holder@example.com' }
        }
      ],
      [
        '/credentials/draft',
        {
          method: 'POST',
          body: {
            issuerId: 'issuer-selected-reference',
            subjectUserId: 'holder-internal-reference',
            type: 'course',
            title: 'Arquitectura de Software',
            sourceType: 'manual_issuer',
            credentialSubject: {
              achievement_name: 'Arquitectura de Software',
              institution_name: 'Universidad Seleccionada'
            }
          }
        }
      ]
    ]);
    expect(document.body.textContent).not.toContain(
      'issuer-selected-reference'
    );
    expect(document.body.textContent).not.toContain(
      'holder-internal-reference'
    );
    expect(document.body.textContent).not.toContain(
      'credential-internal-reference'
    );
  });

  it('creates an academic subject from curriculum with one exact POST and no PATCH', async () => {
    sessionMocks.requestAuthenticated
      .mockResolvedValueOnce({
        id: 'holder-internal-reference',
        email: 'holder@example.com',
        did: null,
        displayLabel: 'Titular Demo'
      })
      .mockResolvedValueOnce({
        items: [
          {
            programReference: 'program-internal-reference',
            programCode: '1621',
            programName: 'Ingeniería en Informática',
            curriculumReference: 'curriculum-internal-reference',
            curriculumCode: '2026'
          }
        ]
      })
      .mockResolvedValueOnce({
        items: [
          {
            academicCourseReference: 'course-internal-reference',
            code: '3.4.213',
            name: 'Ingeniería de Datos II',
            description: null,
            hours: null,
            programReference: 'program-internal-reference',
            programCode: '1621',
            programName: 'Ingeniería en Informática',
            curriculumReference: 'curriculum-internal-reference',
            curriculumCode: '2026'
          }
        ]
      })
      .mockResolvedValueOnce({
        id: 'credential-internal-reference',
        issuerId: 'issuer-selected-reference',
        status: 'draft',
        updatedAt: '2026-07-30T12:00:00.000Z'
      });

    render(<NewCredentialController membership={membership} />);

    fireEvent.change(screen.getByLabelText('Email del titular'), {
      target: { value: 'holder@example.com' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar titular' }));
    await screen.findByText('Titular Demo');
    fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
      target: { value: 'academic_subject' }
    });

    expect(screen.queryByLabelText('Nombre del logro')).toBeNull();
    const createButton = screen.getByRole('button', {
      name: 'Crear borrador'
    }) as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);

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
    expect(createButton.disabled).toBe(true);

    fireEvent.change(
      screen.getByLabelText('Buscar materia de la carrera'),
      { target: { value: 'datos' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Buscar materia' }));
    fireEvent.click(
      await screen.findByRole('button', { name: /Ingeniería de Datos II/ })
    );

    expect(createButton.disabled).toBe(false);
    expect(screen.getByText('Materia seleccionada')).toBeTruthy();
    expect(screen.getByText('Resumen antes de crear')).toBeTruthy();
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(routeMocks.replace).toHaveBeenCalledWith(
        '/issuer/credentials/credential-internal-reference'
      );
    });

    const createCalls = sessionMocks.requestAuthenticated.mock.calls.filter(
      ([path]) => path === '/credentials/draft'
    );
    expect(createCalls).toEqual([
      [
        '/credentials/draft',
        {
          method: 'POST',
          body: {
            issuerId: 'issuer-selected-reference',
            subjectUserId: 'holder-internal-reference',
            type: 'academic_subject',
            sourceType: 'manual_issuer',
            academicCourseReference: 'course-internal-reference',
            curriculumReference: 'curriculum-internal-reference'
          }
        }
      ]
    ]);
    expect(
      sessionMocks.requestAuthenticated.mock.calls.some(
        ([, options]) => options?.method === 'PATCH'
      )
    ).toBe(false);
    expect(document.body.textContent).not.toContain(
      'course-internal-reference'
    );
    expect(document.body.textContent).not.toContain(
      'curriculum-internal-reference'
    );
  });

  it('does not create when a stale subject does not match the selected program', async () => {
    sessionMocks.requestAuthenticated
      .mockResolvedValueOnce({
        id: 'holder-reference',
        email: 'holder@example.com',
        did: null,
        displayLabel: 'Titular Demo'
      })
      .mockResolvedValueOnce({
        items: [
          {
            programReference: 'program-a',
            programCode: '1621',
            programName: 'Ingeniería en Informática',
            curriculumReference: 'curriculum-a',
            curriculumCode: '2026'
          }
        ]
      })
      .mockResolvedValueOnce({
        items: [
          {
            academicCourseReference: 'stale-course',
            code: '3.4.213',
            name: 'Materia desactualizada',
            description: null,
            hours: null,
            programReference: 'program-b',
            programCode: '3824',
            programName: 'Otra carrera',
            curriculumReference: 'curriculum-b',
            curriculumCode: '2026'
          }
        ]
      });

    render(<NewCredentialController membership={membership} />);
    fireEvent.change(screen.getByLabelText('Email del titular'), {
      target: { value: 'holder@example.com' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar titular' }));
    await screen.findByText('Titular Demo');
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
    fireEvent.change(
      screen.getByLabelText('Buscar materia de la carrera'),
      { target: { value: 'datos' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Buscar materia' }));
    fireEvent.click(
      await screen.findByRole('button', { name: /Materia desactualizada/ })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }));

    expect(
      await screen.findByText(/no corresponde a la carrera actual/i)
    ).toBeTruthy();
    expect(
      sessionMocks.requestAuthenticated.mock.calls.filter(
        ([path]) => path === '/credentials/draft'
      )
    ).toHaveLength(0);
  });
});

function courseTemplateFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'template-1',
    credentialType: 'course',
    title: 'Curso de Python',
    description: 'Introducción a Python',
    hours: '22.00',
    modality: 'Online',
    platformName: 'Plataforma de Cursos Demo',
    externalUrl: 'https://plataforma-demo.example.com/curso/python',
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

function certificationTemplateFixture(overrides: Record<string, unknown> = {}) {
  return courseTemplateFixture({
    id: 'template-cert-1',
    credentialType: 'certification',
    title: 'Certificación AWS Cloud Practitioner',
    modality: null,
    platformName: null,
    certificationCode: 'AWS-CCP',
    expirationDate: '2027-01-01',
    providerName: 'Instituto Demo',
    level: 'Fundamentos',
    skills: ['Cloud'],
    learningOutcomes: [],
    ...overrides
  });
}

async function resolveHolderAndPickType(type: 'course' | 'certification') {
  fireEvent.change(screen.getByLabelText('Email del titular'), {
    target: { value: 'holder@example.com' }
  });
  fireEvent.click(screen.getByRole('button', { name: 'Buscar titular' }));
  await screen.findByText('Titular Demo');
  fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
    target: { value: type }
  });
}

function mockNewCredentialApi({
  holder = {
    id: 'holder-internal-reference',
    email: 'holder@example.com',
    did: null,
    displayLabel: 'Titular Demo'
  },
  templates = [],
  draft = {
    id: 'credential-internal-reference',
    issuerId: 'issuer-selected-reference',
    status: 'draft',
    updatedAt: '2026-08-11T09:00:00.000Z'
  },
  patch = {
    id: 'credential-internal-reference',
    issuerId: 'issuer-selected-reference',
    status: 'draft',
    updatedAt: '2026-08-11T09:05:00.000Z'
  }
}: {
  holder?: unknown;
  templates?: unknown;
  draft?: unknown;
  patch?: unknown;
} = {}) {
  sessionMocks.requestAuthenticated.mockImplementation(
    (path: string, options?: Record<string, unknown>) => {
      if (path.endsWith('/holders/resolve')) {
        return Promise.resolve(holder);
      }
      if (path === '/credentials/draft') {
        return Promise.resolve(draft);
      }
      if (options?.method === 'PATCH') {
        return Promise.resolve(patch);
      }
      if (path.includes('/course-templates')) {
        return Promise.resolve(templates);
      }
      return Promise.resolve(undefined);
    }
  );
}

describe('NewCredentialController reusable templates', () => {
  beforeEach(() => {
    routeMocks.replace.mockReset();
    sessionMocks.requestAuthenticated.mockReset();
  });

  it('does not show the reusable template section for academic_subject', async () => {
    mockNewCredentialApi();
    render(<NewCredentialController membership={membership} />);

    fireEvent.change(screen.getByLabelText('Email del titular'), {
      target: { value: 'holder@example.com' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar titular' }));
    await screen.findByText('Titular Demo');
    fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
      target: { value: 'academic_subject' }
    });

    expect(screen.queryByText('Usar contenido reutilizable')).toBeNull();
  });

  it('does not show the reusable template section for degree', async () => {
    mockNewCredentialApi();
    render(<NewCredentialController membership={membership} />);
    fireEvent.change(screen.getByLabelText('Email del titular'), {
      target: { value: 'holder@example.com' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar titular' }));
    await screen.findByText('Titular Demo');
    fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
      target: { value: 'degree' }
    });

    expect(screen.queryByText('Usar contenido reutilizable')).toBeNull();
  });

  it('shows the reusable template section for course', async () => {
    mockNewCredentialApi();
    render(<NewCredentialController membership={membership} />);
    await resolveHolderAndPickType('course');

    expect(screen.getByText('Usar contenido reutilizable')).toBeTruthy();
    expect(screen.getByLabelText('Buscar curso reutilizable')).toBeTruthy();
  });

  it('shows the reusable template section for certification', async () => {
    mockNewCredentialApi();
    render(<NewCredentialController membership={membership} />);
    await resolveHolderAndPickType('certification');

    expect(screen.getByText('Usar contenido reutilizable')).toBeTruthy();
    expect(
      screen.getByLabelText('Buscar certificación reutilizable')
    ).toBeTruthy();
  });

  it('searches templates of the current issuer with credentialType=course', async () => {
    mockNewCredentialApi({ templates: [courseTemplateFixture()] });
    render(<NewCredentialController membership={membership} />);
    await resolveHolderAndPickType('course');

    fireEvent.change(screen.getByLabelText('Buscar curso reutilizable'), {
      target: { value: 'python' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    await waitFor(() => {
      expect(screen.getByText('Curso de Python')).toBeTruthy();
    });

    const templateCall = sessionMocks.requestAuthenticated.mock.calls.find(
      ([path]) => path.includes('/course-templates')
    );
    expect(templateCall?.[0]).toBe(
      '/issuers/issuer-selected-reference/course-templates?search=python&credentialType=course'
    );
  });

  it('shows a loading state while searching', async () => {
    let resolveSearch: (value: unknown[]) => void = () => {};
    sessionMocks.requestAuthenticated.mockImplementation((path: string) => {
      if (path.endsWith('/holders/resolve')) {
        return Promise.resolve({
          id: 'holder-internal-reference',
          email: 'holder@example.com',
          did: null,
          displayLabel: 'Titular Demo'
        });
      }
      if (path.includes('/course-templates')) {
        return new Promise((resolve) => {
          resolveSearch = resolve;
        });
      }
      return Promise.resolve(undefined);
    });

    render(<NewCredentialController membership={membership} />);
    await resolveHolderAndPickType('course');

    fireEvent.change(screen.getByLabelText('Buscar curso reutilizable'), {
      target: { value: 'python' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    expect(
      await screen.findByRole('button', { name: 'Buscando…' })
    ).toBeTruthy();
    resolveSearch([]);
  });

  it('shows an empty state when there is no reusable content for the type', async () => {
    mockNewCredentialApi({ templates: [] });
    render(<NewCredentialController membership={membership} />);
    await resolveHolderAndPickType('certification');

    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    expect(
      await screen.findByText(
        'No hay contenido reutilizable para este tipo todavía.'
      )
    ).toBeTruthy();
  });

  it('selecting a course template precargas the applicable fields and applies them via PATCH after creating the draft', async () => {
    mockNewCredentialApi({ templates: [courseTemplateFixture()] });
    render(<NewCredentialController membership={membership} />);
    await resolveHolderAndPickType('course');

    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    fireEvent.click(await screen.findByText('Curso de Python'));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Usar este contenido' })
    );

    expect(
      screen.getByText('Datos precargados desde contenido reutilizable')
    ).toBeTruthy();
    expect(
      (screen.getByLabelText('Nombre del logro') as HTMLInputElement).value
    ).toBe('Curso de Python');

    fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }));

    await waitFor(() => {
      expect(routeMocks.replace).toHaveBeenCalledWith(
        '/issuer/credentials/credential-internal-reference'
      );
    });

    const patchCall = sessionMocks.requestAuthenticated.mock.calls.find(
      ([, options]) =>
        options?.method === 'PATCH'
    );
    expect(patchCall?.[0]).toBe(
      '/issuers/issuer-selected-reference/credentials/credential-internal-reference/draft'
    );
    expect(patchCall?.[1].body).toEqual({
      expectedUpdatedAt: '2026-08-11T09:00:00.000Z',
      description: 'Introducción a Python',
      hours: '22.00',
      externalUrl: 'https://plataforma-demo.example.com/curso/python',
      competencies: ['Programación'],
      modality: 'Online',
      learningOutcomes: ['Escribir scripts básicos']
    });
    // Nunca envia templateId -- el backend no tiene ese campo.
    expect(patchCall?.[1].body).not.toHaveProperty('templateId');
    // Nunca copia skills/providerName/level para un course.
    expect(patchCall?.[1].body).not.toHaveProperty('skills');
    expect(patchCall?.[1].body).not.toHaveProperty('providerName');
    expect(patchCall?.[1].body).not.toHaveProperty('level');
    // C4x fix: platformName ya no es un dato editable via PATCH para
    // ningun tipo -- enviarlo tumbaria todo el PATCH best-effort.
    expect(patchCall?.[1].body).not.toHaveProperty('platformName');
  });

  it('C3c fix: if the draft is created but the template PATCH fails, still redirects to the detail with ?templateApply=failed', async () => {
    sessionMocks.requestAuthenticated.mockImplementation(
      (path: string, options?: Record<string, unknown>) => {
        if (path.endsWith('/holders/resolve')) {
          return Promise.resolve({
            id: 'holder-internal-reference',
            email: 'holder@example.com',
            did: null,
            displayLabel: 'Titular Demo'
          });
        }
        if (path === '/credentials/draft') {
          return Promise.resolve({
            id: 'credential-internal-reference',
            issuerId: 'issuer-selected-reference',
            status: 'draft',
            updatedAt: '2026-08-11T09:00:00.000Z'
          });
        }
        if (options?.method === 'PATCH') {
          return Promise.reject(new Error('private backend failure'));
        }
        if (path.includes('/course-templates')) {
          return Promise.resolve([courseTemplateFixture()]);
        }
        return Promise.resolve(undefined);
      }
    );

    render(<NewCredentialController membership={membership} />);
    await resolveHolderAndPickType('course');

    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    fireEvent.click(await screen.findByText('Curso de Python'));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Usar este contenido' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }));

    await waitFor(() => {
      expect(routeMocks.replace).toHaveBeenCalledWith(
        '/issuer/credentials/credential-internal-reference?templateApply=failed'
      );
    });
  });

  it('C3c fix: does not append the failure query param when there is no applied template', async () => {
    mockNewCredentialApi({ templates: [] });
    render(<NewCredentialController membership={membership} />);
    await resolveHolderAndPickType('course');

    fireEvent.change(screen.getByLabelText('Nombre del logro'), {
      target: { value: 'Curso manual sin template' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }));

    await waitFor(() => {
      expect(routeMocks.replace).toHaveBeenCalledWith(
        '/issuer/credentials/credential-internal-reference'
      );
    });
  });

  it('selecting a certification template precargas its applicable fields (never modality/platformName/learningOutcomes)', async () => {
    mockNewCredentialApi({ templates: [certificationTemplateFixture()] });
    render(<NewCredentialController membership={membership} />);
    await resolveHolderAndPickType('certification');

    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    fireEvent.click(
      await screen.findByText('Certificación AWS Cloud Practitioner')
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Usar este contenido' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }));

    await waitFor(() => {
      expect(routeMocks.replace).toHaveBeenCalled();
    });

    const patchCall = sessionMocks.requestAuthenticated.mock.calls.find(
      ([, options]) =>
        options?.method === 'PATCH'
    );
    expect(patchCall?.[1].body).toEqual({
      expectedUpdatedAt: '2026-08-11T09:00:00.000Z',
      description: 'Introducción a Python',
      hours: '22.00',
      externalUrl: 'https://plataforma-demo.example.com/curso/python',
      competencies: ['Programación'],
      certificationCode: 'AWS-CCP',
      expirationDate: '2027-01-01',
      providerName: 'Instituto Demo',
      level: 'Fundamentos',
      skills: ['Cloud']
    });
    expect(patchCall?.[1].body).not.toHaveProperty('modality');
    expect(patchCall?.[1].body).not.toHaveProperty('platformName');
    expect(patchCall?.[1].body).not.toHaveProperty('learningOutcomes');
  });

  // C4x: reutilizacion atomica -- mientras haya un template aplicado, el
  // tipo queda bloqueado (antes se permitia cambiarlo, lo que invalidaba
  // el template en silencio). Ahora el intento de cambio se ignora por
  // completo: ni el tipo cambia ni el template se pierde.
  it('does not allow changing the credential type while a template is applied', async () => {
    mockNewCredentialApi({ templates: [courseTemplateFixture()] });
    render(<NewCredentialController membership={membership} />);
    await resolveHolderAndPickType('course');

    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    fireEvent.click(await screen.findByText('Curso de Python'));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Usar este contenido' })
    );
    expect(
      screen.getByText('Datos precargados desde contenido reutilizable')
    ).toBeTruthy();

    const typeSelect = screen.getByLabelText(
      'Tipo de credencial'
    ) as HTMLSelectElement;
    expect(typeSelect.disabled).toBe(true);

    fireEvent.change(typeSelect, { target: { value: 'certification' } });

    expect(typeSelect.value).toBe('course');
    expect(
      screen.getByText('Datos precargados desde contenido reutilizable')
    ).toBeTruthy();
  });

  it('unlocks the credential type after removing the applied template', async () => {
    mockNewCredentialApi({ templates: [courseTemplateFixture()] });
    render(<NewCredentialController membership={membership} />);
    await resolveHolderAndPickType('course');

    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    fireEvent.click(await screen.findByText('Curso de Python'));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Usar este contenido' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Quitar contenido reutilizable' })
    );

    const typeSelect = screen.getByLabelText(
      'Tipo de credencial'
    ) as HTMLSelectElement;
    expect(typeSelect.disabled).toBe(false);

    fireEvent.change(typeSelect, { target: { value: 'certification' } });
    expect(typeSelect.value).toBe('certification');
  });

  // C4x: el nombre precargado desde un template reutilizable queda
  // bloqueado mientras el template siga aplicado -- evita que el usuario
  // aplique un template y despues escriba un nombre distinto (seleccion
  // no atomica).
  it('does not allow editing the achievementName while a template is applied', async () => {
    mockNewCredentialApi({ templates: [courseTemplateFixture()] });
    render(<NewCredentialController membership={membership} />);
    await resolveHolderAndPickType('course');

    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    fireEvent.click(await screen.findByText('Curso de Python'));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Usar este contenido' })
    );

    const name = screen.getByLabelText(
      'Nombre del logro'
    ) as HTMLInputElement;
    expect(name.disabled).toBe(true);

    fireEvent.change(name, {
      target: { value: 'Curso de Python (editado)' }
    });
    expect(name.value).toBe('Curso de Python');

    fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }));

    await waitFor(() => {
      const createCall = sessionMocks.requestAuthenticated.mock.calls.find(
        ([path]) => path === '/credentials/draft'
      );
      expect(
        (createCall?.[1] as { body: { title: string } }).body.title
      ).toBe('Curso de Python');
    });
  });

  it('unlocks the achievementName after removing the applied template', async () => {
    mockNewCredentialApi({ templates: [courseTemplateFixture()] });
    render(<NewCredentialController membership={membership} />);
    await resolveHolderAndPickType('course');

    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    fireEvent.click(await screen.findByText('Curso de Python'));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Usar este contenido' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Quitar contenido reutilizable' })
    );

    const name = screen.getByLabelText(
      'Nombre del logro'
    ) as HTMLInputElement;
    expect(name.disabled).toBe(false);

    fireEvent.change(name, {
      target: { value: 'Curso de Python (editado)' }
    });
    expect(name.value).toBe('Curso de Python (editado)');
  });

  it('creating a course draft without selecting any template still uses the existing draft endpoint and sends no PATCH', async () => {
    mockNewCredentialApi({ templates: [] });
    render(<NewCredentialController membership={membership} />);
    await resolveHolderAndPickType('course');

    fireEvent.change(screen.getByLabelText('Nombre del logro'), {
      target: { value: 'Curso manual sin template' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }));

    await waitFor(() => {
      expect(routeMocks.replace).toHaveBeenCalled();
    });

    expect(
      sessionMocks.requestAuthenticated.mock.calls.some(
        ([, options]) => options?.method === 'PATCH'
      )
    ).toBe(false);
  });

  it('creating a certification draft without selecting any template still uses the existing draft endpoint and sends no PATCH', async () => {
    mockNewCredentialApi({ templates: [] });
    render(<NewCredentialController membership={membership} />);
    await resolveHolderAndPickType('certification');

    fireEvent.change(screen.getByLabelText('Nombre del logro'), {
      target: { value: 'Certificacion manual sin template' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }));

    await waitFor(() => {
      expect(routeMocks.replace).toHaveBeenCalled();
    });

    expect(
      sessionMocks.requestAuthenticated.mock.calls.some(
        ([, options]) => options?.method === 'PATCH'
      )
    ).toBe(false);
    const createCall = sessionMocks.requestAuthenticated.mock.calls.find(
      ([path]) => path === '/credentials/draft'
    );
    expect(
      (createCall?.[1] as { body: { type: string } }).body.type
    ).toBe('certification');
  });

  it('shows safe feedback when the template search fails, without breaking the screen', async () => {
    sessionMocks.requestAuthenticated.mockImplementation((path: string) => {
      if (path.endsWith('/holders/resolve')) {
        return Promise.resolve({
          id: 'holder-internal-reference',
          email: 'holder@example.com',
          did: null,
          displayLabel: 'Titular Demo'
        });
      }
      if (path.includes('/course-templates')) {
        return Promise.reject(new Error('private backend failure'));
      }
      return Promise.resolve(undefined);
    });

    render(<NewCredentialController membership={membership} />);
    await resolveHolderAndPickType('course');

    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    expect(
      await screen.findByText('No pudimos completar la operación. Intentá nuevamente.')
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain('private backend failure');
    // La pantalla sigue funcionando -- el resto del formulario sigue ahi.
    expect(screen.getByLabelText('Nombre del logro')).toBeTruthy();
  });

  it('never renders forbidden copy near the reusable template section', async () => {
    mockNewCredentialApi({ templates: [courseTemplateFixture()] });
    render(<NewCredentialController membership={membership} />);
    await resolveHolderAndPickType('course');

    expect(document.body.textContent).not.toMatch(/IA certificó/i);
    expect(document.body.textContent).not.toMatch(/blockchain valida/i);
    expect(document.body.textContent).not.toMatch(
      /verificado por|udemy|coursera|aws/i
    );
  });
});

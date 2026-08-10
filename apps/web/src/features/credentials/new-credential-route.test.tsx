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
        status: 'draft'
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

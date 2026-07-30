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
  issuerDid: 'did:example:issuer',
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

    fireEvent.change(screen.getByLabelText('Nombre del logro'), {
      target: { value: 'Arquitectura de Software' }
    });
    fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
      target: { value: 'course' }
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Guardar borrador' })
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
});

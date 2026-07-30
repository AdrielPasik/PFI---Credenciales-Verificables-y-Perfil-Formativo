import {
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CredentialDetailController,
  CredentialDetailView
} from '@/features/credentials/credential-detail-route';
import { ApiError } from '@/lib/errors/api-error';

const sessionMocks = vi.hoisted(() => ({
  requestAuthenticated: vi.fn()
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

const draftResponse = {
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
};

describe('CredentialDetailController', () => {
  beforeEach(() => {
    sessionMocks.requestAuthenticated.mockReset();
  });

  it('announces loading while requesting a direct detail URL', () => {
    sessionMocks.requestAuthenticated.mockReturnValue(
      new Promise(() => undefined)
    );

    render(
      <CredentialDetailController
        credentialReference="credential-internal-reference"
        membership={membership}
      />
    );

    expect(screen.getByText('Cargando borrador')).toBeTruthy();
    expect(sessionMocks.requestAuthenticated).toHaveBeenCalledWith(
      '/credentials/credential-internal-reference'
    );
  });

  it('renders a real draft and excludes technical IDs and future actions', async () => {
    sessionMocks.requestAuthenticated.mockResolvedValue(draftResponse);

    render(
      <CredentialDetailController
        credentialReference="credential-internal-reference"
        membership={membership}
      />
    );

    expect(
      await screen.findByRole('heading', {
        name: 'Arquitectura de Software'
      })
    ).toBeTruthy();
    expect(screen.getByText('Borrador')).toBeTruthy();
    expect(screen.getByText('Tipo de credencial')).toBeTruthy();
    expect(screen.getByText('Curso')).toBeTruthy();
    expect(document.body.textContent).not.toContain('course');
    expect(screen.getByText('Universidad Seleccionada')).toBeTruthy();
    expect(screen.getByText('Titular asociado')).toBeTruthy();
    expect(
      screen.getByText(
        'La información detallada del titular no está disponible en esta vista.'
      )
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain(
      'credential-internal-reference'
    );
    expect(document.body.textContent).not.toContain(
      'holder-internal-reference'
    );
    expect(document.body.textContent).not.toContain(
      'issuer-selected-reference'
    );
    expect(screen.queryByRole('button', { name: 'Emitir' })).toBeNull();
    expect(document.body.textContent).not.toContain('Blockchain');
    expect(document.body.textContent).not.toContain('Análisis IA');
    expect(document.body.textContent).not.toContain('Subir PDF');
    expect(document.body.textContent).not.toMatch(
      /F1c|F1d|contrato de detalle/i
    );
  });

  it('shows a controlled 404', async () => {
    sessionMocks.requestAuthenticated.mockRejectedValue(
      new ApiError('private upstream detail', 'http', 404)
    );

    render(
      <CredentialDetailController
        credentialReference="missing-reference"
        membership={membership}
      />
    );

    expect(
      await screen.findByText('No encontramos la credencial solicitada.')
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain(
      'private upstream detail'
    );
  });

  it('rejects a credential from another issuer context', async () => {
    sessionMocks.requestAuthenticated.mockResolvedValue({
      ...draftResponse,
      issuerId: 'another-issuer-reference'
    });

    render(
      <CredentialDetailController
        credentialReference="credential-internal-reference"
        membership={membership}
      />
    );

    expect(
      await screen.findByText(
        'La credencial no pertenece al contexto institucional activo.'
      )
    ).toBeTruthy();
    expect(
      screen.queryByRole('heading', {
        name: 'Arquitectura de Software'
      })
    ).toBeNull();
  });
});

describe('CredentialDetailView', () => {
  it('represents a non-draft state without inventing F1d controls', () => {
    render(
      <CredentialDetailView
        detail={{
          credentialReference: 'credential-internal-reference',
          issuerReference: 'issuer-selected-reference',
          title: 'Arquitectura de Software',
          type: 'academic_subject',
          typeLabel: 'Asignatura académica',
          status: 'issued',
          statusLabel: 'Emitida',
          institutionName: null,
          createdAt: '2026-07-30T12:00:00.000Z'
        }}
      />
    );

    expect(screen.getByText('Emitida')).toBeTruthy();
    expect(screen.getByText('Institución no disponible')).toBeTruthy();
    expect(
      screen.getByText(
        'Esta credencial está disponible en modo lectura. Las acciones para este estado todavía no están disponibles.'
      )
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Emitir' })).toBeNull();
    expect(document.body.textContent).not.toMatch(
      /F1c|F1d|contrato de detalle/i
    );
  });

  it('keeps the minimal record usable with holder details unavailable', async () => {
    sessionMocks.requestAuthenticated.mockResolvedValue(draftResponse);

    render(
      <CredentialDetailController
        credentialReference="credential-internal-reference"
        membership={membership}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Titular asociado')).toBeTruthy();
    });
    expect(document.body.textContent).not.toContain('DID inventado');
    expect(document.body.textContent).not.toContain(
      'holder-internal-reference'
    );
  });
});

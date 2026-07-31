import {
  fireEvent,
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
import type { IssuerCredentialDetailVM } from '@/models/credentials';

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
  title: 'Arquitectura de Software',
  description: null,
  hours: null,
  type: 'course',
  sourceType: 'manual_issuer',
  status: 'draft',
  createdAt: '2026-07-30T12:00:00.000Z',
  updatedAt: '2026-07-30T12:00:00.000Z',
  credentialSubject: {
    achievement_name: 'Arquitectura de Software',
    institution_name: 'Universidad Seleccionada',
    completion_date: null,
    academic_period: null,
    program_name: null,
    grade: null,
    provider_name: null,
    platform_name: null,
    modality: null,
    level: null,
    certification_code: null,
    expiration_date: null,
    external_url: null,
    skills: [],
    competencies: [],
    learning_outcomes: []
  },
  issuer: {
    displayName: 'Universidad Seleccionada',
    did: 'did:example:issuer'
  },
  holder: {
    displayLabel: 'Demo Holder',
    email: 'holder@example.com',
    did: 'did:example:holder'
  }
};

function detailFixture(
  overrides: Partial<
    Omit<IssuerCredentialDetailVM, 'credentialSubject'>
  > & {
    credentialSubject?: Partial<
      IssuerCredentialDetailVM['credentialSubject']
    >;
  } = {}
): IssuerCredentialDetailVM {
  const credentialSubject: IssuerCredentialDetailVM['credentialSubject'] = {
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
    ...overrides.credentialSubject
  };

  return {
    credentialReference: 'credential-internal-reference',
    title: 'Arquitectura de Software',
    description: null,
    hours: null,
    type: 'academic_subject',
    typeLabel: 'Asignatura académica',
    status: 'draft',
    statusLabel: 'Borrador',
    issuer: {
      displayName: 'Universidad Seleccionada',
      did: 'did:example:issuer'
    },
    holder: {
      displayLabel: 'Demo Holder',
      email: 'holder@example.com',
      did: 'did:example:holder'
    },
    createdAt: '2026-07-30T12:00:00.000Z',
    updatedAt: '2026-07-30T12:00:00.000Z',
    ...overrides,
    credentialSubject
  };
}

describe('CredentialDetailController', () => {
  beforeEach(() => {
    sessionMocks.requestAuthenticated.mockReset();
  });

  it('loads the direct URL through the issuer-scoped read endpoint only', () => {
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
    expect(sessionMocks.requestAuthenticated).toHaveBeenCalledOnce();
    expect(sessionMocks.requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer-selected-reference/credentials/credential-internal-reference'
    );
  });

  it('renders the safe institutional read model without technical IDs or future actions', async () => {
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
    expect(screen.getAllByText('Curso').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Universidad Seleccionada')).toBeTruthy();
    expect(screen.getByText('did:example:issuer')).toBeTruthy();
    expect(screen.getByText('Demo Holder')).toBeTruthy();
    expect(
      screen.getByText('holder@example.com · did:example:holder')
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain(
      'credential-internal-reference'
    );
    expect(document.body.textContent).not.toContain(
      'issuer-selected-reference'
    );
    expect(screen.queryByRole('button', { name: 'Emitir' })).toBeNull();
    expect(document.body.textContent).not.toContain('Blockchain');
    expect(document.body.textContent).not.toContain('Análisis IA');
    expect(document.body.textContent).not.toContain('Subir PDF');
    expect(document.body.textContent).not.toMatch(
      /F1c|F1d|contrato de detalle|readiness/i
    );
    expect(sessionMocks.requestAuthenticated).toHaveBeenCalledOnce();
    expect(sessionMocks.requestAuthenticated.mock.calls[0]).toHaveLength(1);
  });

  it('patches edits through the selected issuer context and accepts the response as truth', async () => {
    sessionMocks.requestAuthenticated
      .mockResolvedValueOnce(draftResponse)
      .mockResolvedValueOnce({
        ...draftResponse,
        description: 'Descripción persistida',
        updatedAt: '2026-07-30T13:00:00.000Z'
      });

    render(
      <CredentialDetailController
        credentialReference="credential-internal-reference"
        membership={membership}
      />
    );

    const description = await screen.findByLabelText('Descripción');
    fireEvent.change(description, {
      target: { value: 'Descripción persistida' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() =>
      expect(sessionMocks.requestAuthenticated).toHaveBeenCalledTimes(2)
    );
    expect(sessionMocks.requestAuthenticated).toHaveBeenLastCalledWith(
      '/issuers/issuer-selected-reference/credentials/credential-internal-reference/draft',
      {
        method: 'PATCH',
        body: {
          expectedUpdatedAt: '2026-07-30T12:00:00.000Z',
          description: 'Descripción persistida'
        }
      }
    );
    expect(await screen.findByText('Cambios guardados')).toBeTruthy();
    expect(
      (screen.getByLabelText('Descripción') as HTMLTextAreaElement).value
    ).toBe('Descripción persistida');
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

  it('presents discrepancies without issuing a corrective request', async () => {
    sessionMocks.requestAuthenticated.mockResolvedValue({
      ...draftResponse,
      credentialSubject: {
        ...draftResponse.credentialSubject,
        achievement_name: 'Arquitectura Aplicada',
        institution_name: 'Institución Histórica'
      }
    });

    render(
      <CredentialDetailController
        credentialReference="credential-internal-reference"
        membership={membership}
      />
    );

    expect(
      await screen.findByText(
        'La institución registrada en el borrador no coincide con el contexto institucional actual.'
      )
    ).toBeTruthy();
    expect(sessionMocks.requestAuthenticated).toHaveBeenCalledOnce();
    expect(sessionMocks.requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer-selected-reference/credentials/credential-internal-reference'
    );
    expect(sessionMocks.requestAuthenticated.mock.calls[0]).toHaveLength(1);
  });
});

describe('CredentialDetailView institutional consistency', () => {
  it('shows one institution when issuer and draft values match after trim', () => {
    render(
      <CredentialDetailView
        detail={detailFixture({
          credentialSubject: {
            institutionName: '  Universidad Seleccionada  '
          }
        })}
      />
    );

    expect(screen.getAllByText('Universidad Seleccionada')).toHaveLength(1);
    expect(
      screen.queryByText(/institución registrada en el borrador no coincide/i)
    ).toBeNull();
  });

  it('uses issuer displayName without warning when draft institution is null', () => {
    render(
      <CredentialDetailView
        detail={detailFixture({
          credentialSubject: { institutionName: null }
        })}
      />
    );

    expect(screen.getByText('Universidad Seleccionada')).toBeTruthy();
    expect(
      screen.queryByText(/institución registrada en el borrador no coincide/i)
    ).toBeNull();
  });

  it('shows an honest fallback when the issuer DID is unavailable', () => {
    render(
      <CredentialDetailView
        detail={detailFixture({
          issuer: {
            displayName: 'Universidad Seleccionada',
            did: null
          }
        })}
      />
    );

    expect(screen.getByText('Universidad Seleccionada')).toBeTruthy();
    expect(screen.getByText('DID institucional no disponible')).toBeTruthy();
  });

  it('keeps issuer displayName authoritative and warns about a different draft institution', () => {
    render(
      <CredentialDetailView
        detail={detailFixture({
          credentialSubject: {
            institutionName: 'Institución Histórica'
          }
        })}
      />
    );

    expect(screen.getByText('Universidad Seleccionada')).toBeTruthy();
    expect(
      screen.getByText(
        'La institución registrada en el borrador no coincide con el contexto institucional actual.'
      )
    ).toBeTruthy();
    expect(screen.getByText(/Institución registrada en el borrador:/)).toBeTruthy();
    expect(screen.getByText('Institución Histórica')).toBeTruthy();
  });

  it('does not duplicate the title when the draft achievement matches', () => {
    render(
      <CredentialDetailView
        detail={detailFixture({
          credentialSubject: {
            achievementName: '  Arquitectura de Software  '
          }
        })}
      />
    );

    expect(screen.getAllByText('Arquitectura de Software')).toHaveLength(1);
    expect(
      screen.queryByText(/nombre registrado en el borrador no coincide/i)
    ).toBeNull();
  });

  it('keeps title usable without a draft achievement name', () => {
    render(
      <CredentialDetailView
        detail={detailFixture({
          credentialSubject: { achievementName: null }
        })}
      />
    );

    expect(screen.getByText('Arquitectura de Software')).toBeTruthy();
    expect(
      screen.queryByText(/nombre registrado en el borrador no coincide/i)
    ).toBeNull();
  });

  it('keeps title authoritative and warns about a different draft achievement name', () => {
    render(
      <CredentialDetailView
        detail={detailFixture({
          credentialSubject: {
            achievementName: 'Arquitectura Aplicada'
          }
        })}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Arquitectura de Software' })
    ).toBeTruthy();
    expect(
      screen.getByText(
        'El nombre registrado en el borrador no coincide con el título principal de la credencial.'
      )
    ).toBeTruthy();
    expect(screen.getByText(/Nombre registrado en el borrador:/)).toBeTruthy();
    expect(screen.getByText('Arquitectura Aplicada')).toBeTruthy();
  });
});

describe('CredentialDetailView read-only states', () => {
  it('represents a non-draft state without inventing later controls', () => {
    render(
      <CredentialDetailView
        detail={detailFixture({
          status: 'issued',
          statusLabel: 'Emitida',
          credentialSubject: {
            achievementName: null,
            institutionName: null
          },
          holder: {
            displayLabel: 'Demo Holder',
            email: null,
            did: null
          }
        })}
      />
    );

    expect(screen.getByText('Emitida')).toBeTruthy();
    expect(screen.getByText('Universidad Seleccionada')).toBeTruthy();
    expect(screen.getByText('Email no disponible · DID no disponible')).toBeTruthy();
    expect(
      screen.getByText(
        'Esta credencial está disponible en modo lectura. Las acciones para este estado todavía no están disponibles.'
      )
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Emitir' })).toBeNull();
    expect(document.body.textContent).not.toMatch(
      /F1c|F1d|contrato de detalle|readiness/i
    );
  });

  it.each([
    ['issued', 'Emitida'],
    ['revoked', 'Revocada']
  ] as const)('does not render the draft editor for %s', (status, statusLabel) => {
    render(
      <CredentialDetailView
        detail={detailFixture({ status, statusLabel })}
        draftEditor={{
          issuerReference: 'issuer-selected-reference',
          onSave: vi.fn(),
          onReloadLatest: vi.fn(),
          onTerminalError: vi.fn()
        }}
      />
    );

    expect(screen.queryByLabelText('Nombre del logro')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).toBeNull();
  });
});

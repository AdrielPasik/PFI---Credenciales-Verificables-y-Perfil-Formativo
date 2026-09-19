/**
 * Administracion de enlaces y consentimiento de analisis contextual.
 *
 * Lo que se defiende aca: ver el perfil y autorizar computo son DOS permisos, y
 * la UI no puede presentarlos como uno solo ni habilitar el segundo sin una
 * eleccion explicita de credenciales.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listShares: vi.fn(),
  revoke: vi.fn(),
  replacePolicy: vi.fn(),
  credentials: vi.fn()
}));

vi.mock('@/lib/api/profile-sharing-api', () => ({
  listMyProfileSharesRequest: mocks.listShares,
  revokeProfileShareRequest: mocks.revoke,
  replaceShareVerificationPolicyRequest: mocks.replacePolicy
}));

vi.mock('@/lib/api/holder-api', () => ({
  getMyCredentialsRequest: mocks.credentials
}));

vi.mock('@/lib/session/session-provider', () => ({
  useSession: () => ({ requestAuthenticated: vi.fn() })
}));

import { ProfileShareManagement } from './profile-share-management';

const ACTIVE_SHARE = {
  shareId: 'share-1',
  status: 'ACTIVE' as const,
  statusLabel: 'Activo',
  createdAtLabel: '1 sept 2026',
  expiresAtLabel: null,
  revokedAtLabel: null,
  lastUsedAtLabel: null,
  contextualVerificationEnabled: false,
  authorizedCredentialCount: 0,
  effectiveAuthorizedCredentialCount: 0
};

const ISSUED_CREDENTIAL = {
  credentialReference: 'cred-a',
  title: 'Análisis de datos con Python',
  type: 'course',
  typeLabel: 'Curso',
  status: 'issued',
  statusLabel: 'Emitida',
  issuerName: 'Institución Demo',
  issuedAtLabel: '1 ago 2026',
  hasIntegrityEvidence: true,
  hasAnalysis: true
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listShares.mockResolvedValue([ACTIVE_SHARE]);
  mocks.credentials.mockResolvedValue([ISSUED_CREDENTIAL]);
  mocks.revoke.mockResolvedValue(undefined);
  mocks.replacePolicy.mockResolvedValue({
    enabled: true,
    policyVersion: 1,
    authorizedCredentialIds: ['cred-a'],
    effectiveAuthorizedCredentialIds: ['cred-a']
  });
});

afterEach(cleanup);

describe('enlaces compartidos', () => {
  it('muestra el estado del enlace y ofrece revocarlo', async () => {
    render(<ProfileShareManagement />);

    expect(await screen.findByText('Enlace compartido')).toBeTruthy();
    expect(screen.getByText('Activo')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revocar enlace' })).toBeTruthy();
  });

  it('un enlace revocado no ofrece revocar ni configurar', async () => {
    mocks.listShares.mockResolvedValue([
      {
        ...ACTIVE_SHARE,
        status: 'REVOKED' as const,
        statusLabel: 'Revocado',
        revokedAtLabel: '2 sept 2026'
      }
    ]);
    render(<ProfileShareManagement />);

    expect(await screen.findByText('Revocado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Revocar enlace' })).toBeNull();
    // Un enlace revocado no autoriza nada: configurarle una politica seria
    // mostrar un permiso que no rige.
    expect(screen.queryByRole('button', { name: 'Configurar' })).toBeNull();
  });

  it('revocar pide confirmacion y explica que es permanente', async () => {
    render(<ProfileShareManagement />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revocar enlace' }));

    expect(screen.getByText('¿Revocar este enlace?')).toBeTruthy();
    expect(screen.getByText(/dejar de funcionar/)).toBeTruthy();
    expect(screen.getByText(/no se puede reactivar/)).toBeTruthy();
    expect(screen.getByText(/también se corta el análisis contextual/i)).toBeTruthy();
    // Nada se revoco todavia: el click abre la confirmacion, no la accion.
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it('confirmar revoca ese enlace y recarga', async () => {
    render(<ProfileShareManagement />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revocar enlace' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sí, revocar' }));

    await waitFor(() => expect(mocks.revoke).toHaveBeenCalledTimes(1));
    expect(mocks.revoke.mock.calls[0]?.[1]).toBe('share-1');
  });

  it('cancelar no revoca nada', async () => {
    render(<ProfileShareManagement />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revocar enlace' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByText('¿Revocar este enlace?')).toBeNull();
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it('sin enlaces explica que todavia no compartio nada', async () => {
    mocks.listShares.mockResolvedValue([]);
    render(<ProfileShareManagement />);

    expect(await screen.findByText(/Todavía no compartiste tu perfil/)).toBeTruthy();
  });
});

describe('consentimiento de analisis contextual', () => {
  it('arranca deshabilitado', async () => {
    render(<ProfileShareManagement />);

    expect(await screen.findByText('Permitir análisis contextual')).toBeTruthy();
    expect(screen.getByText('Deshabilitado')).toBeTruthy();
  });

  it('NO ofrece una casilla de "permitir ver mi perfil"', async () => {
    // El enlace activo YA es ese permiso. Duplicarlo en un control sugeriria
    // que puede existir un enlace activo que no muestre nada.
    render(<ProfileShareManagement />);
    await screen.findByText('Enlace compartido');

    expect(screen.queryByText(/Permitir ver mi perfil/i)).toBeNull();
  });

  it('no deja habilitar sin elegir al menos una credencial', async () => {
    render(<ProfileShareManagement />);
    fireEvent.click(await screen.findByRole('button', { name: 'Configurar' }));
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Permitir que terceros analicen esta evidencia/ })
    );

    expect(screen.getByText(/tenés que elegir al menos una credencial/)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Guardar configuración' }).hasAttribute('disabled')
    ).toBe(true);
    expect(mocks.replacePolicy).not.toHaveBeenCalled();
  });

  it('envia el conjunto COMPLETO de credenciales elegidas', async () => {
    render(<ProfileShareManagement />);
    fireEvent.click(await screen.findByRole('button', { name: 'Configurar' }));
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Permitir que terceros analicen esta evidencia/ })
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /Análisis de datos con Python/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar configuración' }));

    await waitFor(() => expect(mocks.replacePolicy).toHaveBeenCalledTimes(1));
    expect(mocks.replacePolicy.mock.calls[0]?.[2]).toEqual({
      enabled: true,
      credentialIds: ['cred-a']
    });
  });

  it('solo ofrece credenciales emitidas', async () => {
    mocks.credentials.mockResolvedValue([
      ISSUED_CREDENTIAL,
      { ...ISSUED_CREDENTIAL, credentialReference: 'cred-rev', title: 'Curso revocado', status: 'revoked', statusLabel: 'Revocada' },
      { ...ISSUED_CREDENTIAL, credentialReference: 'cred-draft', title: 'Curso borrador', status: 'draft', statusLabel: 'Borrador' }
    ]);
    render(<ProfileShareManagement />);
    fireEvent.click(await screen.findByRole('button', { name: 'Configurar' }));

    expect(screen.getByRole('checkbox', { name: /Análisis de datos con Python/ })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: /Curso revocado/ })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /Curso borrador/ })).toBeNull();
  });

  it('la copia no promete mas privacidad de la que el diseño da', async () => {
    // La metadata segura de una credencial que respalde una conclusion SI puede
    // aparecer en un resultado publico. El holder tiene que saberlo al autorizar.
    render(<ProfileShareManagement />);
    fireEvent.click(await screen.findByRole('button', { name: 'Configurar' }));

    expect(screen.getByText(/no verá el contenido completo de tus fuentes ni sus fragmentos/)).toBeTruthy();
    expect(screen.getByText(/sí puede verse su título, tipo, institución emisora y estado actual/)).toBeTruthy();
  });

  it('avisa cuando una credencial elegida dejo de estar disponible', async () => {
    mocks.listShares.mockResolvedValue([
      {
        ...ACTIVE_SHARE,
        contextualVerificationEnabled: true,
        authorizedCredentialCount: 3,
        effectiveAuthorizedCredentialCount: 2
      }
    ]);
    render(<ProfileShareManagement />);

    expect(await screen.findByText(/ya no está disponible/)).toBeTruthy();
    // El consentimiento no se borra solo: se informa, no se reescribe.
    expect(screen.getByText(/Tu selección se conserva/)).toBeTruthy();
  });
});

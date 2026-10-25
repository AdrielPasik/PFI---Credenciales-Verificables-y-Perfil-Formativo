import { Alert } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { ProfileSharePolicyScreen } from '@/features/sharing/profile-share-policy-screen';
import { credentialListPayload } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ shareId: 'share-1' }),
  Redirect: () => null,
  Stack: Object.assign(() => null, { Screen: () => null }),
  Tabs: Object.assign(() => null, { Screen: () => null }),
  Link: () => null
}));

const savedPolicy = {
  configured: true,
  enabled: true,
  policyVersion: 3,
  authorizedCredentialIds: ['cred-001'],
  effectiveAuthorizedCredentialIds: ['cred-001'],
  updatedAt: '2026-04-01T10:00:00.000Z'
};

function routes(overrides: Record<string, unknown> = {}) {
  return {
    'GET /me/credentials': { body: credentialListPayload() },
    'GET /me/profile/shares/share-1/verification-policy': { body: savedPolicy },
    'PUT /me/profile/shares/share-1/verification-policy': { body: savedPolicy },
    ...overrides
  };
}

async function renderPolicy(overrides: Record<string, unknown> = {}) {
  const result = await renderWithProviders(<ProfileSharePolicyScreen />, {
    routes: routes(overrides) as never
  });
  await waitFor(() => expect(screen.getByLabelText('Sistemas Operativos')).toBeTruthy());
  return result;
}

async function renderPolicyState(overrides: Record<string, unknown> = {}) {
  return renderWithProviders(<ProfileSharePolicyScreen />, {
    routes: routes(overrides) as never
  });
}

describe('política contextual renderizada', () => {
  it('muestra error controlado si falla la política inicial y nunca hace PUT automático', async () => {
    const { calls } = await renderPolicyState({
      'GET /me/profile/shares/share-1/verification-policy': { status: 400 }
    });
    await waitFor(() => expect(screen.getByText('No pudimos cargar la configuración')).toBeTruthy());
    expect(screen.queryByText('Cargando la configuración guardada')).toBeNull();
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);
  });

  it('muestra error controlado si falla la carga de credenciales', async () => {
    await renderPolicyState({ 'GET /me/credentials': { status: 500 } });
    await waitFor(() => expect(screen.getByText('No pudimos cargar la configuración')).toBeTruthy());
    expect(screen.queryByText('Cargando la configuración guardada')).toBeNull();
  });

  it('muestra un único estado recuperable cuando fallan ambas lecturas iniciales', async () => {
    const { calls } = await renderPolicyState({
      'GET /me/credentials': { status: 500 },
      'GET /me/profile/shares/share-1/verification-policy': { status: 400 }
    });
    await waitFor(() => expect(screen.getByText('No pudimos cargar la configuración')).toBeTruthy());
    expect(screen.queryByText('Cargando la configuración guardada')).toBeNull();
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);
  });

  it('permite reintentar una carga fallida y recién entonces habilita la edición', async () => {
    await renderPolicyState({
      'GET /me/profile/shares/share-1/verification-policy': [
        { status: 500 },
        { body: savedPolicy }
      ]
    });
    await waitFor(() => expect(screen.getByText('No pudimos cargar la configuración')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Reintentar'));
    await waitFor(() => expect(screen.getByLabelText('Sistemas Operativos')).toBeTruthy());
  });

  it('distingue una selección vacía guardada de una política nunca configurada', async () => {
    await renderPolicy({
      'GET /me/profile/shares/share-1/verification-policy': {
        body: { ...savedPolicy, configured: true, enabled: false, authorizedCredentialIds: [], effectiveAuthorizedCredentialIds: [] }
      }
    });
    expect(screen.queryByText('Sin configuración previa')).toBeNull();
    expect(screen.getByLabelText('Permitir análisis contextual').props.value).toBe(false);
  });

  it('representa una política no configurada sin enviar cambios automáticamente', async () => {
    const { calls } = await renderPolicy({
      'GET /me/profile/shares/share-1/verification-policy': {
        body: { ...savedPolicy, configured: false, enabled: false, authorizedCredentialIds: [], effectiveAuthorizedCredentialIds: [], policyVersion: 0 }
      }
    });
    expect(screen.getByText('Sin configuración previa')).toBeTruthy();
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);
  });

  it('carga y representa la selección guardada antes de permitir editar', async () => {
    await renderPolicy();
    expect(screen.getByLabelText('Sistemas Operativos').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByLabelText('Introducción a Redes').props.accessibilityState).toMatchObject({ checked: false });
  });

  it('edita, exige confirmación, permite cancelar y reemplaza sólo tras confirmar', async () => {
    let buttons: { text?: string; onPress?: () => void }[] = [];
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_, __, received) => {
      buttons = (received ?? []) as { text?: string; onPress?: () => void }[];
    });
    const { calls } = await renderPolicy();

    await fireEvent.press(screen.getByLabelText('Certificación en Ciberseguridad'));
    expect(screen.getByLabelText('Guardar configuración').props.accessibilityState).toMatchObject({ disabled: false });
    await fireEvent.press(screen.getByLabelText('Guardar configuración'));
    await act(async () => { buttons.find((button) => button.text === 'Cancelar')?.onPress?.(); });
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);

    await fireEvent.press(screen.getByLabelText('Guardar configuración'));
    await act(async () => { buttons.find((button) => button.text === 'Guardar')?.onPress?.(); });
    await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true));
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.body).toBe(JSON.stringify({ enabled: true, credentialIds: ['cred-001', 'cred-003'] }));
    await waitFor(() => expect(screen.getByText('La configuración se guardó correctamente.')).toBeTruthy());
    alert.mockRestore();
  });

  it('muestra un error y conserva el estado cuando el reemplazo confirmado falla', async () => {
    let buttons: { text?: string; onPress?: () => void }[] = [];
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_, __, received) => {
      buttons = (received ?? []) as { text?: string; onPress?: () => void }[];
    });
    await renderPolicy({ 'PUT /me/profile/shares/share-1/verification-policy': { status: 500 } });

    await fireEvent.press(screen.getByLabelText('Certificación en Ciberseguridad'));
    await fireEvent.press(screen.getByLabelText('Guardar configuración'));
    await act(async () => { buttons.find((button) => button.text === 'Guardar')?.onPress?.(); });
    await waitFor(() => expect(screen.getByText('No pudimos guardar la configuración. La selección guardada no cambió.')).toBeTruthy());
    expect(screen.getByLabelText('Sistemas Operativos').props.accessibilityState).toMatchObject({ checked: true });
    alert.mockRestore();
  });

  it('refresca la política autorizativa después de guardar', async () => {
    const updated = {
      ...savedPolicy,
      policyVersion: 4,
      authorizedCredentialIds: ['cred-001', 'cred-003'],
      effectiveAuthorizedCredentialIds: ['cred-001', 'cred-003']
    };
    const { calls } = await renderPolicy({
      'GET /me/profile/shares/share-1/verification-policy': [
        { body: savedPolicy },
        { body: updated }
      ],
      'PUT /me/profile/shares/share-1/verification-policy': { body: updated }
    });
    let buttons: { text?: string; onPress?: () => void }[] = [];
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_, __, received) => {
      buttons = (received ?? []) as { text?: string; onPress?: () => void }[];
    });

    await fireEvent.press(screen.getByLabelText('Certificación en Ciberseguridad'));
    await fireEvent.press(screen.getByLabelText('Guardar configuración'));
    await act(async () => { buttons.find((button) => button.text === 'Guardar')?.onPress?.(); });
    await waitFor(() => expect(calls.filter((call) => call.path.endsWith('/verification-policy') && call.method === 'GET').length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.getByLabelText('Certificación en Ciberseguridad').props.accessibilityState).toMatchObject({ checked: true }));
    alert.mockRestore();
  });
});

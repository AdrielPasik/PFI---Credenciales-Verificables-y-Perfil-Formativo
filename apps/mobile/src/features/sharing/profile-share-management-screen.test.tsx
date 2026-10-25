import * as Clipboard from 'expo-clipboard';
import { Alert, Linking, Share } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { ProfileShareManagementScreen } from '@/features/sharing/profile-share-management-screen';
import { renderWithProviders } from '@/test/render';

const TOKEN = 't'.repeat(43);
const SHARE_URL = `https://scope.test/share/profile/${TOKEN}`;

const activeShare = {
  shareId: 'share-1',
  scope: 'profile',
  status: 'ACTIVE',
  createdAt: '2026-04-01T10:00:00.000Z',
  expiresAt: '2026-05-01T10:00:00.000Z',
  revokedAt: null,
  lastUsedAt: null
};

function defaultRoutes(overrides: Record<string, unknown> = {}) {
  return {
    'GET /me/profile/shares': { body: [activeShare] },
    'POST /me/profile/shares/share-1/link': {
      body: { sharePath: `/share/profile/${TOKEN}`, shareUrl: null }
    },
    'POST /me/profile/shares/share-1/revoke': { body: {} },
    ...overrides
  };
}

async function renderManagement(overrides: Record<string, unknown> = {}) {
  const result = await renderWithProviders(<ProfileShareManagementScreen />, {
    routes: defaultRoutes(overrides) as never
  });
  await waitFor(() => expect(screen.getByText('Enlace compartido')).toBeTruthy());
  return result;
}

describe('gestión renderizada de enlaces de perfil', () => {
  it('no ofrece configurar análisis contextual para un alcance incompatible', async () => {
    await renderManagement({
      'GET /me/profile/shares': { body: [{ ...activeShare, scope: 'credential_and_profile' }] }
    });

    expect(screen.queryByText('Configurar análisis contextual')).toBeNull();
    // Las operaciones propias de un enlace activo siguen disponibles.
    expect(screen.getByText('Copiar enlace')).toBeTruthy();
    expect(screen.getByText('Revocar enlace')).toBeTruthy();
  });

  it('lista enlaces y recupera el material portador sólo por una acción explícita de copiar', async () => {
    const clipboard = jest.spyOn(Clipboard, 'setStringAsync');
    const { calls } = await renderManagement();

    expect(calls.some((call) => call.path.endsWith('/link'))).toBe(false);
    await fireEvent.press(screen.getByText('Copiar enlace'));

    await waitFor(() => expect(clipboard).toHaveBeenCalledWith(SHARE_URL));
    expect(screen.getByText('Enlace copiado.')).toBeTruthy();
    expect(calls.filter((call) => call.path.endsWith('/link'))).toHaveLength(1);
    clipboard.mockRestore();
  });

  it('comparte y abre el enlace recuperado mediante las APIs nativas', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await renderManagement();

    await fireEvent.press(screen.getByText('Compartir'));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(share.mock.calls[0]?.[0]).toMatchObject({ url: SHARE_URL });

    await fireEvent.press(screen.getByText('Abrir en navegador'));
    await waitFor(() => expect(open).toHaveBeenCalledWith(SHARE_URL));
    share.mockRestore();
    open.mockRestore();
  });

  it('exige confirmación, permite cancelar y sólo revoca tras confirmación explícita', async () => {
    let buttons: { text?: string; onPress?: () => void }[] = [];
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_, __, received) => {
      buttons = (received ?? []) as { text?: string; onPress?: () => void }[];
    });
    const { calls } = await renderManagement();

    await fireEvent.press(screen.getByText('Revocar enlace'));
    expect(calls.some((call) => call.path.endsWith('/revoke'))).toBe(false);
    await act(async () => { buttons.find((button) => button.text === 'Cancelar')?.onPress?.(); });
    expect(calls.some((call) => call.path.endsWith('/revoke'))).toBe(false);

    await fireEvent.press(screen.getByText('Revocar enlace'));
    await act(async () => { buttons.find((button) => button.text === 'Revocar enlace')?.onPress?.(); });
    await waitFor(() => expect(calls.some((call) => call.path.endsWith('/revoke'))).toBe(true));
    alert.mockRestore();
  });

  it('muestra un error si la revocación confirmada no se puede completar', async () => {
    let buttons: { text?: string; onPress?: () => void }[] = [];
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_, __, received) => {
      buttons = (received ?? []) as { text?: string; onPress?: () => void }[];
    });
    await renderManagement({ 'POST /me/profile/shares/share-1/revoke': { status: 500 } });

    await fireEvent.press(screen.getByText('Revocar enlace'));
    await act(async () => { buttons.find((button) => button.text === 'Revocar enlace')?.onPress?.(); });
    await waitFor(() => expect(screen.getByText('No pudimos revocar el enlace. Intentá nuevamente.')).toBeTruthy());
    alert.mockRestore();
  });
});

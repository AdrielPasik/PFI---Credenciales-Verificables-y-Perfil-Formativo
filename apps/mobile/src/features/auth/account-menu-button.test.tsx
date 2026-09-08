import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { AccountMenuButton } from '@/features/auth/account-menu-button';
import { currentUserPayload } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';

const ME_ROUTE = 'GET /auth/me';

async function renderAccountMenu(user: unknown = currentUserPayload()) {
  const rendered = await renderWithProviders(<AccountMenuButton />, {
    routes: { [ME_ROUTE]: { body: user } }
  });

  await waitFor(() =>
    expect(screen.getByTestId('account-menu-button')).toBeTruthy()
  );

  return rendered;
}

describe('menú de cuenta', () => {
  it('no se muestra mientras la sesión no está resuelta', async () => {
    await renderWithProviders(<AccountMenuButton />, {
      routes: {},
      accessToken: null
    });

    expect(screen.queryByTestId('account-menu-button')).toBeNull();
  });

  it('el botón tiene etiqueta accesible, no sólo un icono', async () => {
    await renderAccountMenu();

    const trigger = screen.getByTestId('account-menu-button');
    expect(trigger.props.accessibilityLabel).toBe('Cuenta');
    expect(trigger.props.accessibilityRole).toBe('button');
  });

  it('muestra la identidad que provee el API, sin inferirla del correo', async () => {
    await renderAccountMenu();

    await fireEvent.press(screen.getByTestId('account-menu-button'));

    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());
    expect(screen.getByText('titular@example.com')).toBeTruthy();
    expect(
      screen.getByText('did:web:scope.example.org:usuarios:holder-1')
    ).toBeTruthy();
  });

  it('no muestra un DID inexistente', async () => {
    await renderAccountMenu(currentUserPayload({ did: null }));

    await fireEvent.press(screen.getByTestId('account-menu-button'));

    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());
    expect(
      screen.queryByText('Identificador descentralizado')
    ).toBeNull();
  });

  it('cerrar sesión está disponible y limpia el material de sesión', async () => {
    const { storage } = await renderAccountMenu();

    await fireEvent.press(screen.getByTestId('account-menu-button'));
    await waitFor(() =>
      expect(screen.getByTestId('logout-button')).toBeTruthy()
    );

    await fireEvent.press(screen.getByTestId('logout-button'));

    await waitFor(async () =>
      expect(await storage.getAccessToken()).toBeNull()
    );
  });

  it('no expone ninguna superficie institucional', async () => {
    await renderAccountMenu(
      currentUserPayload({
        issuerMemberships: [
          {
            issuerId: 'issuer-1',
            issuerName: 'Universidad Nacional Ejemplo',
            issuerDid: null,
            issuerAuthorizationStatus: 'authorized',
            role: 'admin',
            status: 'active'
          }
        ]
      })
    );

    await fireEvent.press(screen.getByTestId('account-menu-button'));

    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());
    expect(screen.queryByText('Universidad Nacional Ejemplo')).toBeNull();
    expect(screen.queryByText(/emisor/i)).toBeNull();
    expect(screen.queryByText(/instituci[oó]n/i)).toBeNull();
  });
});

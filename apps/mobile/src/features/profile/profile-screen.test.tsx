import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Share } from 'react-native';

import { ProfileScreen } from '@/features/profile/profile-screen';
import {
  credentialListPayload,
  currentProfilePayload,
  LONG_TEXT_500,
  profileSharePayload
} from '@/test/fixtures';
import type { RouteMap, StubResponse } from '@/test/http';
import { renderWithProviders } from '@/test/render';

const PROFILE_ROUTE = 'GET /me/profile/current';
const CREDENTIALS_ROUTE = 'GET /me/credentials';
const REBUILD_ROUTE = 'POST /me/profile/rebuild';
const SHARE_ROUTE = 'POST /me/profile/share';

function routes({
  profile = { body: currentProfilePayload() },
  credentials = { body: credentialListPayload() },
  rebuild,
  share
}: {
  profile?: StubResponse;
  credentials?: StubResponse;
  rebuild?: StubResponse;
  share?: StubResponse;
} = {}): RouteMap {
  const map: RouteMap = {
    [PROFILE_ROUTE]: profile,
    [CREDENTIALS_ROUTE]: credentials
  };

  if (rebuild) map[REBUILD_ROUTE] = rebuild;
  if (share) map[SHARE_ROUTE] = share;

  return map;
}

async function renderProfile(routeMap: RouteMap = routes()) {
  const rendered = await renderWithProviders(<ProfileScreen />, {
    routes: routeMap
  });
  await waitFor(() =>
    expect(screen.getByText('Resumen del perfil')).toBeTruthy()
  );
  return rendered;
}

describe('pantalla de perfil formativo', () => {
  it('presenta el perfil como el inicio del titular, no una lista de tarjetas', async () => {
    await renderProfile();

    expect(screen.getByText('Mi perfil formativo')).toBeTruthy();
    expect(screen.getByText('Espacio personal')).toBeTruthy();
  });

  it('muestra la narrativa y las horas sin inventar puntajes', async () => {
    await renderProfile();

    expect(
      screen.getByText(
        'Tu trayectoria combina fundamentos de infraestructura con práctica en redes.'
      )
    ).toBeTruthy();
    expect(screen.getByText('240 horas oficiales declaradas')).toBeTruthy();
    expect(screen.queryByText(/puntaje/i)).toBeNull();
    expect(screen.queryByText(/nivel experto/i)).toBeNull();
    expect(screen.queryByText(/empleabilidad/i)).toBeNull();
  });

  it('aclara que la confianza describe el análisis, no el conocimiento', async () => {
    await renderProfile();

    expect(screen.getByText(/no tu\s+nivel de conocimiento/i)).toBeTruthy();
  });

  it('muestra el aviso de cobertura sin sugerir una carencia de la persona', async () => {
    await renderProfile();

    expect(screen.getByText('Cobertura del perfil')).toBeTruthy();
    expect(
      screen.getByText('2 credenciales todavía no tienen análisis semántico.')
    ).toBeTruthy();
    expect(screen.getByText('1 credencial no informa horas.')).toBeTruthy();
  });

  it('muestra áreas, habilidades y conceptos', async () => {
    await renderProfile();

    expect(screen.getByText('Infraestructura')).toBeTruthy();
    expect(screen.getByText('120 horas estimadas por IA')).toBeTruthy();
    expect(screen.getAllByText('Administración de sistemas').length).toBeGreaterThan(0);
    expect(screen.getByText('Modelo OSI')).toBeTruthy();
  });

  it('explica la procedencia con texto visible, no sólo con un icono', async () => {
    await renderProfile();

    expect(screen.getAllByText('Emisor').length).toBeGreaterThan(0);
    expect(screen.getAllByText('IA').length).toBeGreaterThan(0);
    expect(
      screen.getByLabelText('2 aportes interpretados con IA')
    ).toBeTruthy();
  });

  it('distingue lo declarado por la institución de lo interpretado por IA', async () => {
    await renderProfile();

    expect(
      screen.getByText('Información declarada por instituciones')
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Proviene de credenciales emitidas. No es una certificación de la IA.'
      )
    ).toBeTruthy();
  });

  it('renderiza contenido declarado de 500 caracteres como texto, no como chip', async () => {
    await renderProfile();

    expect(screen.getByTestId('profile-emitted-competencies')).toBeTruthy();

    const longEntry = screen.getAllByText(LONG_TEXT_500)[0];
    expect(longEntry).toBeTruthy();
    // Nunca se recorta con numberOfLines: el contenido tiene que poder crecer.
    expect(longEntry?.props.numberOfLines).toBeUndefined();
  });

  it('anticipa credenciales y ofrece ver todas', async () => {
    await renderProfile();

    expect(screen.getByText('Sistemas Operativos')).toBeTruthy();
    expect(screen.getByText('Ver todas')).toBeTruthy();
  });

  it('muestra el estado vacío cuando todavía no hay perfil', async () => {
    await renderWithProviders(<ProfileScreen />, {
      routes: routes({ profile: { body: { currentProfile: null } } })
    });

    await waitFor(() =>
      expect(
        screen.getByText('Tu perfil todavía no está disponible')
      ).toBeTruthy()
    );
    // Holder Mobile no puede emitir credenciales: nunca ofrece crearlas.
    expect(screen.queryByText(/crear credencial/i)).toBeNull();
  });

  it('un fallo de perfil no oculta las credenciales', async () => {
    await renderWithProviders(<ProfileScreen />, {
      routes: routes({ profile: { status: 500 } })
    });

    await waitFor(() =>
      expect(
        screen.getByText('Scope no está disponible en este momento')
      ).toBeTruthy()
    );
    expect(screen.getByText('Sistemas Operativos')).toBeTruthy();
  });

  it('un contrato incompatible se distingue de un problema de red', async () => {
    await renderWithProviders(<ProfileScreen />, {
      routes: routes({
        profile: { body: { currentProfile: { profileVersion: 42 } } }
      })
    });

    await waitFor(() =>
      expect(
        screen.getByText('La información no tiene el formato esperado')
      ).toBeTruthy()
    );
  });

  it('muestra el estado vacío de credenciales sin acciones de emisor', async () => {
    await renderWithProviders(<ProfileScreen />, {
      routes: routes({ credentials: { body: [] } })
    });

    await waitFor(() =>
      expect(
        screen.getByText('Todavía no tenés credenciales formativas')
      ).toBeTruthy()
    );
    expect(screen.queryByText(/emitir/i)).toBeNull();
  });
});

describe('actualizar perfil', () => {
  it('sólo se ofrece cuando hay credenciales emitidas', async () => {
    await renderProfile();

    expect(screen.getByTestId('profile-rebuild-action')).toBeTruthy();
  });

  it('no se ofrece en el estado vacío si no hay credenciales', async () => {
    await renderWithProviders(<ProfileScreen />, {
      routes: routes({
        profile: { body: { currentProfile: null } },
        credentials: { body: [] }
      })
    });

    await waitFor(() =>
      expect(
        screen.getByText('Tu perfil todavía no está disponible')
      ).toBeTruthy()
    );
    expect(screen.queryByTestId('profile-rebuild-action')).toBeNull();
  });

  it('llama al endpoint de reconstrucción con POST', async () => {
    const { calls } = await renderProfile(
      routes({
        rebuild: { body: currentProfilePayload({ credentialsCount: 9 }) }
      })
    );

    await fireEvent.press(screen.getByTestId('profile-rebuild-action'));

    await waitFor(() =>
      expect(
        calls.some(
          (call) => call.path === '/me/profile/rebuild' && call.method === 'POST'
        )
      ).toBe(true)
    );
  });

  it('un fallo al actualizar se comunica sin romper el perfil visible', async () => {
    await renderProfile(routes({ rebuild: { status: 500 } }));

    await fireEvent.press(screen.getByTestId('profile-rebuild-action'));

    await waitFor(() =>
      expect(screen.getByText('No pudimos actualizar tu perfil')).toBeTruthy()
    );
    expect(screen.getByText('Resumen del perfil')).toBeTruthy();
  });

  it('NO se dispara sola al montar la pantalla', async () => {
    const { calls } = await renderProfile();

    expect(calls.some((call) => call.path === '/me/profile/rebuild')).toBe(
      false
    );
  });

  it('el refresco de la pantalla NO reconstruye el perfil', async () => {
    const { calls } = await renderProfile(
      routes({ rebuild: { body: currentProfilePayload() } })
    );

    const before = calls.length;
    await fireEvent.scroll(screen.getByText('Mi perfil formativo'), {
      contentOffset: { y: -200 }
    });

    expect(calls.slice(before).some((c) => c.path === '/me/profile/rebuild')).toBe(
      false
    );
  });
});

describe('compartir perfil', () => {
  it('NO genera un enlace al montar la pantalla', async () => {
    const { calls } = await renderProfile();

    expect(calls.some((call) => call.path === '/me/profile/share')).toBe(false);
  });

  it('genera el enlace con el API y lo entrega al share sheet nativo', async () => {
    const shareSpy = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction' } as never);

    const { calls } = await renderProfile(
      routes({ share: { body: profileSharePayload() } })
    );

    await fireEvent.press(screen.getByText('Compartir perfil'));

    await waitFor(() => expect(shareSpy).toHaveBeenCalled());

    expect(
      calls.some(
        (call) => call.path === '/me/profile/share' && call.method === 'POST'
      )
    ).toBe(true);

    const [payload] = shareSpy.mock.calls[0] as [{ url?: string; message?: string }];
    expect(payload.url).toBe(
      `https://scope.test/share/profile/${'t'.repeat(43)}`
    );
    expect(payload.message).toContain('Mi perfil formativo en Scope');

    shareSpy.mockRestore();
  });

  it('reutiliza el enlace y no crea un share nuevo por cada acción', async () => {
    const shareSpy = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction' } as never);

    const { calls } = await renderProfile(
      routes({ share: { body: profileSharePayload() } })
    );

    await fireEvent.press(screen.getByText('Compartir perfil'));
    await waitFor(() => expect(shareSpy).toHaveBeenCalledTimes(1));

    await fireEvent.press(screen.getByText('Copiar enlace'));
    await waitFor(() =>
      expect(screen.getByText('Enlace copiado.')).toBeTruthy()
    );

    expect(
      calls.filter((call) => call.path === '/me/profile/share')
    ).toHaveLength(1);

    shareSpy.mockRestore();
  });

  it('comunica el fallo de generación del enlace', async () => {
    await renderProfile(routes({ share: { status: 500 } }));

    await fireEvent.press(screen.getByText('Compartir perfil'));

    await waitFor(() =>
      expect(screen.getByText('No pudimos compartir')).toBeTruthy()
    );
  });
});

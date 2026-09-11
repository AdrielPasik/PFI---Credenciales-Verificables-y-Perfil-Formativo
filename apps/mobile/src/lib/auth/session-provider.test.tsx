import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { HttpClient } from '@/lib/api/http-client';
import {
  SessionProvider,
  useSession
} from '@/lib/auth/session-provider';
import { InMemorySessionStorage } from '@/lib/auth/session-storage';
import { createQueryClient } from '@/lib/query/query-client';
import {
  createFailingFetch,
  createFetchStub,
  type StubResponse
} from '@/test/http';
import { currentUserPayload, loginResponsePayload } from '@/test/fixtures';

// En React Native Testing Library 14 `render` y `renderHook` son asíncronos:
// siempre se los espera.
async function renderSession({
  responses,
  storage,
  fetchImplementation
}: {
  responses?: StubResponse | StubResponse[];
  storage?: InMemorySessionStorage;
  fetchImplementation?: typeof fetch;
}) {
  const stub = responses ? createFetchStub(responses) : null;
  const client = new HttpClient(
    'https://api.scope.test',
    fetchImplementation ?? stub!.fetchImplementation
  );
  const sessionStorage = storage ?? new InMemorySessionStorage();
  const queryClient = createQueryClient();

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <SessionProvider httpClient={client} storage={sessionStorage}>
          {children}
        </SessionProvider>
      </QueryClientProvider>
    );
  }

  // `renderHook` expone `result` como propiedad no enumerable: hay que
  // devolver la vista tal cual, nunca esparcirla.
  const view = await renderHook(() => useSession(), { wrapper: Wrapper });

  return {
    result: view.result,
    unmount: view.unmount,
    calls: stub?.calls ?? [],
    sessionStorage,
    queryClient
  };
}

describe('restauración de sesión', () => {
  it('sin material de sesión arranca sin autenticar y no llama al backend', async () => {
    const { result, calls } = await renderSession({ responses: { body: {} } });

    await waitFor(() =>
      expect(result.current.state.status).toBe('unauthenticated')
    );
    expect(calls).toHaveLength(0);
  });

  it('con token válido restaura la sesión sin pasar por la pantalla de acceso', async () => {
    const { result, calls } = await renderSession({
      responses: { body: currentUserPayload() },
      storage: new InMemorySessionStorage('jwt-guardado')
    });

    await waitFor(() =>
      expect(result.current.state.status).toBe('authenticated')
    );
    expect(calls[0]?.url).toBe('https://api.scope.test/auth/me');
    expect(calls[0]?.headers.Authorization).toBe('Bearer jwt-guardado');
  });

  it('con token rechazado (401) limpia el material y avisa que la sesión venció', async () => {
    const storage = new InMemorySessionStorage('jwt-vencido');
    const { result } = await renderSession({
      responses: { status: 401 },
      storage
    });

    await waitFor(() =>
      expect(result.current.state.status).toBe('unauthenticated')
    );

    if (result.current.state.status === 'unauthenticated') {
      expect(result.current.state.notice?.code).toBe('session_expired');
    }
    await expect(storage.getAccessToken()).resolves.toBeNull();
  });

  it('con backend caído conserva el token y ofrece reintentar', async () => {
    const storage = new InMemorySessionStorage('jwt-guardado');
    const { result } = await renderSession({
      fetchImplementation: createFailingFetch() as unknown as typeof fetch,
      storage
    });

    await waitFor(() =>
      expect(result.current.state.status).toBe('recoverable-error')
    );
    // El token NO se destruye por un problema de red.
    await expect(storage.getAccessToken()).resolves.toBe('jwt-guardado');
  });
});

describe('login', () => {
  it('persiste el token en almacenamiento seguro y autentica', async () => {
    const { result, sessionStorage } = await renderSession({
      responses: { body: loginResponsePayload() }
    });

    await waitFor(() =>
      expect(result.current.state.status).toBe('unauthenticated')
    );

    await act(async () => {
      await result.current.login({
        email: 'titular@example.com',
        password: 'secreto'
      });
    });

    expect(result.current.state.status).toBe('authenticated');
    await expect(sessionStorage.getAccessToken()).resolves.toBe(
      'header.payload.signature'
    );
  });

  it('nunca persiste la contraseña', async () => {
    const { result, sessionStorage } = await renderSession({
      responses: { body: loginResponsePayload() }
    });

    await waitFor(() =>
      expect(result.current.state.status).toBe('unauthenticated')
    );

    await act(async () => {
      await result.current.login({
        email: 'titular@example.com',
        password: 'contraseña-secreta'
      });
    });

    const stored = await sessionStorage.getAccessToken();
    expect(stored).not.toContain('contraseña-secreta');
  });

  it('credenciales inválidas devuelven un mensaje específico, no genérico', async () => {
    const { result } = await renderSession({ responses: { status: 401 } });

    await waitFor(() =>
      expect(result.current.state.status).toBe('unauthenticated')
    );

    let feedback = null;
    await act(async () => {
      feedback = await result.current.login({
        email: 'titular@example.com',
        password: 'incorrecta'
      });
    });

    expect(feedback).toMatchObject({
      code: 'invalid_credentials',
      message: 'El correo o la contraseña son incorrectos.'
    });
    expect(result.current.state.status).toBe('unauthenticated');
  });

  it('un fallo de red se distingue de credenciales inválidas', async () => {
    const { result } = await renderSession({
      fetchImplementation: createFailingFetch() as unknown as typeof fetch
    });

    await waitFor(() =>
      expect(result.current.state.status).toBe('unauthenticated')
    );

    let feedback = null;
    await act(async () => {
      feedback = await result.current.login({
        email: 'titular@example.com',
        password: 'secreto'
      });
    });

    expect(feedback).toMatchObject({ code: 'network' });
  });

  it('un 500 se reporta como servicio no disponible', async () => {
    const { result } = await renderSession({ responses: { status: 503 } });

    await waitFor(() =>
      expect(result.current.state.status).toBe('unauthenticated')
    );

    let feedback = null;
    await act(async () => {
      feedback = await result.current.login({
        email: 'titular@example.com',
        password: 'secreto'
      });
    });

    expect(feedback).toMatchObject({ code: 'service_unavailable' });
  });
});

describe('register', () => {
  it('reutiliza la activación de sesión, persiste sólo el token y autentica', async () => {
    const { result, sessionStorage, calls } = await renderSession({
      responses: { body: loginResponsePayload() }
    });

    await waitFor(() =>
      expect(result.current.state.status).toBe('unauthenticated')
    );

    await act(async () => {
      await result.current.register({
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        password: 'secreto8'
      });
    });

    expect(calls[0]?.url).toBe('https://api.scope.test/auth/register');
    expect(result.current.state.status).toBe('authenticated');
    expect(
      result.current.state.status === 'authenticated'
        ? result.current.state.currentUser.displayLabel
        : null
    ).toBe('Ada Lovelace');
    await expect(sessionStorage.getAccessToken()).resolves.toBe(
      'header.payload.signature'
    );
    expect(JSON.stringify(await sessionStorage.getAccessToken())).not.toContain('secreto8');
  });

  it('mapea el email duplicado sin persistir una sesión', async () => {
    const { result, sessionStorage } = await renderSession({ responses: { status: 409 } });

    await waitFor(() =>
      expect(result.current.state.status).toBe('unauthenticated')
    );

    let feedback = null;
    await act(async () => {
      feedback = await result.current.register({
        firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', password: 'secreto8'
      });
    });

    expect(feedback).toMatchObject({ code: 'email_in_use' });
    await expect(sessionStorage.getAccessToken()).resolves.toBeNull();
  });
});

describe('logout', () => {
  it('borra el material de sesión y vacía la caché de datos del titular', async () => {
    const storage = new InMemorySessionStorage('jwt-guardado');
    const { result, queryClient } = await renderSession({
      responses: { body: currentUserPayload() },
      storage
    });

    await waitFor(() =>
      expect(result.current.state.status).toBe('authenticated')
    );

    queryClient.setQueryData(['holder', 'profile', 'current'], {
      credentialsCount: 4
    });

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.state.status).toBe('unauthenticated');
    await expect(storage.getAccessToken()).resolves.toBeNull();
    expect(
      queryClient.getQueryData(['holder', 'profile', 'current'])
    ).toBeUndefined();
  });
});

describe('requestAuthenticated', () => {
  it('inyecta el Bearer en cada petición del titular', async () => {
    const { result, calls } = await renderSession({
      responses: [{ body: currentUserPayload() }, { body: [] }],
      storage: new InMemorySessionStorage('jwt-guardado')
    });

    await waitFor(() =>
      expect(result.current.state.status).toBe('authenticated')
    );

    await act(async () => {
      await result.current.requestAuthenticated('/me/credentials');
    });

    expect(calls[1]?.headers.Authorization).toBe('Bearer jwt-guardado');
  });

  it('un 401 en una petición de datos expira la sesión y devuelve a acceso', async () => {
    const storage = new InMemorySessionStorage('jwt-guardado');
    const { result } = await renderSession({
      responses: [{ body: currentUserPayload() }, { status: 401 }],
      storage
    });

    await waitFor(() =>
      expect(result.current.state.status).toBe('authenticated')
    );

    await act(async () => {
      await expect(
        result.current.requestAuthenticated('/me/credentials')
      ).rejects.toMatchObject({ status: 401 });
    });

    expect(result.current.state.status).toBe('unauthenticated');
    await expect(storage.getAccessToken()).resolves.toBeNull();
  });

  it('un 403 NO expira la sesión: es falta de permiso, no sesión vencida', async () => {
    const storage = new InMemorySessionStorage('jwt-guardado');
    const { result } = await renderSession({
      responses: [{ body: currentUserPayload() }, { status: 403 }],
      storage
    });

    await waitFor(() =>
      expect(result.current.state.status).toBe('authenticated')
    );

    await act(async () => {
      await expect(
        result.current.requestAuthenticated('/me/credentials/ajena')
      ).rejects.toMatchObject({ status: 403 });
    });

    expect(result.current.state.status).toBe('authenticated');
    await expect(storage.getAccessToken()).resolves.toBe('jwt-guardado');
  });
});

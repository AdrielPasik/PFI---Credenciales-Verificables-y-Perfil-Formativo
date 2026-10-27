import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integracion con la API SIMULADA: el cliente HTTP, las funciones de `auth-api`, el
 * mapeo de errores, las pantallas y el `SessionProvider` son los REALES; solo `fetch`
 * (y `/auth/me`, que no es parte de esta etapa) esta simulado.
 *
 * No prueba el backend real: eso queda cubierto por la corrida contra la API local.
 */
const authApiOverrides = vi.hoisted(() => ({ currentUserRequest: vi.fn() }));
vi.mock('@/lib/api/auth-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/auth-api')>()),
  currentUserRequest: authApiOverrides.currentUserRequest
}));

import { ForgotPasswordScreen } from '@/features/auth/forgot-password-screen';
import { ResetPasswordScreen } from '@/features/auth/reset-password-screen';
import {
  SessionProvider,
  useSession
} from '@/lib/session/session-provider';
import type { SessionStore } from '@/lib/session/session-store';

const TOKEN = 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA';
const NEW_PASSWORD = 'NuevaContraseña123';

class MemoryStore implements SessionStore {
  cleared = 0;
  constructor(private token: string | null = null) {}
  getAccessToken() {
    return this.token;
  }
  setAccessToken(token: string) {
    this.token = token;
  }
  getSelectedIssuerReference() {
    return null;
  }
  setSelectedIssuerReference() {}
  clearSelectedIssuerReference() {}
  clear() {
    this.token = null;
    this.cleared += 1;
  }
}

const currentUser = {
  id: 'user-reference',
  email: 'persona@example.com',
  did: null,
  status: 'active',
  displayLabel: 'Persona Demo',
  issuerMemberships: []
};

interface Recorded {
  path: string;
  method: string | undefined;
  authorization: string | null;
  body: unknown;
}

const fetchMock = vi.fn();
let calls: Recorded[] = [];

type Handler = (body: Record<string, unknown>) => { status: number; body?: unknown };

function serve(handlers: Record<string, Handler>) {
  fetchMock.mockImplementation(async (url: URL, init: RequestInit) => {
    const path = new URL(url.toString()).pathname;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      path,
      method: init.method,
      authorization: new Headers(init.headers).get('Authorization'),
      body
    });
    const handler = handlers[path];
    if (!handler) {
      return new Response(null, { status: 404 });
    }
    const result = handler(body ?? {});
    return new Response(
      result.body === undefined ? null : JSON.stringify(result.body),
      { status: result.status, headers: { 'Content-Type': 'application/json' } }
    );
  });
}

function SessionProbe() {
  const { state } = useSession();
  return <output data-testid="session-status">{state.status}</output>;
}

function typeEmail(value: string) {
  fireEvent.change(screen.getByLabelText('Correo electrónico'), {
    target: { value }
  });
}

describe('password recovery flow (simulated API)', () => {
  beforeEach(() => {
    calls = [];
    fetchMock.mockReset();
    authApiOverrides.currentUserRequest.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.test');
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    window.history.replaceState(null, '', '/');
  });

  it('request: sends the email to the public endpoint and shows the neutral confirmation, even with a session token in storage', async () => {
    window.sessionStorage.setItem('scope.accessToken', 'jwt-de-la-sesion');
    serve({
      '/auth/password-reset/request': () => ({
        status: 202,
        body: { status: 'requested' }
      })
    });
    render(<ForgotPasswordScreen />);

    typeEmail('Ana@Example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }));

    await screen.findByRole('heading', { name: 'Revisá tu correo' });
    expect(calls).toEqual([
      {
        path: '/auth/password-reset/request',
        method: 'POST',
        authorization: null,
        body: { email: 'ana@example.com' }
      }
    ]);
  });

  it('request: a 429 and a 503 surface as product messages', async () => {
    serve({
      '/auth/password-reset/request': () => ({
        status: 429,
        body: { code: 'TOO_MANY_REQUESTS', message: 'detalle' }
      })
    });
    render(<ForgotPasswordScreen />);
    typeEmail('ana@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }));
    await screen.findByText(/demasiados intentos/);

    serve({
      '/auth/password-reset/request': () => ({
        status: 503,
        body: { code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: 'detalle' }
      })
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }));
    await screen.findByText(/no está disponible en este momento/);
    expect(document.body.textContent).not.toContain('detalle');
  });

  it('reset: verifies, confirms, clears the local session and does not log in', async () => {
    const store = new MemoryStore('jwt-viejo');
    authApiOverrides.currentUserRequest.mockResolvedValue(currentUser);
    serve({
      '/auth/password-reset/verify': () => ({
        status: 200,
        body: { status: 'valid' }
      }),
      '/auth/password-reset/confirm': () => ({
        status: 200,
        body: { status: 'password_reset' }
      })
    });
    window.history.replaceState(null, '', `/reset-password#token=${TOKEN}`);

    render(
      <SessionProvider store={store}>
        <SessionProbe />
        <ResetPasswordScreen />
      </SessionProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId('session-status').textContent).toBe(
        'authenticated'
      )
    );
    await screen.findByRole('heading', { name: 'Elegí una contraseña nueva' });
    // Verificar no toca la sesion.
    expect(store.cleared).toBe(0);

    fireEvent.change(screen.getByLabelText('Contraseña nueva'), {
      target: { value: NEW_PASSWORD }
    });
    fireEvent.change(screen.getByLabelText('Repetí la contraseña nueva'), {
      target: { value: NEW_PASSWORD }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));

    await screen.findByRole('heading', { name: 'Tu contraseña se actualizó' });

    expect(calls.map((call) => call.path)).toEqual([
      '/auth/password-reset/verify',
      '/auth/password-reset/confirm'
    ]);
    expect(calls[0].body).toEqual({ token: TOKEN });
    expect(calls[1].body).toEqual({ token: TOKEN, password: NEW_PASSWORD });
    // Los endpoints publicos nunca reciben el JWT de la sesion.
    expect(calls.every((call) => call.authorization === null)).toBe(true);
    // Sin login automatico: no hubo ninguna llamada a /auth/login.
    expect(calls.some((call) => call.path.startsWith('/auth/login'))).toBe(false);
    // La sesion local se limpio por el mecanismo oficial.
    expect(store.cleared).toBe(1);
    expect(store.getAccessToken()).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('session-status').textContent).toBe(
        'unauthenticated'
      )
    );
    expect(window.location.href).not.toContain(TOKEN);
  });

  it('reset: an already used link is rejected at verify and never reaches confirm', async () => {
    serve({
      '/auth/password-reset/verify': () => ({
        status: 400,
        body: { code: 'PASSWORD_RESET_TOKEN_INVALID', message: 'detalle' }
      })
    });
    window.history.replaceState(null, '', `/reset-password#token=${TOKEN}`);

    render(
      <SessionProvider store={new MemoryStore()}>
        <ResetPasswordScreen />
      </SessionProvider>
    );

    await screen.findByRole('heading', { name: 'Este enlace ya no es válido' });
    expect(calls.map((call) => call.path)).toEqual([
      '/auth/password-reset/verify'
    ]);
  });

  it('reset: a policy rejection from the backend keeps the form, then a second attempt succeeds with the same token', async () => {
    let attempt = 0;
    serve({
      '/auth/password-reset/verify': () => ({
        status: 200,
        body: { status: 'valid' }
      }),
      '/auth/password-reset/confirm': () => {
        attempt += 1;
        return attempt === 1
          ? {
              status: 400,
              body: { code: 'PASSWORD_POLICY_VIOLATION', message: 'detalle' }
            }
          : { status: 200, body: { status: 'password_reset' } };
      }
    });
    window.history.replaceState(null, '', `/reset-password#token=${TOKEN}`);

    render(
      <SessionProvider store={new MemoryStore()}>
        <ResetPasswordScreen />
      </SessionProvider>
    );
    await screen.findByLabelText('Contraseña nueva');

    const submit = (password: string) => {
      fireEvent.change(screen.getByLabelText('Contraseña nueva'), {
        target: { value: password }
      });
      fireEvent.change(screen.getByLabelText('Repetí la contraseña nueva'), {
        target: { value: password }
      });
      fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
    };

    submit('x'.repeat(8));
    await screen.findByText(/8 y 128/);
    submit(NEW_PASSWORD);
    await screen.findByRole('heading', { name: 'Tu contraseña se actualizó' });

    const confirms = calls.filter((call) => call.path.endsWith('/confirm'));
    expect(confirms).toHaveLength(2);
    expect(confirms.every((call) => (call.body as { token: string }).token === TOKEN)).toBe(true);
    expect(calls.filter((call) => call.path.endsWith('/verify'))).toHaveLength(1);
  });

  it('reset: a network cut while confirming is reported as unknown and is not retried', async () => {
    fetchMock.mockImplementation(async (url: URL, init: RequestInit) => {
      const path = new URL(url.toString()).pathname;
      calls.push({
        path,
        method: init.method,
        authorization: new Headers(init.headers).get('Authorization'),
        body: init.body ? JSON.parse(String(init.body)) : undefined
      });
      if (path.endsWith('/verify')) {
        return new Response(JSON.stringify({ status: 'valid' }), { status: 200 });
      }
      throw new TypeError('network down');
    });
    window.history.replaceState(null, '', `/reset-password#token=${TOKEN}`);

    render(
      <SessionProvider store={new MemoryStore()}>
        <ResetPasswordScreen />
      </SessionProvider>
    );
    await screen.findByLabelText('Contraseña nueva');

    fireEvent.change(screen.getByLabelText('Contraseña nueva'), {
      target: { value: NEW_PASSWORD }
    });
    fireEvent.change(screen.getByLabelText('Repetí la contraseña nueva'), {
      target: { value: NEW_PASSWORD }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));

    await screen.findByRole('heading', { name: 'No pudimos confirmar el cambio' });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(calls.filter((call) => call.path.endsWith('/confirm'))).toHaveLength(1);
    expect(document.body.textContent).toMatch(/sí se haya actualizado/);
  });
});

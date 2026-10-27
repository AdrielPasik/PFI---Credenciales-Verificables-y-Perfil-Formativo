import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/errors/api-error';

const authApi = vi.hoisted(() => ({
  verifyPasswordResetToken: vi.fn(),
  confirmPasswordReset: vi.fn()
}));
vi.mock('@/lib/api/auth-api', () => authApi);

const session = vi.hoisted(() => ({
  state: { status: 'unauthenticated' } as { status: string },
  login: vi.fn(),
  logout: vi.fn()
}));
vi.mock('@/lib/session/session-provider', () => ({
  useSession: () => session
}));

import { ResetPasswordScreen } from './reset-password-screen';

const TOKEN = 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA';
const GOOD_PASSWORD = 'NuevaContraseña123';

const http = (status: number, code: string | null = null) =>
  new ApiError('x', 'http', status, code);

/** Aviso de la pantalla: `role=alert` para errores y `role=status` para advertencias. */
async function findFeedback() {
  return waitFor(() => {
    const node = document.querySelector('[data-slot="alert"]');
    expect(node).not.toBeNull();
    return node as HTMLElement;
  });
}

function openLink(hash = `#token=${TOKEN}`, state: unknown = null) {
  window.history.replaceState(state, '', `/reset-password${hash}`);
}

function deferred() {
  let resolve: () => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<void>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function renderReady(options: { strict?: boolean } = {}) {
  authApi.verifyPasswordResetToken.mockResolvedValue(undefined);
  const view = options.strict
    ? render(
        <StrictMode>
          <ResetPasswordScreen />
        </StrictMode>
      )
    : render(<ResetPasswordScreen />);
  await screen.findByRole('heading', { name: 'Elegí una contraseña nueva' });
  return view;
}

function fill(password: string, confirmation = password) {
  fireEvent.change(screen.getByLabelText('Contraseña nueva'), {
    target: { value: password }
  });
  fireEvent.change(screen.getByLabelText('Repetí la contraseña nueva'), {
    target: { value: confirmation }
  });
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
}

describe('ResetPasswordScreen', () => {
  beforeEach(() => {
    authApi.verifyPasswordResetToken.mockReset();
    authApi.confirmPasswordReset.mockReset();
    session.state = { status: 'unauthenticated' };
    session.login.mockReset();
    session.logout.mockReset();
    window.sessionStorage.clear();
    window.localStorage.clear();
    openLink();
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  describe('opening the link', () => {
    it('does not call the backend without a token', () => {
      openLink('');
      render(<ResetPasswordScreen />);

      expect(
        screen.getByRole('heading', { name: 'Este enlace ya no es válido' })
      ).toBeTruthy();
      expect(authApi.verifyPasswordResetToken).not.toHaveBeenCalled();
      expect(authApi.confirmPasswordReset).not.toHaveBeenCalled();
      expect(screen.queryByLabelText('Contraseña nueva')).toBeNull();
    });

    it('does not call the backend with a malformed token and still cleans the URL', () => {
      openLink('#token=corto');
      render(<ResetPasswordScreen />);

      expect(
        screen.getByRole('heading', { name: 'Este enlace ya no es válido' })
      ).toBeTruthy();
      expect(authApi.verifyPasswordResetToken).not.toHaveBeenCalled();
      expect(window.location.hash).toBe('');
      expect(window.location.href).not.toContain('corto');
    });

    it('offers a new link and login from the invalid state', () => {
      openLink('');
      render(<ResetPasswordScreen />);

      expect(
        (
          screen.getByRole('link', { name: 'Pedir un enlace nuevo' }) as HTMLAnchorElement
        ).getAttribute('href')
      ).toBe('/forgot-password');
      expect(
        (
          screen.getByRole('link', { name: 'Volver a iniciar sesión' }) as HTMLAnchorElement
        ).getAttribute('href')
      ).toBe('/login');
    });

    it('verifies the token once, shows the form, and removes it from the URL without a new history entry', async () => {
      const nextState = { __NA: true };
      openLink(`#token=${TOKEN}`, nextState);
      const lengthBefore = window.history.length;

      await renderReady();

      expect(authApi.verifyPasswordResetToken).toHaveBeenCalledOnce();
      expect(authApi.verifyPasswordResetToken).toHaveBeenCalledWith({
        token: TOKEN
      });
      expect(window.location.hash).toBe('');
      expect(window.location.href).not.toContain(TOKEN);
      expect(window.history.state).toEqual(nextState);
      expect(window.history.length).toBe(lengthBefore);
    });

    it('shows a loading status while verifying and focuses nothing destructive', async () => {
      const pending = deferred();
      authApi.verifyPasswordResetToken.mockReturnValue(pending.promise);
      render(<ResetPasswordScreen />);

      expect(screen.getByRole('status').textContent).toMatch(/verificando/);
      expect(screen.queryByLabelText('Contraseña nueva')).toBeNull();

      await act(async () => pending.resolve());
      await screen.findByLabelText('Contraseña nueva');
    });

    it('under React Strict Mode verifies exactly once', async () => {
      await renderReady({ strict: true });

      expect(authApi.verifyPasswordResetToken).toHaveBeenCalledTimes(1);
      expect(window.location.hash).toBe('');
    });

    it('under React Strict Mode the later confirm still has the token', async () => {
      authApi.confirmPasswordReset.mockResolvedValue(undefined);
      await renderReady({ strict: true });

      fill(GOOD_PASSWORD);
      save();

      await screen.findByRole('heading', { name: 'Tu contraseña se actualizó' });
      expect(authApi.confirmPasswordReset).toHaveBeenCalledWith({
        token: TOKEN,
        password: GOOD_PASSWORD
      });
      expect(authApi.verifyPasswordResetToken).toHaveBeenCalledTimes(1);
    });
  });

  describe('verification failures', () => {
    it.each([
      ['expired / used / replaced', http(400, 'PASSWORD_RESET_TOKEN_INVALID')]
    ])('treats %s as an invalid link, with no form', async (_name, error) => {
      authApi.verifyPasswordResetToken.mockRejectedValue(error);
      render(<ResetPasswordScreen />);

      await screen.findByRole('heading', { name: 'Este enlace ya no es válido' });
      expect(screen.queryByLabelText('Contraseña nueva')).toBeNull();
      expect(authApi.confirmPasswordReset).not.toHaveBeenCalled();
      expect(document.body.textContent).toMatch(/vencer|vencido|utilizado/);
    });

    it.each([
      ['network error', new ApiError('x', 'network'), /No pudimos conectar/],
      ['429', http(429, 'TOO_MANY_REQUESTS'), /demasiados intentos/],
      ['5xx', http(503), /no está disponible temporalmente/],
      [
        'unreadable 2xx',
        new ApiError('x', 'invalid-response', 200),
        /formato inesperado/
      ]
    ])(
      'shows a recoverable error for %s and retries only on explicit request',
      async (_name, error, message) => {
        authApi.verifyPasswordResetToken.mockRejectedValueOnce(error);
        render(<ResetPasswordScreen />);

        await screen.findByRole('heading', { name: 'No pudimos comprobar el enlace' });
        expect(document.body.textContent).toMatch(message);
        expect(screen.queryByLabelText('Contraseña nueva')).toBeNull();
        // Sin reintento automatico.
        expect(authApi.verifyPasswordResetToken).toHaveBeenCalledTimes(1);

        authApi.verifyPasswordResetToken.mockResolvedValueOnce(undefined);
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

        await screen.findByRole('heading', { name: 'Elegí una contraseña nueva' });
        expect(authApi.verifyPasswordResetToken).toHaveBeenCalledTimes(2);
        expect(authApi.verifyPasswordResetToken).toHaveBeenLastCalledWith({
          token: TOKEN
        });
      }
    );

    it('keeps the token after a retryable failure even though the URL was cleaned', async () => {
      authApi.verifyPasswordResetToken.mockRejectedValueOnce(
        new ApiError('x', 'network')
      );
      authApi.confirmPasswordReset.mockResolvedValue(undefined);
      render(<ResetPasswordScreen />);
      await screen.findByRole('heading', { name: 'No pudimos comprobar el enlace' });

      authApi.verifyPasswordResetToken.mockResolvedValueOnce(undefined);
      fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
      await screen.findByLabelText('Contraseña nueva');

      fill(GOOD_PASSWORD);
      save();
      await screen.findByRole('heading', { name: 'Tu contraseña se actualizó' });
      expect(authApi.confirmPasswordReset).toHaveBeenCalledWith({
        token: TOKEN,
        password: GOOD_PASSWORD
      });
    });
  });

  describe('password form', () => {
    it.each([
      ['empty', '', '', /Ingresá una contraseña nueva/],
      ['too short', 'corta', 'corta', /entre 8 y 128|8 y 128/i],
      ['too long', 'a'.repeat(129), 'a'.repeat(129), /8 y 128/],
      ['mismatch', GOOD_PASSWORD, `${GOOD_PASSWORD}x`, /no coinciden/]
    ])('rejects %s locally without calling confirm', async (_n, a, b, message) => {
      await renderReady();

      fill(a, b);
      save();

      expect(document.body.textContent).toMatch(message);
      expect(authApi.confirmPasswordReset).not.toHaveBeenCalled();
    });

    it.each([8, 128])('accepts a password of exactly %i characters', async (length) => {
      authApi.confirmPasswordReset.mockResolvedValue(undefined);
      await renderReady();

      fill('x'.repeat(length));
      save();

      await screen.findByRole('heading', { name: 'Tu contraseña se actualizó' });
      expect(authApi.confirmPasswordReset).toHaveBeenCalledOnce();
    });

    it('sends the password exactly as typed, with no trimming', async () => {
      authApi.confirmPasswordReset.mockResolvedValue(undefined);
      await renderReady();

      fill('  con espacios  ');
      save();

      await screen.findByRole('heading', { name: 'Tu contraseña se actualizó' });
      expect(authApi.confirmPasswordReset).toHaveBeenCalledWith({
        token: TOKEN,
        password: '  con espacios  '
      });
    });

    it('can reveal and hide both fields', async () => {
      await renderReady();

      const first = screen.getByLabelText('Contraseña nueva');
      const second = screen.getByLabelText('Repetí la contraseña nueva');
      expect(first.getAttribute('type')).toBe('password');
      expect(first.getAttribute('autocomplete')).toBe('new-password');

      fireEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
      expect(first.getAttribute('type')).toBe('text');
      expect(second.getAttribute('type')).toBe('text');
    });
  });

  describe('confirming', () => {
    it('shows success, does not log in, and points to login', async () => {
      authApi.confirmPasswordReset.mockResolvedValue(undefined);
      await renderReady();

      fill(GOOD_PASSWORD);
      save();

      await screen.findByRole('heading', { name: 'Tu contraseña se actualizó' });
      expect(session.login).not.toHaveBeenCalled();
      expect(
        (
          screen.getByRole('link', { name: 'Ir a iniciar sesión' }) as HTMLAnchorElement
        ).getAttribute('href')
      ).toBe('/login');
      expect(screen.queryByLabelText('Contraseña nueva')).toBeNull();
    });

    it('does not touch the session when there is none', async () => {
      authApi.confirmPasswordReset.mockResolvedValue(undefined);
      await renderReady();

      fill(GOOD_PASSWORD);
      save();
      await screen.findByRole('heading', { name: 'Tu contraseña se actualizó' });

      expect(session.logout).not.toHaveBeenCalled();
    });

    it.each(['authenticated', 'recoverable-error', 'resolving-context'])(
      'clears a local session (%s) with the official logout, only after success',
      async (status) => {
        session.state = { status };
        authApi.confirmPasswordReset.mockResolvedValue(undefined);
        await renderReady();

        // Ni al abrir ni al verificar se toca la sesion.
        expect(session.logout).not.toHaveBeenCalled();

        fill(GOOD_PASSWORD);
        save();
        await screen.findByRole('heading', { name: 'Tu contraseña se actualizó' });

        expect(session.logout).toHaveBeenCalledOnce();
      }
    );

    it('keeps an existing session when the reset fails', async () => {
      session.state = { status: 'authenticated' };
      authApi.confirmPasswordReset.mockRejectedValue(
        http(400, 'PASSWORD_POLICY_VIOLATION')
      );
      await renderReady();

      fill(GOOD_PASSWORD);
      save();
      await screen.findByText(/8 y 128/);

      expect(session.logout).not.toHaveBeenCalled();
    });

    it('sends a single confirm on a double submit', async () => {
      const pending = deferred();
      authApi.confirmPasswordReset.mockReturnValue(pending.promise);
      await renderReady();

      fill(GOOD_PASSWORD);
      const form = screen
        .getByRole('button', { name: 'Guardar contraseña' })
        .closest('form') as HTMLFormElement;
      fireEvent.submit(form);
      fireEvent.submit(form);
      fireEvent.click(screen.getByRole('button', { name: 'Guardando' }));

      expect(authApi.confirmPasswordReset).toHaveBeenCalledTimes(1);

      await act(async () => pending.resolve());
      await screen.findByRole('heading', { name: 'Tu contraseña se actualizó' });
      expect(authApi.confirmPasswordReset).toHaveBeenCalledTimes(1);
    });

    it('treats a token rejected at confirm time as an invalid link', async () => {
      authApi.confirmPasswordReset.mockRejectedValue(
        http(400, 'PASSWORD_RESET_TOKEN_INVALID')
      );
      await renderReady();

      fill(GOOD_PASSWORD);
      save();

      await screen.findByRole('heading', { name: 'Este enlace ya no es válido' });
      expect(screen.queryByLabelText('Contraseña nueva')).toBeNull();
      expect(session.logout).not.toHaveBeenCalled();
    });

    it('keeps the form and the token after a password policy rejection', async () => {
      authApi.confirmPasswordReset.mockRejectedValueOnce(
        http(400, 'PASSWORD_POLICY_VIOLATION')
      );
      await renderReady();

      fill(GOOD_PASSWORD);
      save();
      await screen.findByText(/8 y 128/);

      authApi.confirmPasswordReset.mockResolvedValueOnce(undefined);
      fill('OtraContraseña456');
      save();

      await screen.findByRole('heading', { name: 'Tu contraseña se actualizó' });
      expect(authApi.confirmPasswordReset).toHaveBeenLastCalledWith({
        token: TOKEN,
        password: 'OtraContraseña456'
      });
    });

    it('reports 429 on the form and allows trying again', async () => {
      authApi.confirmPasswordReset.mockRejectedValueOnce(
        http(429, 'TOO_MANY_REQUESTS')
      );
      await renderReady();

      fill(GOOD_PASSWORD);
      save();

      const alert = await findFeedback();
      expect(alert.textContent).toMatch(/demasiados intentos/);
      expect(screen.getByLabelText('Contraseña nueva')).toBeTruthy();
    });

    it.each([
      ['network cut', new ApiError('x', 'network')],
      ['5xx', http(500)],
      ['unreadable 2xx', new ApiError('x', 'invalid-response', 200)]
    ])(
      'on %s says the result is unknown and never retries automatically',
      async (_name, error) => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
          authApi.confirmPasswordReset.mockRejectedValue(error);
          await renderReady();

          fill(GOOD_PASSWORD);
          save();

          await screen.findByRole('heading', {
            name: 'No pudimos confirmar el cambio'
          });
          expect(document.body.textContent).toMatch(/sí se haya actualizado/);
          // No afirma que fallo ni muestra el formulario para reenviar el mismo token.
          expect(document.body.textContent).not.toMatch(/no se actualizó/i);
          expect(screen.queryByLabelText('Contraseña nueva')).toBeNull();

          await act(async () => {
            await vi.advanceTimersByTimeAsync(60_000);
          });

          expect(authApi.confirmPasswordReset).toHaveBeenCalledTimes(1);
          expect(session.logout).not.toHaveBeenCalled();
          expect(
            (
              screen.getByRole('link', { name: 'Ir a iniciar sesión' }) as HTMLAnchorElement
            ).getAttribute('href')
          ).toBe('/login');
        } finally {
          vi.useRealTimers();
        }
      }
    );

    it('does not call confirm if the token was lost', async () => {
      // Sin forma de llegar al formulario sin token: el estado "ready" exige verificar.
      openLink('');
      render(<ResetPasswordScreen />);

      expect(screen.queryByRole('button', { name: 'Guardar contraseña' })).toBeNull();
      expect(authApi.confirmPasswordReset).not.toHaveBeenCalled();
    });
  });

  describe('another link pasted in the same tab (hash-only navigation)', () => {
    const NEW_TOKEN = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo';

    function pasteLink(token: string) {
      window.history.replaceState(null, '', `/reset-password#token=${token}`);
      act(() => {
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
    }

    it('reads the new fragment, verifies it, and removes it from the URL', async () => {
      authApi.confirmPasswordReset.mockResolvedValue(undefined);
      await renderReady();

      pasteLink(NEW_TOKEN);

      await waitFor(() =>
        expect(authApi.verifyPasswordResetToken).toHaveBeenCalledTimes(2)
      );
      expect(authApi.verifyPasswordResetToken).toHaveBeenLastCalledWith({
        token: NEW_TOKEN
      });
      expect(window.location.href).not.toContain(NEW_TOKEN);

      await screen.findByLabelText('Contraseña nueva');
      fill(GOOD_PASSWORD);
      save();
      await screen.findByRole('heading', { name: 'Tu contraseña se actualizó' });
      // El que se confirma es el enlace NUEVO, no el anterior.
      expect(authApi.confirmPasswordReset).toHaveBeenCalledWith({
        token: NEW_TOKEN,
        password: GOOD_PASSWORD
      });
    });

    it('shows the invalid view when the pasted fragment is not a token, without calling the backend', async () => {
      await renderReady();

      pasteLink('corto');

      await screen.findByRole('heading', { name: 'Este enlace ya no es válido' });
      expect(authApi.verifyPasswordResetToken).toHaveBeenCalledTimes(1);
      expect(window.location.href).not.toContain('corto');
    });

    it('ignores a late answer from the previous link', async () => {
      const first = deferred();
      authApi.verifyPasswordResetToken.mockReturnValueOnce(first.promise);
      render(<ResetPasswordScreen />);

      authApi.verifyPasswordResetToken.mockResolvedValueOnce(undefined);
      pasteLink(NEW_TOKEN);
      await screen.findByLabelText('Contraseña nueva');

      // La verificacion vieja termina DESPUES con "token invalido": no debe pisar la pantalla.
      first.reject(http(400, 'PASSWORD_RESET_TOKEN_INVALID'));
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getByLabelText('Contraseña nueva')).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'Este enlace ya no es válido' })).toBeNull();
    });

    it('does not interrupt a confirm in flight, but still cleans the URL', async () => {
      const pending = deferred();
      authApi.confirmPasswordReset.mockReturnValue(pending.promise);
      await renderReady();

      fill(GOOD_PASSWORD);
      save();
      pasteLink(NEW_TOKEN);

      expect(window.location.href).not.toContain(NEW_TOKEN);
      expect(authApi.verifyPasswordResetToken).toHaveBeenCalledTimes(1);

      await act(async () => pending.resolve());
      await screen.findByRole('heading', { name: 'Tu contraseña se actualizó' });
      expect(authApi.confirmPasswordReset).toHaveBeenCalledWith({
        token: TOKEN,
        password: GOOD_PASSWORD
      });
    });

    it('does nothing when the hash is cleared', async () => {
      await renderReady();

      window.history.replaceState(null, '', '/reset-password');
      act(() => {
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });

      expect(screen.getByLabelText('Contraseña nueva')).toBeTruthy();
      expect(authApi.verifyPasswordResetToken).toHaveBeenCalledTimes(1);
    });
  });

  describe('token confidentiality', () => {
    it('never puts the token in the DOM, storage, cookies, console or URL', async () => {
      const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(
        (method) => vi.spyOn(console, method).mockImplementation(() => undefined)
      );
      authApi.confirmPasswordReset.mockRejectedValueOnce(
        http(400, 'PASSWORD_POLICY_VIOLATION')
      );
      await renderReady();

      const snapshot = () => ({
        html: document.documentElement.outerHTML,
        local: JSON.stringify({ ...window.localStorage }),
        session: JSON.stringify({ ...window.sessionStorage }),
        cookie: document.cookie,
        href: window.location.href,
        title: document.title
      });

      for (const where of Object.values(snapshot())) {
        expect(where).not.toContain(TOKEN);
      }

      fill(GOOD_PASSWORD);
      save();
      await screen.findByText(/8 y 128/);

      for (const where of Object.values(snapshot())) {
        expect(where).not.toContain(TOKEN);
      }

      authApi.confirmPasswordReset.mockResolvedValueOnce(undefined);
      fill(GOOD_PASSWORD);
      save();
      await screen.findByRole('heading', { name: 'Tu contraseña se actualizó' });

      for (const where of Object.values(snapshot())) {
        expect(where).not.toContain(TOKEN);
        expect(where).not.toContain(GOOD_PASSWORD);
      }

      for (const spy of consoleSpies) {
        expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN);
        spy.mockRestore();
      }
    });

    it('does not leak the token into messages when verification fails', async () => {
      authApi.verifyPasswordResetToken.mockRejectedValue(
        new ApiError(`token ${TOKEN}`, 'network')
      );
      render(<ResetPasswordScreen />);

      await screen.findByRole('heading', { name: 'No pudimos comprobar el enlace' });
      await waitFor(() =>
        expect(document.documentElement.outerHTML).not.toContain(TOKEN)
      );
    });
  });
});

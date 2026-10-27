import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/errors/api-error';

const authApi = vi.hoisted(() => ({ requestPasswordReset: vi.fn() }));
vi.mock('@/lib/api/auth-api', () => authApi);

import { ForgotPasswordScreen } from './forgot-password-screen';

/** Aviso de la pantalla: `role=alert` para errores y `role=status` para advertencias. */
async function findFeedback() {
  return waitFor(() => {
    const node = document.querySelector('[data-slot="alert"]');
    expect(node).not.toBeNull();
    return node as HTMLElement;
  });
}

function http(status: number, code: string | null = null) {
  return new ApiError('x', 'http', status, code);
}

function typeEmail(value: string) {
  fireEvent.change(screen.getByLabelText('Correo electrónico'), {
    target: { value }
  });
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }));
}

describe('ForgotPasswordScreen', () => {
  beforeEach(() => {
    authApi.requestPasswordReset.mockReset();
  });

  it('renders the form with a way back to login', () => {
    render(<ForgotPasswordScreen />);

    expect(
      screen.getByRole('heading', { name: 'Recuperá el acceso a tu cuenta' })
    ).toBeTruthy();
    expect(
      screen.getByLabelText('Correo electrónico').getAttribute('autocomplete')
    ).toBe('email');
    expect(
      (
        screen.getByRole('link', { name: 'Volver a iniciar sesión' }) as HTMLAnchorElement
      ).getAttribute('href')
    ).toBe('/login');
  });

  it('blocks an empty or malformed email without calling the backend', () => {
    render(<ForgotPasswordScreen />);

    submit();
    expect(screen.getByText('Ingresá tu correo electrónico.')).toBeTruthy();

    typeEmail('no-es-un-correo');
    submit();
    expect(
      screen.getByText('Ingresá un correo electrónico válido.')
    ).toBeTruthy();
    expect(authApi.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('sends the trimmed, lower-cased email and shows the neutral confirmation', async () => {
    authApi.requestPasswordReset.mockResolvedValue(undefined);
    render(<ForgotPasswordScreen />);

    typeEmail('  Ana.Perez@Example.COM ');
    submit();

    await screen.findByRole('heading', { name: 'Revisá tu correo' });
    expect(authApi.requestPasswordReset).toHaveBeenCalledOnce();
    expect(authApi.requestPasswordReset).toHaveBeenCalledWith({
      email: 'ana.perez@example.com'
    });
  });

  it('uses wording that never promises an email nor reveals whether the account exists', async () => {
    authApi.requestPasswordReset.mockResolvedValue(undefined);
    render(<ForgotPasswordScreen />);

    typeEmail('alguien@example.com');
    submit();
    await screen.findByRole('heading', { name: 'Revisá tu correo' });

    const text = document.body.textContent ?? '';
    expect(text).toContain('Si existe una cuenta');
    expect(text).not.toMatch(/te enviamos|te enviamos un correo|enviamos el correo/i);
    expect(text).not.toMatch(/no existe|no encontramos una cuenta|no está registrad/i);
    expect(text).not.toContain('alguien@example.com');
  });

  it('shows identical confirmation text for any email', async () => {
    authApi.requestPasswordReset.mockResolvedValue(undefined);

    const first = render(<ForgotPasswordScreen />);
    typeEmail('existente@example.com');
    submit();
    await screen.findByRole('heading', { name: 'Revisá tu correo' });
    const firstText = document.body.textContent;
    first.unmount();

    render(<ForgotPasswordScreen />);
    typeEmail('inexistente@example.org');
    submit();
    await screen.findByRole('heading', { name: 'Revisá tu correo' });

    expect(document.body.textContent).toBe(firstText);
  });

  it('lets the person try another address from the confirmation', async () => {
    authApi.requestPasswordReset.mockResolvedValue(undefined);
    render(<ForgotPasswordScreen />);

    typeEmail('ana@example.com');
    submit();
    await screen.findByRole('heading', { name: 'Revisá tu correo' });

    fireEvent.click(screen.getByRole('button', { name: 'Usar otro correo' }));

    expect(
      screen.getByRole('heading', { name: 'Recuperá el acceso a tu cuenta' })
    ).toBeTruthy();
    expect(
      (screen.getByLabelText('Correo electrónico') as HTMLInputElement).value
    ).toBe('');
  });

  it('sends only one request on a double click', async () => {
    let resolve: () => void = () => undefined;
    authApi.requestPasswordReset.mockReturnValue(
      new Promise<void>((done) => {
        resolve = done;
      })
    );
    render(<ForgotPasswordScreen />);

    typeEmail('ana@example.com');
    const button = screen.getByRole('button', { name: 'Enviar enlace' });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.submit(button.closest('form') as HTMLFormElement);

    expect(authApi.requestPasswordReset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Enviando' })).toBeTruthy();

    resolve();
    await screen.findByRole('heading', { name: 'Revisá tu correo' });
    expect(authApi.requestPasswordReset).toHaveBeenCalledTimes(1);
  });

  it('shows the server-side email rejection on the field and keeps the email', async () => {
    authApi.requestPasswordReset.mockRejectedValue(http(400, 'INVALID_EMAIL'));
    render(<ForgotPasswordScreen />);

    typeEmail('ana@example.com');
    submit();

    await screen.findByText('Ingresá un correo electrónico válido.');
    expect(
      (screen.getByLabelText('Correo electrónico') as HTMLInputElement).value
    ).toBe('ana@example.com');
  });

  it.each([
    ['429 throttle', http(429, 'TOO_MANY_REQUESTS'), /demasiados intentos/],
    [
      '503 unavailable',
      http(503, 'PASSWORD_RECOVERY_UNAVAILABLE'),
      /no está disponible en este momento/
    ],
    ['400 invalid input', http(400, 'INVALID_REQUEST_INPUT'), /No pudimos procesar/],
    ['network error', new ApiError('x', 'network'), /No pudimos conectar/],
    [
      'malformed 2xx body',
      new ApiError('x', 'invalid-response', 202),
      /formato inesperado/
    ]
  ])(
    'reports %s without losing the typed email and allows a retry',
    async (_name, error, message) => {
      authApi.requestPasswordReset.mockRejectedValueOnce(error);
      render(<ForgotPasswordScreen />);

      typeEmail('ana@example.com');
      submit();

      const alert = await findFeedback();
      expect(alert.textContent).toMatch(message);
      expect(
        (screen.getByLabelText('Correo electrónico') as HTMLInputElement).value
      ).toBe('ana@example.com');
      expect(
        (screen.getByRole('button', { name: 'Enviar enlace' }) as HTMLButtonElement)
          .disabled
      ).toBe(false);

      authApi.requestPasswordReset.mockResolvedValueOnce(undefined);
      submit();
      await screen.findByRole('heading', { name: 'Revisá tu correo' });
      expect(authApi.requestPasswordReset).toHaveBeenCalledTimes(2);
    }
  );

  it('never renders backend messages or codes', async () => {
    authApi.requestPasswordReset.mockRejectedValue(
      new ApiError('detalle interno SECRETO', 'http', 500, 'INTERNAL_THING')
    );
    render(<ForgotPasswordScreen />);

    typeEmail('ana@example.com');
    submit();

    await findFeedback();
    expect(document.body.textContent).not.toContain('SECRETO');
    expect(document.body.textContent).not.toContain('INTERNAL_THING');
  });
});

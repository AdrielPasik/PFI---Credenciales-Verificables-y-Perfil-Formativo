import {
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LoginForm } from '@/features/auth/login-form';

describe('LoginForm', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders accessible credentials fields and toggles password visibility', () => {
    render(
      <LoginForm
        isSubmitting={false}
        onSubmit={vi.fn().mockResolvedValue(null)}
      />
    );

    const email = screen.getByRole('textbox', {
      name: 'Correo electrónico'
    });
    const password = screen.getByLabelText('Contraseña');

    expect(email.getAttribute('type')).toBe('email');
    expect(email.getAttribute('autocomplete')).toBe('email');
    expect(password.getAttribute('type')).toBe('password');
    expect(password.getAttribute('autocomplete')).toBe('current-password');

    fireEvent.click(
      screen.getByRole('button', { name: 'Mostrar contraseña' })
    );

    expect(password.getAttribute('type')).toBe('text');
    expect(
      screen.getByRole('button', { name: 'Ocultar contraseña' })
    ).toBeTruthy();
  });

  it('shows client validation and focuses the first invalid field', () => {
    render(
      <LoginForm
        isSubmitting={false}
        onSubmit={vi.fn().mockResolvedValue(null)}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }));

    expect(
      screen.getByText('Ingresá tu correo electrónico.')
    ).toBeTruthy();
    expect(screen.getByLabelText('Correo electrónico')).toBe(
      document.activeElement
    );
  });

  it('announces loading without rendering credentials or tokens', () => {
    render(
      <LoginForm
        isSubmitting
        onSubmit={vi.fn().mockResolvedValue(null)}
        passwordRecoveryEnabled
      />
    );

    const submit = screen.getByRole('button', { name: 'Ingresando' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).not.toContain('[REDACTED]');
  });

  it('shows controlled server feedback and clears the password', async () => {
    const onSubmit = vi.fn().mockResolvedValue({
      code: 'invalid_credentials',
      message: 'El correo o la contraseña son incorrectos.',
      recoverable: true
    });

    render(<LoginForm isSubmitting={false} onSubmit={onSubmit} />);

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Correo electrónico' }),
      { target: { value: ' PERSONA@EXAMPLE.COM ' } }
    );
    const password = screen.getByLabelText('Contraseña');
    fireEvent.change(password, { target: { value: 'not-a-real-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        email: 'persona@example.com',
        password: 'not-a-real-password'
      });
    });
    expect(
      await screen.findByText('El correo o la contraseña son incorrectos.')
    ).toBeTruthy();
    expect((password as HTMLInputElement).value).toBe('');
    expect(document.body.textContent).not.toContain('not-a-real-password');
    expect(document.body.textContent).not.toContain('[REDACTED]');
  });

  it('hides the password recovery link while recovery is switched off (default)', () => {
    render(<LoginForm isSubmitting={false} onSubmit={vi.fn().mockResolvedValue(null)} />);

    expect(screen.queryByRole('link', { name: '¿Olvidaste tu contraseña?' })).toBeNull();
    expect(document.body.innerHTML).not.toContain('/forgot-password');
  });

  it('links to password recovery after the password field', () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(<LoginForm isSubmitting={false} onSubmit={onSubmit} passwordRecoveryEnabled />);

    const link = screen.getByRole('link', {
      name: '¿Olvidaste tu contraseña?'
    }) as HTMLAnchorElement;

    expect(link.getAttribute('href')).toBe('/forgot-password');

    const password = screen.getByLabelText('Contraseña');
    expect(
      password.compareDocumentPosition(link) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    // Es navegacion pura: un <a>, no un boton de envio, y no toca el login.
    expect(link.tagName).toBe('A');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the link when the build flag NEXT_PUBLIC_PASSWORD_RECOVERY_ENABLED is true', () => {
    vi.stubEnv('NEXT_PUBLIC_PASSWORD_RECOVERY_ENABLED', 'true');
    render(<LoginForm isSubmitting={false} onSubmit={vi.fn().mockResolvedValue(null)} />);

    expect(screen.getByRole('link', { name: '¿Olvidaste tu contraseña?' })).toBeTruthy();
  });

  it('keeps the recovery link available while a login is submitting', () => {
    render(
      <LoginForm
        isSubmitting
        onSubmit={vi.fn().mockResolvedValue(null)}
        passwordRecoveryEnabled
      />
    );

    expect(
      screen.getByRole('link', { name: '¿Olvidaste tu contraseña?' })
    ).toBeTruthy();
  });
});

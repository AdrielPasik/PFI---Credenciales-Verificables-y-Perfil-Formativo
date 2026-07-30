import {
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LoginForm } from '@/features/auth/login-form';

describe('LoginForm', () => {
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
});

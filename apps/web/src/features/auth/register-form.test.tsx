import {
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RegisterForm } from '@/features/auth/register-form';

describe('RegisterForm', () => {
  it('renders accessible email/password/confirm fields with the expected autocomplete', () => {
    render(
      <RegisterForm
        isSubmitting={false}
        onSubmit={vi.fn().mockResolvedValue(null)}
      />
    );

    const email = screen.getByRole('textbox', {
      name: 'Correo electrónico'
    });
    const password = screen.getByLabelText('Contraseña');
    const confirm = screen.getByLabelText('Repetir contraseña');

    expect(email.getAttribute('type')).toBe('email');
    expect(email.getAttribute('autocomplete')).toBe('email');
    expect(password.getAttribute('type')).toBe('password');
    expect(password.getAttribute('autocomplete')).toBe('new-password');
    expect(confirm.getAttribute('type')).toBe('password');
    expect(confirm.getAttribute('autocomplete')).toBe('new-password');
  });

  it('never renders issuer, role, DID, wallet or blockchain fields', () => {
    render(
      <RegisterForm
        isSubmitting={false}
        onSubmit={vi.fn().mockResolvedValue(null)}
      />
    );

    expect(document.body.textContent).not.toMatch(
      /issuer|emisor|rol|role|DID|wallet|blockchain|institución/i
    );
  });

  it('shows client validation and focuses the first invalid field', () => {
    render(
      <RegisterForm
        isSubmitting={false}
        onSubmit={vi.fn().mockResolvedValue(null)}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    expect(
      screen.getByText('Ingresá tu correo electrónico.')
    ).toBeTruthy();
    expect(screen.getByLabelText('Correo electrónico')).toBe(
      document.activeElement
    );
  });

  it('A1: a password/confirmPassword mismatch never calls the API', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(<RegisterForm isSubmitting={false} onSubmit={onSubmit} />);

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Correo electrónico' }),
      { target: { value: 'persona@example.com' } }
    );
    fireEvent.change(screen.getByLabelText('Contraseña'), {
      target: { value: 'CorrectHorse123' }
    });
    fireEvent.change(screen.getByLabelText('Repetir contraseña'), {
      target: { value: 'DifferentPassword123' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    expect(screen.getByText('Las contraseñas no coinciden.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('A1: a password shorter than the minimum is rejected client-side without calling the API', () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(<RegisterForm isSubmitting={false} onSubmit={onSubmit} />);

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Correo electrónico' }),
      { target: { value: 'persona@example.com' } }
    );
    fireEvent.change(screen.getByLabelText('Contraseña'), {
      target: { value: 'short1' }
    });
    fireEvent.change(screen.getByLabelText('Repetir contraseña'), {
      target: { value: 'short1' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    expect(
      screen.getByText(/La contraseña debe tener entre/)
    ).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('A1: happy path calls register with only email/password (never confirmPassword)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(<RegisterForm isSubmitting={false} onSubmit={onSubmit} />);

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Correo electrónico' }),
      { target: { value: ' PERSONA@EXAMPLE.COM ' } }
    );
    fireEvent.change(screen.getByLabelText('Contraseña'), {
      target: { value: 'CorrectHorse123' }
    });
    fireEvent.change(screen.getByLabelText('Repetir contraseña'), {
      target: { value: 'CorrectHorse123' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        email: 'persona@example.com',
        password: 'CorrectHorse123'
      });
    });
    const [call] = onSubmit.mock.calls;
    expect(Object.keys(call[0]).sort()).toEqual(['email', 'password']);
  });

  it('announces loading, disables the submit button and prevents a second concurrent submit', () => {
    render(
      <RegisterForm
        isSubmitting
        onSubmit={vi.fn().mockResolvedValue(null)}
      />
    );

    const submit = screen.getByRole('button', { name: 'Creando cuenta' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it('A1: shows a duplicate-email server feedback in product language and clears the passwords', async () => {
    const onSubmit = vi.fn().mockResolvedValue({
      code: 'email_taken',
      message: 'Ya existe una cuenta con ese correo.',
      recoverable: true
    });

    render(<RegisterForm isSubmitting={false} onSubmit={onSubmit} />);

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Correo electrónico' }),
      { target: { value: 'persona@example.com' } }
    );
    const password = screen.getByLabelText('Contraseña');
    const confirm = screen.getByLabelText('Repetir contraseña');
    fireEvent.change(password, { target: { value: 'CorrectHorse123' } });
    fireEvent.change(confirm, { target: { value: 'CorrectHorse123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    expect(
      await screen.findByText('Ya existe una cuenta con ese correo.')
    ).toBeTruthy();
    expect((password as HTMLInputElement).value).toBe('');
    expect((confirm as HTMLInputElement).value).toBe('');
    expect(document.body.textContent).not.toMatch(/P2002|prisma/i);
  });
});

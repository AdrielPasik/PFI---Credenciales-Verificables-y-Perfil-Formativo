import {
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RegisterForm } from '@/features/auth/register-form';

describe('RegisterForm', () => {
  it('renders accessible name/email/password/confirm fields with the expected autocomplete', () => {
    render(
      <RegisterForm
        isSubmitting={false}
        onSubmit={vi.fn().mockResolvedValue(null)}
      />
    );

    const firstName = screen.getByLabelText('Nombre');
    const lastName = screen.getByLabelText('Apellido');
    const email = screen.getByRole('textbox', {
      name: 'Correo electrónico'
    });
    const password = screen.getByLabelText('Contraseña');
    const confirm = screen.getByLabelText('Repetir contraseña');

    expect(firstName.getAttribute('autocomplete')).toBe('given-name');
    expect(lastName.getAttribute('autocomplete')).toBe('family-name');
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

  it('A1.1: shows client validation and focuses the first invalid field (firstName)', () => {
    render(
      <RegisterForm
        isSubmitting={false}
        onSubmit={vi.fn().mockResolvedValue(null)}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    expect(screen.getByText('Ingresá tu nombre.')).toBeTruthy();
    expect(screen.getByLabelText('Nombre')).toBe(document.activeElement);
  });

  it('A1.1: rejects an empty or whitespace-only lastName without calling the API', () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(<RegisterForm isSubmitting={false} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Apellido'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    expect(screen.getByText('Ingresá tu apellido.')).toBeTruthy();
    expect(screen.getByLabelText('Apellido')).toBe(document.activeElement);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('A1: a password/confirmPassword mismatch never calls the API', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(<RegisterForm isSubmitting={false} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Apellido'), { target: { value: 'Lovelace' } });
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

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Apellido'), { target: { value: 'Lovelace' } });
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

  it('A1.1: happy path calls register with trimmed name + email/password (never confirmPassword)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(<RegisterForm isSubmitting={false} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: '  Ada  ' } });
    fireEvent.change(screen.getByLabelText('Apellido'), { target: { value: '  Lovelace  ' } });
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
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'persona@example.com',
        password: 'CorrectHorse123'
      });
    });
    const [call] = onSubmit.mock.calls;
    expect(Object.keys(call[0]).sort()).toEqual(['email', 'firstName', 'lastName', 'password']);
  });

  it('A1.1: accepts unicode names with accents, apostrophes and hyphens', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(<RegisterForm isSubmitting={false} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'José María' } });
    fireEvent.change(screen.getByLabelText('Apellido'), { target: { value: "O'Connor-Jean-Pierre" } });
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Correo electrónico' }),
      { target: { value: 'persona@example.com' } }
    );
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'CorrectHorse123' } });
    fireEvent.change(screen.getByLabelText('Repetir contraseña'), { target: { value: 'CorrectHorse123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        firstName: 'José María',
        lastName: "O'Connor-Jean-Pierre",
        email: 'persona@example.com',
        password: 'CorrectHorse123'
      });
    });
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

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Apellido'), { target: { value: 'Lovelace' } });
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

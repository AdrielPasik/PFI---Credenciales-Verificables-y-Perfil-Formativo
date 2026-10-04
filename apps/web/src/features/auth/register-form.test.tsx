import {
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RegisterForm } from '@/features/auth/register-form';

/**
 * O1: los campos de identidad, que ya existian antes de este slice. Se extrajo
 * a un helper porque desde O1 el submit ademas exige elegir la intencion, y
 * varios tests necesitan dejar el formulario valido salvo por ese paso.
 */
function fillIdentityFields(overrides: Partial<Record<string, string>> = {}) {
  fireEvent.change(screen.getByLabelText('Nombre'), {
    target: { value: overrides.firstName ?? 'Ada' }
  });
  fireEvent.change(screen.getByLabelText('Apellido'), {
    target: { value: overrides.lastName ?? 'Lovelace' }
  });
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Correo electrónico' }),
    { target: { value: overrides.email ?? 'persona@example.com' } }
  );
  fireEvent.change(screen.getByLabelText('Contraseña'), {
    target: { value: overrides.password ?? 'CorrectHorse123' }
  });
  fireEvent.change(screen.getByLabelText('Repetir contraseña'), {
    target: { value: overrides.confirmPassword ?? 'CorrectHorse123' }
  });
}

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

    // O1: la palabra "institución" SÍ aparece ahora, como copy de la intención
    // de uso ("Trabajar con una institución"). Lo que la invariante siempre
    // quiso prohibir es un CAMPO que confiera autoridad institucional, no la
    // palabra. Así que se sacó del blacklist de texto y se compensa abajo con
    // una aserción estructural sobre los controles del formulario, que es más
    // fuerte que buscar palabras.
    expect(document.body.textContent).not.toMatch(
      /issuer|emisor|\brol\b|role|DID|wallet|blockchain/i
    );
  });

  it('O1: the only form controls are the identity fields and the two intent options', () => {
    // Aserción estructural: ningún selector de institución, ningún campo de
    // rol, DID, wallet ni red. El conjunto de controles está congelado.
    render(
      <RegisterForm
        isSubmitting={false}
        onSubmit={vi.fn().mockResolvedValue(null)}
      />
    );

    expect(document.querySelectorAll('select')).toHaveLength(0);

    const inputs = [...document.querySelectorAll('input')];
    expect(inputs.map((input) => input.getAttribute('type')).sort()).toEqual([
      'email',
      'password',
      'password',
      'radio',
      'radio',
      'text',
      'text'
    ]);

    // Los únicos radios son los dos valores congelados de la intención.
    const radios = inputs.filter((input) => input.getAttribute('type') === 'radio');
    expect(radios.map((radio) => radio.getAttribute('value'))).toEqual([
      'personal',
      'institutional'
    ]);
    // Un solo grupo: no hay un segundo set de opciones escondido.
    expect(new Set(radios.map((radio) => radio.getAttribute('name'))).size).toBe(1);
  });

  it('O1: presents the question as intended use, never as an account type', () => {
    render(
      <RegisterForm
        isSubmitting={false}
        onSubmit={vi.fn().mockResolvedValue(null)}
      />
    );

    expect(
      screen.getByRole('group', { name: '¿Cómo vas a usar Scope?' })
    ).toBeTruthy();
    expect(screen.getByText('Gestionar mi trayectoria')).toBeTruthy();
    expect(screen.getByText('Trabajar con una institución')).toBeTruthy();

    // `User` sigue siendo el mismo tipo de identidad en las dos ramas, así que
    // el copy nunca debe sugerir que se está eligiendo un tipo de cuenta.
    expect(document.body.textContent).not.toMatch(
      /tipo de cuenta|cuenta personal|cuenta institucional/i
    );
  });

  it('O1: no option comes preselected -- the person has to choose', () => {
    render(
      <RegisterForm
        isSubmitting={false}
        onSubmit={vi.fn().mockResolvedValue(null)}
      />
    );

    const radios = [
      ...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')
    ];
    expect(radios).toHaveLength(2);
    expect(radios.every((radio) => !radio.checked)).toBe(true);
  });

  it('O1: submit does not proceed until an intent is selected', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(<RegisterForm isSubmitting={false} onSubmit={onSubmit} />);

    fillIdentityFields();
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'Elegí cómo vas a usar Scope.'
      );
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('O1: sends personal when that option is chosen', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(<RegisterForm isSubmitting={false} onSubmit={onSubmit} />);

    fillIdentityFields();
    fireEvent.click(screen.getByLabelText(/Gestionar mi trayectoria/));
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit.mock.calls[0][0].onboardingIntent).toBe('personal');
  });

  it('O1: sends institutional when that option is chosen', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(<RegisterForm isSubmitting={false} onSubmit={onSubmit} />);

    fillIdentityFields();
    fireEvent.click(screen.getByLabelText(/Trabajar con una institución/));
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit.mock.calls[0][0].onboardingIntent).toBe('institutional');
  });

  it('O1: choosing institutional sends nothing that grants authority', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(<RegisterForm isSubmitting={false} onSubmit={onSubmit} />);

    fillIdentityFields();
    fireEvent.click(screen.getByLabelText(/Trabajar con una institución/));
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(Object.keys(onSubmit.mock.calls[0][0]).sort()).toEqual([
      'email',
      'firstName',
      'lastName',
      'onboardingIntent',
      'password'
    ]);
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
    // O1: desde este slice el submit exige elegir la intencion de uso.
    fireEvent.click(screen.getByLabelText(/Gestionar mi trayectoria/));
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'persona@example.com',
        password: 'CorrectHorse123',
        onboardingIntent: 'personal'
      });
    });
    const [call] = onSubmit.mock.calls;
    // confirmPassword sigue sin salir nunca del form.
    expect(Object.keys(call[0]).sort()).toEqual([
      'email',
      'firstName',
      'lastName',
      'onboardingIntent',
      'password'
    ]);
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
    fireEvent.click(screen.getByLabelText(/Gestionar mi trayectoria/));
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        firstName: 'José María',
        lastName: "O'Connor-Jean-Pierre",
        email: 'persona@example.com',
        password: 'CorrectHorse123',
        onboardingIntent: 'personal'
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
    // O1: desde este slice el submit exige elegir la intencion de uso.
    fireEvent.click(screen.getByLabelText(/Gestionar mi trayectoria/));
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    expect(
      await screen.findByText('Ya existe una cuenta con ese correo.')
    ).toBeTruthy();
    expect((password as HTMLInputElement).value).toBe('');
    expect((confirm as HTMLInputElement).value).toBe('');
    expect(document.body.textContent).not.toMatch(/P2002|prisma/i);
  });
});

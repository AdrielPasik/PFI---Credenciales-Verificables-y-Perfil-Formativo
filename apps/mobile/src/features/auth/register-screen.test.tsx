import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { ReactNode } from 'react';

import { RegisterScreen } from '@/features/auth/register-screen';
import type { AuthFeedback } from '@/types/auth';

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 }
      }}
    >
      {children}
    </SafeAreaProvider>
  );
}

async function renderRegister({
  onSubmit = jest.fn(async () => null),
  onBack = jest.fn(),
  submitting = false
}: {
  onSubmit?: (command: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
  }) => Promise<AuthFeedback | null>;
  onBack?: () => void;
  submitting?: boolean;
} = {}) {
  await render(
    <RegisterScreen
      onSubmit={onSubmit}
      onBack={onBack}
      submitting={submitting}
    />,
    { wrapper: Wrapper }
  );

  return { onSubmit, onBack };
}

async function completeForm() {
  await fireEvent.changeText(screen.getByTestId('register-first-name'), ' Ada ');
  await fireEvent.changeText(screen.getByTestId('register-last-name'), ' Lovelace ');
  await fireEvent.changeText(screen.getByTestId('register-email'), ' ADA@EXAMPLE.COM ');
  await fireEvent.changeText(screen.getByTestId('register-password'), 'secreto8');
  await fireEvent.changeText(
    screen.getByTestId('register-confirm-password'),
    'secreto8'
  );
}

describe('pantalla nativa de registro Holder', () => {
  it('muestra solamente los campos públicos reales de registro', async () => {
    await renderRegister();

    expect(screen.getByTestId('register-first-name')).toBeTruthy();
    expect(screen.getByTestId('register-last-name')).toBeTruthy();
    expect(screen.getByTestId('register-email')).toBeTruthy();
    expect(screen.getByTestId('register-password')).toBeTruthy();
    expect(screen.getByTestId('register-confirm-password')).toBeTruthy();
    expect(screen.queryByText(/institución/i)).toBeNull();
    expect(screen.queryByText(/DNI/i)).toBeNull();
  });

  it('no envía una petición cuando faltan campos requeridos', async () => {
    const { onSubmit } = await renderRegister();
    await fireEvent.press(screen.getByTestId('register-submit'));

    await waitFor(() => expect(screen.getByText('Ingresá tu nombre.')).toBeTruthy());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('bloquea el envío si las contraseñas no coinciden', async () => {
    const { onSubmit } = await renderRegister();
    await completeForm();
    await fireEvent.changeText(
      screen.getByTestId('register-confirm-password'),
      'otra-clave'
    );
    await fireEvent.press(screen.getByTestId('register-submit'));

    await waitFor(() =>
      expect(screen.getByText('Las contraseñas no coinciden.')).toBeTruthy()
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('normaliza y envía sólo el contrato público, sin confirmPassword', async () => {
    const { onSubmit } = await renderRegister();
    await completeForm();
    await fireEvent.press(screen.getByTestId('register-submit'));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        password: 'secreto8'
      })
    );
  });

  it('limpia ambas contraseñas y muestra un error seguro luego del intento', async () => {
    const { onSubmit } = await renderRegister({
      onSubmit: jest.fn(async (): Promise<AuthFeedback> => ({
        code: 'email_in_use',
        message: 'Ya existe una cuenta con ese correo. Iniciá sesión para continuar.',
        recoverable: true
      }))
    });
    await completeForm();
    await fireEvent.press(screen.getByTestId('register-submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(screen.getByTestId('register-password').props.value).toBe('');
    expect(screen.getByTestId('register-confirm-password').props.value).toBe('');
    expect(screen.getByText(/Ya existe una cuenta/)).toBeTruthy();
  });

  it('deshabilita submit y navegación duplicada mientras se está enviando', async () => {
    const { onSubmit, onBack } = await renderRegister({ submitting: true });
    const submit = screen.getByTestId('register-submit');

    await fireEvent.press(submit);
    await fireEvent.press(screen.getByTestId('register-back-to-login'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
    expect(submit.props.accessibilityState.busy).toBe(true);
  });

  it('vuelve al acceso sin crear una cuenta al montar', async () => {
    const { onSubmit, onBack } = await renderRegister();
    expect(onSubmit).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('register-back-to-login'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

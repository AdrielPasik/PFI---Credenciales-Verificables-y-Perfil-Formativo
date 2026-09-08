import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { ReactNode } from 'react';

import { LoginScreen } from '@/features/auth/login-screen';
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

async function renderLogin({
  onSubmit = jest.fn(async () => null),
  submitting = false,
  initialFeedback = null
}: {
  onSubmit?: (command: {
    email: string;
    password: string;
  }) => Promise<AuthFeedback | null>;
  submitting?: boolean;
  initialFeedback?: AuthFeedback | null;
} = {}) {
  await render(
    <LoginScreen
      onSubmit={onSubmit}
      submitting={submitting}
      initialFeedback={initialFeedback}
    />,
    { wrapper: Wrapper }
  );

  return { onSubmit };
}

describe('pantalla de acceso', () => {
  it('presenta la marca y una propuesta orientada al titular', async () => {
    await renderLogin();

    expect(
      screen.getByText('Una nueva forma de entender tu trayectoria.')
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Accedé para consultar tus credenciales y entender tu perfil formativo.'
      )
    ).toBeTruthy();
  });

  it('no ofrece registro, recuperación de contraseña ni SSO', async () => {
    await renderLogin();

    expect(screen.queryByText(/crear una cuenta/i)).toBeNull();
    expect(screen.queryByText(/olvidaste tu contraseña/i)).toBeNull();
    expect(screen.queryByText(/continuar con google/i)).toBeNull();
  });

  it('no muestra ninguna referencia institucional o de emisor', async () => {
    await renderLogin();

    expect(screen.queryByText(/instituci[oó]n/i)).toBeNull();
    expect(screen.queryByText(/emisor/i)).toBeNull();
    expect(screen.queryByText(/verificar una credencial/i)).toBeNull();
  });

  it('valida el correo antes de llamar al backend', async () => {
    const { onSubmit } = await renderLogin();

    await fireEvent.changeText(screen.getByTestId('login-email'), 'no-es-un-correo');
    await fireEvent.changeText(screen.getByTestId('login-password'), 'secreto');
    await fireEvent.press(screen.getByTestId('login-submit'));

    await waitFor(() =>
      expect(
        screen.getByText('Ingresá un correo electrónico válido.')
      ).toBeTruthy()
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('exige la contraseña', async () => {
    const { onSubmit } = await renderLogin();

    await fireEvent.changeText(
      screen.getByTestId('login-email'),
      'titular@example.com'
    );
    await fireEvent.press(screen.getByTestId('login-submit'));

    await waitFor(() =>
      expect(screen.getByText('Ingresá tu contraseña.')).toBeTruthy()
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('normaliza el correo a minúsculas y sin espacios antes de enviarlo', async () => {
    const { onSubmit } = await renderLogin();

    await fireEvent.changeText(
      screen.getByTestId('login-email'),
      '  Titular@Example.COM  '
    );
    await fireEvent.changeText(screen.getByTestId('login-password'), 'secreto');
    await fireEvent.press(screen.getByTestId('login-submit'));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        email: 'titular@example.com',
        password: 'secreto'
      })
    );
  });

  it('deshabilita el envío mientras hay una petición en curso', async () => {
    const onSubmit = jest.fn(async () => null);
    await renderLogin({ onSubmit, submitting: true });

    const submit = screen.getByTestId('login-submit');
    expect(submit.props.accessibilityState.disabled).toBe(true);
    expect(submit.props.accessibilityState.busy).toBe(true);

    await fireEvent.press(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('muestra el aviso de sesión vencida cuando llega desde la sesión', async () => {
    await renderLogin({
      initialFeedback: {
        code: 'session_expired',
        message: 'Tu sesión venció. Volvé a iniciar sesión.',
        recoverable: false
      }
    });

    expect(
      screen.getByText('Tu sesión venció. Volvé a iniciar sesión.')
    ).toBeTruthy();
  });

  it('muestra el error devuelto por el backend tras un intento fallido', async () => {
    const onSubmit = jest.fn(async () => ({
      code: 'invalid_credentials' as const,
      message: 'El correo o la contraseña son incorrectos.',
      recoverable: true
    }));

    await renderLogin({ onSubmit });

    await fireEvent.changeText(
      screen.getByTestId('login-email'),
      'titular@example.com'
    );
    await fireEvent.changeText(screen.getByTestId('login-password'), 'incorrecta');
    await fireEvent.press(screen.getByTestId('login-submit'));

    await waitFor(() =>
      expect(
        screen.getByText('El correo o la contraseña son incorrectos.')
      ).toBeTruthy()
    );
  });

  it('limpia la contraseña del formulario después de cada intento', async () => {
    const onSubmit = jest.fn(async () => null);
    await renderLogin({ onSubmit });

    const passwordField = screen.getByTestId('login-password');
    await fireEvent.changeText(
      screen.getByTestId('login-email'),
      'titular@example.com'
    );
    await fireEvent.changeText(passwordField, 'secreto');
    await fireEvent.press(screen.getByTestId('login-submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId('login-password').props.value).toBe('')
    );
  });

  it('el campo de contraseña oculta el texto y ofrece alternarlo', async () => {
    await renderLogin();

    expect(screen.getByTestId('login-password').props.secureTextEntry).toBe(
      true
    );

    await fireEvent.press(screen.getByLabelText('Mostrar contraseña'));

    await waitFor(() =>
      expect(screen.getByTestId('login-password').props.secureTextEntry).toBe(
        false
      )
    );
    expect(screen.getByLabelText('Ocultar contraseña')).toBeTruthy();
  });

  it('configura el teclado del correo para no autocapitalizar', async () => {
    await renderLogin();

    const email = screen.getByTestId('login-email');
    expect(email.props.autoCapitalize).toBe('none');
    expect(email.props.keyboardType).toBe('email-address');
    expect(email.props.autoComplete).toBe('email');
  });
});

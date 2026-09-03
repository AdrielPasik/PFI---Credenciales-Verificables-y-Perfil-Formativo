import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('@/lib/session/session-provider', () => ({
  useSession: () => ({
    state: { status: 'unauthenticated' },
    login: vi.fn(),
    logout: vi.fn(),
    retry: vi.fn()
  })
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import { LoginScreen } from './login-screen';

it('presents the Scope identity while preserving the login form', () => {
  render(<LoginScreen />);

  const logo = screen.getByRole('img', { name: 'Scope' });
  const logoSource = logo.getAttribute('src') ?? '';
  const logoAssetPath = decodeURIComponent(
    new URL(logoSource, 'http://localhost').searchParams.get('url') ?? ''
  );

  expect(logoAssetPath).toBe('/brand/Logo Scope Invertido.png');
  expect(logoSource).not.toMatch(/^https?:\/\//);
  expect(screen.queryByText('Identidad temporal')).toBeNull();
  expect(
    screen.getByRole('heading', {
      level: 1,
      name: 'Credenciales verificables. Trayectorias que se entienden.'
    })
  ).toBeTruthy();
  expect(screen.getByText('Formación, evidencia y contexto')).toBeTruthy();
  expect(screen.queryByText('Credenciales confiables')).toBeNull();
  expect(screen.queryByText('Perfil formativo')).toBeNull();
  expect(screen.queryByText('Verificación simple')).toBeNull();
  expect(
    screen.getByText(
      'Una nueva forma de entender tu trayectoria.'
    )
  ).toBeTruthy();
  expect(screen.getByLabelText('Correo electrónico')).toBeTruthy();
  expect(screen.getByLabelText('Contraseña').getAttribute('type')).toBe(
    'password'
  );

  fireEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
  expect(screen.getByLabelText('Contraseña').getAttribute('type')).toBe('text');

  expect(
    (
      screen.getByRole('link', { name: 'Verificar una credencial' }) as HTMLAnchorElement
    ).getAttribute('href')
  ).toBe('/verify');
  expect(
    screen.queryByText(/blockchain|IA avanzada|100 % verificado/i)
  ).toBeNull();
});

it('A1: shows a discreet CTA to create a new account, linking to /register', () => {
  render(<LoginScreen />);

  expect(screen.getByText('¿Sos nuevo en Scope?')).toBeTruthy();
  expect(
    (
      screen.getByRole('link', { name: 'Crear una cuenta' }) as HTMLAnchorElement
    ).getAttribute('href')
  ).toBe('/register');
});

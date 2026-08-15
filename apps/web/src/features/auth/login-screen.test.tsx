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

it('presents the definitive Traza identity while preserving the login form', () => {
  render(<LoginScreen />);

  const logo = screen.getByRole('img', { name: 'Traza' });
  const logoSource = logo.getAttribute('src') ?? '';
  const logoAssetPath = decodeURIComponent(
    new URL(logoSource, 'http://localhost').searchParams.get('url') ?? ''
  );

  expect(logoAssetPath).toBe('/brand/LOGO TRAZA SIN FONDO.png');
  expect(logoSource).not.toMatch(/^https?:\/\//);
  expect(screen.queryByText('Identidad temporal')).toBeNull();
  expect(
    screen.getByRole('heading', {
      level: 1,
      name: 'Credenciales verificables. Trayectorias que se entienden.'
    })
  ).toBeTruthy();
  expect(screen.getByText('Credenciales confiables')).toBeTruthy();
  expect(screen.getByText('Perfil formativo')).toBeTruthy();
  expect(screen.getByText('Verificación simple')).toBeTruthy();
  expect(
    screen.getByText(
      'Credenciales verificables para trayectorias formativas confiables.'
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

  expect(screen.getByText('¿Sos nuevo en Traza?')).toBeTruthy();
  expect(
    (
      screen.getByRole('link', { name: 'Crear una cuenta' }) as HTMLAnchorElement
    ).getAttribute('href')
  ).toBe('/register');
});

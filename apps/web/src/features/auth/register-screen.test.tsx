import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('@/lib/session/session-provider', () => ({
  useSession: () => ({
    state: { status: 'unauthenticated' },
    register: vi.fn(),
    logout: vi.fn(),
    retry: vi.fn()
  })
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import { RegisterScreen } from './register-screen';

it('renders the register screen with product copy, the login link and no institutional/technical fields', () => {
  render(<RegisterScreen />);

  expect(
    screen.getByRole('heading', { level: 2, name: 'Crear cuenta' })
  ).toBeTruthy();
  expect(
    screen.getByText(
      'Empezá a construir tu trayectoria formativa en un solo lugar.'
    )
  ).toBeTruthy();
  expect(screen.getByLabelText('Correo electrónico')).toBeTruthy();
  expect(screen.getByLabelText('Contraseña').getAttribute('type')).toBe(
    'password'
  );
  expect(
    screen.getByLabelText('Repetir contraseña').getAttribute('type')
  ).toBe('password');

  const loginLink = screen.getByRole('link', {
    name: 'Ingresar'
  }) as HTMLAnchorElement;
  expect(loginLink.getAttribute('href')).toBe('/login');

  expect(screen.queryByText(/^Sign up$/i)).toBeNull();
  expect(screen.queryByText(/onboarding/i)).toBeNull();
  expect(screen.queryByText(/crear did/i)).toBeNull();
  expect(screen.queryByText(/crear wallet/i)).toBeNull();
  expect(screen.queryByText(/blockchain/i)).toBeNull();
});

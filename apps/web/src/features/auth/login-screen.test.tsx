import { render, screen } from '@testing-library/react';
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

it('offers the public verifier before authentication', () => {
  render(<LoginScreen />);

  expect(
    (screen.getByRole('link', { name: 'Verificar una credencial' }) as HTMLAnchorElement).getAttribute('href')
  ).toBe('/verify');
});

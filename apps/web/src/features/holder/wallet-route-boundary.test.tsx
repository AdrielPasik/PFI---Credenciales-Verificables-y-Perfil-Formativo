import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WalletRouteBoundary } from '@/features/holder/wallet-route-boundary';
import type { UserOnboardingIntent } from '@/models/auth-session';

const router = vi.hoisted(() => ({ replace: vi.fn() }));
const session = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/session/session-provider', () => ({ useSession: () => session.value }));

const membership = {
  issuerReference: 'issuer-reference', issuerName: 'UADE', issuerDid: null,
  issuerAuthorizationStatus: 'authorized' as const, issuerAuthorizationLabel: 'Autorizada',
  role: 'admin' as const, roleLabel: 'Administrador', status: 'active' as const, operational: true
};

function authenticated(options: {
  onboardingIntent?: UserOnboardingIntent | null;
  issuerContext?: unknown;
  isPlatformAdmin?: boolean;
} = {}) {
  session.value = {
    state: {
      status: 'authenticated',
      currentUser: {
        userReference: 'user-reference',
        email: 'juan@uade.edu.ar',
        did: null,
        displayLabel: 'Juan Pérez',
        isPlatformAdmin: options.isPlatformAdmin ?? false,
        onboardingIntent: options.onboardingIntent ?? null
      },
      issuerContext:
        options.issuerContext ?? {
          kind: 'none', issuerContexts: [], operationalIssuerContexts: [], selectedIssuer: null
        }
    },
    retry: vi.fn(), logout: vi.fn(), selectIssuer: vi.fn(), clearSelectedIssuer: vi.fn()
  };
}

/**
 * El espacio personal exige UNICAMENTE sesion autenticada -- O1.
 *
 * Las capacidades no son exclusivas: "holder" no es un tipo de cuenta. Haber
 * elegido la intencion institucional, o tener una IssuerMembership, o ser
 * PlatformAdmin, no quita a nadie su espacio personal.
 */
describe('WalletRouteBoundary', () => {
  beforeEach(() => {
    router.replace.mockClear();
  });

  it('O1/22: lets someone with institutional intent open the wallet directly', async () => {
    authenticated({ onboardingIntent: 'institutional' });
    render(
      <WalletRouteBoundary>
        <p>contenido personal</p>
      </WalletRouteBoundary>
    );

    expect(screen.getByText('contenido personal')).toBeTruthy();
    await waitFor(() => expect(router.replace).not.toHaveBeenCalled());
  });

  it('O1: lets someone WITH an operational membership open the wallet too', async () => {
    authenticated({
      onboardingIntent: 'institutional',
      issuerContext: {
        kind: 'single',
        issuerContexts: [membership],
        operationalIssuerContexts: [membership],
        selectedIssuer: membership
      }
    });
    render(
      <WalletRouteBoundary>
        <p>contenido personal</p>
      </WalletRouteBoundary>
    );

    expect(screen.getByText('contenido personal')).toBeTruthy();
    await waitFor(() => expect(router.replace).not.toHaveBeenCalled());
  });

  for (const intent of ['personal', null] as const) {
    it(`O1: lets someone with intent=${String(intent)} open the wallet`, () => {
      authenticated({ onboardingIntent: intent });
      render(
        <WalletRouteBoundary>
          <p>contenido personal</p>
        </WalletRouteBoundary>
      );

      expect(screen.getByText('contenido personal')).toBeTruthy();
    });
  }

  it('O1: an unauthenticated session still goes to login', async () => {
    session.value = {
      state: { status: 'unauthenticated' },
      retry: vi.fn(), logout: vi.fn(), selectIssuer: vi.fn(), clearSelectedIssuer: vi.fn()
    };
    render(
      <WalletRouteBoundary>
        <p>contenido personal</p>
      </WalletRouteBoundary>
    );

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
  });
});

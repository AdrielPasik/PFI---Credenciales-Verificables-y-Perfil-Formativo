import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InstitutionalAccessPendingRoute } from '@/features/onboarding/institutional-access-pending-route';
import type { UserOnboardingIntent } from '@/models/auth-session';

const router = vi.hoisted(() => ({ replace: vi.fn() }));
const session = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/session/session-provider', () => ({ useSession: () => session.value }));

const currentUser = {
  userReference: 'user-reference',
  email: 'juan@uade.edu.ar',
  did: null,
  displayLabel: 'Juan Pérez',
  isPlatformAdmin: false,
  onboardingIntent: 'institutional' as UserOnboardingIntent | null
};

const membership = {
  issuerReference: 'issuer-reference', issuerName: 'UADE', issuerDid: null,
  issuerAuthorizationStatus: 'authorized' as const, issuerAuthorizationLabel: 'Autorizada',
  role: 'admin' as const, roleLabel: 'Administrador', status: 'active' as const, operational: true
};

const noContext = {
  kind: 'none', issuerContexts: [], operationalIssuerContexts: [], selectedIssuer: null
};

function createSession(options: {
  issuerContext?: unknown;
  onboardingIntent?: UserOnboardingIntent | null;
  retry?: () => Promise<void>;
  logout?: () => void;
} = {}) {
  const retry = options.retry ?? vi.fn().mockResolvedValue(undefined);
  const logout = options.logout ?? vi.fn();

  session.value = {
    state: {
      status: 'authenticated',
      currentUser: {
        ...currentUser,
        onboardingIntent:
          options.onboardingIntent === undefined
            ? 'institutional'
            : options.onboardingIntent
      },
      issuerContext: options.issuerContext ?? noContext
    },
    retry,
    logout,
    selectIssuer: vi.fn(),
    clearSelectedIssuer: vi.fn()
  };

  return { retry, logout };
}

describe('InstitutionalAccessPendingRoute', () => {
  beforeEach(() => {
    router.replace.mockClear();
  });

  it('O1/17: renders the email of the authenticated person', () => {
    createSession();
    render(<InstitutionalAccessPendingRoute />);

    expect(screen.getByText('juan@uade.edu.ar')).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Acceso institucional pendiente' })
    ).toBeTruthy();
  });

  it('O1: the copy never claims a request, a review, an approval or a verification', () => {
    // Nada de eso existe hoy en el sistema, así que afirmarlo sería mentir.
    createSession();
    render(<InstitutionalAccessPendingRoute />);

    expect(document.body.textContent).not.toMatch(
      /solicitud|solicitaste|revisión|revisando|aprobaci|verificad|verificó|invitaci|en proceso/i
    );
    // Y sí dice lo único que es cierto.
    expect(document.body.textContent).toMatch(/Tu cuenta ya está creada/);
  });

  it('O1/18: "Revisar de nuevo" calls the existing session retry', async () => {
    const { retry } = createSession();
    render(<InstitutionalAccessPendingRoute />);

    fireEvent.click(screen.getByRole('button', { name: 'Revisar de nuevo' }));

    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
  });

  it('O1/19: offers an opt-in link to the personal space', () => {
    // Deliberado: la intención institucional no quita la capacidad personal.
    createSession();
    render(<InstitutionalAccessPendingRoute />);

    const link = screen.getByRole('link', { name: /Ir a mi espacio personal/ });
    expect(link.getAttribute('href')).toBe('/wallet');
  });

  it('O1/20: logout uses the real session mechanism and returns to login', () => {
    const { logout } = createSession();
    render(<InstitutionalAccessPendingRoute />);

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    expect(logout).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/login');
  });

  it('O1/21: leaves the pending screen as soon as an operational membership appears', async () => {
    // Es lo que hace suficiente al retry() después de S5a: no hace falta
    // polling, el siguiente /auth/me trae la membership y el boundary saca a la
    // persona de acá.
    createSession({
      issuerContext: {
        kind: 'single',
        issuerContexts: [membership],
        operationalIssuerContexts: [membership],
        selectedIssuer: membership
      }
    });
    render(<InstitutionalAccessPendingRoute />);

    // Redirige a `/` y no a `/issuer`: la precedencia de routing vive en el
    // ContextRouter y no se duplica acá.
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  });

  for (const intent of ['personal', null] as const) {
    it(`O1: does not trap someone whose intent is ${String(intent)}`, async () => {
      createSession({ onboardingIntent: intent });
      render(<InstitutionalAccessPendingRoute />);

      await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    });
  }

  it('O1: an unauthenticated session goes to login', async () => {
    session.value = {
      state: { status: 'unauthenticated' },
      retry: vi.fn(), logout: vi.fn(), selectIssuer: vi.fn(), clearSelectedIssuer: vi.fn()
    };
    render(<InstitutionalAccessPendingRoute />);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
  });

  it('O1: the screen grants nothing -- it offers no issuer portal entry point', () => {
    createSession();
    render(<InstitutionalAccessPendingRoute />);

    const hrefs = [...document.querySelectorAll('a')].map((anchor) =>
      anchor.getAttribute('href')
    );
    expect(hrefs).not.toContain('/issuer');
    expect(hrefs).not.toContain('/admin');
    // Ningún formulario: no se solicita nada, no se elige institución.
    expect(document.querySelectorAll('form')).toHaveLength(0);
    expect(document.querySelectorAll('select')).toHaveLength(0);
    expect(document.querySelectorAll('input')).toHaveLength(0);
  });
});

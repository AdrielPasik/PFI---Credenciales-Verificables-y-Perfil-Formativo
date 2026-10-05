import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminRouteBoundary } from '@/features/admin/admin-route-boundary';
import type { UserOnboardingIntent } from '@/models/auth-session';

const router = vi.hoisted(() => ({ replace: vi.fn() }));
const session = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/session/session-provider', () => ({
  useSession: () => session.value
}));

const membership = {
  issuerReference: 'issuer-reference',
  issuerName: 'UADE',
  issuerDid: null,
  issuerAuthorizationStatus: 'authorized' as const,
  issuerAuthorizationLabel: 'Autorizada',
  role: 'admin' as const,
  roleLabel: 'Administrador',
  status: 'active' as const,
  operational: true
};

const viewerMembership = {
  ...membership,
  issuerReference: 'issuer-viewer',
  role: 'viewer' as const,
  roleLabel: 'Solo lectura',
  operational: false
};

function authenticated(
  options: {
    isPlatformAdmin?: boolean;
    onboardingIntent?: UserOnboardingIntent | null;
    issuerContext?: unknown;
  } = {}
) {
  session.value = {
    state: {
      status: 'authenticated',
      currentUser: {
        userReference: 'user-reference',
        email: 'adriel@example.com',
        did: null,
        displayLabel: 'Adriel Pasik',
        isPlatformAdmin: options.isPlatformAdmin ?? false,
        onboardingIntent: options.onboardingIntent ?? null
      },
      issuerContext:
        options.issuerContext ?? {
          kind: 'none',
          issuerContexts: [],
          operationalIssuerContexts: [],
          selectedIssuer: null
        }
    },
    requestAuthenticated: vi.fn(),
    retry: vi.fn(),
    logout: vi.fn(),
    selectIssuer: vi.fn(),
    clearSelectedIssuer: vi.fn()
  };
}

function sessionWithStatus(status: string) {
  session.value = {
    state: { status },
    requestAuthenticated: vi.fn(),
    retry: vi.fn(),
    logout: vi.fn(),
    selectIssuer: vi.fn(),
    clearSelectedIssuer: vi.fn()
  };
}

function renderBoundary() {
  return render(
    <AdminRouteBoundary>
      <p>contenido administrativo</p>
    </AdminRouteBoundary>
  );
}

const adminContent = () => screen.queryByText('contenido administrativo');

/**
 * Frontera de /admin -- S6a.
 *
 * El claim central: depende de DOS cosas (sesion autenticada +
 * `isPlatformAdmin === true`) y de NADA MAS. Ni issuerContext, ni memberships,
 * ni rol institucional, ni onboardingIntent.
 *
 * Y el recordatorio permanente: esto es UX. La autoridad es
 * `AuthGuard` + `PlatformAdminGuard`, server-side, en cada request.
 */
describe('AdminRouteBoundary', () => {
  beforeEach(() => {
    router.replace.mockClear();
  });

  // -------------------------------------------------------------------------
  // 1. Sesión cargando
  // -------------------------------------------------------------------------

  for (const status of ['booting', 'authenticating', 'resolving-context']) {
    it(`1: con la sesión en "${status}" no se renderiza contenido administrativo`, () => {
      sessionWithStatus(status);
      renderBoundary();

      expect(adminContent()).toBeNull();
      expect(screen.getByRole('status')).toBeTruthy();
      expect(router.replace).not.toHaveBeenCalled();
    });
  }

  // -------------------------------------------------------------------------
  // 2. Sin autenticar
  // -------------------------------------------------------------------------

  for (const status of ['unauthenticated', 'expired']) {
    it(`2: con la sesión en "${status}" redirige a /login y no renderiza nada`, async () => {
      sessionWithStatus(status);
      renderBoundary();

      await waitFor(() =>
        expect(router.replace).toHaveBeenCalledWith('/login')
      );
      expect(adminContent()).toBeNull();
    });
  }

  // -------------------------------------------------------------------------
  // 3-4. Autenticado SIN la capacidad de plataforma
  // -------------------------------------------------------------------------

  it('3: un User normal autenticado NO accede, y se lo saca a la raíz', async () => {
    authenticated({ isPlatformAdmin: false });
    renderBoundary();

    expect(adminContent()).toBeNull();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  });

  it('4: un admin institucional SIN capacidad de plataforma tampoco accede', async () => {
    // Tener `IssuerMembership(role=admin, status=active)` sobre una institución
    // habilitada NO otorga capacidad de plataforma: son planos separados.
    authenticated({
      isPlatformAdmin: false,
      issuerContext: {
        kind: 'single',
        issuerContexts: [membership],
        operationalIssuerContexts: [membership],
        selectedIssuer: membership
      }
    });
    renderBoundary();

    expect(adminContent()).toBeNull();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  });

  it('un isPlatformAdmin que no sea exactamente true no alcanza (fail-closed)', async () => {
    for (const value of [undefined, null, 'true', 1, {}]) {
      router.replace.mockClear();
      authenticated({ isPlatformAdmin: value as never });
      const view = renderBoundary();

      expect(
        adminContent(),
        `isPlatformAdmin=${JSON.stringify(value)} no debe dar acceso`
      ).toBeNull();
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
      view.unmount();
    }
  });

  // -------------------------------------------------------------------------
  // 5-6. PlatformAdmin, con y sin memberships
  // -------------------------------------------------------------------------

  it('5: un PlatformAdmin SIN ninguna membership accede', async () => {
    authenticated({ isPlatformAdmin: true });
    renderBoundary();

    expect(adminContent()).toBeTruthy();
    await waitFor(() => expect(router.replace).not.toHaveBeenCalled());
  });

  it('6: un PlatformAdmin CON una membership accede igual', async () => {
    // Y NO se lo redirige a /issuer por tenerla.
    authenticated({
      isPlatformAdmin: true,
      issuerContext: {
        kind: 'single',
        issuerContexts: [membership],
        operationalIssuerContexts: [membership],
        selectedIssuer: membership
      }
    });
    renderBoundary();

    expect(adminContent()).toBeTruthy();
    await waitFor(() => expect(router.replace).not.toHaveBeenCalled());
  });

  it('6: un PlatformAdmin con selección institucional PENDIENTE accede sin elegir', async () => {
    // `selection-required` bloquea /issuer, no /admin: nadie tiene que elegir
    // una institución para administrar la plataforma.
    authenticated({
      isPlatformAdmin: true,
      issuerContext: {
        kind: 'selection-required',
        issuerContexts: [membership, viewerMembership],
        operationalIssuerContexts: [membership, viewerMembership],
        selectedIssuer: null
      }
    });
    renderBoundary();

    expect(adminContent()).toBeTruthy();
    await waitFor(() => expect(router.replace).not.toHaveBeenCalled());
  });

  it('un PlatformAdmin cuyas memberships son todas no operativas accede igual', async () => {
    authenticated({
      isPlatformAdmin: true,
      issuerContext: {
        kind: 'none',
        issuerContexts: [viewerMembership],
        operationalIssuerContexts: [],
        selectedIssuer: null
      }
    });
    renderBoundary();

    expect(adminContent()).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // 7. onboardingIntent no participa
  // -------------------------------------------------------------------------

  it('7: onboardingIntent NO participa de la decisión, en ninguno de sus valores', async () => {
    for (const onboardingIntent of [
      'personal',
      'institutional',
      null
    ] as const) {
      router.replace.mockClear();
      authenticated({ isPlatformAdmin: true, onboardingIntent });
      const view = renderBoundary();

      expect(
        adminContent(),
        `intent=${String(onboardingIntent)} deberia acceder`
      ).toBeTruthy();
      await waitFor(() => expect(router.replace).not.toHaveBeenCalled());
      view.unmount();
    }

    // Y al revés: la intención institucional no suple la capacidad.
    for (const onboardingIntent of [
      'personal',
      'institutional',
      null
    ] as const) {
      router.replace.mockClear();
      authenticated({ isPlatformAdmin: false, onboardingIntent });
      const view = renderBoundary();

      expect(
        adminContent(),
        `intent=${String(onboardingIntent)} no deberia acceder sin la capacidad`
      ).toBeNull();
      view.unmount();
    }
  });

  // -------------------------------------------------------------------------
  // Error recuperable de sesión
  // -------------------------------------------------------------------------

  it('un error recuperable de sesión muestra el estado existente, no la UI admin', () => {
    session.value = {
      state: {
        status: 'recoverable-error',
        error: {
          code: 'service_unavailable',
          message: 'El servicio no está disponible.',
          recoverable: true
        }
      },
      requestAuthenticated: vi.fn(),
      retry: vi.fn(),
      logout: vi.fn(),
      selectIssuer: vi.fn(),
      clearSelectedIssuer: vi.fn()
    };
    renderBoundary();

    expect(adminContent()).toBeNull();
    expect(screen.getByText('El servicio no está disponible.')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // El shell
  // -------------------------------------------------------------------------

  it('el shell identifica el plano de plataforma y no muestra nada institucional', () => {
    authenticated({
      isPlatformAdmin: true,
      issuerContext: {
        kind: 'single',
        issuerContexts: [membership],
        operationalIssuerContexts: [membership],
        selectedIssuer: membership
      }
    });
    renderBoundary();

    expect(screen.getByText('Administración de plataforma')).toBeTruthy();
    expect(screen.getByText('Adriel Pasik')).toBeTruthy();
    // Ni institución activa, ni "Cambiar institución": otro plano.
    expect(screen.queryByText('UADE')).toBeNull();
    expect(screen.queryByText('Institución activa')).toBeNull();
    expect(screen.queryByRole('button', { name: /Cambiar institución/ })).toBeNull();
    // Ni un segundo enlace a /admin: ya estamos dentro.
    expect(
      screen.queryByRole('link', { name: /Administración de plataforma/ })
    ).toBeNull();
  });

  it('cerrar sesión usa el mecanismo existente y vuelve a /login', async () => {
    authenticated({ isPlatformAdmin: true });
    const logout = (session.value as { logout: () => void }).logout;
    renderBoundary();

    screen.getByRole('button', { name: /Cerrar sesión/ }).click();

    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(router.replace).toHaveBeenCalledWith('/login');
  });
});

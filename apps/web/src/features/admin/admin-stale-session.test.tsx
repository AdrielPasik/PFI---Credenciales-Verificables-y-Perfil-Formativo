import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminRoute } from '@/features/admin/admin-route';
import { ApiError } from '@/lib/errors/api-error';
import type { AuthSessionState } from '@/models/auth-session';

/**
 * SESION DE PLATFORM ADMIN OBSOLETA -- S6a.
 *
 * El escenario: /admin YA renderizo porque `currentUser.isPlatformAdmin` era
 * `true`, y despues una request administrativa vuelve 401 o 403. El frontend
 * boundary es UX; la autoridad es el backend, asi que lo correcto NO es
 * asumir que el backend fallo.
 *
 * POR QUE ESTE ARCHIVO EXISTE APARTE. `admin-route.test.tsx` cubre el 403
 * contra `AdminContent` con el API mockeado, que alcanza para el estado de la
 * vista pero NO para la interaccion con la sesion: ahi `useSession` es un
 * doble estatico y el boundary no participa. Aca se monta `AdminRoute`
 * COMPLETO (boundary incluido) con una sesion que REACCIONA, y se usa el
 * modulo real `admin-api` + el adapter real. Es la unica forma de comprobar
 * que el 401 termina en /login y que el 403 NO invalida la sesion.
 *
 * El doble de `requestAuthenticated` replica lo que hace el
 * `SessionProvider` REAL (verificado en `lib/session/session-provider.tsx`):
 * ante un 401 limpia el store, pasa la sesion a `expired` y RE-LANZA el
 * error; ante cualquier otro status solo re-lanza.
 *
 * `SessionProvider` NO se modifico en S6a: no hubo necesidad real, y este
 * archivo documenta por que -- el mecanismo que ya existia alcanza.
 */

const router = vi.hoisted(() => ({ replace: vi.fn() }));

/**
 * Sesion observable: el estado vive aca y los componentes se re-renderizan
 * cuando cambia, igual que con el provider real.
 */
const bus = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    listeners,
    state: null as unknown,
    requestAuthenticated: (() => {}) as unknown,
    retry: (() => {}) as unknown,
    logout: (() => {}) as unknown,
    notify() {
      for (const listener of listeners) listener();
    }
  };
});

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/session/session-provider', async () => {
  const { useEffect, useState } = await import('react');

  return {
    useSession: () => {
      const [, force] = useState(0);

      useEffect(() => {
        const listener = () => force((version) => version + 1);
        bus.listeners.add(listener);
        return () => {
          bus.listeners.delete(listener);
        };
      }, []);

      return {
        state: bus.state,
        requestAuthenticated: bus.requestAuthenticated,
        retry: bus.retry,
        logout: bus.logout,
        selectIssuer: vi.fn(),
        clearSelectedIssuer: vi.fn()
      };
    }
  };
});

const authenticatedState: AuthSessionState = {
  status: 'authenticated',
  currentUser: {
    userReference: 'user-reference',
    email: 'adriel@example.com',
    did: null,
    displayLabel: 'Adriel Pasik',
    isPlatformAdmin: true,
    onboardingIntent: null
  },
  issuerContext: {
    kind: 'none',
    issuerContexts: [],
    operationalIssuerContexts: [],
    selectedIssuer: null
  }
};

/**
 * Replica del contrato de `SessionProvider.requestAuthenticated` ante un error
 * HTTP, con el status que el test elija.
 *
 * EL `await` DEL PRINCIPIO NO ES DECORATIVO. En el provider real el 401 se
 * detecta en el `catch` de
 * `await createApiClient().request(...)` (ver `lib/session/session-provider.tsx`),
 * asi que la invalidacion de la sesion ocurre SIEMPRE al menos un microtask
 * despues del efecto que disparo la lectura. Sin ese `await`, este doble
 * mutaria el estado de forma sincronica durante el efecto de `AdminContent`,
 * es decir ANTES de que el efecto del boundary (que es su PADRE: los efectos
 * de los hijos corren primero) alcanzara a suscribirse al bus -- y el
 * redirect se perderia por una razon que no existe en la app real, donde
 * `SessionProvider` es un context provider POR ENCIMA del boundary y su
 * `setState` lo re-renderiza siempre.
 */
function rejectingSessionRequest(status: number) {
  return vi.fn(async () => {
    await Promise.resolve();

    const error = new ApiError('El servicio rechazó la operación.', 'http', status);

    if (status === 401) {
      // Lo que hace el provider real: invalida la sesion y RE-LANZA.
      bus.state = {
        status: 'expired',
        error: {
          code: 'session_expired',
          message: 'Tu sesión venció. Volvé a iniciar sesión.',
          recoverable: false
        }
      } satisfies AuthSessionState;
      bus.notify();
    }

    throw error;
  });
}

beforeEach(() => {
  router.replace.mockClear();
  bus.state = authenticatedState;
  bus.retry = vi.fn();
  bus.logout = vi.fn();
});

describe('AdminRoute: sesión de PlatformAdmin obsoleta', () => {
  it('401: la sesión se invalida y se redirige a /login, sin UI administrativa', async () => {
    bus.requestAuthenticated = rejectingSessionRequest(401);

    render(<AdminRoute />);

    // El mecanismo EXISTENTE de sesión es el que actúa: nada propio de /admin.
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));

    expect(screen.queryByText('Instituciones en Scope')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Reintentar' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Revalidar sesión' })
    ).toBeNull();
    // Y no se ofrece ningún error administrativo: no fue un fallo de datos.
    expect(
      screen.queryByText('No pudimos cargar las instituciones')
    ).toBeNull();
  });

  it('401: no se intenta ningún recovery propio ni se reintenta la lectura', async () => {
    const request = rejectingSessionRequest(401);
    bus.requestAuthenticated = request;

    render(<AdminRoute />);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));

    // Una sola lectura: nadie reintenta contra una sesión ya vencida.
    expect(request).toHaveBeenCalledTimes(1);
    // Y /admin no llama a `retry()` por su cuenta ante un 401: eso sería un
    // auth recovery paralelo. El provider ya resolvió el caso.
    expect(bus.retry).not.toHaveBeenCalled();
  });

  it('403: la sesión NO se invalida -- se ofrece revalidarla, no reintentar', async () => {
    const request = rejectingSessionRequest(403);
    bus.requestAuthenticated = request;

    render(<AdminRoute />);

    await screen.findByText(
      'La administración de plataforma no está disponible para esta sesión'
    );

    // No hay redirect: un 403 no es una sesión vencida.
    expect(router.replace).not.toHaveBeenCalled();
    // Y NO se ofrece un retry de datos: el backend ya negó la capacidad, así
    // que repetir el GET sería un bucle.
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('403: "Revalidar sesión" usa el retry del provider, no una vía paralela', async () => {
    bus.requestAuthenticated = rejectingSessionRequest(403);

    render(<AdminRoute />);

    const revalidate = await screen.findByRole('button', {
      name: 'Revalidar sesión'
    });
    revalidate.click();

    // El único mecanismo: `useSession().retry()` -> `GET /auth/me`.
    await waitFor(() => expect(bus.retry).toHaveBeenCalledTimes(1));
  });

  it('403 + capacidad efectivamente revocada: el boundary saca a la persona', async () => {
    // Secuencia completa y realista: el GET da 403, se revalida la sesión,
    // /auth/me devuelve `platformAdmin: false`, y entonces el boundary deja de
    // renderizar /admin. La autoridad siempre fue del backend.
    bus.requestAuthenticated = rejectingSessionRequest(403);
    bus.retry = vi.fn(async () => {
      bus.state = {
        ...authenticatedState,
        currentUser: {
          ...authenticatedState.currentUser,
          isPlatformAdmin: false
        }
      } satisfies AuthSessionState;
      bus.notify();
    });

    render(<AdminRoute />);

    const revalidate = await screen.findByRole('button', {
      name: 'Revalidar sesión'
    });
    revalidate.click();

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(screen.queryByText('Instituciones en Scope')).toBeNull();
  });

  it('un 500 SÍ es un fallo de datos: se ofrece reintentar', async () => {
    // Control negativo: el tratamiento especial es sólo para 401/403. Un error
    // del servicio sigue siendo transitorio y reintentable.
    bus.requestAuthenticated = rejectingSessionRequest(500);

    render(<AdminRoute />);

    await screen.findByText('No pudimos cargar las instituciones');
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Revalidar sesión' })
    ).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

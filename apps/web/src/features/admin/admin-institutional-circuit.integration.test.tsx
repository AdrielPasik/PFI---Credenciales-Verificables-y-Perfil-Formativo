import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminRoute } from '@/features/admin/admin-route';
import { ApiError } from '@/lib/errors/api-error';

/**
 * CIRCUITO ADMINISTRATIVO EN LA WEB -- integracion. Slice S7a, capa B.
 *
 * ---------------------------------------------------------------------------
 * QUE ES REAL Y QUE ESTA SUSTITUIDO
 * ---------------------------------------------------------------------------
 *
 * REAL (codigo productivo ejecutado de verdad): `AdminRoute`,
 * `AdminRouteBoundary`, `AdminShell`, `AdminIssuersView`,
 * `AdminCreateIssuerFlow`, `AdminAddMemberFlow`, el modulo `admin-api`
 * COMPLETO (construccion de rutas, metodos, bodies y `encodeURIComponent`) y
 * los adapters de `platform-admin.adapter` con toda su validacion de contrato.
 *
 * SUSTITUIDO: unicamente el TRANSPORTE. `requestAuthenticated` -- que en
 * produccion pone el `Authorization: Bearer` y hace el `fetch` -- se
 * reemplaza por un backend falso con estado que devuelve los MISMOS DTO
 * crudos que responde el backend real. Todo lo que ocurre despues de recibir
 * ese payload es codigo productivo.
 *
 * A diferencia de las suites de S6a/S6b, aca NO se mockea `@/lib/api/admin-api`:
 * si un adapter rechazara el contrato, este test fallaria. Eso es lo que lo
 * convierte en prueba de integracion y no en prueba de componente.
 *
 * El backend falso TIENE ESTADO a proposito: es la unica forma de demostrar
 * que el refresh posterior a una mutacion relee la autoridad real en vez de
 * pintar un contador optimista.
 */

const router = vi.hoisted(() => ({ replace: vi.fn() }));
const session = vi.hoisted(() => ({
  retry: vi.fn(),
  logout: vi.fn(),
  requestAuthenticated: vi.fn()
}));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/session/session-provider', () => ({
  useSession: () => ({
    state: {
      status: 'authenticated',
      currentUser: {
        userReference: 'user-platform-admin',
        email: 'platform-admin.e2e@example.test',
        did: null,
        displayLabel: 'Adriel Plataforma',
        isPlatformAdmin: true,
        onboardingIntent: 'personal'
      },
      issuerContext: {
        kind: 'none',
        issuerContexts: [],
        operationalIssuerContexts: [],
        selectedIssuer: null
      }
    },
    requestAuthenticated: session.requestAuthenticated,
    retry: session.retry,
    logout: session.logout,
    selectIssuer: vi.fn(),
    clearSelectedIssuer: vi.fn()
  })
}));

// ---------------------------------------------------------------------------
// Backend falso con estado -- devuelve los DTO crudos del backend real
// ---------------------------------------------------------------------------

interface FakeUser {
  id: string;
  email: string;
  displayLabel: string;
  eligible: boolean;
}

interface FakeMembership {
  userId: string;
  role: 'admin' | 'operator' | 'viewer';
  status: 'active' | 'pending' | 'revoked';
  createdAt: string;
}

interface FakeIssuer {
  id: string;
  name: string;
  legalName: string | null;
  memberships: FakeMembership[];
}

interface FakeBackend {
  users: FakeUser[];
  issuers: FakeIssuer[];
  calls: Array<{ method: string; path: string; body?: unknown }>;
  sequence: number;
}

let backend: FakeBackend;

const ACTOR_A: FakeUser = {
  id: 'user-ana',
  email: 'institutional-user.e2e@example.test',
  displayLabel: 'Ana Institucional',
  eligible: true
};

const ACTOR_C: FakeUser = {
  id: 'user-carlos',
  email: 'personal-user.e2e@example.test',
  displayLabel: 'Carlos Personal',
  eligible: true
};

function issuerSummaryDto(issuer: FakeIssuer) {
  const active = issuer.memberships.filter((m) => m.status === 'active').length;
  return {
    id: issuer.id,
    name: issuer.name,
    legalName: issuer.legalName,
    authorizationStatus: 'authorized',
    technicalIdentity: {
      didConfigured: false,
      walletConfigured: false,
      readyToIssue: false
    },
    membershipCounts: { active, total: issuer.memberships.length },
    catalogCounts: {
      academicCourses: 0,
      programs: 0,
      curriculumVersions: 0,
      programCourses: 0
    },
    createdAt: '2026-10-05T10:00:00.000Z'
  };
}

function membershipDto(issuer: FakeIssuer, membership: FakeMembership) {
  const user = backend.users.find((u) => u.id === membership.userId);
  return {
    userId: membership.userId,
    email: user?.email ?? null,
    displayLabel: user?.displayLabel ?? 'Sin datos',
    role: membership.role,
    status: membership.status,
    createdAt: membership.createdAt
  };
}

/**
 * El transporte. Enruta por metodo+path igual que el backend real y devuelve
 * el DTO crudo, o lanza `ApiError` con el status que corresponda -- que es
 * exactamente lo que hace `ApiClient` en produccion.
 */
async function fakeTransport(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<unknown> {
  const method = options.method ?? 'GET';
  backend.calls.push({ method, path, body: options.body });

  if (method === 'GET' && path === '/admin/issuers') {
    return { items: backend.issuers.map(issuerSummaryDto) };
  }

  const membershipsMatch = path.match(/^\/admin\/issuers\/([^/]+)\/memberships$/);

  if (membershipsMatch) {
    const issuerId = decodeURIComponent(membershipsMatch[1]);
    const issuer = backend.issuers.find((i) => i.id === issuerId);

    if (!issuer) {
      throw new ApiError('No existe', 'http', 404);
    }

    if (method === 'GET') {
      return {
        issuer: { id: issuer.id, name: issuer.name },
        items: issuer.memberships.map((m) => membershipDto(issuer, m))
      };
    }

    // S5a: grant sobre un issuer existente.
    const email = (options.body as { userEmail?: string } | undefined)?.userEmail;
    const user = backend.users.find((u) => u.email === email && u.eligible);

    if (!user) {
      throw new ApiError('No elegible', 'http', 404);
    }
    if (issuer.memberships.some((m) => m.userId === user.id)) {
      throw new ApiError('Ya tiene membresia', 'http', 409);
    }

    const membership: FakeMembership = {
      userId: user.id,
      role: 'admin',
      status: 'active',
      createdAt: '2026-10-05T11:00:00.000Z'
    };
    issuer.memberships.push(membership);

    return {
      issuer: { id: issuer.id, name: issuer.name },
      membership: membershipDto(issuer, membership)
    };
  }

  if (method === 'POST' && path === '/admin/users/resolve') {
    const email = (options.body as { email?: string } | undefined)?.email;
    const user = backend.users.find((u) => u.email === email && u.eligible);

    if (!user) {
      throw new ApiError('No elegible', 'http', 404);
    }

    // El contrato de S4: email + displayLabel, SIN userId.
    return { email: user.email, displayLabel: user.displayLabel };
  }

  if (method === 'POST' && path === '/admin/issuers') {
    const body = options.body as {
      name: string;
      legalName: string;
      initialAdminUserEmail: string;
    };
    const user = backend.users.find(
      (u) => u.email === body.initialAdminUserEmail && u.eligible
    );

    if (!user) {
      throw new ApiError('No elegible', 'http', 404);
    }

    backend.sequence += 1;
    const membership: FakeMembership = {
      userId: user.id,
      role: 'admin',
      status: 'active',
      createdAt: '2026-10-05T11:00:00.000Z'
    };
    const issuer: FakeIssuer = {
      id: `issuer-nuevo-${backend.sequence}`,
      name: body.name,
      legalName: body.legalName,
      memberships: [membership]
    };
    backend.issuers.push(issuer);

    return {
      issuer: {
        id: issuer.id,
        name: issuer.name,
        legalName: issuer.legalName,
        authorizationStatus: 'authorized',
        technicalIdentity: {
          didConfigured: false,
          walletConfigured: false,
          readyToIssue: false
        },
        createdAt: '2026-10-05T11:00:00.000Z'
      },
      initialAdminMembership: membershipDto(issuer, membership)
    };
  }

  throw new ApiError(`Ruta no enrutada: ${method} ${path}`, 'http', 404);
}

beforeEach(() => {
  router.replace.mockClear();
  session.retry.mockClear();
  backend = {
    users: [{ ...ACTOR_A }, { ...ACTOR_C }],
    issuers: [],
    calls: [],
    sequence: 0
  };
  session.requestAuthenticated.mockImplementation(
    (path: string, options: { method?: string; body?: unknown } = {}) =>
      fakeTransport(path, options)
  );
});

function callsTo(method: string, pathPattern: RegExp) {
  return backend.calls.filter(
    (call) => call.method === method && pathPattern.test(call.path)
  );
}

// ---------------------------------------------------------------------------
// FLOW B integrado: crear institucion
// ---------------------------------------------------------------------------

describe('S7a/web -- crear institucion desde /admin, integrado', () => {
  it('padron vacio -> crear -> resolver -> confirmar -> institucion nueva seleccionada con su admin', async () => {
    render(<AdminRoute />);

    // El padron arranca vacio y /admin ya ofrece dar de alta.
    await screen.findByText('No hay instituciones configuradas todavía.');
    expect(callsTo('GET', /^\/admin\/issuers$/)).toHaveLength(1);

    // ---- P abre el flujo de alta --------------------------------------
    screen.getByRole('button', { name: /Crear institución/ }).click();

    fireEvent.change(await screen.findByLabelText('Nombre'), {
      target: { value: 'Scope E2E Institute' }
    });
    fireEvent.change(screen.getByLabelText('Razón social'), {
      target: { value: 'Scope E2E Institute Test Entity' }
    });
    fireEvent.change(screen.getByLabelText('Email del primer administrador'), {
      target: { value: ACTOR_A.email }
    });

    // Abrir y tipear no muta nada.
    expect(callsTo('POST', /^\/admin\/issuers$/)).toHaveLength(0);

    // ---- S4: resolve ---------------------------------------------------
    screen.getByRole('button', { name: 'Buscar administrador' }).click();

    await screen.findByText('Nueva institución');
    // La persona se muestra con el contrato real de S4.
    expect(screen.getByText('Ana Institucional')).toBeTruthy();
    expect(screen.getByText(ACTOR_A.email)).toBeTruthy();

    const resolveCalls = callsTo('POST', /^\/admin\/users\/resolve$/);
    expect(resolveCalls).toHaveLength(1);
    expect(resolveCalls[0].body).toEqual({ email: ACTOR_A.email });
    // Todavia no se creo nada.
    expect(callsTo('POST', /^\/admin\/issuers$/)).toHaveLength(0);
    expect(backend.issuers).toHaveLength(0);

    // ---- S5b: confirmar ------------------------------------------------
    screen.getByRole('button', { name: 'Crear institución' }).click();

    await screen.findByText('Institución creada');

    const provisionCalls = callsTo('POST', /^\/admin\/issuers$/);
    expect(provisionCalls).toHaveLength(1);
    // El body EXACTO de S5b, armado por el admin-api real.
    expect(provisionCalls[0].body).toEqual({
      name: 'Scope E2E Institute',
      legalName: 'Scope E2E Institute Test Entity',
      initialAdminUserEmail: ACTOR_A.email
    });

    // ---- El refresh releyo la autoridad real ---------------------------
    await waitFor(() =>
      expect(callsTo('GET', /^\/admin\/issuers$/).length).toBeGreaterThan(1)
    );

    const newIssuerId = backend.issuers[0].id;

    // La institucion nueva quedo SELECCIONADA...
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: /Scope E2E Institute/ })
          .getAttribute('aria-current')
      ).toBe('true')
    );
    expect(
      screen.getByRole('heading', { level: 2, name: 'Scope E2E Institute' })
    ).toBeTruthy();

    // ...y sus memberships se cargaron por SU id.
    await waitFor(() =>
      expect(
        callsTo('GET', new RegExp(`^/admin/issuers/${newIssuerId}/memberships$`))
      ).toHaveLength(1)
    );

    // A aparece como administradora, traida por el refresh.
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Ana Institucional')).toBeTruthy();
    expect(within(table).getByText('Administrador')).toBeTruthy();
    expect(within(table).getByText('Activa')).toBeTruthy();

    // Y la institucion se muestra habilitada pero NO lista para emitir.
    expect(screen.getAllByText('Habilitada').length).toBeGreaterThan(0);
    expect(
      screen.getByText('Lista para emitir').parentElement?.textContent
    ).toContain('No');
  });

  it('el cliente nunca manda userId, role ni status en ninguna llamada', async () => {
    render(<AdminRoute />);
    await screen.findByText('No hay instituciones configuradas todavía.');

    screen.getByRole('button', { name: /Crear institución/ }).click();
    fireEvent.change(await screen.findByLabelText('Nombre'), {
      target: { value: 'Scope E2E Institute' }
    });
    fireEvent.change(screen.getByLabelText('Razón social'), {
      target: { value: 'Scope E2E Institute Test Entity' }
    });
    fireEvent.change(screen.getByLabelText('Email del primer administrador'), {
      target: { value: ACTOR_A.email }
    });
    screen.getByRole('button', { name: 'Buscar administrador' }).click();
    await screen.findByText('Nueva institución');
    screen.getByRole('button', { name: 'Crear institución' }).click();
    await screen.findByText('Institución creada');

    // Ninguna request del circuito lleva campos de autoridad.
    for (const call of backend.calls) {
      const serialized = JSON.stringify(call.body ?? {});
      for (const forbidden of [
        'userId',
        'role',
        'status',
        'authorizationStatus',
        'authorizedAt',
        'did',
        'walletAddress',
        'privateKey',
        'onboardingIntent',
        'metadata'
      ]) {
        expect(
          serialized,
          `${call.method} ${call.path} no debe llevar ${forbidden}`
        ).not.toContain(forbidden);
      }
    }

    // Y solo se usaron los cinco endpoints allowlisted.
    for (const call of backend.calls) {
      expect(['GET', 'POST']).toContain(call.method);
      expect(call.path.startsWith('/admin/')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// FLOW A integrado: agregar administrador a un issuer existente
// ---------------------------------------------------------------------------

describe('S7a/web -- agregar administrador a una institucion existente, integrado', () => {
  beforeEach(() => {
    backend.issuers = [
      {
        id: 'issuer-existente',
        name: 'Scope E2E Institute',
        legalName: 'Scope E2E Institute Test Entity',
        memberships: [
          {
            userId: ACTOR_A.id,
            role: 'admin',
            status: 'active',
            createdAt: '2026-10-05T10:00:00.000Z'
          }
        ]
      }
    ];
  });

  it('resolver C -> confirmar -> S5a -> el refresh lo muestra, y los counts suben leidos del backend', async () => {
    render(<AdminRoute />);

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Ana Institucional')).toBeTruthy();
    // Un solo miembro al empezar.
    const miembros = screen.getByRole('heading', { level: 3, name: 'Miembros' });
    expect(miembros.parentElement?.textContent).toContain('de 1');

    // ---- Agregar administrador ----------------------------------------
    screen.getByRole('button', { name: /Agregar administrador/ }).click();

    fireEvent.change(await screen.findByLabelText('Email de la persona'), {
      target: { value: ACTOR_C.email }
    });
    screen.getByRole('button', { name: 'Buscar persona' }).click();

    await screen.findByText('Persona encontrada');
    expect(screen.getByText('Carlos Personal')).toBeTruthy();
    // El rol se afirma DENTRO del panel de confirmacion: "Administrador"
    // tambien aparece en la tabla como rol de A, asi que la query se acota.
    const rolTerm = screen.getByText('Rol que recibirá');
    expect(rolTerm.parentElement?.textContent).toContain('Administrador');

    // Nada mutado todavia.
    expect(
      callsTo('POST', /^\/admin\/issuers\/.+\/memberships$/)
    ).toHaveLength(0);

    // ---- Confirmar: S5a ------------------------------------------------
    screen.getByRole('button', { name: 'Confirmar asignación' }).click();

    await screen.findByText('Administrador agregado');

    const grantCalls = callsTo('POST', /^\/admin\/issuers\/.+\/memberships$/);
    expect(grantCalls).toHaveLength(1);
    expect(grantCalls[0].path).toBe('/admin/issuers/issuer-existente/memberships');
    // UN solo campo, y es el email que devolvio el backend.
    expect(grantCalls[0].body).toEqual({ userEmail: ACTOR_C.email });

    // ---- El refresh releyo las DOS lecturas ----------------------------
    await waitFor(() =>
      expect(callsTo('GET', /^\/admin\/issuers$/).length).toBeGreaterThan(1)
    );
    await waitFor(() =>
      expect(
        callsTo('GET', /^\/admin\/issuers\/issuer-existente\/memberships$/)
          .length
      ).toBeGreaterThan(1)
    );

    // C aparece porque lo trajo el refresh, no por un update optimista.
    const refreshed = await screen.findByRole('table');
    await waitFor(() =>
      expect(within(refreshed).getByText('Carlos Personal')).toBeTruthy()
    );

    // Y el contador subio porque lo dijo el backend.
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 3, name: 'Miembros' }).parentElement
          ?.textContent
      ).toContain('de 2')
    );
  });

  it('un segundo intento sobre la misma persona da 409 con el copy correcto', async () => {
    render(<AdminRoute />);
    await screen.findByRole('table');

    screen.getByRole('button', { name: /Agregar administrador/ }).click();
    fireEvent.change(await screen.findByLabelText('Email de la persona'), {
      // A ya es administradora de esta institucion.
      target: { value: ACTOR_A.email }
    });
    screen.getByRole('button', { name: 'Buscar persona' }).click();
    await screen.findByText('Persona encontrada');

    screen.getByRole('button', { name: 'Confirmar asignación' }).click();

    const message = await screen.findByText(
      'Esta persona ya tiene una membresía asociada a esta institución.'
    );

    // NUNCA se afirma que ya es administradora: podria ser otro rol o estar
    // revocada.
    expect(message.textContent).not.toContain('ya es administrador');
    // Ni se ofrece reactivar/reemplazar/forzar.
    for (const copy of ['Reactivar', 'Reemplazar', 'Forzar']) {
      expect(screen.queryByRole('button', { name: copy })).toBeNull();
    }
    // Un solo POST, y la membership no cambio.
    expect(
      callsTo('POST', /^\/admin\/issuers\/.+\/memberships$/)
    ).toHaveLength(1);
    expect(backend.issuers[0].memberships).toHaveLength(1);
  });

  it('un email no elegible da el 404 uniforme, sin filtrar el estado de la cuenta', async () => {
    render(<AdminRoute />);
    await screen.findByRole('table');

    screen.getByRole('button', { name: /Agregar administrador/ }).click();
    fireEvent.change(await screen.findByLabelText('Email de la persona'), {
      target: { value: 'nadie.e2e@example.test' }
    });
    screen.getByRole('button', { name: 'Buscar persona' }).click();

    const message = await screen.findByText(
      /No encontramos una cuenta activa disponible para ese email/
    );
    const text = (message.textContent ?? '').toLowerCase();
    for (const leak of ['suspend', 'archiv', 'pendiente', 'no existe']) {
      expect(text).not.toContain(leak);
    }
    // Y no se ofrece crear la cuenta.
    expect(screen.queryByRole('button', { name: /Crear usuario/ })).toBeNull();
  });
});

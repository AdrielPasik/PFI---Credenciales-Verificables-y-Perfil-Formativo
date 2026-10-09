import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IssuerShell } from '@/components/layout/issuer-shell';
import { IssuerRouteBoundary } from '@/features/issuer-context/issuer-route-boundary';
import { InstitutionalAccessPendingRoute } from '@/features/onboarding/institutional-access-pending-route';
import { IssuerTechnicalIdentityRoute } from '@/features/issuer-technical-identity/issuer-technical-identity-route';
import {
  listTechnicalAdminMemberships,
  resolveTechnicalIssuer
} from '@/features/issuer-technical-identity/technical-admin-memberships';
import {
  deriveIssuerContext,
  isOperationalIssuerMembership,
  type IssuerMembershipSummaryVM
} from '@/models/issuer-context';

const router = vi.hoisted(() => ({ replace: vi.fn() }));
const session = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/session/session-provider', () => ({
  useSession: () => session.value
}));

type Authorization = 'authorized' | 'pending' | 'revoked';
type Role = 'admin' | 'operator' | 'viewer';
type Status = 'active' | 'pending' | 'revoked';

function membership(
  reference: string,
  options: {
    role?: Role;
    status?: Status;
    authorization?: Authorization;
  } = {}
): IssuerMembershipSummaryVM {
  const authorization = options.authorization ?? 'authorized';
  return {
    issuerReference: reference,
    issuerName: `Institucion ${reference}`,
    issuerDid: null,
    issuerAuthorizationStatus: authorization,
    issuerAuthorizationLabel:
      authorization === 'authorized'
        ? 'Autorizada'
        : authorization === 'pending'
          ? 'Pendiente de autorizacion'
          : 'Autorizacion revocada',
    role: options.role ?? 'admin',
    roleLabel: 'Rol',
    status: options.status ?? 'active',
    operational: false
  };
}

const spies = {
  selectIssuer: vi.fn(),
  clearSelectedIssuer: vi.fn(),
  retry: vi.fn(),
  logout: vi.fn()
};

function technicalPayload(issuerId: string) {
  return {
    issuerId,
    issuerName: `Institucion ${issuerId}`,
    authorizationStatus: 'pending',
    allowedCredentialTypes: [],
    administrativelyAuthorized: false,
    configurationReady: false,
    hasCredentialCapabilities: false,
    readyToIssue: false,
    readinessReasons: ['ISSUER_NOT_AUTHORIZED'],
    technicalIdentity: null,
    assertionSigner: null,
    anchorSigner: null,
    blockchainTarget: {
      mode: 'mock',
      network: null,
      chainId: null,
      contractAddress: null,
      deploymentId: null
    }
  };
}

function setAuthenticatedSession(
  memberships: IssuerMembershipSummaryVM[],
  options: {
    selectedOperationalReference?: string | null;
    isPlatformAdmin?: boolean;
    onboardingIntent?: 'institutional' | 'personal' | null;
  } = {}
) {
  const request = vi.fn(async (path: string) =>
    technicalPayload(decodeURIComponent(path.split('/')[2]))
  );

  session.value = {
    state: {
      status: 'authenticated',
      currentUser: {
        userReference: 'user-1',
        email: 'admin@institucion.edu',
        did: null,
        displayLabel: 'Admin',
        isPlatformAdmin: options.isPlatformAdmin ?? false,
        onboardingIntent:
          options.onboardingIntent === undefined
            ? 'institutional'
            : options.onboardingIntent
      },
      issuerContext: deriveIssuerContext(
        memberships,
        options.selectedOperationalReference ?? null
      )
    },
    requestAuthenticated: request,
    ...spies
  };

  return request;
}

function setSessionStatus(status: string) {
  const request = vi.fn();
  session.value = {
    state: { status },
    requestAuthenticated: request,
    ...spies
  };
  return request;
}

beforeEach(() => {
  router.replace.mockClear();
  Object.values(spies).forEach((spy) => spy.mockClear());
});

const requestedPaths = (request: ReturnType<typeof vi.fn>) =>
  request.mock.calls.map(([path]) => String(path));

describe('acceso a la configuracion tecnica', () => {
  it('un admin ACTIVO de un issuer AUTORIZADO accede', async () => {
    const request = setAuthenticatedSession([membership('issuer-a')]);
    render(<IssuerTechnicalIdentityRoute />);

    expect(await screen.findByText('Configuración técnica')).toBeTruthy();
    expect(requestedPaths(request)).toEqual([
      '/issuers/issuer-a/technical-identity'
    ]);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('un admin ACTIVO de un issuer NO autorizado accede, y el encabezado no dice "Institución activa"', async () => {
    for (const authorization of ['pending', 'revoked'] as const) {
      router.replace.mockClear();
      const request = setAuthenticatedSession([
        membership('issuer-u', { authorization })
      ]);
      const { unmount } = render(<IssuerTechnicalIdentityRoute />);

      expect(await screen.findByText('Configuración técnica')).toBeTruthy();
      expect(requestedPaths(request)).toEqual([
        '/issuers/issuer-u/technical-identity'
      ]);
      expect(router.replace).not.toHaveBeenCalled();
      // El rotulo muestra el estado administrativo REAL.
      expect(screen.queryByText('Institución activa')).toBeNull();
      expect(
        screen.getByText(/Configuración técnica · (Pendiente|Autorizacion)/)
      ).toBeTruthy();
      unmount();
    }
  });

  it('un admin NO activo (pendiente / revocado) es rechazado sin consultar la API', () => {
    for (const status of ['pending', 'revoked'] as const) {
      router.replace.mockClear();
      const request = setAuthenticatedSession([membership('issuer-a', { status })]);
      const { unmount } = render(<IssuerTechnicalIdentityRoute />);

      expect(router.replace).toHaveBeenCalledWith('/');
      expect(request).not.toHaveBeenCalled();
      expect(screen.queryByText('Configuración técnica')).toBeNull();
      unmount();
    }
  });

  it('operator y viewer son rechazados, incluso en un issuer autorizado', () => {
    for (const role of ['operator', 'viewer'] as const) {
      router.replace.mockClear();
      const request = setAuthenticatedSession([membership('issuer-a', { role })]);
      const { unmount } = render(<IssuerTechnicalIdentityRoute />);

      expect(router.replace).toHaveBeenCalledWith('/');
      expect(request).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('un PlatformAdmin SIN membership no recibe bypass', () => {
    const request = setAuthenticatedSession([], { isPlatformAdmin: true });
    render(<IssuerTechnicalIdentityRoute />);

    expect(router.replace).toHaveBeenCalledWith('/');
    expect(request).not.toHaveBeenCalled();
  });

  it('mientras la sesion se resuelve NO concluye "sin acceso"', () => {
    for (const status of ['booting', 'authenticating', 'resolving-context']) {
      router.replace.mockClear();
      const request = setSessionStatus(status);
      const { unmount } = render(<IssuerTechnicalIdentityRoute />);

      expect(router.replace).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('sesion no autenticada / vencida va a /login', () => {
    for (const status of ['unauthenticated', 'expired']) {
      router.replace.mockClear();
      setSessionStatus(status);
      const { unmount } = render(<IssuerTechnicalIdentityRoute />);

      expect(router.replace).toHaveBeenCalledWith('/login');
      unmount();
    }
  });

  it('varios admins elegibles: elige el correcto y pasa SU id al cliente', async () => {
    const request = setAuthenticatedSession([
      membership('issuer-a', { authorization: 'pending' }),
      membership('issuer-b', { authorization: 'revoked' })
    ]);
    render(<IssuerTechnicalIdentityRoute />);

    // Sin seleccion explicita no hay consulta.
    const selector = (await screen.findByLabelText('Institución')) as HTMLSelectElement;
    expect(request).not.toHaveBeenCalled();

    fireEvent.change(selector, { target: { value: 'issuer-b' } });
    await waitFor(() =>
      expect(requestedPaths(request)).toEqual([
        '/issuers/issuer-b/technical-identity'
      ])
    );

    fireEvent.change(selector, { target: { value: 'issuer-a' } });
    await waitFor(() =>
      expect(requestedPaths(request)).toEqual([
        '/issuers/issuer-b/technical-identity',
        '/issuers/issuer-a/technical-identity'
      ])
    );
  });

  it('el selector solo ofrece candidatos elegibles', async () => {
    setAuthenticatedSession([
      membership('issuer-a', { authorization: 'pending' }),
      membership('issuer-b'),
      membership('issuer-op', { role: 'operator' }),
      membership('issuer-vw', { role: 'viewer' }),
      membership('issuer-in', { status: 'pending' })
    ]);
    render(<IssuerTechnicalIdentityRoute />);

    const selector = (await screen.findByLabelText('Institución')) as HTMLSelectElement;
    expect(Array.from(selector.options).map((o) => o.value).filter(Boolean)).toEqual([
      'issuer-a',
      'issuer-b'
    ]);
  });

  it('elegir un issuer tecnico NO muta la seleccion operativa global', async () => {
    setAuthenticatedSession(
      [
        membership('issuer-a', { authorization: 'pending' }),
        membership('issuer-b')
      ],
      { selectedOperationalReference: null }
    );
    render(<IssuerTechnicalIdentityRoute />);

    fireEvent.change(await screen.findByLabelText('Institución'), {
      target: { value: 'issuer-a' }
    });
    await screen.findByText('Configuración técnica');

    expect(spies.selectIssuer).not.toHaveBeenCalled();
    expect(spies.clearSelectedIssuer).not.toHaveBeenCalled();
    // Y el boton "Cambiar institucion" (contexto operativo) no se ofrece.
    expect(screen.queryByText(/Cambiar instituci/)).toBeNull();
  });

  it('no usa el issuer operativo global si NO es candidato tecnico', async () => {
    // El operativo es X (operator); el unico admin es Y.
    const request = setAuthenticatedSession(
      [
        membership('issuer-x', { role: 'operator' }),
        membership('issuer-y', { authorization: 'pending' })
      ],
      { selectedOperationalReference: 'issuer-x' }
    );
    render(<IssuerTechnicalIdentityRoute />);

    await screen.findByText('Configuración técnica');
    expect(requestedPaths(request)).toEqual([
      '/issuers/issuer-y/technical-identity'
    ]);
  });

  it('una seleccion local que deja de ser elegible se DESCARTA', async () => {
    setAuthenticatedSession([
      membership('issuer-a', { authorization: 'pending' }),
      membership('issuer-b', { authorization: 'pending' })
    ]);
    const { rerender } = render(<IssuerTechnicalIdentityRoute />);
    fireEvent.change(await screen.findByLabelText('Institución'), {
      target: { value: 'issuer-a' }
    });
    await screen.findByText('Configuración técnica');

    // La membership de A deja de ser admin activa; aparece C. Quedan B y C.
    const request = setAuthenticatedSession([
      membership('issuer-a', { role: 'viewer' }),
      membership('issuer-b', { authorization: 'pending' }),
      membership('issuer-c', { authorization: 'pending' })
    ]);
    rerender(<IssuerTechnicalIdentityRoute />);

    // Hay que elegir de nuevo: no se conserva A, y no se consulto A.
    const selector = (await screen.findByLabelText('Institución')) as HTMLSelectElement;
    expect(selector.value).toBe('');
    expect(requestedPaths(request).some((p) => p.includes('issuer-a'))).toBe(false);
  });

  it('si queda UN solo elegible, se selecciona ese', async () => {
    setAuthenticatedSession([
      membership('issuer-a', { authorization: 'pending' }),
      membership('issuer-b', { authorization: 'pending' })
    ]);
    const { rerender } = render(<IssuerTechnicalIdentityRoute />);
    fireEvent.change(await screen.findByLabelText('Institución'), {
      target: { value: 'issuer-a' }
    });
    await screen.findByText('Configuración técnica');

    const request = setAuthenticatedSession([
      membership('issuer-a', { status: 'revoked' }),
      membership('issuer-b', { authorization: 'pending' })
    ]);
    rerender(<IssuerTechnicalIdentityRoute />);

    await waitFor(() =>
      expect(requestedPaths(request)).toEqual([
        '/issuers/issuer-b/technical-identity'
      ])
    );
  });

  it('el health NUNCA se llama en el render inicial', async () => {
    const request = setAuthenticatedSession([
      membership('issuer-a', { authorization: 'pending' })
    ]);
    render(<IssuerTechnicalIdentityRoute />);

    await screen.findByText('Configuración técnica');
    expect(requestedPaths(request).some((p) => p.includes('network-health'))).toBe(
      false
    );
  });
});

describe('resolveTechnicalIssuer (puro)', () => {
  const a = membership('issuer-a');
  const b = membership('issuer-b');

  it('cubre las reglas de decision', () => {
    expect(
      resolveTechnicalIssuer({ candidates: [], localSelectionReference: 'x', globalSelectedReference: 'x' })
    ).toEqual({ kind: 'none' });
    expect(
      resolveTechnicalIssuer({ candidates: [a], localSelectionReference: 'zzz', globalSelectedReference: null })
    ).toEqual({ kind: 'selected', membership: a });
    expect(
      resolveTechnicalIssuer({ candidates: [a, b], localSelectionReference: 'issuer-b', globalSelectedReference: 'issuer-a' })
    ).toEqual({ kind: 'selected', membership: b });
    expect(
      resolveTechnicalIssuer({ candidates: [a, b], localSelectionReference: 'stale', globalSelectedReference: 'issuer-a' })
    ).toEqual({ kind: 'selected', membership: a });
    expect(
      resolveTechnicalIssuer({ candidates: [a, b], localSelectionReference: 'stale', globalSelectedReference: 'not-candidate' })
    ).toEqual({ kind: 'selection-required' });
  });

  it('listTechnicalAdminMemberships: active + admin, sin duplicados, sin mirar autorizacion', () => {
    const result = listTechnicalAdminMemberships([
      membership('issuer-a', { authorization: 'revoked' }),
      membership('issuer-a', { authorization: 'revoked' }),
      membership('issuer-b', { role: 'operator' }),
      membership('issuer-c', { status: 'pending' })
    ]);
    expect(result.map((m) => m.issuerReference)).toEqual(['issuer-a']);
  });
});

describe('enlace desde /institutional-access-pending', () => {
  const link = () =>
    screen
      .queryAllByRole('link')
      .find((a) => a.getAttribute('href') === '/issuer/configuracion-tecnica');

  it('aparece para un admin activo de un issuer no autorizado', () => {
    setAuthenticatedSession([membership('issuer-u', { authorization: 'pending' })]);
    render(<InstitutionalAccessPendingRoute />);

    expect(link()).toBeTruthy();
    expect(screen.getByText(/Institucion issuer-u/)).toBeTruthy();
  });

  it('NO aparece para operator, viewer, membership inactiva ni sin membership', () => {
    const cases: IssuerMembershipSummaryVM[][] = [
      [membership('i', { role: 'operator', authorization: 'pending' })],
      [membership('i', { role: 'viewer', authorization: 'pending' })],
      [membership('i', { status: 'pending', authorization: 'pending' })],
      [membership('i', { status: 'revoked', authorization: 'pending' })],
      []
    ];
    for (const memberships of cases) {
      setAuthenticatedSession(memberships);
      const { unmount } = render(<InstitutionalAccessPendingRoute />);
      expect(link()).toBeUndefined();
      unmount();
    }
  });

  it('un PlatformAdmin sin membership no ve el enlace', () => {
    setAuthenticatedSession([], { isPlatformAdmin: true });
    render(<InstitutionalAccessPendingRoute />);
    expect(link()).toBeUndefined();
  });

  it('no cambia el routing global de la pantalla', () => {
    setAuthenticatedSession([membership('issuer-u', { authorization: 'pending' })]);
    render(<InstitutionalAccessPendingRoute />);
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('las rutas operativas no cambian', () => {
  it('un admin activo de un issuer NO autorizado sigue sin ser operativo', () => {
    const pendingAdmin = membership('issuer-u', { authorization: 'pending' });
    expect(isOperationalIssuerMembership(pendingAdmin)).toBe(false);

    const context = deriveIssuerContext([pendingAdmin], null);
    expect(context.kind).toBe('none');
    expect(context.operationalIssuerContexts).toEqual([]);
  });

  it('IssuerRouteBoundary sigue rechazando a ese admin: redirige y no renderiza hijos', () => {
    setAuthenticatedSession([membership('issuer-u', { authorization: 'pending' })]);
    const children = vi.fn(() => <p>CONTENIDO OPERATIVO</p>);

    render(<IssuerRouteBoundary>{children}</IssuerRouteBoundary>);

    expect(router.replace).toHaveBeenCalledWith('/');
    expect(children).not.toHaveBeenCalled();
    expect(screen.queryByText('CONTENIDO OPERATIVO')).toBeNull();
  });

  it('el boundary operativo sigue mostrando "Institución activa"', () => {
    setAuthenticatedSession([membership('issuer-a')]);
    render(
      <IssuerRouteBoundary>{() => <p>contenido</p>}</IssuerRouteBoundary>
    );

    expect(screen.getByText('Institución activa')).toBeTruthy();
  });

  it('IssuerShell conserva su rotulo por defecto', () => {
    render(
      <IssuerShell
        label="x"
        issuerName="UADE"
        canChangeIssuer={false}
        onChangeIssuer={() => undefined}
        onLogout={() => undefined}
      >
        <p>c</p>
      </IssuerShell>
    );

    expect(screen.getByText('Institución activa')).toBeTruthy();
  });
});

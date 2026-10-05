import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminContent } from '@/features/admin/admin-route';
import { ApiError, IncompatiblePayloadError } from '@/lib/errors/api-error';
import type {
  AdminIssuerMembershipsVM,
  AdminIssuerVM,
  AdminMembershipVM
} from '@/models/platform-admin';

const api = vi.hoisted(() => ({
  getIssuers: vi.fn(),
  getMemberships: vi.fn()
}));
const session = vi.hoisted(() => ({
  requestAuthenticated: vi.fn(),
  retry: vi.fn()
}));

vi.mock('@/lib/api/admin-api', () => ({
  getAdminIssuersRequest: (...args: unknown[]) => api.getIssuers(...args),
  getAdminIssuerMembershipsRequest: (...args: unknown[]) =>
    api.getMemberships(...args)
}));
vi.mock('@/lib/session/session-provider', () => ({
  useSession: () => ({
    requestAuthenticated: session.requestAuthenticated,
    retry: session.retry
  })
}));

// ---------------------------------------------------------------------------
// Fixtures de view model
// ---------------------------------------------------------------------------

function issuer(overrides: Partial<AdminIssuerVM> = {}): AdminIssuerVM {
  return {
    issuerReference: 'issuer-uade',
    name: 'Universidad Argentina de la Empresa',
    legalName: 'UADE S.A.',
    authorizationStatus: 'authorized',
    authorizationLabel: 'Habilitada',
    technicalIdentity: {
      didConfigured: true,
      walletConfigured: true,
      readyToIssue: true,
      readinessLabel: 'Lista'
    },
    membershipCounts: { active: 3, total: 5, summaryLabel: '3 activos de 5' },
    catalogCounts: {
      academicCourses: 42,
      programs: 4,
      curriculumVersions: 6,
      programCourses: 120
    },
    createdAtLabel: '15 ene 2026, 10:30',
    ...overrides
  };
}

/** Una institución recién provisionada por S5b. */
const provisioned = issuer({
  issuerReference: 'issuer-nuevo',
  name: 'Universidad X',
  legalName: 'Universidad X',
  authorizationStatus: 'authorized',
  authorizationLabel: 'Habilitada',
  technicalIdentity: {
    didConfigured: false,
    walletConfigured: false,
    readyToIssue: false,
    readinessLabel: 'Pendiente'
  },
  membershipCounts: { active: 1, total: 1, summaryLabel: '1 activos de 1' },
  catalogCounts: {
    academicCourses: 0,
    programs: 0,
    curriculumVersions: 0,
    programCourses: 0
  }
});

function membership(
  overrides: Partial<AdminMembershipVM> = {}
): AdminMembershipVM {
  return {
    userReference: 'user-juan',
    email: 'juan@uade.edu.ar',
    displayLabel: 'Juan Pérez',
    role: 'admin',
    roleLabel: 'Administrador',
    status: 'active',
    statusLabel: 'Activa',
    createdAtLabel: '1 feb 2026, 09:00',
    ...overrides
  };
}

function membershipsFor(
  issuerReference: string,
  items: AdminMembershipVM[]
): AdminIssuerMembershipsVM {
  return {
    issuer: { issuerReference, name: `nombre-${issuerReference}` },
    items
  };
}

/** Promesa que se resuelve cuando el test lo decide. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function issuerButton(name: string | RegExp) {
  return screen.getByRole('button', { name });
}

beforeEach(() => {
  api.getIssuers.mockReset();
  api.getMemberships.mockReset();
  session.retry.mockReset();
  api.getMemberships.mockResolvedValue(
    membershipsFor('issuer-uade', [membership()])
  );
});

// ---------------------------------------------------------------------------
// LISTADO
// ---------------------------------------------------------------------------

describe('AdminContent: listado de instituciones', () => {
  it('1: muestra un loading mientras carga el padrón', async () => {
    api.getIssuers.mockReturnValue(deferred().promise);
    render(<AdminContent />);

    expect(screen.getByText('Cargando instituciones')).toBeTruthy();
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('2: cero instituciones muestra el empty state, sin botón de crear', async () => {
    api.getIssuers.mockResolvedValue({ items: [] });
    render(<AdminContent />);

    await screen.findByText('No hay instituciones configuradas todavía.');
    // S6a es lectura pura: el alta es S6b.
    expect(screen.queryByRole('button', { name: /Crear/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Agregar/ })).toBeNull();
    expect(api.getMemberships).not.toHaveBeenCalled();
  });

  it('3: una institución se renderiza', async () => {
    api.getIssuers.mockResolvedValue({ items: [issuer()] });
    render(<AdminContent />);

    await screen.findByText('Instituciones (1)');
    expect(
      issuerButton(/Universidad Argentina de la Empresa/)
    ).toBeTruthy();
  });

  it('4: múltiples instituciones se renderizan todas', async () => {
    api.getIssuers.mockResolvedValue({
      items: [
        issuer(),
        issuer({ issuerReference: 'issuer-utn', name: 'UTN' }),
        provisioned
      ]
    });
    render(<AdminContent />);

    await screen.findByText('Instituciones (3)');
    expect(issuerButton(/Universidad Argentina de la Empresa/)).toBeTruthy();
    expect(issuerButton(/UTN/)).toBeTruthy();
    expect(issuerButton(/Universidad X/)).toBeTruthy();
  });

  it('5: se conserva el orden determinista del backend', async () => {
    api.getIssuers.mockResolvedValue({
      items: [
        issuer({ issuerReference: 'z', name: 'Zeta' }),
        issuer({ issuerReference: 'a', name: 'Alfa' }),
        issuer({ issuerReference: 'm', name: 'Mu' })
      ]
    });
    render(<AdminContent />);

    await screen.findByText('Instituciones (3)');
    const items = screen.getAllByRole('listitem');
    // El nombre es lo primero del boton; despues vienen razon social, badges y
    // conteos, asi que se compara por prefijo y no por un corte fijo.
    const esperado = ['Zeta', 'Alfa', 'Mu'];
    expect(items).toHaveLength(3);
    items.forEach((item, index) => {
      expect(
        item.textContent?.startsWith(esperado[index]),
        `la posicion ${index} deberia ser ${esperado[index]}`
      ).toBe(true);
    });
  });

  it('6: muestra name y legalName cuando difieren, y no repite si son iguales', async () => {
    api.getIssuers.mockResolvedValue({
      items: [issuer(), provisioned]
    });
    render(<AdminContent />);

    await screen.findByText('Instituciones (2)');
    // legalName distinto -> se muestra (en la lista y en el detalle).
    expect(screen.getAllByText('UADE S.A.').length).toBeGreaterThan(0);
    // legalName igual al name -> no se duplica dentro del botón de la lista.
    const provisionedItem = issuerButton(/Universidad X/);
    expect(
      within(provisionedItem).getAllByText('Universidad X')
    ).toHaveLength(1);
  });

  it('legalName null se presenta como ausencia, nunca como ""', async () => {
    api.getIssuers.mockResolvedValue({
      items: [issuer({ legalName: null })]
    });
    render(<AdminContent />);

    await screen.findByText('Sin razón social registrada');
  });

  it('7: NO presenta la habilitación como "verificada"', async () => {
    api.getIssuers.mockResolvedValue({
      items: [
        issuer(),
        issuer({
          issuerReference: 'issuer-pendiente',
          name: 'Pendiente',
          authorizationStatus: 'pending',
          authorizationLabel: 'Pendiente de habilitación'
        })
      ]
    });
    const { container } = render(<AdminContent />);

    await screen.findByText('Instituciones (2)');
    const text = (container.textContent ?? '').toLowerCase();

    for (const prohibida of [
      'verificada',
      'verificado',
      'institución verificada',
      'validada',
      'acreditada',
      'verified'
    ]) {
      expect(text, `no debe decir "${prohibida}"`).not.toContain(prohibida);
    }
    // Y sí dice lo que authorized realmente significa.
    expect(screen.getByText('Estado operativo')).toBeTruthy();
  });

  it('8: muestra los tres booleanos de identidad técnica', async () => {
    api.getIssuers.mockResolvedValue({ items: [issuer()] });
    render(<AdminContent />);

    await screen.findByText('Identidad técnica');
    for (const label of [
      'DID configurado',
      'Wallet configurada',
      'Lista para emitir'
    ]) {
      const term = screen.getByText(label);
      expect(term.parentElement?.textContent).toContain('Sí');
    }
  });

  it('8: el issuer de S5b se muestra habilitado y con emisión pendiente, sin error', async () => {
    api.getIssuers.mockResolvedValue({ items: [provisioned] });
    const { container } = render(<AdminContent />);

    await screen.findByText('Identidad técnica');

    // Habilitada operativamente...
    expect(screen.getAllByText('Habilitada').length).toBeGreaterThan(0);
    // ...y los tres booleanos en No.
    for (const label of [
      'DID configurado',
      'Wallet configurada',
      'Lista para emitir'
    ]) {
      expect(screen.getByText(label).parentElement?.textContent).toContain(
        'No'
      );
    }
    // Sin lenguaje de error para un estado legítimo.
    expect((container.textContent ?? '').toLowerCase()).not.toContain('error');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('9: muestra los conteos de miembros y de catálogo', async () => {
    api.getIssuers.mockResolvedValue({ items: [issuer()] });
    render(<AdminContent />);

    await screen.findByText('Catálogo');
    expect(screen.getByText('Cursos').parentElement?.textContent).toContain(
      '42'
    );
    expect(screen.getByText('Programas').parentElement?.textContent).toContain(
      '4'
    );
    expect(
      screen.getByText('Versiones curriculares').parentElement?.textContent
    ).toContain('6');
    expect(
      screen.getByText('Relaciones programa-curso').parentElement?.textContent
    ).toContain('120');

    // Miembros, en el panel de detalle: "3 de 5".
    const miembros = screen.getByRole('heading', {
      level: 3,
      name: 'Miembros'
    });
    expect(miembros.parentElement?.textContent).toContain('3');
    expect(miembros.parentElement?.textContent).toContain('de 5');
  });

  it('10: NO muestra el valor del DID ni de la walletAddress', async () => {
    api.getIssuers.mockResolvedValue({ items: [issuer()] });
    const { container } = render(<AdminContent />);

    await screen.findByText('Identidad técnica');
    const text = container.textContent ?? '';

    expect(text).not.toContain('did:');
    expect(text).not.toContain('0x');
  });
});

// ---------------------------------------------------------------------------
// SELECCIÓN
// ---------------------------------------------------------------------------

describe('AdminContent: selección', () => {
  it('1: la primera institución queda seleccionada por defecto', async () => {
    api.getIssuers.mockResolvedValue({
      items: [issuer(), issuer({ issuerReference: 'issuer-utn', name: 'UTN' })]
    });
    render(<AdminContent />);

    await waitFor(() =>
      expect(
        issuerButton(/Universidad Argentina de la Empresa/).getAttribute(
          'aria-current'
        )
      ).toBe('true')
    );
    expect(issuerButton(/UTN/).getAttribute('aria-current')).toBeNull();
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Universidad Argentina de la Empresa'
      })
    ).toBeTruthy();
  });

  it('2-3: al hacer click en la segunda cambia la selección y pide SUS memberships', async () => {
    api.getIssuers.mockResolvedValue({
      items: [issuer(), issuer({ issuerReference: 'issuer-utn', name: 'UTN' })]
    });
    render(<AdminContent />);

    await waitFor(() => expect(api.getMemberships).toHaveBeenCalledTimes(1));
    expect(api.getMemberships.mock.calls[0][1]).toBe('issuer-uade');

    issuerButton(/UTN/).click();

    await waitFor(() =>
      expect(issuerButton(/UTN/).getAttribute('aria-current')).toBe('true')
    );
    await waitFor(() => expect(api.getMemberships).toHaveBeenCalledTimes(2));
    expect(api.getMemberships.mock.calls[1][1]).toBe('issuer-utn');
    expect(
      screen.getByRole('heading', { level: 2, name: 'UTN' })
    ).toBeTruthy();
  });

  it('4: cambiar de selección NO vuelve a pedir el padrón', async () => {
    api.getIssuers.mockResolvedValue({
      items: [issuer(), issuer({ issuerReference: 'issuer-utn', name: 'UTN' })]
    });
    render(<AdminContent />);

    await waitFor(() => expect(api.getIssuers).toHaveBeenCalledTimes(1));

    issuerButton(/UTN/).click();
    await waitFor(() => expect(api.getMemberships).toHaveBeenCalledTimes(2));

    expect(api.getIssuers).toHaveBeenCalledTimes(1);
  });

  it('volver a clickear la institución ya seleccionada no re-pide nada', async () => {
    api.getIssuers.mockResolvedValue({ items: [issuer()] });
    render(<AdminContent />);

    await waitFor(() => expect(api.getMemberships).toHaveBeenCalledTimes(1));

    issuerButton(/Universidad Argentina de la Empresa/).click();
    issuerButton(/Universidad Argentina de la Empresa/).click();

    await waitFor(() => expect(api.getMemberships).toHaveBeenCalledTimes(1));
  });

  it('5: una respuesta tardía del issuer ANTERIOR no se pinta como la del nuevo', async () => {
    api.getIssuers.mockResolvedValue({
      items: [issuer(), issuer({ issuerReference: 'issuer-utn', name: 'UTN' })]
    });

    const first = deferred<AdminIssuerMembershipsVM>();
    const second = deferred<AdminIssuerMembershipsVM>();
    api.getMemberships
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    render(<AdminContent />);

    await waitFor(() => expect(api.getMemberships).toHaveBeenCalledTimes(1));

    // Cambio de selección ANTES de que llegue la primera respuesta.
    issuerButton(/UTN/).click();
    await waitFor(() => expect(api.getMemberships).toHaveBeenCalledTimes(2));

    // Ahora llega la del issuer anterior, TARDE.
    first.resolve(
      membershipsFor('issuer-uade', [
        membership({
          userReference: 'user-vieja',
          displayLabel: 'Persona de UADE',
          email: 'vieja@uade.edu.ar'
        })
      ])
    );
    // Y después la correcta.
    second.resolve(
      membershipsFor('issuer-utn', [
        membership({
          userReference: 'user-nueva',
          displayLabel: 'Persona de UTN',
          email: 'nueva@utn.edu.ar'
        })
      ])
    );

    await screen.findByText('Persona de UTN');
    // La tardía nunca se muestra.
    expect(screen.queryByText('Persona de UADE')).toBeNull();
  });

  it('la request abandonada se aborta', async () => {
    api.getIssuers.mockResolvedValue({
      items: [issuer(), issuer({ issuerReference: 'issuer-utn', name: 'UTN' })]
    });
    api.getMemberships.mockReturnValue(
      deferred<AdminIssuerMembershipsVM>().promise
    );
    render(<AdminContent />);

    await waitFor(() => expect(api.getMemberships).toHaveBeenCalledTimes(1));
    const firstSignal = api.getMemberships.mock.calls[0][2].signal;
    expect(firstSignal.aborted).toBe(false);

    issuerButton(/UTN/).click();

    await waitFor(() => expect(firstSignal.aborted).toBe(true));
  });
});

// ---------------------------------------------------------------------------
// MEMBERSHIPS
// ---------------------------------------------------------------------------

describe('AdminContent: memberships', () => {
  beforeEach(() => {
    api.getIssuers.mockResolvedValue({ items: [issuer()] });
  });

  it('1: el loading de memberships es LOCAL: el listado sigue en pantalla', async () => {
    api.getMemberships.mockReturnValue(
      deferred<AdminIssuerMembershipsVM>().promise
    );
    render(<AdminContent />);

    await screen.findByText('Cargando personas con acceso');
    // El padrón y el detalle del issuer NO desaparecen.
    expect(screen.getByText('Instituciones (1)')).toBeTruthy();
    expect(screen.getByText('Identidad técnica')).toBeTruthy();
  });

  it('2: un issuer sin miembros muestra su empty state', async () => {
    api.getMemberships.mockResolvedValue(membershipsFor('issuer-uade', []));
    render(<AdminContent />);

    await screen.findByText(
      'No hay miembros asociados a esta institución.'
    );
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('3-5: muestra los tres roles y los tres estados, incluidas las NO activas', async () => {
    api.getMemberships.mockResolvedValue(
      membershipsFor('issuer-uade', [
        membership(),
        membership({
          userReference: 'user-operador',
          displayLabel: 'Ana Gómez',
          email: 'ana@uade.edu.ar',
          role: 'operator',
          roleLabel: 'Operador',
          status: 'pending',
          statusLabel: 'Pendiente'
        }),
        membership({
          userReference: 'user-viewer',
          displayLabel: 'Luis Díaz',
          email: 'luis@uade.edu.ar',
          role: 'viewer',
          roleLabel: 'Solo lectura',
          status: 'revoked',
          statusLabel: 'Revocada'
        })
      ])
    );
    render(<AdminContent />);

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    // Encabezado + tres filas.
    expect(rows).toHaveLength(4);

    // Las no activas NO se esconden: /admin es diagnóstico.
    expect(within(table).getByText('Administrador')).toBeTruthy();
    expect(within(table).getByText('Operador')).toBeTruthy();
    expect(within(table).getByText('Solo lectura')).toBeTruthy();
    expect(within(table).getByText('Activa')).toBeTruthy();
    expect(within(table).getByText('Pendiente')).toBeTruthy();
    expect(within(table).getByText('Revocada')).toBeTruthy();
  });

  it('6: email null se muestra como "Sin email", nunca vacío', async () => {
    api.getMemberships.mockResolvedValue(
      membershipsFor('issuer-uade', [
        membership({ userReference: 'user-sin-email', email: null })
      ])
    );
    render(<AdminContent />);

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Sin email')).toBeTruthy();
    // La membership se muestra igual: no se oculta por no tener email.
    expect(within(table).getByText('Juan Pérez')).toBeTruthy();
  });

  it('7: el displayLabel es el encabezado de cada fila', async () => {
    api.getMemberships.mockResolvedValue(
      membershipsFor('issuer-uade', [membership()])
    );
    render(<AdminContent />);

    const table = await screen.findByRole('table');
    expect(
      within(table).getByRole('rowheader', { name: 'Juan Pérez' })
    ).toBeTruthy();
    expect(within(table).getByText('juan@uade.edu.ar')).toBeTruthy();
  });

  it('8-9: un error de memberships es LOCAL, conserva el listado y ofrece reintentar', async () => {
    api.getMemberships.mockRejectedValueOnce(
      new ApiError('falló', 'network')
    );
    render(<AdminContent />);

    await screen.findByText('No pudimos cargar las personas con acceso');
    // El listado y la selección sobreviven.
    expect(screen.getByText('Instituciones (1)')).toBeTruthy();
    expect(
      issuerButton(/Universidad Argentina de la Empresa/).getAttribute(
        'aria-current'
      )
    ).toBe('true');

    api.getMemberships.mockResolvedValue(
      membershipsFor('issuer-uade', [membership()])
    );
    screen.getByRole('button', { name: 'Reintentar' }).click();

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Juan Pérez')).toBeTruthy();
    // El padrón no se volvió a pedir por reintentar memberships.
    expect(api.getIssuers).toHaveBeenCalledTimes(1);
  });

  it('10: cambiar de institución reemplaza las memberships anteriores', async () => {
    api.getIssuers.mockResolvedValue({
      items: [issuer(), issuer({ issuerReference: 'issuer-utn', name: 'UTN' })]
    });
    api.getMemberships
      .mockResolvedValueOnce(
        membershipsFor('issuer-uade', [
          membership({ displayLabel: 'Persona de UADE' })
        ])
      )
      .mockResolvedValueOnce(
        membershipsFor('issuer-utn', [
          membership({
            userReference: 'user-utn',
            displayLabel: 'Persona de UTN'
          })
        ])
      );
    render(<AdminContent />);

    await screen.findByText('Persona de UADE');

    issuerButton(/UTN/).click();

    await screen.findByText('Persona de UTN');
    expect(screen.queryByText('Persona de UADE')).toBeNull();
  });

  it('un payload incompatible de memberships informa sin romper el listado', async () => {
    api.getMemberships.mockRejectedValueOnce(new IncompatiblePayloadError());
    render(<AdminContent />);

    await screen.findByText('No pudimos cargar las personas con acceso');
    expect(
      screen.getByText(/no tiene el formato esperado/)
    ).toBeTruthy();
    expect(screen.getByText('Instituciones (1)')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// ERRORES DEL PADRÓN
// ---------------------------------------------------------------------------

describe('AdminContent: errores del padrón', () => {
  it('un fallo de red muestra error con retry, y el retry recarga', async () => {
    api.getIssuers.mockRejectedValueOnce(new ApiError('sin red', 'network'));
    render(<AdminContent />);

    await screen.findByText('No pudimos cargar las instituciones');
    expect(screen.getByRole('alert')).toBeTruthy();

    api.getIssuers.mockResolvedValue({ items: [issuer()] });
    screen.getByRole('button', { name: 'Reintentar' }).click();

    await screen.findByText('Instituciones (1)');
    expect(api.getIssuers).toHaveBeenCalledTimes(2);
  });

  it('un payload incompatible informa el formato, no un fallo genérico', async () => {
    api.getIssuers.mockRejectedValueOnce(new IncompatiblePayloadError());
    render(<AdminContent />);

    await screen.findByText('No pudimos cargar las instituciones');
    expect(screen.getByText(/no tiene el formato esperado/)).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // 403: sesión de PlatformAdmin obsoleta
  // -------------------------------------------------------------------------

  it('un 403 NO ofrece reintentar los datos: ofrece revalidar la sesión', async () => {
    // El backend ya negó la capacidad. Repetir el GET daría 403 otra vez, así
    // que un retry de datos sería un bucle inútil.
    api.getIssuers.mockRejectedValueOnce(
      new ApiError('rechazado', 'http', 403)
    );
    render(<AdminContent />);

    await screen.findByText(
      'La administración de plataforma no está disponible para esta sesión'
    );
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();

    const revalidate = screen.getByRole('button', {
      name: 'Revalidar sesión',
    });
    revalidate.click();

    // Usa el mecanismo de sesión existente (`GET /auth/me`), no un recovery
    // paralelo.
    await waitFor(() => expect(session.retry).toHaveBeenCalledTimes(1));
    expect(api.getIssuers).toHaveBeenCalledTimes(1);
  });

  it('un 403 en memberships también ofrece revalidar, no reintentar', async () => {
    api.getIssuers.mockResolvedValue({ items: [issuer()] });
    api.getMemberships.mockRejectedValueOnce(
      new ApiError('rechazado', 'http', 403)
    );
    render(<AdminContent />);

    await screen.findByText(
      'La administración de plataforma no está disponible para esta sesión'
    );
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
    // El listado sigue visible: el 403 fue de este panel.
    expect(screen.getByText('Instituciones (1)')).toBeTruthy();

    screen.getByRole('button', { name: 'Revalidar sesión' }).click();
    await waitFor(() => expect(session.retry).toHaveBeenCalledTimes(1));
  });

  it('un 404 de memberships se informa como institución no encontrada', async () => {
    api.getIssuers.mockResolvedValue({ items: [issuer()] });
    api.getMemberships.mockRejectedValueOnce(
      new ApiError('no existe', 'http', 404)
    );
    render(<AdminContent />);

    await screen.findByText(/No encontramos la institución solicitada/);
  });
});

// ---------------------------------------------------------------------------
// LECTURA PURA
// ---------------------------------------------------------------------------

describe('AdminContent: lectura pura', () => {
  it('con datos completos no existe ningún control de mutación', async () => {
    api.getIssuers.mockResolvedValue({ items: [issuer(), provisioned] });
    api.getMemberships.mockResolvedValue(
      membershipsFor('issuer-uade', [membership()])
    );
    const { container } = render(<AdminContent />);

    await screen.findByRole('table');

    // Ni formularios, ni inputs, ni botones deshabilitados.
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('button[disabled]')).toBeNull();

    // Los únicos botones son los dos de selección de institución.
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.getAttribute('type')).toBe('button');
    }

    const text = container.textContent ?? '';
    for (const copy of [
      'Crear institución',
      'Agregar admin',
      'Asignar usuario',
      'Próximamente'
    ]) {
      expect(text, `no debe anticipar "${copy}"`).not.toContain(copy);
    }
  });
});

// ---------------------------------------------------------------------------
// ACCESIBILIDAD
// ---------------------------------------------------------------------------

describe('AdminContent: accesibilidad', () => {
  it('la jerarquía de headings es coherente', async () => {
    api.getIssuers.mockResolvedValue({ items: [issuer()] });
    render(<AdminContent />);

    await screen.findByRole('table');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Instituciones en Scope' })
    ).toBeTruthy();
    // h2 para el listado y para el detalle; h3 para las secciones internas.
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBe(2);
    expect(
      screen.getByRole('heading', { level: 3, name: 'Estado operativo' })
    ).toBeTruthy();
  });

  it('la selección usa botones reales, no divs clickeables', async () => {
    api.getIssuers.mockResolvedValue({
      items: [issuer(), issuer({ issuerReference: 'issuer-utn', name: 'UTN' })]
    });
    render(<AdminContent />);

    await screen.findByText('Instituciones (2)');
    const items = screen.getAllByRole('listitem');

    for (const item of items) {
      expect(item.querySelector('button')).toBeTruthy();
    }
    // Y son focuseables sin tabindex artificial.
    expect(issuerButton(/UTN/).getAttribute('tabindex')).toBeNull();
  });

  it('la tabla de memberships tiene caption y headers de columna', async () => {
    api.getIssuers.mockResolvedValue({ items: [issuer()] });
    render(<AdminContent />);

    const table = await screen.findByRole('table');

    expect(table.querySelector('caption')?.textContent).toContain(
      'Personas con acceso'
    );
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent)
    ).toEqual(['Persona', 'Email', 'Rol', 'Acceso']);
  });

  it('los estados de carga se anuncian', async () => {
    api.getIssuers.mockReturnValue(deferred().promise);
    render(<AdminContent />);

    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toContain('Cargando instituciones');
  });
});

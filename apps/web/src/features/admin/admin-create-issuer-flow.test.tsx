import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminCreateIssuerFlow } from '@/features/admin/admin-create-issuer-flow';
import { ApiError, IncompatiblePayloadError } from '@/lib/errors/api-error';
import type { AdminIssuerProvisionResultVM } from '@/models/platform-admin';

const api = vi.hoisted(() => ({
  resolve: vi.fn(),
  provision: vi.fn()
}));

vi.mock('@/lib/api/admin-api', () => ({
  resolveAdminUserRequest: (...args: unknown[]) => api.resolve(...args),
  provisionAdminIssuerRequest: (...args: unknown[]) => api.provision(...args)
}));
vi.mock('@/lib/session/session-provider', () => ({
  useSession: () => ({ requestAuthenticated: vi.fn() })
}));

const RESOLVED = { email: 'ana@uade.edu.ar', displayLabel: 'Ana Gómez' };

const PROVISION_RESULT: AdminIssuerProvisionResultVM = {
  issuer: {
    issuerReference: 'issuer-nuevo',
    name: 'Universidad X',
    legalName: 'Universidad X S.A.',
    authorizationStatus: 'authorized',
    authorizationLabel: 'Habilitada',
    technicalIdentity: {
      didConfigured: false,
      walletConfigured: false,
      readyToIssue: false,
      readinessLabel: 'Pendiente'
    },
    createdAtLabel: '5 oct 2026, 10:00'
  },
  initialAdminMembership: {
    userReference: 'user-ana',
    email: 'ana@uade.edu.ar',
    displayLabel: 'Ana Gómez',
    role: 'admin',
    roleLabel: 'Administrador',
    status: 'active',
    statusLabel: 'Activa',
    createdAtLabel: '5 oct 2026, 10:00'
  }
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderFlow(
  overrides: {
    onCreated?: (issuerReference: string) => Promise<boolean>;
    onRefreshIssuers?: () => Promise<boolean>;
    onClose?: () => void;
    onRevalidateSession?: () => void;
  } = {}
) {
  const onCreated = overrides.onCreated ?? vi.fn().mockResolvedValue(true);
  const onRefreshIssuers =
    overrides.onRefreshIssuers ?? vi.fn().mockResolvedValue(true);
  const onClose = overrides.onClose ?? vi.fn();
  const onRevalidateSession = overrides.onRevalidateSession ?? vi.fn();

  const view = render(
    <AdminCreateIssuerFlow
      onCreated={onCreated}
      onRefreshIssuers={onRefreshIssuers}
      onClose={onClose}
      onRevalidateSession={onRevalidateSession}
    />
  );

  return { ...view, onCreated, onRefreshIssuers, onClose, onRevalidateSession };
}

const nameInput = () => screen.getByLabelText('Nombre') as HTMLInputElement;
const legalNameInput = () =>
  screen.getByLabelText('Razón social') as HTMLInputElement;
const emailInput = () =>
  screen.getByLabelText('Email del primer administrador') as HTMLInputElement;
const searchButton = () =>
  screen.getByRole('button', { name: /Buscar administrador|Buscando/ });
const createButton = () =>
  screen.getByRole('button', { name: /Crear institución|Creando/ });

function fillForm(
  values: { name?: string; legalName?: string; email?: string } = {}
) {
  fireEvent.change(nameInput(), {
    target: { value: values.name ?? 'Universidad X' }
  });
  fireEvent.change(legalNameInput(), {
    target: { value: values.legalName ?? 'Universidad X S.A.' }
  });
  fireEvent.change(emailInput(), {
    target: { value: values.email ?? 'ana@uade.edu.ar' }
  });
}

async function reachConfirm() {
  fillForm();
  searchButton().click();
  await screen.findByText('Nueva institución');
}

beforeEach(() => {
  api.resolve.mockReset();
  api.provision.mockReset();
  api.resolve.mockResolvedValue(RESOLVED);
  api.provision.mockResolvedValue(PROVISION_RESULT);
});

/**
 * FLOW B -- crear institucion. S6b.
 *
 * Lo que se defiende: ninguna institucion se crea sin resolver antes al primer
 * administrador y confirmar explicitamente; el POST no es idempotente, asi que
 * NUNCA se repite solo; y un fallo ambiguo no se resuelve adivinando.
 */
describe('AdminCreateIssuerFlow: formulario y resolve', () => {
  it('2: abrir el flujo no muta nada', () => {
    renderFlow();

    expect(api.resolve).not.toHaveBeenCalled();
    expect(api.provision).not.toHaveBeenCalled();
  });

  it('3-5: los tres campos son requeridos y nada llega al servicio sin ellos', async () => {
    renderFlow();

    searchButton().click();

    await screen.findByText('Ingresá el nombre de la institución.');
    expect(screen.getByText('Ingresá la razón social.')).toBeTruthy();
    expect(
      screen.getByText('Ingresá el email del primer administrador.')
    ).toBeTruthy();
    expect(api.resolve).not.toHaveBeenCalled();
  });

  it('4: legalName es requerido según el contrato de S5b', async () => {
    renderFlow();

    fillForm({ legalName: '   ' });
    searchButton().click();

    await screen.findByText('Ingresá la razón social.');
    expect(api.resolve).not.toHaveBeenCalled();
  });

  it('6: resolver el primer administrador usa S4 una sola vez', async () => {
    renderFlow();

    fillForm();
    searchButton().click();

    await waitFor(() => expect(api.resolve).toHaveBeenCalledTimes(1));
    expect(api.resolve.mock.calls[0][1]).toBe('ana@uade.edu.ar');
  });

  it('7-8: la confirmación muestra la persona, el nombre y la razón social', async () => {
    renderFlow();
    await reachConfirm();

    expect(screen.getByText('Ana Gómez')).toBeTruthy();
    expect(screen.getByText('ana@uade.edu.ar')).toBeTruthy();
    expect(screen.getByText('Universidad X')).toBeTruthy();
    expect(screen.getByText('Universidad X S.A.')).toBeTruthy();
    expect(screen.getByText('Primer administrador')).toBeTruthy();
  });

  it('la confirmación anuncia el estado inicial, sin decir "verificada"', async () => {
    const { container } = renderFlow();
    await reachConfirm();

    const estado = screen.getByText(/Habilitación operativa: Habilitada/);
    expect(estado.textContent).toContain('Identidad técnica: Pendiente');
    expect(estado.textContent).toContain('Lista para emitir: No');

    const text = (container.textContent ?? '').toLowerCase();
    for (const prohibida of ['verificada', 'validada', 'acreditada', 'verified']) {
      expect(text, `no debe decir "${prohibida}"`).not.toContain(prohibida);
    }
  });

  it('9: todavía CERO llamadas a S5b antes de confirmar', async () => {
    renderFlow();
    await reachConfirm();

    expect(api.provision).not.toHaveBeenCalled();
  });

  it('22: un 404 del resolve usa el copy uniforme', async () => {
    api.resolve.mockRejectedValueOnce(new ApiError('no', 'http', 404));
    renderFlow();

    fillForm();
    searchButton().click();

    const message = await screen.findByText(
      /No encontramos una cuenta activa disponible para ese email/
    );
    for (const leak of ['suspend', 'archiv', 'no existe']) {
      expect(message.textContent?.toLowerCase()).not.toContain(leak);
    }
    expect(screen.queryByRole('button', { name: /Crear usuario/ })).toBeNull();
  });

  it('10: cambiar el email INVALIDA la resolución', async () => {
    renderFlow();
    await reachConfirm();

    fireEvent.change(emailInput(), { target: { value: 'otra@uade.edu.ar' } });

    expect(screen.queryByText('Nueva institución')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Crear institución/ })
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Buscar administrador' })
    ).toBeTruthy();
    expect(api.provision).not.toHaveBeenCalled();
  });

  it('11-12: cambiar name o legalName NO invalida la resolución', async () => {
    renderFlow();
    await reachConfirm();

    fireEvent.change(nameInput(), { target: { value: 'Universidad Y' } });
    fireEvent.change(legalNameInput(), { target: { value: 'Universidad Y SA' } });

    // La persona sigue resuelta: su identidad no depende del nombre.
    expect(screen.getByText('Nueva institución')).toBeTruthy();
    expect(screen.getByText('Ana Gómez')).toBeTruthy();
    // Y los nombres nuevos se reflejan en la confirmación.
    expect(screen.getByText('Universidad Y')).toBeTruthy();
    expect(screen.getByText('Universidad Y SA')).toBeTruthy();
    expect(api.resolve).toHaveBeenCalledTimes(1);
  });
});

describe('AdminCreateIssuerFlow: creación', () => {
  it('13-14-15: confirmar llama a S5b una vez, con los tres campos exactos', async () => {
    renderFlow();
    await reachConfirm();

    createButton().click();

    await waitFor(() => expect(api.provision).toHaveBeenCalledTimes(1));
    const command = api.provision.mock.calls[0][1];
    expect(command).toEqual({
      name: 'Universidad X',
      legalName: 'Universidad X S.A.',
      initialAdminUserEmail: 'ana@uade.edu.ar'
    });
    expect(Object.keys(command).sort()).toEqual([
      'initialAdminUserEmail',
      'legalName',
      'name'
    ]);
  });

  it('15: no viaja status, authorizationStatus, did, wallet ni nada técnico', async () => {
    renderFlow();
    await reachConfirm();

    createButton().click();
    await waitFor(() => expect(api.provision).toHaveBeenCalledTimes(1));

    const serialized = JSON.stringify(api.provision.mock.calls[0][1]);
    for (const leak of [
      'status',
      'authorizationStatus',
      'authorizedAt',
      'role',
      'did',
      'walletAddress',
      'privateKey',
      'mnemonic',
      'chainId',
      'network',
      'metadata',
      'userId'
    ]) {
      expect(serialized, `no debe viajar ${leak}`).not.toContain(leak);
    }
  });

  it('el email que viaja es el que DEVOLVIÓ el backend', async () => {
    api.resolve.mockResolvedValue({
      email: 'ana@uade.edu.ar',
      displayLabel: 'Ana Gómez'
    });
    renderFlow();

    fillForm({ email: '  ANA@UADE.EDU.AR  ' });
    searchButton().click();
    await screen.findByText('Nueva institución');
    createButton().click();

    await waitFor(() => expect(api.provision).toHaveBeenCalledTimes(1));
    expect(api.provision.mock.calls[0][1].initialAdminUserEmail).toBe(
      'ana@uade.edu.ar'
    );
  });

  it('16: doble click NO crea dos instituciones', async () => {
    // El caso mas peligroso del slice: S5b no es idempotente y el schema no
    // tiene unique sobre `name`.
    const pending = deferred<AdminIssuerProvisionResultVM>();
    api.provision.mockReturnValue(pending.promise);
    renderFlow();
    await reachConfirm();

    createButton().click();
    createButton().click();
    createButton().click();

    await waitFor(() => expect(api.provision).toHaveBeenCalledTimes(1));
    expect(createButton().hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Creando…' })).toBeTruthy();

    pending.resolve(PROVISION_RESULT);
    await screen.findByText('Institución creada');
    expect(api.provision).toHaveBeenCalledTimes(1);
  });

  it('17-18: el éxito refresca el padrón y selecciona el issuer nuevo', async () => {
    const { onCreated } = renderFlow();
    await reachConfirm();

    createButton().click();

    await screen.findByText('Institución creada');
    expect(onCreated).toHaveBeenCalledTimes(1);
    // El id del response es lo que decide QUE seleccionar.
    expect(onCreated).toHaveBeenCalledWith('issuer-nuevo');
  });

  it('21: el formulario se resetea tras el éxito', async () => {
    renderFlow();
    await reachConfirm();

    createButton().click();
    await screen.findByText('Institución creada');

    expect(screen.queryByLabelText('Nombre')).toBeNull();
    expect(screen.queryByLabelText('Razón social')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Crear institución/ })
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeTruthy();
  });

  it('20: el éxito nombra al primer administrador', async () => {
    renderFlow();
    await reachConfirm();

    createButton().click();

    await screen.findByText('Institución creada');
    expect(
      screen.getByText(/Ana Gómez como primer administrador/)
    ).toBeTruthy();
  });
});

describe('AdminCreateIssuerFlow: fallo ambiguo del alta', () => {
  it('24: un fallo de red NO reintenta y NO vuelve a ofrecer crear', async () => {
    api.provision.mockRejectedValueOnce(new ApiError('sin red', 'network'));
    renderFlow();
    await reachConfirm();

    createButton().click();

    await screen.findByText('No pudimos confirmar si la institución se creó');
    // Un solo POST, y ninguna CTA de creación.
    expect(api.provision).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('button', { name: /Crear institución/ })
    ).toBeNull();
    // Tampoco se reafirma que nada se creó: no se sabe.
    expect(screen.queryByText(/no se creó/)).toBeNull();
    expect(screen.queryByText(/No se creó/)).toBeNull();
  });

  it('24: lo único ofrecido es releer el padrón', async () => {
    api.provision.mockRejectedValueOnce(new ApiError('cayó', 'http', 500));
    const { onRefreshIssuers } = renderFlow();
    await reachConfirm();

    createButton().click();
    await screen.findByText('No pudimos confirmar si la institución se creó');

    screen.getByRole('button', { name: 'Actualizar instituciones' }).click();

    await waitFor(() => expect(onRefreshIssuers).toHaveBeenCalledTimes(1));
    // Releer NO reenvía el POST.
    expect(api.provision).toHaveBeenCalledTimes(1);
  });

  it('25: no hay ninguna heurística por nombre para adivinar el resultado', async () => {
    api.provision.mockRejectedValueOnce(new ApiError('sin red', 'network'));
    const { onRefreshIssuers } = renderFlow();
    await reachConfirm();

    createButton().click();
    await screen.findByText('No pudimos confirmar si la institución se creó');

    // El flujo no busca "Universidad X" en ninguna parte para decidir: lo
    // único que hace es ofrecer releer y que la persona mire.
    expect(api.resolve).toHaveBeenCalledTimes(1);
    expect(onRefreshIssuers).not.toHaveBeenCalled();
  });

  it('un payload ilegible también es ambiguo: el POST pudo haberse aplicado', async () => {
    api.provision.mockRejectedValueOnce(new IncompatiblePayloadError());
    renderFlow();
    await reachConfirm();

    createButton().click();

    await screen.findByText('No pudimos confirmar si la institución se creó');
    expect(
      screen.queryByRole('button', { name: /Crear institución/ })
    ).toBeNull();
  });

  it('un 4xx NO es ambiguo: el servidor respondió, así que se puede corregir', async () => {
    // Un 400 llegó, se procesó y se rechazó. No hay nada creado, y conviene
    // dejar reintentar con los datos corregidos.
    api.provision.mockRejectedValueOnce(new ApiError('malo', 'http', 400));
    renderFlow();
    await reachConfirm();

    createButton().click();

    await screen.findByText(/Revisá los datos de la institución/);
    expect(
      screen.queryByText('No pudimos confirmar si la institución se creó')
    ).toBeNull();
    expect(screen.getByRole('button', { name: /Crear institución/ })).toBeTruthy();
  });

  it('un 403 ofrece revalidar la sesión y no reenvía el POST', async () => {
    api.provision.mockRejectedValueOnce(new ApiError('no', 'http', 403));
    const { onRevalidateSession } = renderFlow();
    await reachConfirm();

    createButton().click();

    await screen.findByText(
      'La administración de plataforma no está disponible para esta sesión'
    );
    screen.getByRole('button', { name: 'Revalidar sesión' }).click();

    expect(onRevalidateSession).toHaveBeenCalledTimes(1);
    expect(api.provision).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('button', { name: /Crear institución/ })
    ).toBeNull();
  });

  it('un 404 del provision invalida la resolución y vuelve al formulario', async () => {
    // La persona dejó de ser elegible entre el resolve y el confirm.
    api.provision.mockRejectedValueOnce(new ApiError('no', 'http', 404));
    renderFlow();
    await reachConfirm();

    createButton().click();

    await screen.findByText(
      /No encontramos una cuenta activa disponible para ese email/
    );
    expect(screen.queryByText('Nueva institución')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Buscar administrador' })
    ).toBeTruthy();
  });

  it('23: un error transitorio conserva los datos ingresados', async () => {
    api.provision.mockRejectedValueOnce(new ApiError('malo', 'http', 400));
    renderFlow();
    await reachConfirm();

    createButton().click();
    await screen.findByText(/Revisá los datos de la institución/);

    expect(nameInput().value).toBe('Universidad X');
    expect(legalNameInput().value).toBe('Universidad X S.A.');
    expect(emailInput().value).toBe('ana@uade.edu.ar');
  });
});

describe('AdminCreateIssuerFlow: mutación confirmada vs refresh fallido', () => {
  it('201 + refresh fallido: NO hay segundo POST, y el estado los distingue', async () => {
    const onCreated = vi.fn().mockResolvedValue(false);
    renderFlow({ onCreated });
    await reachConfirm();

    createButton().click();

    await screen.findByText('Institución creada');
    expect(screen.getByText('No pudimos actualizar la vista')).toBeTruthy();
    expect(screen.getByText(/La institución quedó creada/)).toBeTruthy();

    expect(
      screen.queryByRole('button', { name: /Crear institución/ })
    ).toBeNull();
    expect(api.provision).toHaveBeenCalledTimes(1);

    onCreated.mockResolvedValue(true);
    screen.getByRole('button', { name: 'Actualizar datos' }).click();

    await waitFor(() =>
      expect(screen.queryByText('No pudimos actualizar la vista')).toBeNull()
    );
    expect(onCreated).toHaveBeenCalledTimes(2);
    expect(api.provision).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Institución creada')).toBeTruthy();
  });
});

describe('AdminCreateIssuerFlow: duplicados, cancelar y accesibilidad', () => {
  it('26: un nombre duplicado NO se bloquea en el frontend', async () => {
    // El schema deliberadamente no tiene unique sobre name/legalName. Inventar
    // la constraint en el cliente seria falso (tiene carrera) y ademas asumiria
    // que dos nombres iguales son la misma entidad.
    renderFlow();
    await reachConfirm();

    createButton().click();

    await screen.findByText('Institución creada');
    expect(api.provision).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/ya existe una/i)).toBeNull();
    expect(screen.queryByText(/nombre duplicado/i)).toBeNull();
  });

  it('21: cancelar no muta ni dispara requests', async () => {
    const { onClose } = renderFlow();
    await reachConfirm();

    screen.getByRole('button', { name: 'Cancelar' }).click();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.provision).not.toHaveBeenCalled();
  });

  it('un resolve tardío no puede confirmar a nadie tras cancelar', async () => {
    const pending = deferred<typeof RESOLVED>();
    api.resolve.mockReturnValue(pending.promise);
    const { onClose } = renderFlow();

    fillForm();
    searchButton().click();
    await screen.findByText('Buscando persona…');

    screen.getByRole('button', { name: 'Cancelar' }).click();
    expect(onClose).toHaveBeenCalledTimes(1);

    pending.resolve(RESOLVED);
    await waitFor(() => expect(api.provision).not.toHaveBeenCalled());
  });

  it('27: el actor puede ser el primer administrador, sin tratamiento especial', async () => {
    api.resolve.mockResolvedValue({
      email: 'adriel@example.com',
      displayLabel: 'Adriel Pasik'
    });
    renderFlow();

    fillForm({ email: 'adriel@example.com' });
    searchButton().click();
    await screen.findByText('Adriel Pasik');
    createButton().click();

    await waitFor(() => expect(api.provision).toHaveBeenCalledTimes(1));
    expect(api.provision.mock.calls[0][1].initialAdminUserEmail).toBe(
      'adriel@example.com'
    );
  });

  it('no existe ningún campo de clave privada, DID, wallet ni red', () => {
    const { container } = renderFlow();

    const labels = Array.from(container.querySelectorAll('label')).map(
      (label) => label.textContent?.toLowerCase() ?? ''
    );
    expect(labels).toEqual([
      'nombre',
      'razón social',
      'email del primer administrador'
    ]);

    for (const forbidden of [
      'clave',
      'private',
      'mnemo',
      'seed',
      'secret',
      'wallet',
      'did',
      'rpc',
      'contrato',
      'chain',
      'red',
      'blockchain'
    ]) {
      for (const label of labels) {
        expect(label, `no debe pedir "${forbidden}"`).not.toContain(forbidden);
      }
    }
    // Y exactamente tres inputs, ninguno de tipo password.
    const inputs = Array.from(container.querySelectorAll('input'));
    expect(inputs).toHaveLength(3);
    expect(inputs.some((input) => input.type === 'password')).toBe(false);
  });

  it('los tres inputs tienen label real y los errores quedan asociados', async () => {
    renderFlow();

    searchButton().click();
    await screen.findByText('Ingresá el nombre de la institución.');

    for (const [input, message] of [
      [nameInput(), 'Ingresá el nombre de la institución.'],
      [legalNameInput(), 'Ingresá la razón social.'],
      [emailInput(), 'Ingresá el email del primer administrador.']
    ] as const) {
      const error = screen.getByText(message);
      expect(error.getAttribute('role')).toBe('alert');
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(input.getAttribute('aria-describedby')).toContain(error.id);
    }
  });

  it('la confirmación tiene heading y los controles son buttons reales', () => {
    const { container } = renderFlow();

    expect(
      screen.getByRole('heading', { name: 'Crear institución' })
    ).toBeTruthy();
    for (const button of screen.getAllByRole('button')) {
      expect(button.getAttribute('type')).toBe('button');
    }
    expect(container.querySelector('form')).toBeNull();
  });
});

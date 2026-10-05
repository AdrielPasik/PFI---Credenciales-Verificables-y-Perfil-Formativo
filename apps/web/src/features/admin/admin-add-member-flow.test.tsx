import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminAddMemberFlow } from '@/features/admin/admin-add-member-flow';
import { ApiError, IncompatiblePayloadError } from '@/lib/errors/api-error';
import type { AdminMembershipGrantResultVM } from '@/models/platform-admin';

const api = vi.hoisted(() => ({
  resolve: vi.fn(),
  grant: vi.fn()
}));

vi.mock('@/lib/api/admin-api', () => ({
  resolveAdminUserRequest: (...args: unknown[]) => api.resolve(...args),
  grantAdminMembershipRequest: (...args: unknown[]) => api.grant(...args)
}));
vi.mock('@/lib/session/session-provider', () => ({
  useSession: () => ({ requestAuthenticated: vi.fn() })
}));

const ISSUER = { issuerReference: 'issuer-uade', name: 'UADE' };

const RESOLVED = {
  email: 'ana@uade.edu.ar',
  displayLabel: 'Ana Gómez'
};

const GRANT_RESULT: AdminMembershipGrantResultVM = {
  issuer: { issuerReference: 'issuer-uade', name: 'UADE' },
  membership: {
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
    onGranted?: () => Promise<boolean>;
    onClose?: () => void;
    onRevalidateSession?: () => void;
  } = {}
) {
  const onGranted = overrides.onGranted ?? vi.fn().mockResolvedValue(true);
  const onClose = overrides.onClose ?? vi.fn();
  const onRevalidateSession = overrides.onRevalidateSession ?? vi.fn();

  const view = render(
    <AdminAddMemberFlow
      issuer={ISSUER}
      onGranted={onGranted}
      onClose={onClose}
      onRevalidateSession={onRevalidateSession}
    />
  );

  return { ...view, onGranted, onClose, onRevalidateSession };
}

const emailInput = () =>
  screen.getByLabelText('Email de la persona') as HTMLInputElement;
// El rotulo cambia a "Buscando..." mientras resuelve, y "Buscando" NO
// contiene "Buscar".
const searchButton = () =>
  screen.getByRole('button', { name: /Buscar persona|Buscando/ });
const confirmButton = () =>
  screen.getByRole('button', { name: /Confirmar asignación|Asignando/ });

function typeEmail(value: string) {
  fireEvent.change(emailInput(), { target: { value } });
}

beforeEach(() => {
  api.resolve.mockReset();
  api.grant.mockReset();
  api.resolve.mockResolvedValue(RESOLVED);
  api.grant.mockResolvedValue(GRANT_RESULT);
});

/**
 * FLOW A -- agregar administrador. S6b.
 *
 * Lo que se defiende: ninguna autoridad se otorga sin resolver primero a la
 * persona y confirmar explicitamente; el email que viaja es el que devolvio el
 * backend; y ningun camino de error reintenta un POST por su cuenta.
 */
describe('AdminAddMemberFlow: resolve', () => {
  it('2: abrir el flujo no dispara ninguna mutación', () => {
    renderFlow();

    expect(api.resolve).not.toHaveBeenCalled();
    expect(api.grant).not.toHaveBeenCalled();
  });

  it('10: el issuer de destino está visible desde el primer paso', () => {
    renderFlow();

    expect(screen.getByText(/Vas a agregar un administrador a:/)).toBeTruthy();
    expect(screen.getByText('UADE')).toBeTruthy();
  });

  it('3: el email es requerido y no se llama al servicio sin él', async () => {
    renderFlow();

    searchButton().click();

    await screen.findByText('Ingresá el email de la persona.');
    expect(api.resolve).not.toHaveBeenCalled();

    // Sólo espacios tampoco.
    typeEmail('   ');
    searchButton().click();
    await waitFor(() => expect(api.resolve).not.toHaveBeenCalled());
  });

  it('5: buscar persona llama a S4 exactamente una vez, con el email trimeado', async () => {
    renderFlow();

    typeEmail('  ana@uade.edu.ar  ');
    searchButton().click();

    await waitFor(() => expect(api.resolve).toHaveBeenCalledTimes(1));
    expect(api.resolve.mock.calls[0][1]).toBe('ana@uade.edu.ar');
  });

  it('6: muestra el progreso del resolve y bloquea el submit repetido', async () => {
    const pending = deferred<typeof RESOLVED>();
    api.resolve.mockReturnValue(pending.promise);
    renderFlow();

    typeEmail('ana@uade.edu.ar');
    searchButton().click();

    await screen.findByText('Buscando persona…');
    expect(screen.getByRole('button', { name: 'Buscando…' }).hasAttribute('disabled')).toBe(true);
    expect(emailInput().disabled).toBe(true);

    // Clicks extra mientras está en vuelo: una sola request.
    searchButton().click();
    searchButton().click();
    await waitFor(() => expect(api.resolve).toHaveBeenCalledTimes(1));

    pending.resolve(RESOLVED);
    await screen.findByText('Ana Gómez');
  });

  it('9-11: el resolve exitoso muestra persona, institución y el rol', async () => {
    renderFlow();

    typeEmail('ana@uade.edu.ar');
    searchButton().click();

    await screen.findByText('Persona encontrada');
    expect(screen.getByText('Ana Gómez')).toBeTruthy();
    expect(screen.getByText('ana@uade.edu.ar')).toBeTruthy();
    // Los tres datos que reducen un grant accidental.
    expect(screen.getByText('Persona')).toBeTruthy();
    expect(screen.getByText('Institución')).toBeTruthy();
    expect(screen.getByText('Rol que recibirá')).toBeTruthy();
    expect(screen.getByText('Administrador')).toBeTruthy();
  });

  it('no hay selector de rol: S5a fija admin server-side', async () => {
    const { container } = renderFlow();

    typeEmail('ana@uade.edu.ar');
    searchButton().click();
    await screen.findByText('Persona encontrada');

    expect(container.querySelector('select')).toBeNull();
    expect(screen.queryByLabelText(/Rol$/)).toBeNull();
    expect(screen.queryByText('Operador')).toBeNull();
    expect(screen.queryByText('Solo lectura')).toBeNull();
  });

  it('12: todavía CERO llamadas a S5a antes de confirmar', async () => {
    renderFlow();

    typeEmail('ana@uade.edu.ar');
    searchButton().click();
    await screen.findByText('Persona encontrada');

    expect(api.grant).not.toHaveBeenCalled();
  });

  it('7: un 404 muestra el copy uniforme y NO filtra el estado de la cuenta', async () => {
    api.resolve.mockRejectedValueOnce(new ApiError('no', 'http', 404));
    renderFlow();

    typeEmail('ana@uade.edu.ar');
    searchButton().click();

    const message = await screen.findByText(
      /No encontramos una cuenta activa disponible para ese email/
    );
    // Nunca se dice por qué: suspendida, archivada, pendiente, inexistente.
    for (const leak of ['suspend', 'archiv', 'pendiente', 'no existe']) {
      expect(message.textContent?.toLowerCase()).not.toContain(leak);
    }
    // Y no se ofrece crear la cuenta: las personas crean sus propias cuentas.
    expect(screen.queryByRole('button', { name: /Crear usuario/ })).toBeNull();
    expect(api.grant).not.toHaveBeenCalled();
  });

  it('8: un 500 muestra un mensaje genérico, sin candidatos', async () => {
    api.resolve.mockRejectedValueOnce(new ApiError('no', 'http', 500));
    renderFlow();

    typeEmail('ana@uade.edu.ar');
    searchButton().click();

    await screen.findByText('No pudimos resolver esa cuenta en este momento.');
    expect(screen.queryByText('Persona encontrada')).toBeNull();
  });

  it('un payload incompatible no deja el flujo en estado de confirmación', async () => {
    api.resolve.mockRejectedValueOnce(new IncompatiblePayloadError());
    renderFlow();

    typeEmail('ana@uade.edu.ar');
    searchButton().click();

    await screen.findByText(/no tiene el formato esperado/);
    expect(screen.queryByText('Persona encontrada')).toBeNull();
  });
});

describe('AdminAddMemberFlow: confirmación y grant', () => {
  async function reachConfirm() {
    typeEmail('ana@uade.edu.ar');
    searchButton().click();
    await screen.findByText('Persona encontrada');
  }

  it('13-14: confirmar llama a S5a una vez, con el issuer del path y SOLO el email', async () => {
    renderFlow();
    await reachConfirm();

    confirmButton().click();

    await waitFor(() => expect(api.grant).toHaveBeenCalledTimes(1));
    // (request, issuerReference, userEmail)
    expect(api.grant.mock.calls[0][1]).toBe('issuer-uade');
    expect(api.grant.mock.calls[0][2]).toBe('ana@uade.edu.ar');
    // Tres argumentos: no hay lugar para role, status ni userId.
    expect(api.grant.mock.calls[0]).toHaveLength(3);
  });

  it('el email que viaja es el que DEVOLVIÓ el backend, no el tipeado', async () => {
    // S4 normaliza; el flujo manda el resultado del backend.
    api.resolve.mockResolvedValue({
      email: 'ana@uade.edu.ar',
      displayLabel: 'Ana Gómez'
    });
    renderFlow();

    typeEmail('  ANA@UADE.EDU.AR  ');
    searchButton().click();
    await screen.findByText('Persona encontrada');
    confirmButton().click();

    await waitFor(() => expect(api.grant).toHaveBeenCalledTimes(1));
    expect(api.grant.mock.calls[0][2]).toBe('ana@uade.edu.ar');
  });

  it('15: doble click no duplica el POST', async () => {
    const pending = deferred<AdminMembershipGrantResultVM>();
    api.grant.mockReturnValue(pending.promise);
    renderFlow();
    await reachConfirm();

    confirmButton().click();
    confirmButton().click();
    confirmButton().click();

    await waitFor(() => expect(api.grant).toHaveBeenCalledTimes(1));
    expect(confirmButton().hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Asignando…' })).toBeTruthy();

    pending.resolve(GRANT_RESULT);
    await screen.findByText('Administrador agregado');
    expect(api.grant).toHaveBeenCalledTimes(1);
  });

  it('16-17-18: el éxito muestra feedback y dispara UN refresh de datos', async () => {
    const { onGranted } = renderFlow();
    await reachConfirm();

    confirmButton().click();

    await screen.findByText('Administrador agregado');
    expect(screen.getByText(/ya tiene acceso de administrador a/)).toBeTruthy();
    expect(onGranted).toHaveBeenCalledTimes(1);
  });

  it('el formulario se cierra/resetea tras el éxito: no queda CTA de asignación', async () => {
    renderFlow();
    await reachConfirm();

    confirmButton().click();
    await screen.findByText('Administrador agregado');

    expect(
      screen.queryByRole('button', { name: /Confirmar asignación/ })
    ).toBeNull();
    expect(screen.queryByLabelText('Email de la persona')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeTruthy();
  });

  it('24: editar el email después de resolver INVALIDA la resolución', async () => {
    renderFlow();
    await reachConfirm();

    // Estrategia B: se vuelve al paso de búsqueda inmediatamente.
    typeEmail('otra@uade.edu.ar');

    expect(screen.queryByText('Persona encontrada')).toBeNull();
    expect(screen.queryByText('Ana Gómez')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Confirmar asignación/ })
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Buscar persona' })).toBeTruthy();
    expect(api.grant).not.toHaveBeenCalled();
  });

  it('24: es imposible confirmar a A con el email de B en pantalla', async () => {
    renderFlow();
    await reachConfirm();

    typeEmail('otra@uade.edu.ar');
    // Hay que volver a resolver; la segunda resolución es la que manda.
    api.resolve.mockResolvedValue({
      email: 'otra@uade.edu.ar',
      displayLabel: 'Otra Persona'
    });
    searchButton().click();
    await screen.findByText('Otra Persona');

    confirmButton().click();

    await waitFor(() => expect(api.grant).toHaveBeenCalledTimes(1));
    expect(api.grant.mock.calls[0][2]).toBe('otra@uade.edu.ar');
  });

  it('25: un resolve tardío no puede reabrir el flujo ni confirmar a nadie', async () => {
    const pending = deferred<typeof RESOLVED>();
    api.resolve.mockReturnValue(pending.promise);
    const { onClose } = renderFlow();

    typeEmail('ana@uade.edu.ar');
    searchButton().click();
    await screen.findByText('Buscando persona…');

    // Se cancela mientras la request sigue en vuelo.
    screen.getByRole('button', { name: 'Cancelar' }).click();
    expect(onClose).toHaveBeenCalledTimes(1);

    // Y ahora llega, tarde. En la app el componente ya está desmontado; acá se
    // comprueba lo esencial: nunca se otorga nada por una resolución tardía.
    pending.resolve(RESOLVED);
    await waitFor(() => expect(api.grant).not.toHaveBeenCalled());
  });
});

describe('AdminAddMemberFlow: errores del grant', () => {
  async function reachConfirm() {
    typeEmail('ana@uade.edu.ar');
    searchButton().click();
    await screen.findByText('Persona encontrada');
  }

  it('22: un 409 informa la membresía existente SIN afirmar "ya es administrador"', async () => {
    api.grant.mockRejectedValueOnce(new ApiError('conflicto', 'http', 409));
    renderFlow();
    await reachConfirm();

    confirmButton().click();

    const message = await screen.findByText(
      'Esta persona ya tiene una membresía asociada a esta institución.'
    );
    // La membership existente podría ser operator, viewer o estar revocada.
    expect(message.textContent).not.toContain('ya es administrador');
    // Y no se ofrece reactivar, reemplazar ni forzar: no existe el endpoint.
    for (const copy of ['Reactivar', 'Reemplazar', 'Forzar', 'Actualizar rol']) {
      expect(screen.queryByRole('button', { name: copy })).toBeNull();
    }
    // La resolución se invalida: reintentar daría 409 otra vez.
    expect(
      screen.queryByRole('button', { name: /Confirmar asignación/ })
    ).toBeNull();
  });

  it('un 404 en el grant invalida la resolución y vuelve al paso de búsqueda', async () => {
    // La persona dejó de ser elegible ENTRE el resolve y el confirm. Eso
    // demuestra que S4 nunca fue autoridad.
    api.grant.mockRejectedValueOnce(new ApiError('no', 'http', 404));
    renderFlow();
    await reachConfirm();

    confirmButton().click();

    await screen.findByText(
      /No encontramos una cuenta activa disponible para ese email/
    );
    expect(screen.queryByText('Persona encontrada')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Confirmar asignación/ })
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Buscar persona' })).toBeTruthy();
    expect(api.grant).toHaveBeenCalledTimes(1);
  });

  it('un 403 ofrece revalidar la sesión y NO reenvía el POST', async () => {
    api.grant.mockRejectedValueOnce(new ApiError('rechazado', 'http', 403));
    const { onRevalidateSession } = renderFlow();
    await reachConfirm();

    confirmButton().click();

    await screen.findByText(
      'La administración de plataforma no está disponible para esta sesión'
    );
    screen.getByRole('button', { name: 'Revalidar sesión' }).click();

    expect(onRevalidateSession).toHaveBeenCalledTimes(1);
    // Revalidar NO reenvía la mutación: hay que reiniciar la acción.
    expect(api.grant).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('button', { name: /Confirmar asignación/ })
    ).toBeNull();
  });

  it('un error transitorio conserva la resolución y permite reintentar A MANO', async () => {
    api.grant.mockRejectedValueOnce(new ApiError('sin red', 'network'));
    renderFlow();
    await reachConfirm();

    confirmButton().click();

    await screen.findByText(/Podés volver a intentarlo ahora/);
    // La persona resuelta sigue en pantalla: no hay que volver a tipear.
    expect(screen.getByText('Ana Gómez')).toBeTruthy();
    // Un solo POST: nada se reintentó por su cuenta.
    expect(api.grant).toHaveBeenCalledTimes(1);

    // El reintento es MANUAL, y es seguro porque S5a es create-only.
    api.grant.mockResolvedValue(GRANT_RESULT);
    confirmButton().click();
    await screen.findByText('Administrador agregado');
    expect(api.grant).toHaveBeenCalledTimes(2);
  });

  it('ningún POST se reintenta automáticamente en ningún camino de error', async () => {
    for (const failure of [
      new ApiError('x', 'http', 409),
      new ApiError('x', 'http', 404),
      new ApiError('x', 'http', 403),
      new ApiError('x', 'http', 500),
      new ApiError('x', 'network'),
      new IncompatiblePayloadError()
    ]) {
      api.grant.mockReset();
      api.grant.mockRejectedValue(failure);
      const view = renderFlow();
      typeEmail('ana@uade.edu.ar');
      searchButton().click();
      await screen.findByText('Persona encontrada');

      confirmButton().click();

      await waitFor(() => expect(api.grant).toHaveBeenCalledTimes(1));
      // Se espera un tick extra para descartar cualquier reintento diferido.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(
        api.grant,
        `no debe reintentar tras ${String(failure)}`
      ).toHaveBeenCalledTimes(1);
      view.unmount();
    }
  });
});

describe('AdminAddMemberFlow: mutación confirmada vs refresh fallido', () => {
  it('201 + refresh fallido: NO hay segundo POST, y el estado los distingue', async () => {
    const onGranted = vi.fn().mockResolvedValue(false);
    renderFlow({ onGranted });

    typeEmail('ana@uade.edu.ar');
    searchButton().click();
    await screen.findByText('Persona encontrada');
    confirmButton().click();

    // La mutación se considera CONFIRMADA...
    await screen.findByText('Administrador agregado');
    // ...y el fallo del refresh es un problema SEPARADO.
    expect(screen.getByText('No pudimos actualizar la vista')).toBeTruthy();
    expect(screen.getByText(/La asignación quedó registrada/)).toBeTruthy();

    // No hay ninguna CTA que parezca intentar asignar otra vez.
    expect(
      screen.queryByRole('button', { name: /Confirmar asignación/ })
    ).toBeNull();
    expect(api.grant).toHaveBeenCalledTimes(1);

    // Lo único reintentable son las lecturas.
    onGranted.mockResolvedValue(true);
    screen.getByRole('button', { name: 'Actualizar datos' }).click();

    await waitFor(() =>
      expect(screen.queryByText('No pudimos actualizar la vista')).toBeNull()
    );
    expect(onGranted).toHaveBeenCalledTimes(2);
    expect(api.grant).toHaveBeenCalledTimes(1);
    // El éxito de la mutación sigue afirmado.
    expect(screen.getByText('Administrador agregado')).toBeTruthy();
  });

  it('con refresh exitoso no se muestra ningún error de actualización', async () => {
    renderFlow({ onGranted: vi.fn().mockResolvedValue(true) });

    typeEmail('ana@uade.edu.ar');
    searchButton().click();
    await screen.findByText('Persona encontrada');
    confirmButton().click();

    await screen.findByText('Administrador agregado');
    expect(screen.queryByText('No pudimos actualizar la vista')).toBeNull();
  });
});

describe('AdminAddMemberFlow: cancelar y accesibilidad', () => {
  it('23: cancelar no muta nada ni dispara requests', async () => {
    const { onClose } = renderFlow();

    typeEmail('ana@uade.edu.ar');
    searchButton().click();
    await screen.findByText('Persona encontrada');

    screen.getByRole('button', { name: 'Cancelar' }).click();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.grant).not.toHaveBeenCalled();
  });

  it('27: el self-assignment funciona igual que cualquier otro grant', async () => {
    // Si S4 resuelve el email del propio actor, el flujo no lo trata distinto.
    api.resolve.mockResolvedValue({
      email: 'adriel@example.com',
      displayLabel: 'Adriel Pasik'
    });
    renderFlow();

    typeEmail('adriel@example.com');
    searchButton().click();
    await screen.findByText('Adriel Pasik');
    confirmButton().click();

    await waitFor(() => expect(api.grant).toHaveBeenCalledTimes(1));
    expect(api.grant.mock.calls[0][2]).toBe('adriel@example.com');
  });

  it('el input tiene label real y el error queda asociado', async () => {
    renderFlow();

    const input = emailInput();
    expect(input.tagName).toBe('INPUT');
    expect(input.type).toBe('email');

    searchButton().click();
    const error = await screen.findByText('Ingresá el email de la persona.');

    expect(error.getAttribute('role')).toBe('alert');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain(error.id);
  });

  it('el panel tiene heading y los controles son buttons reales', async () => {
    const { container } = renderFlow();

    expect(
      screen.getByRole('heading', { name: 'Agregar administrador' })
    ).toBeTruthy();
    for (const button of screen.getAllByRole('button')) {
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('type')).toBe('button');
    }
    // No hay <form>: el submit es explícito y por paso.
    expect(container.querySelector('form')).toBeNull();
  });

  it('el estado de carga se anuncia', async () => {
    api.resolve.mockReturnValue(deferred().promise);
    renderFlow();

    typeEmail('ana@uade.edu.ar');
    searchButton().click();

    const status = await screen.findByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
  });
});

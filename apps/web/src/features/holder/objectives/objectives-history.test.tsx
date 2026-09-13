/**
 * Historia y detalle de objetivos — P2.3.
 *
 * El punto no negociable de la lista: se dibuja SOLO con el contrato de resumen.
 * Pedir el detalle de cada fila para mostrar una cantidad de requisitos seria un
 * N+1 por un dato decorativo.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ObjectiveDetailRoute } from '@/features/holder/objectives/objective-detail-route';
import { ObjectivesListRoute } from '@/features/holder/objectives/objectives-list-route';
import { ApiError } from '@/lib/errors/api-error';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  listRuns: vi.fn(),
  requestAuthenticated: vi.fn(),
  params: { objectiveId: 'obj-1' } as Record<string, string>
}));

vi.mock('@/lib/session/session-provider', () => ({
  useSession: () => ({ requestAuthenticated: mocks.requestAuthenticated })
}));

vi.mock('next/navigation', () => ({
  useParams: () => mocks.params,
  useRouter: () => ({ push: vi.fn() })
}));

vi.mock('@/lib/api/objectives-api', () => ({
  listMyObjectivesRequest: mocks.list,
  getMyObjectiveRequest: mocks.get
}));

// P2.4B: el detalle monta el panel de analisis. Por defecto, sin runs — asi
// estos tests siguen describiendo el objetivo confirmado y no el analisis.
vi.mock('@/lib/api/reasoning-runs-api', () => ({
  listMyReasoningRunsRequest: mocks.listRuns,
  getMyReasoningRunRequest: vi.fn(),
  createMyReasoningRunRequest: vi.fn(),
  executeMyReasoningRunRequest: vi.fn()
}));

const summary = {
  objectiveReference: 'obj-1',
  objectiveType: 'EMPLOYMENT' as const,
  objectiveTypeLabel: 'Busqueda laboral',
  title: 'Backend Engineer',
  createdAtLabel: '11 de septiembre de 2026'
};

const detail = {
  objectiveReference: 'obj-1',
  objectiveType: 'EMPLOYMENT' as const,
  objectiveTypeLabel: 'Busqueda laboral',
  title: 'Backend Engineer',
  createdAtLabel: '11 de septiembre de 2026',
  requirements: [
    {
      requirementId: 'req_01',
      requirementText: 'Experiencia con Python.',
      provenanceKind: 'DERIVED_FROM_SOURCE_TEXT' as const,
      originLabel: 'Del objetivo',
      sourceQuote: '- Experiencia con Python.'
    },
    {
      requirementId: 'req_02',
      requirementText: 'Disponibilidad para viajar.',
      provenanceKind: 'DIRECT_STRUCTURED_INPUT' as const,
      originLabel: 'Agregado por vos',
      sourceQuote: null
    }
  ],
  sourceOriginalText: '\n- Experiencia con Python.\n'
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([summary]);
  mocks.get.mockResolvedValue(detail);
  mocks.listRuns.mockResolvedValue([]);
  mocks.params = { objectiveId: 'obj-1' };
});

describe('lista de objetivos', () => {
  it('keeps objectives inside the Holder navigation hierarchy', async () => {
    render(<ObjectivesListRoute />);

    await screen.findByText('Backend Engineer');
    expect(screen.getByRole('navigation', { name: 'Ubicacion' })).toBeTruthy();
    expect(screen.getByText('Mi perfil formativo')).toBeTruthy();
    expect(screen.getAllByText('Objetivos').length).toBeGreaterThan(0);
  });

  it('muestra solo lo que trae el contrato de resumen', async () => {
    render(<ObjectivesListRoute />);

    expect(await screen.findByText('Backend Engineer')).toBeTruthy();
    expect(screen.getByText(/Busqueda laboral/)).toBeTruthy();
    // Sin cantidad de requisitos: el resumen no la trae.
    expect(screen.queryByText(/requisitos?$/i)).toBeNull();
    expect((document.body.textContent ?? '')).not.toMatch(/\d+\s+requisitos/);
  });

  it('NO pide el detalle de cada fila: cero N+1', async () => {
    mocks.list.mockResolvedValue([
      summary,
      { ...summary, objectiveReference: 'obj-2', title: 'Beca' },
      { ...summary, objectiveReference: 'obj-3', title: 'Admision' }
    ]);
    render(<ObjectivesListRoute />);

    await screen.findByText('Beca');
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('estado vacio con salida a analizar', async () => {
    mocks.list.mockResolvedValue([]);
    render(<ObjectivesListRoute />);

    expect(await screen.findByText('Todavía no analizaste un objetivo.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Analizar un objetivo' })).toBeTruthy();
  });

  it('un error se puede reintentar', async () => {
    mocks.list.mockRejectedValue(new ApiError('x', 'network'));
    render(<ObjectivesListRoute />);

    expect(await screen.findByRole('button', { name: 'Reintentar' })).toBeTruthy();
    expect(screen.getAllByText(/No pudimos cargar tus objetivos/).length).toBeGreaterThan(0);
  });

  it('enlaza al detalle de cada objetivo', async () => {
    render(<ObjectivesListRoute />);
    const link = await screen.findByRole('link', { name: /Backend Engineer/ });
    expect(link.getAttribute('href')).toBe('/wallet/objectives/obj-1');
  });
});

describe('detalle de objetivo', () => {
  it('muestra los requisitos confirmados en orden y en solo lectura', async () => {
    render(<ObjectiveDetailRoute />);

    expect(await screen.findByText('Experiencia con Python.')).toBeTruthy();
    expect(screen.getByText('Disponibilidad para viajar.')).toBeTruthy();
    // Solo lectura: ningun control de edicion.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Eliminar/ })).toBeNull();
  });

  it('traduce la procedencia y no muestra el enum', async () => {
    render(<ObjectiveDetailRoute />);

    expect(await screen.findByText('Del objetivo')).toBeTruthy();
    expect(screen.getByText('Agregado por vos')).toBeTruthy();
    const body = document.body.textContent ?? '';
    expect(body.includes('DERIVED_FROM_SOURCE_TEXT')).toBe(false);
    expect(body.includes('DIRECT_STRUCTURED_INPUT')).toBe(false);
    expect(body.includes('req_01')).toBe(false);
  });

  /*
   * P2.4B invierte esta afirmacion a proposito: la accion de analisis YA existe
   * y es real. Lo que sigue valiendo es que el objetivo confirmado no se edita.
   */
  it('ofrece la accion REAL de analisis y sigue sin permitir editar', async () => {
    render(<ObjectiveDetailRoute />);
    await screen.findByText('Experiencia con Python.');

    const cta = await screen.findByRole('button', { name: 'Analizar mi trayectoria' });
    expect(cta.hasAttribute('disabled')).toBe(false);

    const body = document.body.textContent ?? '';
    expect(body.includes('Proximamente')).toBe(false);
    expect(body.includes('Editar objetivo')).toBe(false);
  });

  it('un objetivo ajeno o inexistente da un estado seguro', async () => {
    mocks.get.mockRejectedValue(new ApiError('x', 'http', 404));
    render(<ObjectiveDetailRoute />);

    expect(
      await screen.findByText('No encontramos este objetivo en tu espacio personal.')
    ).toBeTruthy();
  });

  /*
   * P2.4B: el detalle SI consulta runs, pero solo LEE. Abrir un objetivo no
   * puede crear ni ejecutar nada — eso compraria llamadas al proveedor sin que
   * nadie las pidiera.
   */
  it('al abrir el detalle solo LEE la lista de analisis, no crea ni ejecuta', async () => {
    const api = await import('@/lib/api/reasoning-runs-api');
    render(<ObjectiveDetailRoute />);
    await screen.findByText('Experiencia con Python.');

    await waitFor(() => expect(mocks.listRuns).toHaveBeenCalledTimes(1));
    expect(api.createMyReasoningRunRequest).not.toHaveBeenCalled();
    expect(api.executeMyReasoningRunRequest).not.toHaveBeenCalled();
    expect(api.getMyReasoningRunRequest).not.toHaveBeenCalled();
  });
});

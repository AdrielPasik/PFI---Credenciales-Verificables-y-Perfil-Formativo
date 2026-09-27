import { screen, waitFor } from '@testing-library/react-native';

import { ObjectiveDetailScreen } from '@/features/objectives/objective-detail-screen';
import { ObjectivesListScreen } from '@/features/objectives/objectives-list-screen';
import {
  objectiveDetailPayload,
  objectiveSummariesPayload,
  OBJECTIVE_SOURCE_TEXT
} from '@/test/objective-fixtures';
import type { RouteMap, StubResponse } from '@/test/http';
import { renderWithProviders } from '@/test/render';

const LIST_ROUTE = 'GET /me/objectives';
const DETAIL_ROUTE = 'GET /me/objectives/obj_01';
const RUNS_ROUTE = 'GET /me/reasoning-runs';

describe('historial de objetivos', () => {
  async function renderList(list: StubResponse) {
    return renderWithProviders(<ObjectivesListScreen />, {
      routes: { [LIST_ROUTE]: list }
    });
  }

  it('lista los objetivos con su tipo y fecha', async () => {
    await renderList({ body: objectiveSummariesPayload() });

    await waitFor(() =>
      expect(screen.getByText('Analista de datos')).toBeTruthy()
    );
    expect(screen.getByText('Beca de posgrado')).toBeTruthy();
    expect(screen.getByText('Búsqueda laboral')).toBeTruthy();
    expect(screen.getByText('Beca')).toBeTruthy();
  });

  it('NO inventa un conteo de requisitos: el resumen no lo trae', async () => {
    await renderList({ body: objectiveSummariesPayload() });

    await waitFor(() =>
      expect(screen.getByText('Analista de datos')).toBeTruthy()
    );
    expect(screen.queryByText(/requisito/i)).toBeNull();
  });

  it('cada objetivo es un objetivo táctil completo y descriptivo', async () => {
    await renderList({ body: objectiveSummariesPayload() });

    await waitFor(() =>
      expect(screen.getByTestId('objective-card-obj_01')).toBeTruthy()
    );

    const card = screen.getByTestId('objective-card-obj_01');
    expect(card.props.accessibilityRole).toBe('button');
    expect(card.props.accessibilityLabel).toContain('Analista de datos');
    expect(card.props.accessibilityLabel).toContain('Búsqueda laboral');
  });

  it('el estado vacío explica cómo empezar, sin inventar acciones', async () => {
    await renderList({ body: [] });

    await waitFor(() =>
      expect(
        screen.getByText('Todavía no preparaste ningún objetivo')
      ).toBeTruthy()
    );
    expect(screen.getByTestId('objectives-list-new')).toBeTruthy();
  });

  it('distingue un error de servicio de una lista vacía', async () => {
    await renderList({ status: 503 });

    await waitFor(() =>
      expect(screen.getByText('No pudimos cargar tus objetivos')).toBeTruthy()
    );
    expect(
      screen.queryByText('Todavía no preparaste ningún objetivo')
    ).toBeNull();
  });

  it('montar la lista NO dispara ninguna acción costosa', async () => {
    const { calls } = await renderList({ body: objectiveSummariesPayload() });

    await waitFor(() =>
      expect(screen.getByText('Analista de datos')).toBeTruthy()
    );
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });
});

describe('detalle del objetivo', () => {
  async function renderDetail(routeMap?: RouteMap) {
    return renderWithProviders(
      <ObjectiveDetailScreen objectiveReference="obj_01" />,
      {
        routes: routeMap ?? {
          [DETAIL_ROUTE]: { body: objectiveDetailPayload() },
          [RUNS_ROUTE]: { body: [] }
        }
      }
    );
  }

  it('muestra la identidad del objetivo sin ids técnicos', async () => {
    await renderDetail();

    await waitFor(() =>
      expect(screen.getByText('Analista de datos')).toBeTruthy()
    );
    expect(screen.getByText('Búsqueda laboral')).toBeTruthy();
    expect(screen.getByText(/2 requisitos/)).toBeTruthy();
    expect(screen.queryByText(/obj_01|req_01|req_02/)).toBeNull();
  });

  it('el análisis es lo primero: se ofrece analizar la trayectoria', async () => {
    await renderDetail();

    await waitFor(() =>
      expect(screen.getByText('Analizar mi trayectoria')).toBeTruthy()
    );
  });

  it('los requisitos confirmados vienen plegados como referencia', async () => {
    await renderDetail();

    await waitFor(() =>
      expect(screen.getByTestId('objective-requirements-disclosure')).toBeTruthy()
    );
    // Plegado por defecto: el texto del requisito todavía no está.
    expect(screen.queryByTestId('objective-requirement-0')).toBeNull();
  });

  it('el texto original del objetivo viene plegado', async () => {
    await renderDetail();

    await waitFor(() =>
      expect(screen.getByTestId('objective-source-disclosure')).toBeTruthy()
    );
    expect(screen.queryByText(OBJECTIVE_SOURCE_TEXT)).toBeNull();
  });

  it('un 404 se distingue de un fallo de servicio', async () => {
    await renderDetail({
      [DETAIL_ROUTE]: { status: 404 },
      [RUNS_ROUTE]: { body: [] }
    });

    await waitFor(() =>
      expect(
        screen.getByText('No encontramos este objetivo en tu espacio personal.')
      ).toBeTruthy()
    );
  });

  it('montar el detalle NO crea ni ejecuta un análisis', async () => {
    const { calls } = await renderDetail();

    await waitFor(() =>
      expect(screen.getByText('Analizar mi trayectoria')).toBeTruthy()
    );

    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    expect(calls.some((call) => call.path.endsWith('/execute'))).toBe(false);
  });
});

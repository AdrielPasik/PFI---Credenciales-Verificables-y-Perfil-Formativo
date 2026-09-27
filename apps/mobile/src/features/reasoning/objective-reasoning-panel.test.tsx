import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { ObjectiveReasoningPanel } from '@/features/reasoning/objective-reasoning-panel';
import {
  evidencePayload,
  FORBIDDEN_INTERNAL_TOKENS,
  reasoningRunDetailPayload,
  reasoningRunSummariesPayload
} from '@/test/objective-fixtures';
import type { JsonObject } from '@/test/objective-fixtures';
import type { RouteMap, StubResponse } from '@/test/http';
import { renderWithProviders } from '@/test/render';

const LIST_ROUTE = 'GET /me/reasoning-runs';
const CREATE_ROUTE = 'POST /me/reasoning-runs';
const DETAIL_ROUTE = 'GET /me/reasoning-runs/run_01';
const EXECUTE_ROUTE = 'POST /me/reasoning-runs/run_01/execute';

function routes({
  list = { body: [] },
  detail,
  create,
  execute
}: {
  list?: StubResponse;
  detail?: StubResponse;
  create?: StubResponse;
  execute?: StubResponse;
} = {}): RouteMap {
  const map: RouteMap = { [LIST_ROUTE]: list };
  if (detail) map[DETAIL_ROUTE] = detail;
  if (create) map[CREATE_ROUTE] = create;
  if (execute) map[EXECUTE_ROUTE] = execute;
  return map;
}

async function renderPanel(routeMap: RouteMap = routes()) {
  return renderWithProviders(
    <ObjectiveReasoningPanel objectiveReference="obj_01" />,
    { routes: routeMap }
  );
}

function summariesWith(status: string): JsonObject[] {
  const summaries = reasoningRunSummariesPayload();
  return [{ ...summaries[1], status }] as JsonObject[];
}

describe('guardas de acciones costosas', () => {
  it('montar el panel sólo LEE: no crea ni ejecuta ningún run', async () => {
    const { calls } = await renderPanel();

    await waitFor(() =>
      expect(screen.getByText('Analizar mi trayectoria')).toBeTruthy()
    );

    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    expect(
      calls.filter((call) => call.path === '/me/reasoning-runs')
    ).toHaveLength(1);
  });

  it('dos toques rápidos producen UNA sola creación y UNA sola ejecución', async () => {
    const { calls } = await renderPanel(
      routes({
        create: { body: reasoningRunDetailPayload({ status: 'pending', result: null, synthesis: null }) },
        execute: { body: reasoningRunDetailPayload() }
      })
    );

    await waitFor(() =>
      expect(screen.getByTestId('reasoning-start')).toBeTruthy()
    );

    const button = screen.getByTestId('reasoning-start');

    // DOS invocaciones en el MISMO tick, antes de que ningún setState se
    // haya aplicado. Es justo lo que el cerrojo tiene que atajar: con un
    // `fireEvent.press` esperado entre medio, el render ya habría cambiado
    // y el test no probaría nada.
    await act(async () => {
      button.props.onClick();
      button.props.onClick();
    });

    await waitFor(() =>
      expect(screen.getByTestId('objective-synthesis')).toBeTruthy()
    );

    expect(
      calls.filter(
        (call) => call.path === '/me/reasoning-runs' && call.method === 'POST'
      )
    ).toHaveLength(1);
    expect(
      calls.filter((call) => call.path.endsWith('/execute'))
    ).toHaveLength(1);
  });

  it('un run que NACE failed no se intenta ejecutar', async () => {
    const { calls } = await renderPanel(
      routes({
        create: {
          body: reasoningRunDetailPayload({
            status: 'failed',
            result: null,
            synthesis: null,
            completedAt: null,
            failedAt: '2026-09-21T10:00:10.000Z',
            failureCategory: 'EVIDENCE_PREPARATION_BLOCKED'
          })
        }
      })
    );

    await waitFor(() =>
      expect(screen.getByTestId('reasoning-start')).toBeTruthy()
    );
    await fireEvent.press(screen.getByTestId('reasoning-start'));

    await waitFor(() =>
      expect(screen.getByText('El análisis no pudo completarse')).toBeTruthy()
    );
    expect(calls.some((call) => call.path.endsWith('/execute'))).toBe(false);
  });
});

describe('ciclo de vida del run', () => {
  it('sin runs ofrece analizar por primera vez', async () => {
    await renderPanel();

    await waitFor(() =>
      expect(screen.getByText('Analizar mi trayectoria')).toBeTruthy()
    );
    expect(screen.getByText(/requisito por\s+requisito/i)).toBeTruthy();
  });

  it('un run pending ofrece continuar, que es el único reintento seguro', async () => {
    await renderPanel(
      routes({
        list: { body: summariesWith('pending') },
        detail: {
          body: reasoningRunDetailPayload({
            status: 'pending',
            result: null,
            synthesis: null,
            completedAt: null
          })
        }
      })
    );

    await waitFor(() =>
      expect(screen.getByTestId('reasoning-continue')).toBeTruthy()
    );
    expect(screen.getByText(/todavía no se completó/i)).toBeTruthy();
  });

  it('continuar ejecuta el MISMO run, sin crear uno nuevo', async () => {
    const { calls } = await renderPanel(
      routes({
        list: { body: summariesWith('pending') },
        detail: {
          body: reasoningRunDetailPayload({
            status: 'pending',
            result: null,
            synthesis: null,
            completedAt: null
          })
        },
        execute: { body: reasoningRunDetailPayload() }
      })
    );

    await waitFor(() =>
      expect(screen.getByTestId('reasoning-continue')).toBeTruthy()
    );
    await fireEvent.press(screen.getByTestId('reasoning-continue'));

    await waitFor(() =>
      expect(screen.getByTestId('objective-synthesis')).toBeTruthy()
    );

    expect(
      calls.some(
        (call) => call.path === '/me/reasoning-runs' && call.method === 'POST'
      )
    ).toBe(false);
    expect(
      calls.filter((call) => call.path.endsWith('/execute'))
    ).toHaveLength(1);
  });

  it('un run running NO se re-ejecuta solo y dice la limitación', async () => {
    const { calls } = await renderPanel(
      routes({
        list: { body: summariesWith('running') },
        detail: {
          body: reasoningRunDetailPayload({
            status: 'running',
            result: null,
            synthesis: null,
            completedAt: null
          })
        }
      })
    );

    await waitFor(() =>
      expect(
        screen.getByText('Hay un análisis en curso para este objetivo.')
      ).toBeTruthy()
    );

    expect(screen.getByText(/no puede retomarse/i)).toBeTruthy();
    expect(calls.some((call) => call.path.endsWith('/execute'))).toBe(false);
    // Sólo ofrece empezar uno nuevo; nunca "continuar" un running.
    expect(screen.queryByTestId('reasoning-continue')).toBeNull();
    expect(screen.getByTestId('reasoning-start-new')).toBeTruthy();
  });

  it('un run failed explica la categoría sin exponer el token', async () => {
    await renderPanel(
      routes({
        list: { body: summariesWith('failed') },
        detail: {
          body: reasoningRunDetailPayload({
            status: 'failed',
            result: null,
            synthesis: null,
            completedAt: null,
            failureCategory: 'EVIDENCE_PREPARATION_BLOCKED'
          })
        }
      })
    );

    await waitFor(() =>
      expect(screen.getByText('El análisis no pudo completarse')).toBeTruthy()
    );

    expect(screen.getByText(/no pudo preparar toda la evidencia/i)).toBeTruthy();
    expect(screen.queryByText(/EVIDENCE_PREPARATION_BLOCKED/)).toBeNull();
    // Y no culpa a la persona.
    expect(screen.queryByText(/no tenés|no cumplís|te falta/i)).toBeNull();
  });

  it('un fallo genérico no inventa una causa', async () => {
    await renderPanel(
      routes({
        list: { body: summariesWith('failed') },
        detail: {
          body: reasoningRunDetailPayload({
            status: 'failed',
            result: null,
            synthesis: null,
            completedAt: null,
            failureCategory: 'EXECUTION_FAILED'
          })
        }
      })
    );

    await waitFor(() =>
      expect(screen.getAllByText('El análisis no pudo completarse').length).toBeGreaterThan(0)
    );
    expect(screen.queryByText(/evidencia de tus credenciales/i)).toBeNull();
  });

  it('un error de lectura ofrece volver a cargar', async () => {
    await renderPanel(routes({ list: { status: 503 } }));

    await waitFor(() =>
      expect(screen.getByText(/no pudimos cargar el análisis/i)).toBeTruthy()
    );
    expect(screen.getByTestId('reasoning-retry')).toBeTruthy();
  });
});

describe('resultado completado', () => {
  async function renderCompleted(detail?: StubResponse) {
    const rendered = await renderPanel(
      routes({
        list: { body: summariesWith('completed') },
        detail: detail ?? { body: reasoningRunDetailPayload() }
      })
    );
    await waitFor(() =>
      expect(screen.getByTestId('objective-synthesis')).toBeTruthy()
    );
    return rendered;
  }

  it('muestra la síntesis que entrega el servidor', async () => {
    await renderCompleted();

    expect(screen.getByText('Resumen del análisis')).toBeTruthy();
    expect(
      screen.getByText(/encontró respaldo formativo para 1 requisito/i)
    ).toBeTruthy();
    expect(screen.getByText('1 respaldado')).toBeTruthy();
    expect(screen.getByText('1 no evaluables con evidencia formativa')).toBeTruthy();
  });

  it('NUNCA muestra un porcentaje de compatibilidad ni un puntaje', async () => {
    await renderCompleted();

    expect(screen.queryByText(/%/)).toBeNull();
    expect(
      screen.queryByText(/compatibilidad|puntaje|score|ranking|apto/i)
    ).toBeNull();
  });

  it('nunca usa lenguaje de déficit sobre la persona', async () => {
    await renderCompleted();

    expect(
      screen.queryByText(/no tenés|no cumplís|no sos apto|te falta|no podés aplicar/i)
    ).toBeNull();
  });

  it('muestra las etiquetas humanas de los cinco estados, no los enums', async () => {
    await renderCompleted();

    expect(screen.getAllByText('Respaldado por tu evidencia').length).toBeGreaterThan(0);
    expect(screen.getByText('No evaluable con evidencia formativa')).toBeTruthy();
    expect(screen.queryByText('SUPPORTED')).toBeNull();
    expect(screen.queryByText('NOT_ASSESSABLE')).toBeNull();
  });

  it('muestra la evidencia con su cita exacta, sección y página', async () => {
    await renderCompleted();

    expect(
      screen.getByText('Programación en Python aplicada a análisis de datos.')
    ).toBeTruthy();
    expect(screen.getByText(/Documento respaldatorio · Contenidos · Página 3/)).toBeTruthy();
  });

  it('NOT_ASSESSABLE no muestra sección de evidencia aunque el backend la proyecte', async () => {
    const payload = reasoningRunDetailPayload();
    const result = payload.result as Record<string, unknown>;
    const results = result.requirementResults as Record<string, unknown>[];
    // El backend PUEDE proyectar evidencia en este estado; la presentación la
    // oculta porque la policy decidió antes de mirarla.
    results[1]!.evidence = [evidencePayload()];

    await renderCompleted({ body: payload });

    expect(screen.queryByText('Evidencia relacionada')).toBeNull();
    expect(screen.getAllByText('Evidencia que respalda este requisito')).toHaveLength(1);
  });

  it('enlaza a la credencial por referencia autoritativa', async () => {
    await renderCompleted();

    expect(
      screen.getByTestId('evidence-open-credential-cred-001')
    ).toBeTruthy();
  });

  it('muestra supportedWeakerClaim cuando existe', async () => {
    const payload = reasoningRunDetailPayload();
    const result = payload.result as Record<string, unknown>;
    const results = result.requirementResults as Record<string, unknown>[];
    results[0]!.finalState = 'PARTIALLY_SUPPORTED';
    results[0]!.supportedWeakerClaim =
      'Puede justificarse formación en Python aplicada a análisis de datos.';

    await renderCompleted({ body: payload });

    expect(
      screen.getAllByText(/Lo que sí puede justificarse/).length
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(
        'Puede justificarse formación en Python aplicada a análisis de datos.'
      )
    ).toBeTruthy();
  });

  it('el estado de la credencial se presenta como ACTUAL', async () => {
    await renderCompleted();

    expect(screen.getByText('Estado actual de la credencial')).toBeTruthy();
    expect(screen.queryByText(/revocada después|se revocó después/i)).toBeNull();
  });

  it('no filtra ningún identificador interno a la pantalla', async () => {
    await renderCompleted();

    for (const token of FORBIDDEN_INTERNAL_TOKENS) {
      if (token === 'schemaVersion') continue;
      expect(screen.queryByText(new RegExp(token, 'i'))).toBeNull();
    }
  });

  it('ofrece analizar de nuevo sin borrar el análisis anterior', async () => {
    await renderCompleted();

    expect(screen.getByTestId('reasoning-start-new')).toBeTruthy();
    expect(screen.getByText(/no borra este/i)).toBeTruthy();
  });
});

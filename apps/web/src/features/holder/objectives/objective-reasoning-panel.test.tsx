/**
 * Analisis de trayectoria en la web — P2.4B.
 *
 * Cubre las tres cosas que pueden salir caras si se rompen en silencio:
 * el lifecycle (no comprar dos veces al proveedor), los cinco estados finales
 * (no convertirlos en aprobado/reprobado) y la frontera de privacidad.
 *
 * CERO LLAMADAS REALES. El cliente esta mockeado entero.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ObjectiveReasoningPanel } from '@/features/holder/objectives/objective-reasoning-panel';
import { ApiError } from '@/lib/errors/api-error';
import type {
  ReasoningRunDetailVM,
  RequirementFinalState,
  RequirementResultVM
} from '@/models/reasoning-runs';

const mocks = vi.hoisted(() => ({
  listRuns: vi.fn(),
  getRun: vi.fn(),
  createRun: vi.fn(),
  executeRun: vi.fn(),
  requestAuthenticated: vi.fn()
}));

vi.mock('@/lib/session/session-provider', () => ({
  useSession: () => ({ requestAuthenticated: mocks.requestAuthenticated })
}));

vi.mock('@/lib/api/reasoning-runs-api', () => ({
  listMyReasoningRunsRequest: mocks.listRuns,
  getMyReasoningRunRequest: mocks.getRun,
  createMyReasoningRunRequest: mocks.createRun,
  executeMyReasoningRunRequest: mocks.executeRun
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const credential = (overrides = {}) => ({
  credentialReference: 'cred-1',
  title: 'Analisis de datos con Python para negocios',
  credentialType: 'course',
  issuerName: 'Plataforma de Cursos Demo',
  currentStatus: 'issued',
  currentStatusLabel: 'Emitida',
  ...overrides
});

const evidence = (overrides = {}) => ({
  excerpt: 'diseno y consumo de APIs REST',
  contextBefore: 'Contenidos: ',
  contextAfter: ' y persistencia.',
  sectionLabel: 'Contenidos',
  pageNumber: 3,
  coverage: 'FULL' as const,
  sourceKind: 'DOCUMENT' as const,
  credential: credential(),
  ...overrides
});

const result = (overrides: Partial<RequirementResultVM> = {}): RequirementResultVM => ({
  requirementId: 'req_01',
  requirementText: 'Experiencia disenando APIs REST',
  finalState: 'SUPPORTED',
  supportedWeakerClaim: null,
  evidence: [evidence()],
  ...overrides
});

const summary = (overrides = {}) => ({
  reasoningRunReference: 'run-1',
  objectiveReference: 'obj-1',
  objectiveTitle: 'Backend Engineer',
  status: 'completed' as const,
  requirementCount: 1,
  failureCategory: null,
  createdAt: '2026-09-11T10:00:00.000Z',
  createdAtLabel: '11 de septiembre de 2026',
  ...overrides
});

const detail = (
  overrides: Partial<ReasoningRunDetailVM> = {}
): ReasoningRunDetailVM => ({
  reasoningRunReference: 'run-1',
  status: 'completed',
  objectiveReference: 'obj-1',
  objectiveTitle: 'Backend Engineer',
  failureCategory: null,
  createdAt: '2026-09-11T10:00:00.000Z',
  createdAtLabel: '11 de septiembre de 2026',
  completedAtLabel: '11 de septiembre de 2026',
  requirementResults: [result()],
  ...overrides
});

const renderPanel = () =>
  render(<ObjectiveReasoningPanel objectiveReference="obj-1" />);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listRuns.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe('lifecycle del analisis', () => {
  it('sin runs ofrece la accion real, y no ejecuta nada sola', async () => {
    renderPanel();

    const cta = await screen.findByRole('button', { name: 'Analizar mi trayectoria' });
    expect(cta.hasAttribute('disabled')).toBe(false);
    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(mocks.executeRun).not.toHaveBeenCalled();
  });

  it('crear y ejecutar ocurre UNA sola vez por click', async () => {
    mocks.createRun.mockResolvedValue(detail({ status: 'pending', requirementResults: null }));
    mocks.executeRun.mockResolvedValue(detail());
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Analizar mi trayectoria' }));

    await screen.findByText('Experiencia disenando APIs REST');
    expect(mocks.createRun).toHaveBeenCalledTimes(1);
    expect(mocks.executeRun).toHaveBeenCalledTimes(1);
    expect(mocks.executeRun).toHaveBeenCalledWith(expect.anything(), 'run-1');
  });

  it('un doble click no compra dos analisis', async () => {
    let release: (value: ReasoningRunDetailVM) => void = () => {};
    mocks.createRun.mockReturnValue(
      new Promise<ReasoningRunDetailVM>((resolve) => {
        release = resolve;
      })
    );
    mocks.executeRun.mockResolvedValue(detail());
    renderPanel();

    const cta = await screen.findByRole('button', { name: 'Analizar mi trayectoria' });
    fireEvent.click(cta);
    // El segundo click llega mientras el primero sigue en vuelo.
    fireEvent.click(cta);

    release(detail({ status: 'pending', requirementResults: null }));
    await screen.findByText('Experiencia disenando APIs REST');
    expect(mocks.createRun).toHaveBeenCalledTimes(1);
    expect(mocks.executeRun).toHaveBeenCalledTimes(1);
  });

  it('un run pending ofrece continuar, y ejecuta sin volver a crear', async () => {
    mocks.listRuns.mockResolvedValue([summary({ status: 'pending' })]);
    mocks.getRun.mockResolvedValue(
      detail({ status: 'pending', requirementResults: null, completedAtLabel: null })
    );
    mocks.executeRun.mockResolvedValue(detail());
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Continuar analisis' }));

    await screen.findByText('Experiencia disenando APIs REST');
    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(mocks.executeRun).toHaveBeenCalledTimes(1);
  });

  it('un run running NO se reintenta ni se reclama', async () => {
    mocks.listRuns.mockResolvedValue([summary({ status: 'running' })]);
    mocks.getRun.mockResolvedValue(
      detail({ status: 'running', requirementResults: null, completedAtLabel: null })
    );
    renderPanel();

    await screen.findByText('Hay un analisis en curso para este objetivo.');
    expect(screen.queryByRole('button', { name: 'Continuar analisis' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reintentar/ })).toBeNull();
    expect(mocks.executeRun).not.toHaveBeenCalled();
    // La limitacion se dice, y la salida segura es un run nuevo.
    expect(
      screen.getByRole('button', { name: 'Iniciar un analisis nuevo' })
    ).toBeTruthy();
  });

  it('un run failed no se reejecuta en la misma fila', async () => {
    mocks.listRuns.mockResolvedValue([summary({ status: 'failed' })]);
    mocks.getRun.mockResolvedValue(
      detail({
        status: 'failed',
        requirementResults: null,
        completedAtLabel: null,
        failureCategory: 'EVIDENCE_PREPARATION_BLOCKED'
      })
    );
    renderPanel();

    await screen.findByText('El analisis no pudo completarse');
    expect(screen.getByText(/No pudimos preparar la evidencia/)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Iniciar un analisis nuevo' })
    ).toBeTruthy();
    expect(mocks.executeRun).not.toHaveBeenCalled();
  });

  it('un run que NACE failed no se intenta ejecutar', async () => {
    mocks.createRun.mockResolvedValue(
      detail({
        status: 'failed',
        requirementResults: null,
        failureCategory: 'EVIDENCE_PREPARATION_BLOCKED'
      })
    );
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Analizar mi trayectoria' }));

    await screen.findByText('El analisis no pudo completarse');
    expect(mocks.executeRun).not.toHaveBeenCalled();
  });

  it('un run completado se muestra sin volver a ejecutarlo', async () => {
    mocks.listRuns.mockResolvedValue([summary()]);
    mocks.getRun.mockResolvedValue(detail());
    renderPanel();

    await screen.findByText('Experiencia disenando APIs REST');
    expect(mocks.executeRun).not.toHaveBeenCalled();
    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(mocks.getRun).toHaveBeenCalledTimes(1);
  });

  it('el estado largo se muestra mientras la ejecucion esta en vuelo', async () => {
    let release: (value: ReasoningRunDetailVM) => void = () => {};
    mocks.createRun.mockResolvedValue(
      detail({ status: 'pending', requirementResults: null })
    );
    mocks.executeRun.mockReturnValue(
      new Promise<ReasoningRunDetailVM>((resolve) => {
        release = resolve;
      })
    );
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Analizar mi trayectoria' }));

    await screen.findByText('Analizando tu trayectoria frente a este objetivo...');
    // Sin porcentaje inventado y sin nombres de etapa.
    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/\d+\s*%/);
    expect(body).not.toContain('Evidence Units');
    expect(body).not.toContain('Contextual');

    release(detail());
    await screen.findByText('Experiencia disenando APIs REST');
  });

  it('un fallo de ejecucion no expone nada interno', async () => {
    mocks.createRun.mockResolvedValue(
      detail({ status: 'pending', requirementResults: null })
    );
    mocks.executeRun.mockRejectedValue(new ApiError('x', 'http', 503));
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Analizar mi trayectoria' }));

    await screen.findByText(/El analisis no se pudo completar en este momento/);
    const body = document.body.textContent ?? '';
    for (const forbidden of ['openai', 'gpt-', 'PROVIDER_', 'failureCode', '503']) {
      expect(body.includes(forbidden), `expone ${forbidden}`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Seleccion de run
// ---------------------------------------------------------------------------

describe('seleccion del run a mostrar', () => {
  it('ignora los runs de otros objetivos', async () => {
    mocks.listRuns.mockResolvedValue([
      summary({ objectiveReference: 'obj-9', reasoningRunReference: 'run-ajeno' })
    ]);
    renderPanel();

    await screen.findByRole('button', { name: 'Analizar mi trayectoria' });
    expect(mocks.getRun).not.toHaveBeenCalled();
  });

  it('un pending gana sobre un completado viejo: si no, seria inalcanzable', async () => {
    mocks.listRuns.mockResolvedValue([
      summary({ reasoningRunReference: 'run-2', status: 'pending' }),
      summary({ reasoningRunReference: 'run-1', status: 'completed' })
    ]);
    mocks.getRun.mockResolvedValue(
      detail({
        reasoningRunReference: 'run-2',
        status: 'pending',
        requirementResults: null
      })
    );
    renderPanel();

    await screen.findByRole('button', { name: 'Continuar analisis' });
    expect(mocks.getRun).toHaveBeenCalledWith(expect.anything(), 'run-2');
  });

  it('un completado gana sobre un failed: el resultado sigue disponible', async () => {
    mocks.listRuns.mockResolvedValue([
      summary({ reasoningRunReference: 'run-3', status: 'failed' }),
      summary({ reasoningRunReference: 'run-1', status: 'completed' })
    ]);
    mocks.getRun.mockResolvedValue(detail());
    renderPanel();

    await screen.findByText('Experiencia disenando APIs REST');
    expect(mocks.getRun).toHaveBeenCalledWith(expect.anything(), 'run-1');
  });

  it('los analisis anteriores siguen siendo visibles', async () => {
    mocks.listRuns.mockResolvedValue([
      summary({ reasoningRunReference: 'run-1' }),
      summary({
        reasoningRunReference: 'run-0',
        createdAtLabel: '01 de septiembre de 2026'
      })
    ]);
    mocks.getRun.mockResolvedValue(detail());
    renderPanel();

    await screen.findByText('Experiencia disenando APIs REST');
    expect(screen.getByText(/Analisis anteriores \(1\)/)).toBeTruthy();
    expect(screen.getByText(/01 de septiembre de 2026/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Los cinco estados
// ---------------------------------------------------------------------------

const EXPECTED_LABELS: Record<RequirementFinalState, string> = {
  SUPPORTED: 'Respaldado por tu evidencia',
  PARTIALLY_SUPPORTED: 'Respaldado parcialmente',
  INSUFFICIENT_EVIDENCE: 'Evidencia insuficiente',
  NOT_ASSESSABLE: 'No evaluable con evidencia formativa',
  ABSTAIN: 'No se pudo determinar con suficiente confiabilidad'
};

describe('los cinco estados finales', () => {
  beforeEach(() => {
    mocks.listRuns.mockResolvedValue([summary()]);
  });

  it.each(Object.entries(EXPECTED_LABELS))(
    '%s se muestra como "%s" y sin el token crudo',
    async (finalState, label) => {
      mocks.getRun.mockResolvedValue(
        detail({
          requirementResults: [
            result({ finalState: finalState as RequirementFinalState, evidence: [] })
          ]
        })
      );
      renderPanel();

      expect(await screen.findByText(label)).toBeTruthy();
      expect((document.body.textContent ?? '').includes(finalState)).toBe(false);
    }
  );

  it('INSUFFICIENT_EVIDENCE habla de la evidencia, no de la persona', async () => {
    mocks.getRun.mockResolvedValue(
      detail({
        requirementResults: [
          result({ finalState: 'INSUFFICIENT_EVIDENCE', evidence: [] })
        ]
      })
    );
    renderPanel();

    expect(
      await screen.findByText(
        'No encontramos evidencia suficiente en las credenciales disponibles para justificar este requisito.'
      )
    ).toBeTruthy();

    const body = document.body.textContent ?? '';
    for (const forbidden of [
      'No tenes',
      'No cumplis',
      'No sos apto',
      'Te falta',
      'match'
    ]) {
      expect(body.includes(forbidden), `dice "${forbidden}"`).toBe(false);
    }
  });

  it('ABSTAIN es un resultado, no una pantalla de error', async () => {
    mocks.getRun.mockResolvedValue(
      detail({ requirementResults: [result({ finalState: 'ABSTAIN', evidence: [] })] })
    );
    renderPanel();

    await screen.findByText('No se pudo determinar con suficiente confiabilidad');
    // Se muestra junto al requisito, no como alerta ni como fallo del analisis.
    expect(screen.getByText('Experiencia disenando APIs REST')).toBeTruthy();
    expect(screen.queryByText('El analisis no pudo completarse')).toBeNull();
  });

  it('PARTIALLY_SUPPORTED muestra el claim mas debil cuando existe', async () => {
    mocks.getRun.mockResolvedValue(
      detail({
        requirementResults: [
          result({
            finalState: 'PARTIALLY_SUPPORTED',
            supportedWeakerClaim: 'Exposicion formativa a diseno de APIs REST.'
          })
        ]
      })
    );
    renderPanel();

    await screen.findByText('Respaldado parcialmente');
    expect(
      screen.getByText('Lo que si puede justificarse con la evidencia disponible')
    ).toBeTruthy();
    expect(
      screen.getByText('Exposicion formativa a diseno de APIs REST.')
    ).toBeTruthy();
  });

  it('sin claim mas debil no se inventa uno', async () => {
    mocks.getRun.mockResolvedValue(
      detail({
        requirementResults: [result({ finalState: 'PARTIALLY_SUPPORTED' })]
      })
    );
    renderPanel();

    await screen.findByText('Respaldado parcialmente');
    expect(
      screen.queryByText('Lo que si puede justificarse con la evidencia disponible')
    ).toBeNull();
  });

  it('el recuento es descriptivo y nunca un porcentaje', async () => {
    mocks.getRun.mockResolvedValue(
      detail({
        requirementResults: [
          result({ requirementId: 'req_01', finalState: 'SUPPORTED' }),
          result({
            requirementId: 'req_02',
            requirementText: 'Segundo requisito',
            finalState: 'INSUFFICIENT_EVIDENCE',
            evidence: []
          })
        ]
      })
    );
    renderPanel();

    await screen.findByText('Segundo requisito');
    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/\d+\s*%/);
    expect(body).not.toMatch(/compatibilidad|puntaje|score|ranking/i);
  });
});

// ---------------------------------------------------------------------------
// Evidencia
// ---------------------------------------------------------------------------

describe('evidencia', () => {
  beforeEach(() => {
    mocks.listRuns.mockResolvedValue([summary()]);
  });

  it('muestra credencial, emisor, cita exacta y pagina', async () => {
    mocks.getRun.mockResolvedValue(detail());
    renderPanel();

    expect(
      await screen.findByText('Analisis de datos con Python para negocios')
    ).toBeTruthy();
    expect(screen.getByText('Plataforma de Cursos Demo')).toBeTruthy();
    expect(screen.getAllByText(/diseno y consumo de APIs REST/).length).toBeGreaterThan(0);
    expect(screen.getByText('Pagina 3')).toBeTruthy();
    expect(screen.getByText('Contenidos')).toBeTruthy();
  });

  it('enlaza a la credencial del holder, no a una superficie publica', async () => {
    mocks.getRun.mockResolvedValue(detail());
    renderPanel();

    const link = await screen.findByRole('link', { name: /Ver credencial/ });
    expect(link.getAttribute('href')).toBe('/wallet/credentials/cred-1');
  });

  it('sin pagina no dibuja ninguna', async () => {
    mocks.getRun.mockResolvedValue(
      detail({
        requirementResults: [
          result({
            evidence: [
              evidence({ pageNumber: null, sourceKind: 'TEXT', sectionLabel: null })
            ]
          })
        ]
      })
    );
    renderPanel();

    await screen.findAllByText(/diseno y consumo de APIs REST/);
    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/Pagina/);
    expect(body).not.toContain('desconocida');
  });

  it('agrupa por credencial y conserva las dos citas', async () => {
    mocks.getRun.mockResolvedValue(
      detail({
        requirementResults: [
          result({
            evidence: [
              evidence(),
              evidence({ excerpt: 'integro servicios REST en produccion' })
            ]
          })
        ]
      })
    );
    renderPanel();

    await screen.findAllByText(/diseno y consumo de APIs REST/);
    expect(screen.getAllByText(/integro servicios REST en produccion/).length).toBeGreaterThan(0);
    // Una sola tarjeta de credencial para las dos citas.
    expect(
      screen.getAllByText('Analisis de datos con Python para negocios')
    ).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: /Ver credencial/ })).toHaveLength(1);
  });

  it('dos credenciales distintas no se colapsan', async () => {
    mocks.getRun.mockResolvedValue(
      detail({
        requirementResults: [
          result({
            evidence: [
              evidence(),
              evidence({
                excerpt: 'practica profesional en backend',
                credential: credential({
                  credentialReference: 'cred-2',
                  title: 'Programa de formacion en backend',
                  issuerName: 'Instituto Demo'
                })
              })
            ]
          })
        ]
      })
    );
    renderPanel();

    await screen.findByText('Analisis de datos con Python para negocios');
    expect(screen.getByText('Programa de formacion en backend')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /Ver credencial/ })).toHaveLength(2);
  });

  it('sin credencial conserva la cita y no inventa una asociacion', async () => {
    mocks.getRun.mockResolvedValue(
      detail({
        requirementResults: [result({ evidence: [evidence({ credential: null })] })]
      })
    );
    renderPanel();

    expect((await screen.findAllByText(/diseno y consumo de APIs REST/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: /Ver credencial/ })).toBeNull();
  });

  it('el estado de la credencial se muestra como ACTUAL', async () => {
    mocks.getRun.mockResolvedValue(
      detail({
        requirementResults: [
          result({
            evidence: [
              evidence({
                credential: credential({
                  currentStatus: 'revoked',
                  currentStatusLabel: 'Revocada'
                })
              })
            ]
          })
        ]
      })
    );
    renderPanel();

    expect(
      await screen.findByText('Estado actual de la credencial: Revocada')
    ).toBeTruthy();

    // NUNCA en pasado: el backend no sabe cual era su estado durante el run.
    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/despues del analisis|al momento del analisis/i);
    // Y el resultado historico no se oculta ni se invalida.
    expect(screen.getByText('Respaldado por tu evidencia')).toBeTruthy();
    expect(screen.getAllByText(/diseno y consumo de APIs REST/).length).toBeGreaterThan(0);
  });

  it('una extraccion parcial se avisa como problema de la FUENTE', async () => {
    mocks.getRun.mockResolvedValue(
      detail({
        requirementResults: [
          result({ evidence: [evidence({ coverage: 'PARTIAL' })] })
        ]
      })
    );
    renderPanel();

    expect(
      await screen.findByText(/La extraccion de esta fuente fue parcial/)
    ).toBeTruthy();
    // Sigue contando como respaldo: la cobertura no degrada el estado final.
    expect(screen.getByText('Respaldado por tu evidencia')).toBeTruthy();
  });

  it('sin evidencia no dibuja la seccion', async () => {
    mocks.getRun.mockResolvedValue(
      detail({
        requirementResults: [
          result({ finalState: 'NOT_ASSESSABLE', evidence: [] })
        ]
      })
    );
    renderPanel();

    await screen.findByText('No evaluable con evidencia formativa');
    expect(screen.queryByText('Evidencia utilizada')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Privacidad
// ---------------------------------------------------------------------------

describe('frontera de privacidad', () => {
  it('el DOM no expone ningun identificador ni dato interno', async () => {
    mocks.listRuns.mockResolvedValue([summary()]);
    mocks.getRun.mockResolvedValue(
      detail({
        requirementResults: [
          result({ finalState: 'PARTIALLY_SUPPORTED', supportedWeakerClaim: 'X.' }),
          result({
            requirementId: 'req_02',
            requirementText: 'Segundo',
            finalState: 'ABSTAIN',
            evidence: []
          })
        ]
      })
    );
    renderPanel();

    await screen.findByText('Segundo');
    const body = document.body.textContent ?? '';
    for (const forbidden of [
      'src_',
      'eu_',
      'req_01',
      'req_02',
      'run-1',
      'cred-1',
      'sourceId',
      'evidenceUnitId',
      'charStart',
      'charEnd',
      'sourceSha256',
      'segmentId',
      'artifactBlobSha256',
      'storageKey',
      'openai',
      'OpenAI',
      'gpt-',
      'prompt',
      'reasoningEffort',
      'FORMATIVE_EVIDENCE',
      'DIRECT_SUPPORT',
      'explanation',
      'Objetivo epistemologico',
      'Claim ceiling',
      'DOCUMENT',
      'ISSUER_DECLARED'
    ]) {
      expect(body.includes(forbidden), `el DOM expone "${forbidden}"`).toBe(false);
    }
  });

  it('el enlace a la credencial es descriptivo y el estado no depende del color', async () => {
    mocks.listRuns.mockResolvedValue([summary()]);
    mocks.getRun.mockResolvedValue(detail());
    renderPanel();

    const link = await screen.findByRole('link', {
      name: 'Ver credencial: Analisis de datos con Python para negocios'
    });
    expect(link).toBeTruthy();
    // La etiqueta de estado es TEXTO legible, no solo un color.
    expect(screen.getByText('Respaldado por tu evidencia')).toBeTruthy();
  });

  it('anuncia los cambios de estado con aria-live', async () => {
    mocks.listRuns.mockResolvedValue([summary()]);
    mocks.getRun.mockResolvedValue(detail());
    const { container } = renderPanel();

    await waitFor(() =>
      expect(container.querySelector('[aria-live="polite"]')).toBeTruthy()
    );
  });
});

// ---------------------------------------------------------------------------
// Reconciliacion: el desenlace de la ejecucion es la verdad
// ---------------------------------------------------------------------------

describe('reconciliacion del run ejecutado', () => {
  it('de "analizando" a resultados SIN recargar y sin releer', async () => {
    let release: (value: ReasoningRunDetailVM) => void = () => {};
    mocks.createRun.mockResolvedValue(
      detail({ status: 'pending', requirementResults: null })
    );
    mocks.executeRun.mockReturnValue(
      new Promise<ReasoningRunDetailVM>((resolve) => {
        release = resolve;
      })
    );
    renderPanel();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Analizar mi trayectoria' })
    );
    await screen.findByText('Analizando tu trayectoria frente a este objetivo...');

    const readsBefore = mocks.getRun.mock.calls.length;
    release(detail({ requirementResults: [result({ finalState: 'SUPPORTED' })] }));

    // El resultado sale de la respuesta del execute, que YA trae el detalle
    // completo. Un GET posterior seria trabajo de red inventado.
    expect(await screen.findByText('Respaldado por tu evidencia')).toBeTruthy();
    expect(
      screen.queryByText('Analizando tu trayectoria frente a este objetivo...')
    ).toBeNull();
    expect(mocks.getRun.mock.calls.length).toBe(readsBefore);
    expect(mocks.listRuns).toHaveBeenCalledTimes(1);
    expect(mocks.createRun).toHaveBeenCalledTimes(1);
    expect(mocks.executeRun).toHaveBeenCalledTimes(1);
  });

  it('el completado reemplaza al pending del MISMO run, sin duplicar historial', async () => {
    mocks.listRuns.mockResolvedValue([summary({ status: 'pending' })]);
    mocks.getRun.mockResolvedValue(
      detail({ status: 'pending', requirementResults: null })
    );
    mocks.executeRun.mockResolvedValue(detail({ status: 'completed' }));
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Continuar analisis' }));
    await screen.findByText('Experiencia disenando APIs REST');

    // Un solo run logico: ni la oferta de continuar sobrevive, ni aparece un
    // bloque de "analisis anteriores" que seria el mismo run contado dos veces.
    expect(screen.queryByRole('button', { name: 'Continuar analisis' })).toBeNull();
    expect(screen.queryByText(/Analisis anteriores/)).toBeNull();
    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(mocks.executeRun).toHaveBeenCalledTimes(1);
  });

  it('una lectura VIEJA que llega tarde no degrada el run completado', async () => {
    /*
      La carrera real: `requestAuthenticated` se recrea en cada render del
      proveedor de sesion, asi que el efecto de lectura puede volver a
      dispararse EN MEDIO de una ejecucion. Si esa lectura —que ve el run
      todavia `pending`— resolviera despues del execute, pisaria el resultado y
      la pantalla volveria a ofrecer "continuar" un analisis ya terminado.
    */
    let releaseStaleRead: (value: ReasoningRunDetailVM) => void = () => {};
    let releaseExecute: (value: ReasoningRunDetailVM) => void = () => {};

    mocks.createRun.mockResolvedValue(
      detail({ status: 'pending', requirementResults: null })
    );
    mocks.executeRun.mockReturnValue(
      new Promise<ReasoningRunDetailVM>((resolve) => {
        releaseExecute = resolve;
      })
    );

    const { rerender } = render(<ObjectiveReasoningPanel objectiveReference="obj-1" />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Analizar mi trayectoria' })
    );
    await screen.findByText('Analizando tu trayectoria frente a este objetivo...');

    // El proveedor de sesion re-renderiza: nueva identidad, el efecto se repite.
    mocks.listRuns.mockResolvedValue([summary({ status: 'pending' })]);
    mocks.getRun.mockReturnValue(
      new Promise<ReasoningRunDetailVM>((resolve) => {
        releaseStaleRead = resolve;
      })
    );
    mocks.requestAuthenticated = vi.fn();
    rerender(<ObjectiveReasoningPanel objectiveReference="obj-1" />);

    releaseExecute(detail({ status: 'completed' }));
    await screen.findByText('Experiencia disenando APIs REST');

    // Recien AHORA llega la foto vieja. Tiene que perder.
    releaseStaleRead(detail({ status: 'pending', requirementResults: null }));
    await waitFor(() => {
      expect(screen.getByText('Experiencia disenando APIs REST')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Continuar analisis' })).toBeNull();
    expect(
      screen.queryByText('Analizando tu trayectoria frente a este objetivo...')
    ).toBeNull();
    expect(mocks.createRun).toHaveBeenCalledTimes(1);
    expect(mocks.executeRun).toHaveBeenCalledTimes(1);
  });

  it('un fallo de ejecucion tambien cierra el estado de carga', async () => {
    mocks.createRun.mockResolvedValue(
      detail({ status: 'pending', requirementResults: null })
    );
    mocks.executeRun.mockRejectedValue(new ApiError('x', 'http', 503));
    renderPanel();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Analizar mi trayectoria' })
    );

    await screen.findByText(/El analisis no se pudo completar en este momento/);
    expect(
      screen.queryByText('Analizando tu trayectoria frente a este objetivo...')
    ).toBeNull();
    // Sin reintento automatico ni segundo run.
    expect(mocks.createRun).toHaveBeenCalledTimes(1);
    expect(mocks.executeRun).toHaveBeenCalledTimes(1);
  });

  it('un run YA completado se renderiza al abrir, sin ejecutar nada', async () => {
    mocks.listRuns.mockResolvedValue([summary()]);
    mocks.getRun.mockResolvedValue(detail());
    renderPanel();

    await screen.findByText('Experiencia disenando APIs REST');
    expect(screen.queryByRole('button', { name: 'Analizar mi trayectoria' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continuar analisis' })).toBeNull();
    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(mocks.executeRun).not.toHaveBeenCalled();
    expect(mocks.listRuns).toHaveBeenCalledTimes(1);
    expect(mocks.getRun).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Que dice la evidencia segun el estado
// ---------------------------------------------------------------------------

describe('semantica de la evidencia por estado final', () => {
  beforeEach(() => {
    mocks.listRuns.mockResolvedValue([summary()]);
  });

  const renderWith = (overrides: Partial<RequirementResultVM>) => {
    mocks.getRun.mockResolvedValue(detail({ requirementResults: [result(overrides)] }));
    renderPanel();
  };

  it('SUPPORTED presenta la evidencia como respaldo, con la cita exacta', async () => {
    renderWith({ finalState: 'SUPPORTED' });

    expect(await screen.findByText('Evidencia que respalda este requisito')).toBeTruthy();
    expect(screen.getByText('Analisis de datos con Python para negocios')).toBeTruthy();
    expect(screen.getAllByText(/diseno y consumo de APIs REST/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/no alcanza para justificar/)).toBeNull();
  });

  it('PARTIALLY_SUPPORTED dice parcialmente y conserva el claim mas debil', async () => {
    renderWith({
      finalState: 'PARTIALLY_SUPPORTED',
      supportedWeakerClaim: 'Cobertura formativa de fundamentos de APIs REST.'
    });

    expect(
      await screen.findByText('Evidencia que respalda parcialmente este requisito')
    ).toBeTruthy();
    expect(
      screen.getByText('Cobertura formativa de fundamentos de APIs REST.')
    ).toBeTruthy();
    expect(screen.queryByText('Evidencia que respalda este requisito')).toBeNull();
  });

  it('INSUFFICIENT_EVIDENCE con evidencia la llama considerada, no respaldo', async () => {
    renderWith({ finalState: 'INSUFFICIENT_EVIDENCE' });

    expect(await screen.findByText('Evidencia considerada')).toBeTruthy();
    expect(
      screen.getByText(
        'La evidencia disponible no alcanza para justificar este requisito.'
      )
    ).toBeTruthy();
    expect(screen.queryByText('Evidencia que respalda este requisito')).toBeNull();
    expect(screen.queryByText('Evidencia utilizada')).toBeNull();

    const body = document.body.textContent ?? '';
    for (const forbidden of ['No tenes', 'No cumplis', 'Te falta']) {
      expect(body.includes(forbidden), forbidden).toBe(false);
    }
  });

  it('INSUFFICIENT_EVIDENCE sin evidencia no dibuja un contenedor vacio', async () => {
    renderWith({ finalState: 'INSUFFICIENT_EVIDENCE', evidence: [] });

    await screen.findByText('Evidencia insuficiente');
    expect(screen.queryByText('Evidencia considerada')).toBeNull();
    expect(
      screen.getByText(
        'No encontramos evidencia suficiente en las credenciales disponibles para justificar este requisito.'
      )
    ).toBeTruthy();
  });

  it('ABSTAIN la llama relacionada, y sigue siendo un resultado', async () => {
    renderWith({ finalState: 'ABSTAIN' });

    expect(await screen.findByText('Evidencia relacionada')).toBeTruthy();
    expect(screen.getByText(/no permitio llegar a una conclusion confiable/)).toBeTruthy();
    expect(screen.queryByText('Evidencia que respalda este requisito')).toBeNull();
    expect(screen.queryByText('El analisis no pudo completarse')).toBeNull();
  });

  it('NOT_ASSESSABLE no muestra la evidencia proyectada', async () => {
    /*
      El caso exacto del smoke: tres anos de experiencia profesional con la cita
      de una credencial de APIs REST debajo. La policy decidio ese estado sin
      mirar la evidencia; mostrarla afirmaria una participacion que no hubo.
    */
    renderWith({
      requirementText:
        'Contar con al menos 3 anos de experiencia profesional en un rol equivalente.',
      finalState: 'NOT_ASSESSABLE'
    });

    expect(await screen.findByText('No evaluable con evidencia formativa')).toBeTruthy();
    expect(
      screen.getByText(
        'Este requisito no puede evaluarse de forma confiable a partir de credenciales formativas.'
      )
    ).toBeTruthy();

    for (const forbidden of [
      'Evidencia utilizada',
      'Evidencia que respalda este requisito',
      'Evidencia considerada',
      'Evidencia relacionada'
    ]) {
      expect(screen.queryByText(forbidden), forbidden).toBeNull();
    }
    // La credencial de REST no aparece debajo del requisito de trayectoria.
    expect(screen.queryByText('Analisis de datos con Python para negocios')).toBeNull();
    expect(document.body.textContent).not.toContain('diseno y consumo de APIs REST');
  });

  it('la evidencia de REST nunca se describe como respaldo de Kubernetes', async () => {
    renderWith({
      requirementId: 'req_02',
      requirementText: 'Kubernetes',
      finalState: 'INSUFFICIENT_EVIDENCE'
    });

    await screen.findByText('Kubernetes');
    expect(screen.getByText('Evidencia considerada')).toBeTruthy();
    expect(screen.queryByText('Evidencia que respalda este requisito')).toBeNull();
    expect(
      screen.queryByText('Evidencia que respalda parcialmente este requisito')
    ).toBeNull();
  });
});

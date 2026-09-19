/**
 * Experiencia publica del verificador, de punta a punta.
 *
 * Lo que estos tests defienden:
 *
 *   1. el token de sesion vive SOLO en sessionStorage, nunca en la URL ni en el DOM;
 *   2. al recargar, el paso lo decide el SERVIDOR;
 *   3. perder la respuesta del POST de ejecucion NO crea otra solicitud;
 *   4. cada fallo ofrece exactamente el camino que el backend permite;
 *   5. el resultado no muestra citas, ids internos, puntajes ni ranking.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/errors/api-error';
import type { PublicAnalysisResultVM, PublicVerificationSessionVM } from '@/models/public-analysis';

const api = vi.hoisted(() => ({
  createVerificationRequestRequest: vi.fn(),
  proposeVerificationRequirementsRequest: vi.fn(),
  getVerificationSessionRequest: vi.fn(),
  confirmVerificationRequirementsRequest: vi.fn(),
  executeVerificationAnalysisRequest: vi.fn(),
  getVerificationResultRequest: vi.fn()
}));
const shareApi = vi.hoisted(() => ({ getPublicProfileShareRequest: vi.fn() }));

vi.mock('@/lib/api/public-analysis-api', () => api);
vi.mock('@/lib/api/profile-sharing-api', () => shareApi);

import { PublicAnalysisRoute } from './public-analysis-route';
import { requestTokenStorageKey } from './request-token-storage';

const SHARE_TOKEN = 's'.repeat(43);
const REQUEST_TOKEN = 'r'.repeat(43);

function profile(contextualVerificationEnabled = true) {
  return {
    holderLabel: 'Titular Demo',
    narrative: null,
    areas: [],
    skills: [],
    concepts: [],
    totalOfficialHoursLabel: null,
    credentialsCount: 1,
    credentials: [],
    contextualVerificationEnabled
  };
}

function session(
  overrides: Partial<PublicVerificationSessionVM> = {}
): PublicVerificationSessionVM {
  return {
    status: 'requirements_proposed',
    objectiveType: 'EMPLOYMENT',
    objectiveTypeLabel: 'Busqueda laboral',
    rawObjectiveText: 'Buscamos backend junior',
    objectiveTitle: 'Backend junior',
    proposal: {
      candidates: [
        {
          candidateId: 'cand_01',
          proposedRequirementText: 'Diseño de APIs REST',
          primaryExcerpt: 'backend junior',
          excerptRange: { start: 9, end: 23 },
          grounding: 'UNIQUE',
          confirmableAsSourceDerived: true,
          sourceSectionLabel: null,
          isExactDuplicate: false
        }
      ],
      unresolvedPassageCount: 0
    },
    proposalInProgress: false,
    confirmedRequirements: [],
    expiresAtLabel: null,
    ...overrides
  };
}

function result(overrides: Partial<PublicAnalysisResultVM> = {}): PublicAnalysisResultVM {
  return {
    state: 'PROCESSING',
    objective: null,
    completedAtLabel: null,
    failure: null,
    result: null,
    ...overrides
  };
}

function completedResult(): PublicAnalysisResultVM {
  return {
    state: 'COMPLETED',
    completedAtLabel: '16 sept 2026',
    failure: null,
    objective: {
      objectiveType: 'EMPLOYMENT',
      objectiveTypeLabel: 'Busqueda laboral',
      title: 'Backend junior',
      objectiveContext: 'Equipo de plataforma',
      requirements: [{ order: 1, requirementText: 'Diseño de APIs REST' }]
    },
    result: {
      requirements: [
        {
          order: 1,
          requirementText: 'Diseño de APIs REST',
          finalState: 'PARTIALLY_SUPPORTED',
          finalStateLabel: 'Respaldado parcialmente',
          supportedWeakerClaim: 'Exposición formativa a diseño de APIs REST.',
          supportingCredentials: [
            {
              credentialReference: 'cred-1',
              title: 'Curso de APIs',
              credentialTypeLabel: 'Curso',
              issuerName: 'Universidad Demo',
              currentStatus: 'revoked',
              currentStatusLabel: 'Revocada',
              sourceKindLabels: ['Documento'],
              supportingUnitCount: 1
            }
          ]
        },
        {
          order: 2,
          requirementText: 'Experiencia con Kubernetes',
          finalState: 'INSUFFICIENT_EVIDENCE',
          finalStateLabel: 'Evidencia insuficiente',
          supportedWeakerClaim: null,
          supportingCredentials: []
        }
      ],
      synthesis: {
        stateSummary: [
          { state: 'SUPPORTED', label: 'Respaldado por la evidencia compartida', count: 0 },
          { state: 'PARTIALLY_SUPPORTED', label: 'Respaldado parcialmente', count: 1 },
          { state: 'INSUFFICIENT_EVIDENCE', label: 'Evidencia insuficiente', count: 1 },
          { state: 'NOT_ASSESSABLE', label: 'No evaluable con esta evidencia', count: 0 },
          { state: 'ABSTAIN', label: 'No se pudo determinar con suficiente confiabilidad', count: 0 }
        ],
        totalRequirements: 2,
        positiveConclusions: [
          {
            order: 1,
            requirementText: 'Diseño de APIs REST',
            finalState: 'PARTIALLY_SUPPORTED',
            finalStateLabel: 'Respaldado parcialmente',
            supportedWeakerClaim: 'Exposición formativa a diseño de APIs REST.',
            supportingCredentialReferences: ['cred-1']
          }
        ],
        supportingCredentials: [
          {
            credentialReference: 'cred-1',
            title: 'Curso de APIs',
            credentialTypeLabel: 'Curso',
            issuerName: 'Universidad Demo',
            currentStatus: 'revoked',
            currentStatusLabel: 'Revocada',
            supportedRequirementOrders: [],
            partiallySupportedRequirementOrders: [1]
          }
        ]
      },
      temporalNotice:
        'El análisis refleja la evidencia disponible al momento de su ejecución. El estado que se muestra de cada credencial corresponde a su estado actual.'
    }
  };
}

beforeEach(() => {
  for (const mock of Object.values({ ...api, ...shareApi })) mock.mockReset();
  shareApi.getPublicProfileShareRequest.mockResolvedValue(profile());
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

function renderRoute() {
  return render(<PublicAnalysisRoute token={SHARE_TOKEN} />);
}

// ---------------------------------------------------------------------------
// Sesión y almacenamiento
// ---------------------------------------------------------------------------

it('sin sesión guardada empieza por el objetivo y no consulta la sesión del servidor', async () => {
  renderRoute();
  expect(await screen.findByRole('heading', { name: '¿Qué querés analizar?' })).toBeTruthy();
  expect(api.getVerificationSessionRequest).not.toHaveBeenCalled();
});

it('guarda el token SOLO en sessionStorage: nunca en la URL, en localStorage ni en el DOM', async () => {
  api.createVerificationRequestRequest.mockResolvedValue({
    requestToken: REQUEST_TOKEN,
    session: session({ status: 'draft', proposal: null })
  });
  api.proposeVerificationRequirementsRequest.mockResolvedValue(session());

  renderRoute();
  fireEvent.change(await screen.findByLabelText('Objetivo'), {
    target: { value: 'Buscamos backend junior' }
  });
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

  await screen.findByRole('heading', { name: 'Revisá qué se va a evaluar' });

  expect(window.sessionStorage.getItem(requestTokenStorageKey(SHARE_TOKEN))).toBe(REQUEST_TOKEN);
  expect(requestTokenStorageKey(SHARE_TOKEN)).not.toContain(REQUEST_TOKEN);
  expect(requestTokenStorageKey(SHARE_TOKEN)).not.toContain(SHARE_TOKEN);
  expect(window.localStorage.getItem(requestTokenStorageKey(SHARE_TOKEN))).toBeNull();
  expect(window.location.href).not.toContain(REQUEST_TOKEN);
  expect(document.body.innerHTML).not.toContain(REQUEST_TOKEN);
});

it('al recargar, el paso lo decide el servidor y no un índice local', async () => {
  window.sessionStorage.setItem(requestTokenStorageKey(SHARE_TOKEN), REQUEST_TOKEN);
  api.getVerificationSessionRequest.mockResolvedValue(
    session({
      status: 'requirements_confirmed',
      proposal: null,
      confirmedRequirements: ['Diseño de APIs REST']
    })
  );

  renderRoute();

  expect(await screen.findByRole('heading', { name: 'Todo listo para analizar' })).toBeTruthy();
  expect(screen.getByText(/Diseño de APIs REST/)).toBeTruthy();
  // Confirmado = inmutable: no se ofrece editar lo que el backend ya rechazaría.
  expect(screen.queryByRole('button', { name: 'Confirmar requisitos' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Agregar requisito' })).toBeNull();
});

it('una sesión consumida se resuelve por el resultado', async () => {
  window.sessionStorage.setItem(requestTokenStorageKey(SHARE_TOKEN), REQUEST_TOKEN);
  api.getVerificationSessionRequest.mockResolvedValue(session({ status: 'consumed', proposal: null }));
  api.getVerificationResultRequest.mockResolvedValue(completedResult());

  renderRoute();

  expect(await screen.findByRole('heading', { name: 'Qué respalda la evidencia compartida' })).toBeTruthy();
});

it('una sesión vencida limpia SOLO ese token y ofrece empezar de nuevo', async () => {
  window.sessionStorage.setItem(requestTokenStorageKey(SHARE_TOKEN), REQUEST_TOKEN);
  api.getVerificationSessionRequest.mockRejectedValue(
    new ApiError('x', 'http', 404, 'REQUEST_NOT_AVAILABLE')
  );

  renderRoute();

  expect(await screen.findByRole('heading', { name: '¿Qué querés analizar?' })).toBeTruthy();
  expect(window.sessionStorage.getItem(requestTokenStorageKey(SHARE_TOKEN))).toBeNull();
});

it('sin análisis habilitado y sin sesión previa, no hay flujo', async () => {
  shareApi.getPublicProfileShareRequest.mockResolvedValue(profile(false));
  renderRoute();
  expect(await screen.findByText('Este perfil no tiene habilitado el análisis de trayectoria.')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '¿Qué querés analizar?' })).toBeNull();
});

// ---------------------------------------------------------------------------
// Requisitos
// ---------------------------------------------------------------------------

it('permite editar, agregar y confirmar requisitos dentro del tope del backend', async () => {
  window.sessionStorage.setItem(requestTokenStorageKey(SHARE_TOKEN), REQUEST_TOKEN);
  api.getVerificationSessionRequest.mockResolvedValue(session());
  api.confirmVerificationRequirementsRequest.mockResolvedValue(
    session({
      status: 'requirements_confirmed',
      proposal: null,
      confirmedRequirements: ['Diseño de APIs REST editado', 'Agregado a mano']
    })
  );

  renderRoute();
  await screen.findByRole('heading', { name: 'Revisá qué se va a evaluar' });

  fireEvent.change(screen.getByLabelText('Requisito 1'), {
    target: { value: 'Diseño de APIs REST editado' }
  });
  fireEvent.click(screen.getByRole('button', { name: 'Agregar requisito' }));
  fireEvent.change(screen.getByLabelText('Requisito 2'), { target: { value: 'Agregado a mano' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar requisitos' }));

  await screen.findByRole('heading', { name: 'Todo listo para analizar' });

  const body = api.confirmVerificationRequirementsRequest.mock.calls[0][2];
  expect(body.requirements).toHaveLength(2);
  // Editado => deja de ser derivado de la fuente: la misma regla del holder.
  expect(body.requirements[0]).toEqual({
    requirementText: 'Diseño de APIs REST editado',
    provenanceKind: 'DIRECT_STRUCTURED_INPUT',
    sourceQuote: null
  });
  expect(body.requirements[1].provenanceKind).toBe('DIRECT_STRUCTURED_INPUT');
});

it('no deja confirmar más de 12 requisitos', async () => {
  window.sessionStorage.setItem(requestTokenStorageKey(SHARE_TOKEN), REQUEST_TOKEN);
  api.getVerificationSessionRequest.mockResolvedValue(session());

  renderRoute();
  await screen.findByRole('heading', { name: 'Revisá qué se va a evaluar' });

  for (let index = 0; index < 11; index += 1) {
    fireEvent.click(screen.getByRole('button', { name: 'Agregar requisito' }));
    fireEvent.change(screen.getByLabelText(`Requisito ${index + 2}`), {
      target: { value: `Requisito manual ${index + 2}` }
    });
  }

  expect(screen.getByText('12 de hasta 12 requisitos')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Agregar requisito' }) as HTMLButtonElement).disabled).toBe(true);
});

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

async function renderReadyToExecute() {
  window.sessionStorage.setItem(requestTokenStorageKey(SHARE_TOKEN), REQUEST_TOKEN);
  api.getVerificationSessionRequest.mockResolvedValue(
    session({ status: 'requirements_confirmed', proposal: null, confirmedRequirements: ['Diseño de APIs REST'] })
  );
  renderRoute();
  await screen.findByRole('heading', { name: 'Todo listo para analizar' });
}

it('ejecuta una sola vez aunque se hagan varios clics', async () => {
  await renderReadyToExecute();
  api.executeVerificationAnalysisRequest.mockImplementation(
    () => new Promise(() => undefined) as Promise<never>
  );

  const button = screen.getByRole('button', { name: 'Analizar evidencia' });
  fireEvent.click(button);
  fireEvent.click(button);
  fireEvent.click(button);

  await screen.findByText('Analizando la evidencia autorizada…');
  expect(api.executeVerificationAnalysisRequest).toHaveBeenCalledTimes(1);
});

it('si se pierde la respuesta del POST, recupera por el resultado y NO crea otra solicitud', async () => {
  await renderReadyToExecute();
  api.executeVerificationAnalysisRequest.mockRejectedValue(new ApiError('timeout', 'network'));
  api.getVerificationResultRequest.mockResolvedValue(result({ state: 'PROCESSING' }));

  fireEvent.click(screen.getByRole('button', { name: 'Analizar evidencia' }));

  await waitFor(() => expect(api.getVerificationResultRequest).toHaveBeenCalled());
  expect(screen.getByText('Analizando la evidencia autorizada…')).toBeTruthy();
  expect(api.createVerificationRequestRequest).not.toHaveBeenCalled();
  expect(api.executeVerificationAnalysisRequest).toHaveBeenCalledTimes(1);
});

it('sondea el resultado mientras procesa y se detiene al completar', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await renderReadyToExecute();
  api.executeVerificationAnalysisRequest.mockResolvedValue(result({ state: 'PROCESSING' }));
  api.getVerificationResultRequest.mockResolvedValue(completedResult());

  fireEvent.click(screen.getByRole('button', { name: 'Analizar evidencia' }));
  await vi.waitFor(() => expect(screen.getByText('Analizando la evidencia autorizada…')).toBeTruthy());

  await vi.advanceTimersByTimeAsync(4_000);
  await vi.waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Qué respalda la evidencia compartida' })).toBeTruthy()
  );

  const callsAtCompletion = api.getVerificationResultRequest.mock.calls.length;
  await vi.advanceTimersByTimeAsync(20_000);
  expect(api.getVerificationResultRequest.mock.calls.length).toBe(callsAtCompletion);
});

it('deja de sondear si el enlace deja de estar disponible', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await renderReadyToExecute();
  api.executeVerificationAnalysisRequest.mockResolvedValue(result({ state: 'PROCESSING' }));
  api.getVerificationResultRequest.mockRejectedValue(
    new ApiError('x', 'http', 404, 'SHARE_NOT_AVAILABLE')
  );

  fireEvent.click(screen.getByRole('button', { name: 'Analizar evidencia' }));
  await vi.advanceTimersByTimeAsync(4_000);
  await vi.waitFor(() =>
    expect(screen.getByText('Este perfil compartido ya no está disponible.')).toBeTruthy()
  );

  const calls = api.getVerificationResultRequest.mock.calls.length;
  await vi.advanceTimersByTimeAsync(30_000);
  expect(api.getVerificationResultRequest.mock.calls.length).toBe(calls);
});

// ---------------------------------------------------------------------------
// Fallos
// ---------------------------------------------------------------------------

it('un fallo temporal reintenta el MISMO análisis, sin borrador nuevo', async () => {
  await renderReadyToExecute();
  api.executeVerificationAnalysisRequest.mockResolvedValueOnce(
    result({ state: 'FAILED', failure: { category: 'TEMPORARILY_UNAVAILABLE', retryable: true } })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Analizar evidencia' }));

  const retry = await screen.findByRole('button', { name: 'Reintentar análisis' });
  api.executeVerificationAnalysisRequest.mockResolvedValueOnce(completedResult());
  fireEvent.click(retry);

  await screen.findByRole('heading', { name: 'Qué respalda la evidencia compartida' });
  expect(api.createVerificationRequestRequest).not.toHaveBeenCalled();
  expect(api.proposeVerificationRequirementsRequest).not.toHaveBeenCalled();
  expect(api.executeVerificationAnalysisRequest).toHaveBeenCalledTimes(2);
});

it('un análisis interrumpido no ofrece reintentar, solo empezar uno nuevo', async () => {
  await renderReadyToExecute();
  api.executeVerificationAnalysisRequest.mockResolvedValue(
    result({ state: 'FAILED', failure: { category: 'EXECUTION_INTERRUPTED', retryable: false } })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Analizar evidencia' }));

  expect(await screen.findByText('Este análisis no pudo finalizar')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Reintentar análisis' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Iniciar un nuevo análisis' }));
  expect(await screen.findByRole('heading', { name: '¿Qué querés analizar?' })).toBeTruthy();
  // El token viejo sigue disponible hasta que exista un borrador nuevo.
  expect(window.sessionStorage.getItem(requestTokenStorageKey(SHARE_TOKEN))).toBe(REQUEST_TOKEN);
});

it('con la autorización retirada y el análisis ya deshabilitado, no ofrece ningún camino', async () => {
  shareApi.getPublicProfileShareRequest.mockResolvedValue(profile(false));
  window.sessionStorage.setItem(requestTokenStorageKey(SHARE_TOKEN), REQUEST_TOKEN);
  api.getVerificationSessionRequest.mockResolvedValue(session({ status: 'consumed', proposal: null }));
  api.getVerificationResultRequest.mockResolvedValue(
    result({ state: 'FAILED', failure: { category: 'AUTHORIZATION_WITHDRAWN', retryable: false } })
  );

  renderRoute();

  expect(await screen.findByText('Se detuvo porque cambió la autorización del perfil.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Iniciar un nuevo análisis' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Reintentar análisis' })).toBeNull();
  expect(document.body.textContent).not.toMatch(/credencial revocada|el titular/i);
});

it('el presupuesto agotado ofrece un análisis nuevo y no menciona intentos', async () => {
  await renderReadyToExecute();
  api.executeVerificationAnalysisRequest.mockResolvedValue(
    result({ state: 'FAILED', failure: { category: 'RETRY_BUDGET_EXHAUSTED', retryable: false } })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Analizar evidencia' }));

  expect(await screen.findByRole('button', { name: 'Iniciar un nuevo análisis' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Reintentar análisis' })).toBeNull();
  expect(document.body.textContent).not.toMatch(/3 intentos|presupuesto|proveedor/i);
});

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

it('muestra los estados en palabras, el claim más débil y la credencial hoy revocada', async () => {
  window.sessionStorage.setItem(requestTokenStorageKey(SHARE_TOKEN), REQUEST_TOKEN);
  api.getVerificationSessionRequest.mockResolvedValue(session({ status: 'consumed', proposal: null }));
  api.getVerificationResultRequest.mockResolvedValue(completedResult());

  renderRoute();
  await screen.findByRole('heading', { name: 'Qué respalda la evidencia compartida' });

  expect(screen.getAllByText('Respaldado parcialmente').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Evidencia insuficiente').length).toBeGreaterThan(0);
  expect(screen.getByText('Exposición formativa a diseño de APIs REST.')).toBeTruthy();
  expect(screen.getAllByText('Hoy: Revocada').length).toBeGreaterThan(0);
  expect(
    screen.getByText(/El análisis refleja la evidencia disponible al momento de su ejecución/)
  ).toBeTruthy();
  expect(
    screen.getByText('Para este requisito, la evidencia compartida no alcanza para afirmar un respaldo.')
  ).toBeTruthy();
  expect((screen.getByRole('link', { name: 'Verificar credencial' }) as HTMLAnchorElement).getAttribute('href')).toBe(
    '/verify?credential=cred-1'
  );
});

it('el resultado no expone citas, ids internos, puntajes ni ranking', async () => {
  window.sessionStorage.setItem(requestTokenStorageKey(SHARE_TOKEN), REQUEST_TOKEN);
  api.getVerificationSessionRequest.mockResolvedValue(session({ status: 'consumed', proposal: null }));
  api.getVerificationResultRequest.mockResolvedValue(completedResult());

  renderRoute();
  await screen.findByRole('heading', { name: 'Qué respalda la evidencia compartida' });

  const text = document.body.textContent ?? '';
  for (const forbidden of [
    'src_',
    'eu_',
    'req_',
    'sha256',
    'policyTrace',
    'executionMetadata',
    'openai',
    'FINAL_STATE_IS_HISTORICAL',
    REQUEST_TOKEN
  ]) {
    expect(text).not.toContain(forbidden);
  }
  expect(text).not.toMatch(/puntaje|score|ranking|match|% de compatibilidad|apto|califica|cumple/i);
});

it('un resultado ya COMPLETADO sigue siendo legible si el titular deshabilita el análisis después', async () => {
  // Regla del backend: deshabilitar la politica corta trabajo NUEVO; solo
  // revocar o vencer el ENLACE corta el acceso publico. La web no puede ser mas
  // restrictiva que eso o esconderia un resultado que el tercero ya obtuvo.
  shareApi.getPublicProfileShareRequest.mockResolvedValue(profile(false));
  window.sessionStorage.setItem(requestTokenStorageKey(SHARE_TOKEN), REQUEST_TOKEN);
  api.getVerificationSessionRequest.mockResolvedValue(session({ status: 'consumed', proposal: null }));
  api.getVerificationResultRequest.mockResolvedValue(completedResult());

  renderRoute();

  expect(await screen.findByRole('heading', { name: 'Qué respalda la evidencia compartida' })).toBeTruthy();
  expect(screen.getByText('Exposición formativa a diseño de APIs REST.')).toBeTruthy();
  // Sin permiso vigente no se ofrece abrir otro analisis.
  expect(screen.queryByRole('button', { name: 'Iniciar un nuevo análisis' })).toBeNull();
});

it('el token guardado se manda como header en cada llamada y nunca como argumento de URL', async () => {
  window.sessionStorage.setItem(requestTokenStorageKey(SHARE_TOKEN), REQUEST_TOKEN);
  api.getVerificationSessionRequest.mockResolvedValue(session({ status: 'consumed', proposal: null }));
  api.getVerificationResultRequest.mockResolvedValue(completedResult());

  renderRoute();
  await screen.findByRole('heading', { name: 'Qué respalda la evidencia compartida' });

  // La capa de API recibe el token como argumento y lo pone en el header; el
  // enlace es lo unico que viaja en el path.
  expect(api.getVerificationSessionRequest).toHaveBeenCalledWith(SHARE_TOKEN, REQUEST_TOKEN);
  expect(window.location.search).toBe('');
  expect(window.location.hash).toBe('');
});


/**
 * Transporte del Objective Analysis en el cliente NestJS — F3.3B.
 *
 * `fetch` se falsea con `context.mock.method`, igual que en los otros tests de
 * transporte: nunca se llama a FastAPI ni a ningún proveedor desde acá.
 *
 * Lo que se prueba es lo que decide el destino del run. Desde F3.3B.1 un
 * desenlace terminal exige una afirmación de NUESTRA aplicación —envelope
 * `ai_service_error_v1`, código del vocabulario cerrado, coherente con el
 * status—. El status a secas no alcanza: un `502` lo emite cualquier proxy, y
 * matar un run por eso sería inventar un hecho. El texto del error no clasifica
 * nada, nunca.
 */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { AiServiceClient } from './ai-service.client';
import {
  AI_SERVICE_ERROR_SCHEMA_VERSION,
  AI_SERVICE_ERROR_STATUS_BY_CODE,
  ObjectiveAnalysisTransportError,
  type AnalyzeObjectiveWithAiInput
} from './ai-service.types';

const RESPONSE_BODY = JSON.stringify({
  schemaVersion: 'product_objective_analysis_response_v1',
  execution: { effectiveModelVerification: 'MATCH' },
  artifact: { schemaVersion: 'objective_analysis_v1', requirements: [] }
});

function configureAiEnv(context: TestContext) {
  const previous = new Map<string, string | undefined>();
  const values: Record<string, string> = {
    AI_SERVICE_BASE_URL: 'http://ai.test',
    AI_SERVICE_TIMEOUT_MS: '60000',
    AI_SERVICE_AUTH_MODE: 'jwt',
    AI_SERVICE_JWT_SECRET: 'internal-service-test-secret',
    AI_SERVICE_JWT_ISSUER: 'traza-api',
    AI_SERVICE_JWT_AUDIENCE: 'traza-ai-service',
    AI_SERVICE_JWT_EXPIRES_IN_SECONDS: '60'
  };
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, process.env[name]);
    process.env[name] = value;
  }
  context.after(() => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

interface Captured {
  url: string;
  init: RequestInit | undefined;
}

function captureFetch(
  context: TestContext,
  body = RESPONSE_BODY,
  status = 200
): Captured[] {
  const captured: Captured[] = [];
  context.mock.method(
    globalThis,
    'fetch',
    async (url: string | URL | Request, init?: RequestInit) => {
      captured.push({ url: String(url), init });
      return new Response(body, {
        status,
        headers: { 'content-type': 'application/json' }
      });
    }
  );
  return captured;
}

const input = (overrides: Partial<AnalyzeObjectiveWithAiInput> = {}) =>
  ({
    schemaVersion: 'product_objective_analysis_request_v1',
    executionPlan: {
      artifactSchemaVersion: 'objective_analysis_v1',
      promptVersion: 'product_objective_analysis_v1',
      adapterVersion: 'product_objective_analysis_adapter_v1',
      provider: 'openai',
      model: 'test-model',
      reasoningEffort: 'medium'
    },
    objectiveType: 'EMPLOYMENT',
    objectiveContext: 'Backend Developer Junior',
    requirements: [
      { requirementId: 'req_01', requirementText: 'Diseno de APIs REST' }
    ],
    ...overrides
  }) as AnalyzeObjectiveWithAiInput;

async function expectTransportCode(
  fn: () => Promise<unknown>,
  code: string
): Promise<ObjectiveAnalysisTransportError> {
  try {
    await fn();
  } catch (error: unknown) {
    assert.ok(error instanceof ObjectiveAnalysisTransportError, String(error));
    assert.equal(error.code, code);
    return error;
  }
  throw new Error(`expected ${code} but nothing was thrown`);
}

// ---------------------------------------------------------------------------
// Envío
// ---------------------------------------------------------------------------

test('una sola llamada a la ruta congelada, con auth interno', async (context) => {
  configureAiEnv(context);
  const captured = captureFetch(context);

  await new AiServiceClient().analyzeObjective(input());

  assert.equal(captured.length, 1);
  assert.equal(captured[0].url, 'http://ai.test/v1/objective-analysis');
  assert.equal(captured[0].init?.method, 'POST');
  const headers = new Headers(captured[0].init?.headers);
  assert.ok(headers.get('authorization')?.startsWith('Bearer '));
});

test('el body lleva exactamente el contrato, sin nada de evidencia', async (context) => {
  configureAiEnv(context);
  const captured = captureFetch(context);

  await new AiServiceClient().analyzeObjective(input());

  const body = JSON.parse(String(captured[0].init?.body));
  assert.deepEqual(Object.keys(body).sort(), [
    'executionPlan',
    'objectiveContext',
    'objectiveType',
    'requirements',
    'schemaVersion'
  ]);
  assert.deepEqual(Object.keys(body.requirements[0]).sort(), [
    'requirementId',
    'requirementText'
  ]);
});

test('un objectiveContext vacio es valido y viaja tal cual', async (context) => {
  // La ausencia de contexto es informacion, no un hueco: rechazarla aca la haria
  // irrepresentable.
  configureAiEnv(context);
  const captured = captureFetch(context);

  await new AiServiceClient().analyzeObjective(input({ objectiveContext: '' }));

  assert.equal(JSON.parse(String(captured[0].init?.body)).objectiveContext, '');
});

test('la respuesta se devuelve SIN interpretar', async (context) => {
  configureAiEnv(context);
  captureFetch(context);

  const response = await new AiServiceClient().analyzeObjective(input());

  assert.deepEqual(response, JSON.parse(RESPONSE_BODY));
});

// ---------------------------------------------------------------------------
// Taxonomía cerrada, derivada del CODIGO DE APLICACION VALIDADO — F3.3B.1
// ---------------------------------------------------------------------------

/** Un envelope `ai_service_error_v1` bien formado. */
function envelope(code: string, message = 'algo'): string {
  return JSON.stringify({
    schemaVersion: 'ai_service_error_v1',
    code,
    message
  });
}

test('409 con envelope valido es desajuste de plan', async (context) => {
  configureAiEnv(context);
  captureFetch(context, envelope('EXECUTION_PLAN_MISMATCH'), 409);

  const error = await expectTransportCode(
    () => new AiServiceClient().analyzeObjective(input()),
    'EXECUTION_PLAN_MISMATCH'
  );
  assert.equal(error.status, 409);
});

test('502 con envelope valido es salida invalida del proveedor', async (context) => {
  configureAiEnv(context);
  captureFetch(context, envelope('PROVIDER_INVALID_OUTPUT'), 502);

  await expectTransportCode(
    () => new AiServiceClient().analyzeObjective(input()),
    'PROVIDER_INVALID_OUTPUT'
  );
});

test('503 con envelope valido es fallo de transporte, reintentable', async (context) => {
  configureAiEnv(context);
  captureFetch(context, envelope('PROVIDER_TRANSPORT_FAILURE'), 503);

  await expectTransportCode(
    () => new AiServiceClient().analyzeObjective(input()),
    'PROVIDER_TRANSPORT_FAILURE'
  );
});

// ---------------------------------------------------------------------------
// Respuestas opacas: NUNCA un desenlace terminal
// ---------------------------------------------------------------------------

test('un 502 VACIO no mata el run', async (context) => {
  // Éste es el caso que motivó F3.3B.1: un proxy que devuelve 502 sin cuerpo no
  // demuestra que un proveedor haya respondido nada.
  configureAiEnv(context);
  captureFetch(context, '', 502);

  await expectTransportCode(
    () => new AiServiceClient().analyzeObjective(input()),
    'INTERNAL_AI_SERVICE_FAILURE'
  );
});

test('un 502 con HTML no mata el run', async (context) => {
  configureAiEnv(context);
  captureFetch(context, '<html><body>502 Bad Gateway</body></html>', 502);

  await expectTransportCode(
    () => new AiServiceClient().analyzeObjective(input()),
    'INTERNAL_AI_SERVICE_FAILURE'
  );
});

test('un 502 con JSON arbitrario no mata el run', async (context) => {
  configureAiEnv(context);
  captureFetch(context, JSON.stringify({ error: 'bad gateway', code: 502 }), 502);

  await expectTransportCode(
    () => new AiServiceClient().analyzeObjective(input()),
    'INTERNAL_AI_SERVICE_FAILURE'
  );
});

test('un envelope malformado no mata el run', async (context) => {
  configureAiEnv(context);
  const cases = [
    { schemaVersion: 'ai_service_error_v1' },
    { schemaVersion: 'ai_service_error_v1', code: 42 },
    { schemaVersion: 'ai_service_error_v2', code: 'PROVIDER_INVALID_OUTPUT' },
    { code: 'PROVIDER_INVALID_OUTPUT' },
    [{ schemaVersion: 'ai_service_error_v1', code: 'PROVIDER_INVALID_OUTPUT' }],
    null
  ];

  for (const body of cases) {
    context.mock.restoreAll();
    captureFetch(context, JSON.stringify(body), 502);
    await expectTransportCode(
      () => new AiServiceClient().analyzeObjective(input()),
      'INTERNAL_AI_SERVICE_FAILURE'
    );
  }
});

test('un codigo desconocido no mata el run', async (context) => {
  // Sin catch-all terminal: un token que este cliente no conoce NO puede
  // significar "el proveedor respondio mal".
  configureAiEnv(context);
  captureFetch(context, envelope('SOMETHING_NEW'), 502);

  await expectTransportCode(
    () => new AiServiceClient().analyzeObjective(input()),
    'INTERNAL_AI_SERVICE_FAILURE'
  );
});

test('un 409 opaco tampoco mata el run', async (context) => {
  configureAiEnv(context);
  captureFetch(context, JSON.stringify({ detail: 'conflict' }), 409);

  await expectTransportCode(
    () => new AiServiceClient().analyzeObjective(input()),
    'INTERNAL_AI_SERVICE_FAILURE'
  );
});

// ---------------------------------------------------------------------------
// Coherencia status / code
// ---------------------------------------------------------------------------

test('un par status/code inconsistente se descarta entero', async (context) => {
  // La frontera esta emitiendo un contrato internamente inconsistente. Elegir
  // cual de las dos mitades creer seria inventar el hecho que falta.
  configureAiEnv(context);
  const inconsistent = [
    [502, 'EXECUTION_PLAN_MISMATCH'],
    [409, 'PROVIDER_INVALID_OUTPUT'],
    [503, 'EXECUTION_PLAN_MISMATCH'],
    [502, 'PROVIDER_TRANSPORT_FAILURE']
  ] as const;

  for (const [status, code] of inconsistent) {
    context.mock.restoreAll();
    captureFetch(context, envelope(code), status);
    await expectTransportCode(
      () => new AiServiceClient().analyzeObjective(input()),
      'INTERNAL_AI_SERVICE_FAILURE'
    );
  }
});

test('la tabla de correspondencia es la misma que la del AI service', () => {
  assert.deepEqual(AI_SERVICE_ERROR_STATUS_BY_CODE, {
    EXECUTION_PLAN_MISMATCH: 409,
    PROVIDER_INVALID_OUTPUT: 502,
    PROVIDER_TRANSPORT_FAILURE: 503,
    PROVIDER_CONFIGURATION_FAILURE: 424
  });
  assert.equal(AI_SERVICE_ERROR_SCHEMA_VERSION, 'ai_service_error_v1');

  // Biyectiva: dos codigos que compartieran status borrarian la diferencia
  // entre terminal y reintentable.
  const statuses = Object.values(AI_SERVICE_ERROR_STATUS_BY_CODE);
  assert.equal(new Set(statuses).size, statuses.length);
});

// ---------------------------------------------------------------------------
// Fallo determinista del proveedor — F3.3B.2
// ---------------------------------------------------------------------------

test('424 con envelope valido es fallo determinista de configuracion', async (context) => {
  configureAiEnv(context);
  captureFetch(context, envelope('PROVIDER_CONFIGURATION_FAILURE'), 424);

  const error = await expectTransportCode(
    () => new AiServiceClient().analyzeObjective(input()),
    'PROVIDER_CONFIGURATION_FAILURE'
  );
  assert.equal(error.status, 424);
});

test('un 424 opaco NO se convierte en fallo de configuracion', async (context) => {
  // La provenance de F3.3B.1 sigue intacta: sin afirmacion de la aplicacion, el
  // status por si solo no alcanza para matar un run.
  configureAiEnv(context);
  captureFetch(context, '<html>424</html>', 424);

  await expectTransportCode(
    () => new AiServiceClient().analyzeObjective(input()),
    'INTERNAL_AI_SERVICE_FAILURE'
  );
});

test('un 424 con otro code del vocabulario se descarta por incoherente', async (context) => {
  configureAiEnv(context);
  captureFetch(context, envelope('PROVIDER_TRANSPORT_FAILURE'), 424);

  await expectTransportCode(
    () => new AiServiceClient().analyzeObjective(input()),
    'INTERNAL_AI_SERVICE_FAILURE'
  );
});

test('transitorio y determinista NO comparten codigo ni status', async (context) => {
  configureAiEnv(context);
  captureFetch(context, envelope('PROVIDER_TRANSPORT_FAILURE'), 503);
  const transient = await expectTransportCode(
    () => new AiServiceClient().analyzeObjective(input()),
    'PROVIDER_TRANSPORT_FAILURE'
  );

  context.mock.restoreAll();
  captureFetch(context, envelope('PROVIDER_CONFIGURATION_FAILURE'), 424);
  const deterministic = await expectTransportCode(
    () => new AiServiceClient().analyzeObjective(input()),
    'PROVIDER_CONFIGURATION_FAILURE'
  );

  assert.notEqual(transient.code, deterministic.code);
  assert.notEqual(transient.status, deterministic.status);
});

// ---------------------------------------------------------------------------
// Lo que sigue sin cambiar
// ---------------------------------------------------------------------------

test('422 de validacion de request no es desenlace del run', async (context) => {
  // FastAPI usa 422 para su propia validacion, y no lleva envelope a proposito.
  configureAiEnv(context);
  captureFetch(context, JSON.stringify({ detail: [{ loc: ['body'] }] }), 422);

  await expectTransportCode(
    () => new AiServiceClient().analyzeObjective(input()),
    'INTERNAL_AI_SERVICE_FAILURE'
  );
});

test('401 y 500 tampoco son desenlaces del run', async (context) => {
  configureAiEnv(context);
  captureFetch(context, JSON.stringify({ detail: 'x' }), 401);
  await expectTransportCode(
    () => new AiServiceClient().analyzeObjective(input()),
    'INTERNAL_AI_SERVICE_FAILURE'
  );
});

test('el AI service caido es fallo de transporte', async (context) => {
  // Sin envelope, y correctamente: la afirmacion no es sobre el proveedor, es
  // sobre este cliente, que sabe que no obtuvo ninguna respuesta.
  configureAiEnv(context);
  context.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed');
  });

  await expectTransportCode(
    () => new AiServiceClient().analyzeObjective(input()),
    'PROVIDER_TRANSPORT_FAILURE'
  );
});

test('el error no arrastra el mensaje del AI service', async (context) => {
  configureAiEnv(context);
  captureFetch(context, envelope('PROVIDER_INVALID_OUTPUT', 'secreto'), 502);

  const error = await expectTransportCode(
    () => new AiServiceClient().analyzeObjective(input()),
    'PROVIDER_INVALID_OUTPUT'
  );
  assert.ok(!error.message.includes('secreto'));
});

test('la clasificacion NO depende de ningun texto', async (context) => {
  // Mismo status y mismo code, mensajes opuestos: el resultado tiene que ser el
  // mismo. Y un `detail` que dice lo contrario no cambia nada.
  configureAiEnv(context);
  captureFetch(
    context,
    JSON.stringify({
      schemaVersion: 'ai_service_error_v1',
      code: 'EXECUTION_PLAN_MISMATCH',
      message: 'provider invalid output',
      detail: 'PROVIDER_INVALID_OUTPUT'
    }),
    409
  );

  await expectTransportCode(
    () => new AiServiceClient().analyzeObjective(input()),
    'EXECUTION_PLAN_MISMATCH'
  );
});

// ---------------------------------------------------------------------------
// F3.5 — la misma taxonomía sobre la ruta contextual
// ---------------------------------------------------------------------------

const contextualInput = {
  schemaVersion: 'product_contextual_reasoning_request_v1',
  executionPlan: {
    artifactSchemaVersion: 'reasoning_run_result_v1',
    promptVersion: 'product_contextual_reasoning_v1',
    adapterVersion: 'product_contextual_reasoning_adapter_v1',
    provider: 'openai',
    model: 'test-model',
    reasoningEffort: 'medium'
  },
  objectiveContext: 'Backend',
  requirement: {
    requirementId: 'req_01',
    requirementText: 'Diseno de APIs REST',
    epistemicTarget: 'FORMATIVE_EVIDENCE',
    atomicity: 'ATOMIC',
    evaluability: {
      requiredEvidenceType: 'FORMATIVE_EVIDENCE',
      formativeEvidenceCapable: true,
      rationale: 'x'
    },
    qualifiers: [],
    normalizedRequirement: 'y'
  },
  evidenceUnits: [],
  sources: [],
  preparation: {
    mode: 'FULL_SCAN',
    evidenceUnitIds: [],
    exactRedundancyGroups: [],
    sourceObservabilityFacts: [],
    discardedEvidenceProposalCount: 0
  }
} as never;

test('la ruta contextual es una sola, y lleva auth interno', async (context) => {
  configureAiEnv(context);
  const captured = captureFetch(
    context,
    JSON.stringify({ schemaVersion: 'product_contextual_reasoning_response_v1' })
  );

  await new AiServiceClient().analyzeContextualReasoning(contextualInput);

  assert.equal(captured.length, 1);
  assert.equal(captured[0].url, 'http://ai.test/v1/contextual-reasoning');
  const headers = new Headers(captured[0].init?.headers);
  assert.ok(headers.get('authorization')?.startsWith('Bearer '));
});

test('el body contextual lleva UN Requirement, no un conjunto', async (context) => {
  configureAiEnv(context);
  const captured = captureFetch(
    context,
    JSON.stringify({ schemaVersion: 'product_contextual_reasoning_response_v1' })
  );

  await new AiServiceClient().analyzeContextualReasoning(contextualInput);

  const body = JSON.parse(String(captured[0].init?.body));
  assert.deepEqual(Object.keys(body).sort(), [
    'evidenceUnits',
    'executionPlan',
    'objectiveContext',
    'preparation',
    'requirement',
    'schemaVersion',
    'sources'
  ]);
  assert.equal('requirements' in body, false);
});

test('la ruta contextual reusa la taxonomía cerrada, sin envelope propio', async (context) => {
  configureAiEnv(context);
  const cases: [number, string][] = [
    [409, 'EXECUTION_PLAN_MISMATCH'],
    [502, 'PROVIDER_INVALID_OUTPUT'],
    [503, 'PROVIDER_TRANSPORT_FAILURE'],
    [424, 'PROVIDER_CONFIGURATION_FAILURE']
  ];

  for (const [status, code] of cases) {
    context.mock.restoreAll();
    captureFetch(context, envelope(code), status);
    await expectTransportCode(
      () => new AiServiceClient().analyzeContextualReasoning(contextualInput),
      code
    );
  }
});

test('una respuesta contextual opaca no mata el run', async (context) => {
  configureAiEnv(context);
  for (const body of ['', '<html>502</html>', JSON.stringify({ error: 'x' })]) {
    context.mock.restoreAll();
    captureFetch(context, body, 502);
    await expectTransportCode(
      () => new AiServiceClient().analyzeContextualReasoning(contextualInput),
      'INTERNAL_AI_SERVICE_FAILURE'
    );
  }
});

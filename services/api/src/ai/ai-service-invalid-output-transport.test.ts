/**
 * El subcodigo de salida invalida sobrevive el transporte — P2.4 OBS.
 *
 * Prueba las DOS mitades que la slice tiene que sostener a la vez:
 *
 *   1. el subcodigo llega al error tipado, por las tres etapas de F3;
 *   2. la CLASIFICACION no cambia — el mismo `code`, el mismo `status`, el
 *      mismo desenlace que antes de instrumentar nada.
 *
 * `fetch` se falsea con `context.mock.method`, igual que el resto de los tests
 * de transporte: cero llamadas a FastAPI y cero al proveedor.
 */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { AiServiceClient } from './ai-service.client';
import { UNKNOWN_INVALID_OUTPUT_SUBCODE } from './ai-service-invalid-output-diagnostics';
import {
  ObjectiveAnalysisTransportError,
  type AnalyzeContextualReasoningWithAiInput,
  type AnalyzeEvidenceUnitsWithAiInput,
  type AnalyzeObjectiveWithAiInput
} from './ai-service.types';

function configureAiEnv(context: TestContext) {
  const previous = new Map<string, string | undefined>();
  const values: Record<string, string> = {
    AI_SERVICE_BASE_URL: 'http://ai.test',
    AI_SERVICE_TIMEOUT_MS: '60000',
    AI_SERVICE_AUTH_MODE: 'none'
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

function respondWith(context: TestContext, body: unknown, status: number) {
  context.mock.method(globalThis, 'fetch', async () => {
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' }
    });
  });
}

const plan = {
  artifactSchemaVersion: 'objective_analysis_v1',
  promptVersion: 'product_objective_analysis_v2',
  adapterVersion: 'product_objective_analysis_adapter_v1',
  provider: 'openai',
  model: 'test-model',
  reasoningEffort: 'medium'
};

/** Una llamada por etapa, con el input minimo que cada contrato exige. */
const STAGES = {
  objective_analysis: (client: AiServiceClient) =>
    client.analyzeObjective({
      schemaVersion: 'product_objective_analysis_request_v1',
      executionPlan: plan,
      objectiveType: 'EMPLOYMENT',
      objectiveContext: 'Backend Developer Junior',
      requirements: [{ requirementId: 'req_01', requirementText: 'APIs REST' }]
    } as unknown as AnalyzeObjectiveWithAiInput),
  evidence_units: (client: AiServiceClient) =>
    client.analyzeEvidenceUnits({
      schemaVersion: 'product_evidence_units_request_v1',
      executionPlan: plan,
      sources: []
    } as unknown as AnalyzeEvidenceUnitsWithAiInput),
  contextual_reasoning: (client: AiServiceClient) =>
    client.analyzeContextualReasoning({
      schemaVersion: 'product_contextual_reasoning_request_v1',
      executionPlan: plan,
      objectiveContext: 'Backend Developer Junior',
      requirement: { requirementId: 'req_01' },
      evidenceUnits: [],
      sources: [],
      preparation: {}
    } as unknown as AnalyzeContextualReasoningWithAiInput)
} as const;

const invalidOutputEnvelope = (message: string) => ({
  schemaVersion: 'ai_service_error_v1',
  code: 'PROVIDER_INVALID_OUTPUT',
  message
});

async function captureTransportError(
  fn: () => Promise<unknown>
): Promise<ObjectiveAnalysisTransportError> {
  try {
    await fn();
  } catch (error: unknown) {
    assert.ok(error instanceof ObjectiveAnalysisTransportError, String(error));
    return error;
  }
  throw new Error('expected a transport error');
}

// ---------------------------------------------------------------------------
// El subcodigo llega, por las tres etapas
// ---------------------------------------------------------------------------

const KNOWN_SUBCODE = {
  objective_analysis: 'requirement_count_mismatch',
  evidence_units: 'provider_evidence_units_not_a_list',
  contextual_reasoning: 'provider_output_unexpected_keys'
} as const;

for (const stage of ['objective_analysis', 'evidence_units', 'contextual_reasoning'] as const) {
  test(`${stage}: el subcodigo sobrevive y la clasificacion no cambia`, async (context) => {
    configureAiEnv(context);
    const subcode = KNOWN_SUBCODE[stage];
    respondWith(
      context,
      invalidOutputEnvelope(`${stage}_invalid_provider_output:${subcode}`),
      502
    );

    const error = await captureTransportError(() => STAGES[stage](new AiServiceClient()));

    // Clasificacion IDENTICA a antes de la slice.
    assert.equal(error.code, 'PROVIDER_INVALID_OUTPUT');
    assert.equal(error.status, 502);
    // Y ahora, ademas, el diagnostico.
    assert.equal(error.invalidOutputSubcode, subcode);
  });
}

// ---------------------------------------------------------------------------
// Todo lo demas sigue igual
// ---------------------------------------------------------------------------

test('un subcodigo desconocido da centinela, no el valor crudo', async (context) => {
  configureAiEnv(context);
  respondWith(
    context,
    invalidOutputEnvelope(
      'contextual_reasoning_invalid_provider_output:token_que_no_existe'
    ),
    502
  );

  const error = await captureTransportError(() =>
    STAGES.contextual_reasoning(new AiServiceClient())
  );
  assert.equal(error.code, 'PROVIDER_INVALID_OUTPUT');
  assert.equal(error.invalidOutputSubcode, UNKNOWN_INVALID_OUTPUT_SUBCODE);
});

test('un envelope sin message no rompe la clasificacion', async (context) => {
  configureAiEnv(context);
  respondWith(
    context,
    { schemaVersion: 'ai_service_error_v1', code: 'PROVIDER_INVALID_OUTPUT' },
    502
  );

  const error = await captureTransportError(() =>
    STAGES.contextual_reasoning(new AiServiceClient())
  );
  assert.equal(error.code, 'PROVIDER_INVALID_OUTPUT');
  assert.equal(error.invalidOutputSubcode, UNKNOWN_INVALID_OUTPUT_SUBCODE);
});

test('los OTROS codigos de aplicacion no arrastran subcodigo', async (context) => {
  configureAiEnv(context);
  for (const [code, status] of [
    ['EXECUTION_PLAN_MISMATCH', 409],
    ['PROVIDER_TRANSPORT_FAILURE', 503],
    ['PROVIDER_CONFIGURATION_FAILURE', 424]
  ] as const) {
    const single = new TestContextShim(context);
    single.respond(
      { schemaVersion: 'ai_service_error_v1', code, message: `algo:${code}` },
      status
    );
    const error = await captureTransportError(() =>
      STAGES.contextual_reasoning(new AiServiceClient())
    );
    assert.equal(error.code, code);
    assert.equal(error.invalidOutputSubcode, null, code);
    single.restore();
  }
});

test('un 502 SIN envelope sigue siendo fallo interno, sin subcodigo', async (context) => {
  configureAiEnv(context);
  // Un 502 de un proxy. La regla congelada —HTTP_STATUS_ALONE_TERMINAL: NO—
  // no se toca: no mata el run y no inventa diagnostico.
  respondWith(context, '<html>bad gateway</html>', 502);

  const error = await captureTransportError(() =>
    STAGES.contextual_reasoning(new AiServiceClient())
  );
  assert.equal(error.code, 'INTERNAL_AI_SERVICE_FAILURE');
  assert.equal(error.invalidOutputSubcode, null);
});

test('el mensaje del Error nunca lleva el detalle del ai-service', async (context) => {
  configureAiEnv(context);
  respondWith(
    context,
    invalidOutputEnvelope(
      'contextual_reasoning_invalid_provider_output:provider_output_unexpected_keys'
    ),
    502
  );

  const error = await captureTransportError(() =>
    STAGES.contextual_reasoning(new AiServiceClient())
  );
  // El `message` se imprime en cualquier log accidental: se mantiene minimo.
  assert.equal(error.message, 'PROVIDER_INVALID_OUTPUT: status 502');
  assert.ok(!error.message.includes('unexpected_keys'));
});

/** Permite reprogramar la respuesta dentro de un mismo test. */
class TestContextShim {
  private restoreFn: (() => void) | null = null;

  public constructor(private readonly context: TestContext) {}

  public respond(body: unknown, status: number): void {
    const mock = this.context.mock.method(globalThis, 'fetch', async () => {
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' }
      });
    });
    this.restoreFn = () => mock.mock.restore();
  }

  public restore(): void {
    this.restoreFn?.();
    this.restoreFn = null;
  }
}

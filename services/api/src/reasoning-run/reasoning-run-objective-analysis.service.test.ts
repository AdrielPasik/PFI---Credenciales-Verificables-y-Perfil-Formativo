/**
 * Ejecución productiva del Objective Analysis — F3.3B.
 *
 * CERO llamadas reales: el `AiServiceClient` se falsea y además CUENTA sus
 * invocaciones, porque buena parte de este contrato consiste en demostrar que en
 * ciertos caminos el proveedor no se toca.
 *
 * El servicio de slots es el REAL, sobre un Prisma falso. Falsearlo también
 * dejaría sin probar lo único que importa de verdad acá: que la validación, la
 * verificación contra el snapshot y el compare-and-set corren de punta a punta.
 */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { Prisma } from '@prisma/client';

import { AiServiceClient } from '../ai/ai-service.client';
import { ObjectiveAnalysisTransportError } from '../ai/ai-service.types';
import {
  clone,
  validObjectiveAnalysis
} from './__fixtures__/reasoning-run-artifacts.fixture';
import { ReasoningRunArtifactSlotService } from './reasoning-run-artifact-slot.service';
import { ReasoningRunObjectiveAnalysisService } from './reasoning-run-objective-analysis.service';
import { ObjectiveAnalysisStageError } from './reasoning-run-objective-analysis.errors';
import {
  OBJECTIVE_ANALYSIS_STAGE_IDENTITY,
  REASONING_EXECUTION_MODEL_ENV
} from './product-stage-identity';

const RUN_ID = 'run-1';
const MODEL = 'gpt-5.6-terra';

const REQUIREMENT_TEXT = 'Requisito: APIs REST nivel intermedio en backend';

function objectiveSnapshot(requirementIds: readonly string[] = ['req_01']) {
  return {
    schemaVersion: 'objective_definition_v1',
    objectiveType: 'EMPLOYMENT',
    objectiveContext: 'Backend Developer Junior',
    source: { inputType: 'DIRECT_STRUCTURED_INPUT', originalText: null },
    requirements: requirementIds.map((requirementId, index) => ({
      requirementId,
      order: index + 1,
      requirementText: REQUIREMENT_TEXT,
      provenance: { kind: 'DIRECT_STRUCTURED_INPUT', sourceQuote: null },
      qualifiers: []
    }))
  };
}

/** El artifact tal como lo devolvería el AI service, dentro de su envelope. */
function envelope(artifact: unknown = validObjectiveAnalysis()) {
  return {
    schemaVersion: 'product_objective_analysis_response_v1',
    execution: {
      artifactSchemaVersion: 'objective_analysis_v1',
      promptVersion: OBJECTIVE_ANALYSIS_STAGE_IDENTITY.promptVersion,
      adapterVersion: OBJECTIVE_ANALYSIS_STAGE_IDENTITY.adapterVersion,
      provider: 'openai',
      requestedModel: MODEL,
      reasoningEffort: 'medium',
      effectiveModelVerification: 'MATCH'
    },
    artifact
  };
}

function frozenPlan(overrides: Record<string, unknown> = {}) {
  const stage = (identity: {
    artifactSchemaVersion: string;
    promptVersion: string;
    adapterVersion: string;
  }) => ({
    artifactSchemaVersion: identity.artifactSchemaVersion,
    promptVersion: identity.promptVersion,
    adapterVersion: identity.adapterVersion,
    provider: { provider: 'openai', model: MODEL, reasoningEffort: 'medium' }
  });

  return {
    schemaVersion: 'reasoning_execution_metadata_v1',
    reasonerContractVersion: 'product_reasoner_v1',
    deterministicPolicyVersion: 'product_epistemic_policy_v1',
    objectiveAnalysis: { ...stage(OBJECTIVE_ANALYSIS_STAGE_IDENTITY), ...overrides },
    evidenceUnits: stage({
      artifactSchemaVersion: 'evidence_units_v1',
      promptVersion: 'product_evidence_units_v1',
      adapterVersion: 'product_evidence_units_adapter_v1'
    }),
    contextualReasoning: stage({
      artifactSchemaVersion: 'reasoning_run_result_v1',
      promptVersion: 'product_contextual_reasoning_v1',
      adapterVersion: 'product_contextual_reasoning_adapter_v1'
    })
  };
}

interface FakeRun {
  id: string;
  status: string;
  failureCode: string | null;
  failedAt: Date | null;
  objectiveDefinitionSnapshot: unknown;
  objectiveAnalysisArtifact: unknown;
  evidenceUnitsArtifact: unknown;
  resultArtifact: unknown;
  executionMetadata: unknown;
}

function matchesFilter(actual: unknown, expected: unknown): boolean {
  if (
    expected !== null &&
    typeof expected === 'object' &&
    'equals' in (expected as Record<string, unknown>)
  ) {
    const target = (expected as Record<string, unknown>).equals;
    if (target === Prisma.DbNull) return actual === null || actual === undefined;
    return actual === target;
  }
  return actual === expected;
}

function fakePrisma(overrides: Partial<FakeRun> = {}) {
  const state: { run: FakeRun | null } = {
    run: {
      id: RUN_ID,
      status: 'pending',
      failureCode: null,
      failedAt: null,
      objectiveDefinitionSnapshot: objectiveSnapshot(),
      objectiveAnalysisArtifact: null,
      evidenceUnitsArtifact: null,
      resultArtifact: null,
      executionMetadata: null,
      ...overrides
    }
  };

  const prisma = {
    reasoningRun: {
      findUnique: async ({ where }: any) =>
        state.run && state.run.id === where.id ? { ...state.run } : null,
      updateMany: async ({ where, data }: any) => {
        const run = state.run;
        if (!run || run.id !== where.id) return { count: 0 };
        for (const [column, expected] of Object.entries(where)) {
          if (column === 'id') continue;
          if (!matchesFilter((run as any)[column], expected)) return { count: 0 };
        }
        Object.assign(run, data);
        return { count: 1 };
      }
    },
    reasoningRunInventoryItem: { findMany: async () => [] }
  };

  return { prisma, state };
}

interface AiCall {
  schemaVersion: string;
  executionPlan: Record<string, unknown>;
  objectiveType: string;
  objectiveContext: string;
  requirements: { requirementId: string; requirementText: string }[];
  correlationId?: string;
}

function fakeAi(behaviour: {
  response?: unknown;
  throws?: Error;
} = {}) {
  const calls: AiCall[] = [];
  const ai = {
    analyzeObjective: async (input: AiCall) => {
      calls.push(input);
      if (behaviour.throws) throw behaviour.throws;
      return behaviour.response ?? envelope();
    }
  };
  return { ai, calls };
}

function service(prisma: unknown, ai: unknown): ReasoningRunObjectiveAnalysisService {
  return new ReasoningRunObjectiveAnalysisService(
    prisma as never,
    new ReasoningRunArtifactSlotService(prisma as never),
    ai as never
  );
}

function withModel(context: TestContext, model: string | null = MODEL): void {
  const previous = process.env[REASONING_EXECUTION_MODEL_ENV];
  if (model === null) delete process.env[REASONING_EXECUTION_MODEL_ENV];
  else process.env[REASONING_EXECUTION_MODEL_ENV] = model;
  context.after(() => {
    if (previous === undefined) delete process.env[REASONING_EXECUTION_MODEL_ENV];
    else process.env[REASONING_EXECUTION_MODEL_ENV] = previous;
  });
}

async function expectStageCode(
  fn: () => Promise<unknown>,
  code: string
): Promise<ObjectiveAnalysisStageError> {
  try {
    await fn();
  } catch (error: unknown) {
    assert.ok(error instanceof ObjectiveAnalysisStageError, String(error));
    assert.equal(error.code, code);
    return error;
  }
  throw new Error(`expected ${code} but nothing was thrown`);
}

// ---------------------------------------------------------------------------
// Camino feliz
// ---------------------------------------------------------------------------

test('un run pendiente congela el plan, llama UNA vez y persiste el artifact', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma();
  const { ai, calls } = fakeAi();

  const outcome = await service(prisma, ai).ensureObjectiveAnalysisForRun(RUN_ID);

  assert.equal(calls.length, 1);
  assert.equal(outcome.providerCalled, true);
  assert.equal(outcome.effectiveModelVerification, 'MATCH');
  assert.equal(outcome.artifact.schemaVersion, 'objective_analysis_v1');
  assert.notEqual(state.run!.objectiveAnalysisArtifact, null);
  assert.notEqual(state.run!.executionMetadata, null);
});

test('el plan se congela ANTES de la primera llamada', async (context) => {
  // No es cosmética de orden: anotar después con qué modelo se llamó convertiría
  // el plan en una crónica, y un plan que se escribe después no compromete nada.
  withModel(context);
  const { prisma, state } = fakePrisma();
  const events: string[] = [];
  const ai = {
    analyzeObjective: async () => {
      events.push(state.run!.executionMetadata === null ? 'sin-plan' : 'con-plan');
      return envelope();
    }
  };

  await service(prisma, ai).ensureObjectiveAnalysisForRun(RUN_ID);

  assert.deepEqual(events, ['con-plan']);
});

test('el plan congela las TRES etapas, incluidas las que no existen', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma();
  const { ai } = fakeAi();

  await service(prisma, ai).ensureObjectiveAnalysisForRun(RUN_ID);

  const plan = state.run!.executionMetadata as Record<string, any>;
  assert.equal(plan.objectiveAnalysis.promptVersion, 'product_objective_analysis_v1');
  assert.equal(plan.evidenceUnits.promptVersion, 'product_evidence_units_v1');
  assert.equal(
    plan.contextualReasoning.promptVersion,
    'product_contextual_reasoning_v1'
  );
  // Un plan parcial no es escribible: con fill-once, una etapa indeterminada no
  // podría completarse nunca.
  for (const stage of ['objectiveAnalysis', 'evidenceUnits', 'contextualReasoning']) {
    assert.equal(plan[stage].provider.model, MODEL);
  }
});

test('un plan ya persistido NO se reescribe con la configuracion de hoy', async (context) => {
  withModel(context);
  const frozen = frozenPlan();
  const { prisma, state } = fakePrisma({ executionMetadata: clone(frozen) });
  const { ai } = fakeAi();

  await service(prisma, ai).ensureObjectiveAnalysisForRun(RUN_ID);

  assert.deepEqual(state.run!.executionMetadata, frozen);
});

// ---------------------------------------------------------------------------
// Autoridad: la fila, no el llamante
// ---------------------------------------------------------------------------

test('el metodo no recibe NINGUNA autoridad del llamante', () => {
  // Si el llamante pudiera pasar el Objective, podria pasar OTRO Objective, y el
  // snapshot congelado dejaria de ser la autoridad del run.
  //
  // F3.6 agrego un SEGUNDO parametro que NO es autoridad: la claim de ejecucion
  // es una capability que nombra la fila ya reclamada, no un dato contra el cual
  // validar. Sigue sin haber forma de pasar Requirements, inventario ni catalogo.
  assert.equal(
    ReasoningRunObjectiveAnalysisService.prototype.ensureObjectiveAnalysisForRun
      .length,
    2
  );
});

test('los Requirements salen del snapshot persistido', async (context) => {
  withModel(context);
  const { prisma } = fakePrisma({
    objectiveDefinitionSnapshot: objectiveSnapshot(['req_01', 'req_02'])
  });
  const raw = validObjectiveAnalysis();
  const second = clone(raw.requirements[0]);
  second.requirementId = 'req_02';
  second.qualifiers[0].qualifierId = 'q_01';
  raw.requirements.push(second);
  const { ai, calls } = fakeAi({ response: envelope(raw) });

  await service(prisma, ai).ensureObjectiveAnalysisForRun(RUN_ID);

  assert.deepEqual(
    calls[0].requirements.map((item) => item.requirementId),
    ['req_01', 'req_02']
  );
  assert.equal(calls[0].requirements[0].requirementText, REQUIREMENT_TEXT);
});

test('el request es evidence-blind por construccion', async (context) => {
  withModel(context);
  const { prisma } = fakePrisma();
  const { ai, calls } = fakeAi();

  await service(prisma, ai).ensureObjectiveAnalysisForRun(RUN_ID);

  assert.deepEqual(Object.keys(calls[0]).sort(), [
    'correlationId',
    'executionPlan',
    'objectiveContext',
    'objectiveType',
    'requirements',
    'schemaVersion'
  ]);
  const serialized = JSON.stringify(calls[0]);
  for (const forbidden of ['evidenceUnit', 'credential', 'exactExcerpt', 'sha256']) {
    assert.ok(!serialized.includes(forbidden), forbidden);
  }
});

// ---------------------------------------------------------------------------
// Idempotencia
// ---------------------------------------------------------------------------

test('con el artifact ya persistido no se llama al proveedor', async (context) => {
  withModel(context);
  const { prisma } = fakePrisma({
    objectiveAnalysisArtifact: validObjectiveAnalysis(),
    executionMetadata: frozenPlan()
  });
  const { ai, calls } = fakeAi();

  const outcome = await service(prisma, ai).ensureObjectiveAnalysisForRun(RUN_ID);

  assert.equal(calls.length, 0);
  assert.equal(outcome.providerCalled, false);
  assert.equal(outcome.effectiveModelVerification, null);
});

test('dos ejecuciones seguidas dejan UN solo artifact', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma();
  const { ai, calls } = fakeAi();
  const target = service(prisma, ai);

  const first = await target.ensureObjectiveAnalysisForRun(RUN_ID);
  const second = await target.ensureObjectiveAnalysisForRun(RUN_ID);

  assert.equal(calls.length, 1, 'la segunda no vuelve a preguntar');
  assert.deepEqual(first.artifact, second.artifact);
  assert.notEqual(state.run!.objectiveAnalysisArtifact, null);
});

// ---------------------------------------------------------------------------
// Elegibilidad
// ---------------------------------------------------------------------------

test('un run inexistente se rechaza', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma();
  state.run = null;
  const { ai, calls } = fakeAi();

  await expectStageCode(
    () => service(prisma, ai).ensureObjectiveAnalysisForRun(RUN_ID),
    'REASONING_RUN_NOT_FOUND'
  );
  assert.equal(calls.length, 0);
});

test('un run ya fallado no ejecuta la etapa', async (context) => {
  withModel(context);
  const { prisma } = fakePrisma({
    status: 'failed',
    failureCode: 'reasoning_input_freeze_blocked'
  });
  const { ai, calls } = fakeAi();

  await expectStageCode(
    () => service(prisma, ai).ensureObjectiveAnalysisForRun(RUN_ID),
    'RUN_NOT_ELIGIBLE'
  );
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// Configuración y desajuste de plan
// ---------------------------------------------------------------------------

test('sin modelo configurado no se congela un plan a medias', async (context) => {
  withModel(context, null);
  const { prisma, state } = fakePrisma();
  const { ai, calls } = fakeAi();

  await expectStageCode(
    () => service(prisma, ai).ensureObjectiveAnalysisForRun(RUN_ID),
    'EXECUTION_CONFIGURATION_MISSING'
  );
  assert.equal(calls.length, 0);
  assert.equal(state.run!.executionMetadata, null, 'no se escribe un plan parcial');
  assert.equal(state.run!.status, 'pending', 'no es un desenlace del run');
});

test('un plan congelado que ya no describe la configuracion mata el run', async (context) => {
  // CONFIG_DRIFT_POLICY: FAIL_CLOSED. Y sin gastar una llamada.
  withModel(context);
  const { prisma, state } = fakePrisma({
    executionMetadata: frozenPlan({ promptVersion: 'product_objective_analysis_v0' })
  });
  const { ai, calls } = fakeAi();

  await expectStageCode(
    () => service(prisma, ai).ensureObjectiveAnalysisForRun(RUN_ID),
    'EXECUTION_PLAN_MISMATCH'
  );
  assert.equal(calls.length, 0);
  assert.equal(state.run!.status, 'failed');
  assert.equal(state.run!.failureCode, 'reasoning_execution_plan_mismatch');
});

test('el modelo del plan tambien se compara antes de llamar', async (context) => {
  withModel(context, 'otro-modelo');
  const { prisma, state } = fakePrisma({ executionMetadata: frozenPlan() });
  const { ai, calls } = fakeAi();

  await expectStageCode(
    () => service(prisma, ai).ensureObjectiveAnalysisForRun(RUN_ID),
    'EXECUTION_PLAN_MISMATCH'
  );
  assert.equal(calls.length, 0);
  assert.equal(state.run!.failureCode, 'reasoning_execution_plan_mismatch');
});

test('el codigo de fallo NO lleva configuracion de despliegue', async (context) => {
  withModel(context, 'modelo-de-despliegue');
  const { prisma, state } = fakePrisma({ executionMetadata: frozenPlan() });
  const { ai } = fakeAi();

  const error = await expectStageCode(
    () => service(prisma, ai).ensureObjectiveAnalysisForRun(RUN_ID),
    'EXECUTION_PLAN_MISMATCH'
  );
  assert.ok(!error.message.includes('modelo-de-despliegue'));
  assert.ok(!error.message.includes(MODEL));
  assert.equal(state.run!.failureCode, 'reasoning_execution_plan_mismatch');
});

test('el AI service tambien puede rechazar el plan desde su lado', async (context) => {
  // Los dos comparan a proposito: ninguno confia en el otro por convencion.
  withModel(context);
  const { prisma, state } = fakePrisma();
  const { ai } = fakeAi({
    throws: new ObjectiveAnalysisTransportError('EXECUTION_PLAN_MISMATCH', 409)
  });

  await expectStageCode(
    () => service(prisma, ai).ensureObjectiveAnalysisForRun(RUN_ID),
    'EXECUTION_PLAN_MISMATCH'
  );
  assert.equal(state.run!.status, 'failed');
});

// ---------------------------------------------------------------------------
// Salida del proveedor
// ---------------------------------------------------------------------------

test('una salida completa e invalida mata el run sin volver a preguntar', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma();
  const { ai, calls } = fakeAi({
    throws: new ObjectiveAnalysisTransportError('PROVIDER_INVALID_OUTPUT', 502)
  });

  await expectStageCode(
    () => service(prisma, ai).ensureObjectiveAnalysisForRun(RUN_ID),
    'PROVIDER_INVALID_OUTPUT'
  );
  assert.equal(calls.length, 1, 'no se le vuelve a preguntar');
  assert.equal(state.run!.failureCode, 'reasoning_objective_analysis_invalid_output');
});

test('un artifact que no verifica contra el snapshot PERSISTIDO mata el run', async (context) => {
  // El AI service verifico contra lo que dijo haber recibido; esto verifica
  // contra la autoridad del run.
  withModel(context);
  const { prisma, state } = fakePrisma();
  const raw = validObjectiveAnalysis();
  raw.requirements[0].requirementId = 'req_09';
  const { ai } = fakeAi({ response: envelope(raw) });

  await expectStageCode(
    () => service(prisma, ai).ensureObjectiveAnalysisForRun(RUN_ID),
    'PROVIDER_INVALID_OUTPUT'
  );
  assert.equal(state.run!.failureCode, 'reasoning_objective_analysis_invalid_output');
  assert.equal(state.run!.objectiveAnalysisArtifact, null);
});

test('un qualifier que no cita literalmente el Requirement mata el run', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma();
  const raw = validObjectiveAnalysis();
  raw.requirements[0].qualifiers[0].sourcePhrase = 'dominio avanzado';
  const { ai } = fakeAi({ response: envelope(raw) });

  await expectStageCode(
    () => service(prisma, ai).ensureObjectiveAnalysisForRun(RUN_ID),
    'PROVIDER_INVALID_OUTPUT'
  );
  assert.equal(state.run!.objectiveAnalysisArtifact, null);
});

test('un Requirement agregado por el modelo no es persistible', async (context) => {
  // La mitigacion real de la inyeccion no es que el prompt la prohiba: es que el
  // Requirement extra no entre en la base.
  withModel(context);
  const { prisma, state } = fakePrisma();
  const raw = validObjectiveAnalysis();
  const extra = clone(raw.requirements[0]);
  extra.requirementId = 'req_02';
  raw.requirements.push(extra);
  const { ai } = fakeAi({ response: envelope(raw) });

  await expectStageCode(
    () => service(prisma, ai).ensureObjectiveAnalysisForRun(RUN_ID),
    'PROVIDER_INVALID_OUTPUT'
  );
  assert.equal(state.run!.objectiveAnalysisArtifact, null);
});

// ---------------------------------------------------------------------------
// Fallos que NO son desenlaces del run
// ---------------------------------------------------------------------------

test('un fallo de transporte deja el run intacto y reintentable', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma();
  const { ai } = fakeAi({
    throws: new ObjectiveAnalysisTransportError('PROVIDER_TRANSPORT_FAILURE', 503)
  });

  await expectStageCode(
    () => service(prisma, ai).ensureObjectiveAnalysisForRun(RUN_ID),
    'PROVIDER_TRANSPORT_FAILURE'
  );
  assert.equal(state.run!.status, 'pending');
  assert.equal(state.run!.failureCode, null);
  assert.equal(state.run!.objectiveAnalysisArtifact, null);
});

test('despues de un fallo de transporte, el reintento en la MISMA fila funciona', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma();
  let fail = true;
  const ai = {
    analyzeObjective: async () => {
      if (fail) {
        fail = false;
        throw new ObjectiveAnalysisTransportError('PROVIDER_TRANSPORT_FAILURE', 503);
      }
      return envelope();
    }
  };
  const target = service(prisma, ai);

  await assert.rejects(() => target.ensureObjectiveAnalysisForRun(RUN_ID));
  const outcome = await target.ensureObjectiveAnalysisForRun(RUN_ID);

  assert.equal(outcome.providerCalled, true);
  assert.notEqual(state.run!.objectiveAnalysisArtifact, null);
});

test('un fallo interno del AI service no mata el run', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma();
  const { ai } = fakeAi({
    throws: new ObjectiveAnalysisTransportError('INTERNAL_AI_SERVICE_FAILURE', 422)
  });

  await expectStageCode(
    () => service(prisma, ai).ensureObjectiveAnalysisForRun(RUN_ID),
    'INTERNAL_AI_SERVICE_FAILURE'
  );
  assert.equal(state.run!.status, 'pending');
  assert.equal(state.run!.failureCode, null);
});

test('un envelope que no se entiende es fallo interno, no del proveedor', async (context) => {
  // Un desajuste de despliegue entre los dos servicios no puede matar runs.
  withModel(context);
  const { prisma, state } = fakePrisma();
  const { ai } = fakeAi({
    response: { schemaVersion: 'product_objective_analysis_response_v2', artifact: {} }
  });

  await expectStageCode(
    () => service(prisma, ai).ensureObjectiveAnalysisForRun(RUN_ID),
    'INTERNAL_AI_SERVICE_FAILURE'
  );
  assert.equal(state.run!.status, 'pending');
});

// ---------------------------------------------------------------------------
// Coherencia de la fila
// ---------------------------------------------------------------------------

test('un run failed nunca queda con artifact de etapa', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma();
  const { ai } = fakeAi({
    throws: new ObjectiveAnalysisTransportError('PROVIDER_INVALID_OUTPUT', 502)
  });

  await assert.rejects(() =>
    service(prisma, ai).ensureObjectiveAnalysisForRun(RUN_ID)
  );

  assert.equal(state.run!.status, 'failed');
  assert.equal(state.run!.objectiveAnalysisArtifact, null);
});

test('un exito concurrente no se pisa con un fallo terminal', async (context) => {
  // La transicion es CONDICIONAL sobre el mismo estado elegible que el CAS del
  // artifact. Si otro trabajador ya persistio, la fila gana y no se reescribe.
  withModel(context);
  const { prisma, state } = fakePrisma();
  const { ai } = fakeAi({
    throws: new ObjectiveAnalysisTransportError('PROVIDER_INVALID_OUTPUT', 502)
  });
  const target = service(prisma, ai);

  // Un exito concurrente entre la llamada y la marca terminal.
  const original = prisma.reasoningRun.updateMany;
  prisma.reasoningRun.updateMany = async (args: any) => {
    state.run!.objectiveAnalysisArtifact = validObjectiveAnalysis();
    prisma.reasoningRun.updateMany = original;
    return original(args);
  };

  await assert.rejects(() => target.ensureObjectiveAnalysisForRun(RUN_ID));

  assert.equal(state.run!.status, 'pending', 'la fila conserva el exito');
  assert.equal(state.run!.failureCode, null);
  assert.notEqual(state.run!.objectiveAnalysisArtifact, null);
});

test('la marca terminal se escribe ANTES de lanzar, no en segundo plano', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma();
  const { ai } = fakeAi({
    throws: new ObjectiveAnalysisTransportError('PROVIDER_INVALID_OUTPUT', 502)
  });

  await assert.rejects(() =>
    service(prisma, ai).ensureObjectiveAnalysisForRun(RUN_ID)
  );

  // Sin `await`, esta asercion pasaria por casualidad segun el scheduler.
  assert.equal(state.run!.failureCode, 'reasoning_objective_analysis_invalid_output');
  assert.ok(state.run!.failedAt instanceof Date);
});


// ---------------------------------------------------------------------------
// Composición con el transporte real — F3.3B.1
// ---------------------------------------------------------------------------

/**
 * Los tests de arriba inyectan errores de transporte ya clasificados. Éstos
 * atraviesan el `AiServiceClient` REAL con `fetch` falseado, que es la única
 * forma de demostrar que las dos mitades componen: una respuesta opaca no puede
 * terminar matando un run por más que el status diga 502.
 */
function configureAiEnv(context: TestContext): void {
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

function realClientReturning(
  context: TestContext,
  body: string,
  status: number
): AiServiceClient {
  configureAiEnv(context);
  context.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(body, {
        status,
        headers: { 'content-type': 'application/json' }
      })
  );
  return new AiServiceClient();
}

test('un 502 OPACO no mata el run — end to end', async (context) => {
  // El caso que motivó F3.3B.1. Un proxy contesta 502 sin cuerpo y el run tiene
  // que seguir vivo: nadie demostró que un proveedor haya respondido nada.
  withModel(context);
  const { prisma, state } = fakePrisma();
  const client = realClientReturning(context, '', 502);

  await expectStageCode(
    () => service(prisma, client).ensureObjectiveAnalysisForRun(RUN_ID),
    'INTERNAL_AI_SERVICE_FAILURE'
  );

  assert.equal(state.run!.status, 'pending');
  assert.equal(state.run!.failureCode, null);
  assert.equal(state.run!.objectiveAnalysisArtifact, null);
});

test('un 502 con envelope valido SI mata el run — end to end', async (context) => {
  // La contracara: con la afirmación de la aplicación delante, el desenlace
  // terminal es correcto y necesario.
  withModel(context);
  const { prisma, state } = fakePrisma();
  const client = realClientReturning(
    context,
    JSON.stringify({
      schemaVersion: 'ai_service_error_v1',
      code: 'PROVIDER_INVALID_OUTPUT',
      message: 'objective_analysis_invalid_provider_output:requirement_count_mismatch'
    }),
    502
  );

  await expectStageCode(
    () => service(prisma, client).ensureObjectiveAnalysisForRun(RUN_ID),
    'PROVIDER_INVALID_OUTPUT'
  );

  assert.equal(state.run!.status, 'failed');
  assert.equal(state.run!.failureCode, 'reasoning_objective_analysis_invalid_output');
});

test('un 409 con envelope valido mata el run — end to end', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma();
  const client = realClientReturning(
    context,
    JSON.stringify({
      schemaVersion: 'ai_service_error_v1',
      code: 'EXECUTION_PLAN_MISMATCH'
    }),
    409
  );

  await expectStageCode(
    () => service(prisma, client).ensureObjectiveAnalysisForRun(RUN_ID),
    'EXECUTION_PLAN_MISMATCH'
  );

  assert.equal(state.run!.failureCode, 'reasoning_execution_plan_mismatch');
});

test('un 503 con envelope valido deja el run reintentable — end to end', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma();
  const client = realClientReturning(
    context,
    JSON.stringify({
      schemaVersion: 'ai_service_error_v1',
      code: 'PROVIDER_TRANSPORT_FAILURE'
    }),
    503
  );

  await expectStageCode(
    () => service(prisma, client).ensureObjectiveAnalysisForRun(RUN_ID),
    'PROVIDER_TRANSPORT_FAILURE'
  );

  assert.equal(state.run!.status, 'pending');
  assert.equal(state.run!.failureCode, null);
});

test('un 422 de validacion de request no mata el run — end to end', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma();
  const client = realClientReturning(
    context,
    JSON.stringify({ detail: [{ loc: ['body', 'requirements'] }] }),
    422
  );

  await expectStageCode(
    () => service(prisma, client).ensureObjectiveAnalysisForRun(RUN_ID),
    'INTERNAL_AI_SERVICE_FAILURE'
  );

  assert.equal(state.run!.status, 'pending');
  assert.equal(state.run!.failureCode, null);
});


// ---------------------------------------------------------------------------
// Fallo determinista del proveedor — F3.3B.2
// ---------------------------------------------------------------------------

test('un rechazo determinista del proveedor mata el run', async (context) => {
  // Modelo inexistente o credencial invalida: repetir el MISMO plan no puede dar
  // otro resultado, asi que dejarlo pendiente seria un bucle.
  withModel(context);
  const { prisma, state } = fakePrisma();
  const { ai, calls } = fakeAi({
    throws: new ObjectiveAnalysisTransportError('PROVIDER_CONFIGURATION_FAILURE', 424)
  });

  await expectStageCode(
    () => service(prisma, ai).ensureObjectiveAnalysisForRun(RUN_ID),
    'PROVIDER_CONFIGURATION_FAILURE'
  );

  assert.equal(calls.length, 1);
  assert.equal(state.run!.status, 'failed');
  assert.equal(state.run!.failureCode, 'reasoning_provider_configuration_invalid');
  assert.equal(state.run!.objectiveAnalysisArtifact, null);
});

test('el fallo determinista NO deja el run reintentable', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma();
  const { ai } = fakeAi({
    throws: new ObjectiveAnalysisTransportError('PROVIDER_CONFIGURATION_FAILURE', 424)
  });
  const target = service(prisma, ai);

  await assert.rejects(() => target.ensureObjectiveAnalysisForRun(RUN_ID));
  // El segundo intento ni siquiera llega al proveedor: el run ya termino.
  await expectStageCode(
    () => target.ensureObjectiveAnalysisForRun(RUN_ID),
    'RUN_NOT_ELIGIBLE'
  );
  assert.equal(state.run!.failureCode, 'reasoning_provider_configuration_invalid');
});

test('transitorio y determinista dan desenlaces OPUESTOS', async (context) => {
  withModel(context);

  const transient = fakePrisma();
  await expectStageCode(
    () =>
      service(
        transient.prisma,
        fakeAi({
          throws: new ObjectiveAnalysisTransportError('PROVIDER_TRANSPORT_FAILURE', 503)
        }).ai
      ).ensureObjectiveAnalysisForRun(RUN_ID),
    'PROVIDER_TRANSPORT_FAILURE'
  );

  const deterministic = fakePrisma();
  await expectStageCode(
    () =>
      service(
        deterministic.prisma,
        fakeAi({
          throws: new ObjectiveAnalysisTransportError('PROVIDER_CONFIGURATION_FAILURE', 424)
        }).ai
      ).ensureObjectiveAnalysisForRun(RUN_ID),
    'PROVIDER_CONFIGURATION_FAILURE'
  );

  assert.equal(transient.state.run!.status, 'pending');
  assert.equal(transient.state.run!.failureCode, null);
  assert.equal(deterministic.state.run!.status, 'failed');
  assert.notEqual(deterministic.state.run!.failureCode, null);
});

test('el failureCode determinista no lleva configuracion ni credencial', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma();
  const { ai } = fakeAi({
    throws: new ObjectiveAnalysisTransportError('PROVIDER_CONFIGURATION_FAILURE', 424)
  });

  const error = await expectStageCode(
    () => service(prisma, ai).ensureObjectiveAnalysisForRun(RUN_ID),
    'PROVIDER_CONFIGURATION_FAILURE'
  );

  assert.equal(state.run!.failureCode, 'reasoning_provider_configuration_invalid');
  assert.ok(!error.message.includes(MODEL));
  assert.ok(!error.message.includes('sk-'));
});

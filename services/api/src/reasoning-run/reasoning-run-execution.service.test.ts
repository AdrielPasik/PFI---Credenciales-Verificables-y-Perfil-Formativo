/**
 * Ejecución completa de un ReasoningRun — slice F3.6.
 *
 * Se ejercita el lifecycle REAL —claim, policy, verificación y finalización
 * atómica— contra una Prisma falsa y con las TRES etapas semánticas dobladas.
 *
 *     REAL_PROVIDER_CALLS: 0
 *
 * Las etapas se doblan porque sus caminos ya están cubiertos por F3.3/F3.4/F3.5;
 * lo que este slice tiene que probar es lo que ninguna de ellas prueba: quién
 * puede ejecutar, qué pasa cuando dos lo intentan a la vez, y que un resultado
 * final y su `completed` no puedan existir uno sin el otro.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { Prisma } from '@prisma/client';

import { ReasoningRunArtifactSlotService } from './reasoning-run-artifact-slot.service';
import { ReasoningRunExecutionClaimService } from './reasoning-run-execution-claim.service';
import { ReasoningRunExecutionService } from './reasoning-run-execution.service';
import { ReasoningRunExecutionError } from './reasoning-run-execution.errors';
import { ContextualReasoningStageError } from './reasoning-run-contextual-reasoning.errors';
import { applyDeterministicReasoningPolicy } from './deterministic-epistemic-policy';
import {
  clone,
  CONFIRMED_REQUIREMENT_TEXT,
  validEvidenceUnits,
  validExecutionMetadata,
  validObjectiveAnalysis,
  validResult,
  type Mutable
} from './__fixtures__/reasoning-run-artifacts.fixture';

const RUN_ID = 'run-1';

// ---------------------------------------------------------------------------
// Artifacts congelados de la fila
// ---------------------------------------------------------------------------

function snapshot(ids: readonly string[] = ['req_01']): Mutable {
  return {
    schemaVersion: 'objective_definition_v1',
    objectiveType: 'EMPLOYMENT',
    objectiveContext: 'Backend Developer Junior en equipo de plataforma',
    source: { inputType: 'DIRECT_STRUCTURED_INPUT', originalText: null },
    requirements: ids.map((requirementId, index) => ({
      requirementId,
      order: index + 1,
      requirementText: CONFIRMED_REQUIREMENT_TEXT,
      provenance: { kind: 'DIRECT_STRUCTURED_INPUT', sourceQuote: null },
      qualifiers: []
    }))
  };
}

function analysisArtifact(ids: readonly string[] = ['req_01']): Mutable {
  const base = validObjectiveAnalysis();
  base.requirements = ids.map((requirementId) => {
    const requirement = clone(base.requirements[0]) as Mutable;
    requirement.requirementId = requirementId;
    requirement.validations[0].artifactRef = requirementId;
    requirement.validations[0].detail = requirementId;
    return requirement;
  });
  return base;
}

function contextualResult(requirementId: string): Mutable {
  const result = clone(validResult().requirementResults[0]) as Mutable;
  delete result.finalState;
  delete result.policyTrace;
  delete result.explanation;
  result.requirementId = requirementId;
  return result;
}

function contextualAggregate(ids: readonly string[] = ['req_01']): Mutable {
  return {
    schemaVersion: 'contextual_reasoning_v1',
    requirementResults: ids.map((id) => contextualResult(id))
  };
}

/** El artifact final que la policy produce para estas mismas entradas. */
function expectedResult(ids: readonly string[] = ['req_01']) {
  return applyDeterministicReasoningPolicy({
    definition: snapshot(ids),
    objectiveAnalysis: analysisArtifact(ids),
    evidenceUnits: validEvidenceUnits(),
    contextualReasoning: contextualAggregate(ids)
  } as never);
}

// ---------------------------------------------------------------------------
// Dobles
// ---------------------------------------------------------------------------

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

function fakePrisma(options: { run?: Record<string, unknown>; ids?: readonly string[] } = {}) {
  const ids = options.ids ?? ['req_01'];
  const state: { run: Record<string, any> | null } = {
    run: {
      id: RUN_ID,
      status: 'pending',
      failureCode: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      objectiveDefinitionSnapshot: snapshot(ids),
      objectiveAnalysisArtifact: analysisArtifact(ids),
      evidenceUnitsArtifact: validEvidenceUnits(),
      resultArtifact: null,
      executionMetadata: validExecutionMetadata(),
      ...options.run
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
          if (!matchesFilter(run[column], expected)) return { count: 0 };
        }
        Object.assign(run, data);
        return { count: 1 };
      }
    },
    reasoningRunInventoryItem: { findMany: async () => [] }
  };

  return { prisma, state };
}

interface StageBehaviour {
  readonly ids?: readonly string[];
  readonly objectiveAnalysisError?: Error;
  readonly evidenceUnitsError?: Error;
  readonly contextualError?: Error;
  /** El Requirement en el que corta el razonamiento contextual. */
  readonly contextualFailsAt?: string;
  readonly objectiveAnalysisPersisted?: boolean;
  readonly evidenceUnitsPersisted?: boolean;
}

function fakeStages(behaviour: StageBehaviour = {}) {
  const ids = behaviour.ids ?? ['req_01'];
  const calls = {
    objectiveAnalysis: 0,
    evidenceUnits: 0,
    contextualRequirements: [] as string[],
    claimedIds: [] as (string | undefined)[]
  };

  const objectiveAnalysis = {
    ensureObjectiveAnalysisForRun: async (runId: string, claim?: any) => {
      calls.objectiveAnalysis += 1;
      calls.claimedIds.push(claim?.reasoningRunId);
      if (behaviour.objectiveAnalysisError) throw behaviour.objectiveAnalysisError;
      return {
        reasoningRunId: runId,
        artifact: analysisArtifact(ids),
        providerCalled: behaviour.objectiveAnalysisPersisted !== true,
        effectiveModelVerification: null
      };
    }
  };

  const evidenceUnits = {
    ensureEvidenceUnitsForRun: async (runId: string, claim?: any) => {
      calls.evidenceUnits += 1;
      calls.claimedIds.push(claim?.reasoningRunId);
      if (behaviour.evidenceUnitsError) throw behaviour.evidenceUnitsError;
      return {
        reasoningRunId: runId,
        artifact: validEvidenceUnits(),
        providerCalled: behaviour.evidenceUnitsPersisted !== true,
        effectiveModelVerification: null,
        includedSourceCount: 1
      };
    }
  };

  const contextual = {
    generateContextualReasoningForRun: async (runId: string, claim?: any) => {
      calls.claimedIds.push(claim?.reasoningRunId);
      if (behaviour.contextualError) throw behaviour.contextualError;
      // FAIL_FAST: se recorre en orden y se corta en el primero que falla, sin
      // llamar por los siguientes.
      for (const id of ids) {
        calls.contextualRequirements.push(id);
        if (behaviour.contextualFailsAt === id) {
          throw new ContextualReasoningStageError('PROVIDER_TRANSPORT_FAILURE', {
            invariant: 'no_usable_semantic_response',
            reasoningRunId: runId,
            requirementId: id
          });
        }
      }
      return {
        reasoningRunId: runId,
        contextualReasoning: contextualAggregate(ids),
        providerCallsMade: ids.length,
        effectiveModelVerification: null
      };
    }
  };

  return { calls, objectiveAnalysis, evidenceUnits, contextual };
}

function service(prisma: unknown, stages: ReturnType<typeof fakeStages>) {
  const slots = new ReasoningRunArtifactSlotService(prisma as never);
  const claims = new ReasoningRunExecutionClaimService(prisma as never);
  return new ReasoningRunExecutionService(
    prisma as never,
    claims,
    slots,
    stages.objectiveAnalysis as never,
    stages.evidenceUnits as never,
    stages.contextual as never
  );
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error: unknown) {
    assert.ok(error instanceof ReasoningRunExecutionError, String(error));
    return error.code;
  }
  assert.fail('se esperaba un error de ejecucion');
}

// ---------------------------------------------------------------------------
// Camino completo
// ---------------------------------------------------------------------------

test('PIPELINE: claim, tres etapas, policy y completado atomico', async () => {
  const { prisma, state } = fakePrisma();
  const stages = fakeStages();

  const outcome = await service(prisma, stages).executeReasoningRun(RUN_ID);

  assert.equal(outcome.executed, true);
  assert.equal(outcome.requirementCount, 1);
  // 1 Objective Analysis + 1 EvidenceUnits + 1 contextual. La policy no suma.
  assert.equal(outcome.providerLogicalCalls, 3);

  assert.equal(state.run!.status, 'completed');
  assert.ok(state.run!.completedAt instanceof Date);
  assert.equal(state.run!.failureCode, null);
  assert.equal(state.run!.failedAt, null);
  assert.deepEqual(state.run!.resultArtifact, expectedResult());
});

test('la claim se toma ANTES de que ninguna etapa compre una observacion', async () => {
  const { prisma, state } = fakePrisma();
  const observed: string[] = [];
  const stages = fakeStages();
  const original = stages.objectiveAnalysis.ensureObjectiveAnalysisForRun;
  stages.objectiveAnalysis.ensureObjectiveAnalysisForRun = async (id: string, claim?: any) => {
    observed.push(state.run!.status);
    return original(id, claim);
  };

  await service(prisma, stages).executeReasoningRun(RUN_ID);
  assert.deepEqual(observed, ['running']);
});

test('startedAt se fija en el primer intento y NO se reescribe despues', async () => {
  const first = new Date('2020-01-01T00:00:00.000Z');
  const { prisma, state } = fakePrisma({ run: { startedAt: first } });
  await service(prisma, fakeStages()).executeReasoningRun(RUN_ID);
  assert.equal(state.run!.startedAt, first);
});

test('un run sin startedAt lo recibe al reclamar', async () => {
  const { prisma, state } = fakePrisma();
  await service(prisma, fakeStages()).executeReasoningRun(RUN_ID);
  assert.ok(state.run!.startedAt instanceof Date);
});

test('las tres etapas reciben la claim de ESTE run', async () => {
  const { prisma } = fakePrisma();
  const stages = fakeStages();
  await service(prisma, stages).executeReasoningRun(RUN_ID);
  assert.deepEqual(stages.calls.claimedIds, [RUN_ID, RUN_ID, RUN_ID]);
});

test('MULTI-REQUIREMENT: tres Requirements en el orden del snapshot', async () => {
  const ids = ['req_01', 'req_02', 'req_03'];
  const { prisma, state } = fakePrisma({ ids });
  const stages = fakeStages({ ids });

  const outcome = await service(prisma, stages).executeReasoningRun(RUN_ID);

  assert.deepEqual(stages.calls.contextualRequirements, ids);
  assert.equal(outcome.providerLogicalCalls, 5); // 1 + 1 + 3
  assert.deepEqual(
    state.run!.resultArtifact.requirementResults.map((item: any) => item.requirementId),
    ids
  );
  // UN solo artifact agregado, no tres.
  assert.equal(state.run!.resultArtifact.schemaVersion, 'reasoning_run_result_v1');
});

test('REUSO: con los dos artifacts ya persistidos no se vuelve a comprar', async () => {
  const { prisma } = fakePrisma();
  const stages = fakeStages({
    objectiveAnalysisPersisted: true,
    evidenceUnitsPersisted: true
  });

  const outcome = await service(prisma, stages).executeReasoningRun(RUN_ID);

  assert.equal(stages.calls.objectiveAnalysis, 1); // se consulta
  assert.equal(stages.calls.evidenceUnits, 1);
  assert.equal(outcome.providerLogicalCalls, 1); // pero sólo el contextual compra
});

// ---------------------------------------------------------------------------
// Exclusión mutua
// ---------------------------------------------------------------------------

test('CAS: de dos intentos simultaneos gana exactamente uno', async () => {
  const { prisma, state } = fakePrisma();
  const winner = fakeStages();
  const loser = fakeStages();

  const [first, second] = await Promise.allSettled([
    service(prisma, winner).executeReasoningRun(RUN_ID),
    service(prisma, loser).executeReasoningRun(RUN_ID)
  ]);

  const fulfilled = [first, second].filter((item) => item.status === 'fulfilled');
  const rejected = [first, second].filter((item) => item.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);

  const error = (rejected[0] as PromiseRejectedResult).reason;
  assert.ok(error instanceof ReasoningRunExecutionError);
  assert.equal(error.code, 'EXECUTION_ALREADY_CLAIMED');

  // El perdedor NO ejecuta ninguna etapa: cero llamadas.
  const loserCalls =
    winner.calls.objectiveAnalysis + loser.calls.objectiveAnalysis;
  assert.equal(loserCalls, 1);
  assert.equal(state.run!.status, 'completed');
});

test('un run ya reclamado por otro rechaza sin ejecutar nada', async () => {
  const { prisma } = fakePrisma({ run: { status: 'running' } });
  const stages = fakeStages();

  assert.equal(
    await codeOf(() => service(prisma, stages).executeReasoningRun(RUN_ID)),
    'EXECUTION_ALREADY_CLAIMED'
  );
  assert.equal(stages.calls.objectiveAnalysis, 0);
});

// ---------------------------------------------------------------------------
// Lecturas terminales idempotentes
// ---------------------------------------------------------------------------

test('un run completed devuelve lo persistido sin comprar ni recomputar', async () => {
  const persisted = expectedResult();
  const { prisma, state } = fakePrisma({
    run: { status: 'completed', resultArtifact: clone(persisted) }
  });
  const stages = fakeStages();

  const outcome = await service(prisma, stages).executeReasoningRun(RUN_ID);

  assert.equal(outcome.executed, false);
  assert.equal(outcome.providerLogicalCalls, 0);
  assert.equal(stages.calls.objectiveAnalysis, 0);
  assert.deepEqual(outcome.result, persisted);
  assert.equal(state.run!.status, 'completed');
});

test('completed con resultado corrupto FALLA CERRADO y no se repara', async () => {
  const corrupt = clone(expectedResult()) as Mutable;
  corrupt.requirementResults[0].finalState = 'MAGNIFICO';
  const { prisma, state } = fakePrisma({
    run: { status: 'completed', resultArtifact: corrupt }
  });
  const stages = fakeStages();

  assert.equal(
    await codeOf(() => service(prisma, stages).executeReasoningRun(RUN_ID)),
    'COMPLETED_RUN_RESULT_UNUSABLE'
  );
  assert.equal(stages.calls.objectiveAnalysis, 0);
  // No se sobreescribe historia.
  assert.equal(state.run!.resultArtifact.requirementResults[0].finalState, 'MAGNIFICO');
});

test('un run failed NO se reinicia en la misma fila', async () => {
  const { prisma, state } = fakePrisma({
    run: { status: 'failed', failureCode: 'reasoning_provider_invalid_output' }
  });
  const stages = fakeStages();

  assert.equal(
    await codeOf(() => service(prisma, stages).executeReasoningRun(RUN_ID)),
    'RUN_TERMINALLY_FAILED'
  );
  assert.equal(stages.calls.objectiveAnalysis, 0);
  assert.equal(state.run!.status, 'failed');
});

test('un resultArtifact fuera de un run completed es incoherencia, no una base', async () => {
  const { prisma } = fakePrisma({ run: { resultArtifact: expectedResult() } });
  const stages = fakeStages();

  assert.equal(
    await codeOf(() => service(prisma, stages).executeReasoningRun(RUN_ID)),
    'COMPLETED_RUN_RESULT_UNUSABLE'
  );
  assert.equal(stages.calls.objectiveAnalysis, 0);
});

// ---------------------------------------------------------------------------
// Deriva de versión de policy
// ---------------------------------------------------------------------------

test('DERIVA DE POLICY: el run muere antes de reclamar y sin comprar nada', async () => {
  const plan = validExecutionMetadata();
  plan.deterministicPolicyVersion = 'product_epistemic_policy_v0';
  const { prisma, state } = fakePrisma({ run: { executionMetadata: plan } });
  const stages = fakeStages();

  assert.equal(
    await codeOf(() => service(prisma, stages).executeReasoningRun(RUN_ID)),
    'DETERMINISTIC_POLICY_VERSION_MISMATCH'
  );
  assert.equal(stages.calls.objectiveAnalysis, 0);
  assert.equal(state.run!.status, 'failed');
  assert.equal(state.run!.failureCode, 'reasoning_execution_plan_mismatch');
  assert.equal(state.run!.resultArtifact, null);
  // Nunca llegó a `running`: la claim no se compró.
  assert.equal(state.run!.startedAt, null);
});

// ---------------------------------------------------------------------------
// Fallos bajo claim
// ---------------------------------------------------------------------------

test('TRANSITORIO: el run vuelve a pending y puede reclamarse de nuevo', async () => {
  const { prisma, state } = fakePrisma();
  const stages = fakeStages({
    contextualError: new ContextualReasoningStageError('PROVIDER_TRANSPORT_FAILURE', {
      invariant: 'no_usable_semantic_response',
      reasoningRunId: RUN_ID
    })
  });

  await assert.rejects(() => service(prisma, stages).executeReasoningRun(RUN_ID));

  assert.equal(state.run!.status, 'pending');
  assert.equal(state.run!.failureCode, null);
  assert.equal(state.run!.resultArtifact, null);
  // El intento quedó registrado: `startedAt` sobrevive al reset.
  assert.ok(state.run!.startedAt instanceof Date);

  // Y un intento nuevo puede reclamar.
  const outcome = await service(prisma, fakeStages()).executeReasoningRun(RUN_ID);
  assert.equal(outcome.executed, true);
  assert.equal(state.run!.status, 'completed');
});

test('TERMINAL: salida invalida mata el run y no deja resultado', async () => {
  const { prisma, state } = fakePrisma();
  const stages = fakeStages({
    contextualError: new ContextualReasoningStageError('PROVIDER_INVALID_OUTPUT', {
      invariant: 'contextual_result_must_satisfy_the_contract',
      reasoningRunId: RUN_ID
    })
  });

  await assert.rejects(() => service(prisma, stages).executeReasoningRun(RUN_ID));

  assert.equal(state.run!.status, 'failed');
  assert.equal(state.run!.failureCode, 'reasoning_provider_invalid_output');
  assert.ok(state.run!.failedAt instanceof Date);
  assert.equal(state.run!.resultArtifact, null);
});

test('un run terminalmente fallido no se reejecuta: cero llamadas', async () => {
  const { prisma } = fakePrisma();
  const stages = fakeStages({
    contextualError: new ContextualReasoningStageError('PROVIDER_CONFIGURATION_FAILURE', {
      invariant: 'provider_rejected_the_request',
      reasoningRunId: RUN_ID
    })
  });
  await assert.rejects(() => service(prisma, stages).executeReasoningRun(RUN_ID));

  const retry = fakeStages();
  assert.equal(
    await codeOf(() => service(prisma, retry).executeReasoningRun(RUN_ID)),
    'RUN_TERMINALLY_FAILED'
  );
  assert.equal(retry.calls.objectiveAnalysis, 0);
});

test('MID-CONTEXTUAL TRANSITORIO: no hay checkpoint y el reintento empieza de cero', async () => {
  const ids = ['req_01', 'req_02', 'req_03'];
  const { prisma, state } = fakePrisma({ ids });
  const stages = fakeStages({ ids, contextualFailsAt: 'req_02' });

  await assert.rejects(() => service(prisma, stages).executeReasoningRun(RUN_ID));

  // req_03 NO se llamó.
  assert.deepEqual(stages.calls.contextualRequirements, ['req_01', 'req_02']);
  assert.equal(state.run!.resultArtifact, null);
  assert.equal(state.run!.status, 'pending');

  // El reintento vuelve a empezar por req_01: no hay agregado parcial guardado.
  const retry = fakeStages({ ids });
  await service(prisma, retry).executeReasoningRun(RUN_ID);
  assert.deepEqual(retry.calls.contextualRequirements, ids);
});

test('MID-CONTEXTUAL TERMINAL: se corta, se mata el run y no hay reintento', async () => {
  const ids = ['req_01', 'req_02', 'req_03'];
  const { prisma, state } = fakePrisma({ ids });
  const stages = {
    ...fakeStages({ ids }),
    contextual: {
      generateContextualReasoningForRun: async () => {
        throw new ContextualReasoningStageError('PROVIDER_INVALID_OUTPUT', {
          invariant: 'contextual_result_must_satisfy_the_contract',
          reasoningRunId: RUN_ID,
          requirementId: 'req_02',
          providerCallsMade: 2
        });
      }
    }
  } as ReturnType<typeof fakeStages>;

  await assert.rejects(() => service(prisma, stages).executeReasoningRun(RUN_ID));

  assert.equal(state.run!.status, 'failed');
  assert.equal(state.run!.resultArtifact, null);

  const retry = fakeStages({ ids });
  assert.equal(
    await codeOf(() => service(prisma, retry).executeReasoningRun(RUN_ID)),
    'RUN_TERMINALLY_FAILED'
  );
});

test('el grounding corrupto de F3.4 mata el run con su propio codigo', async () => {
  const { prisma, state } = fakePrisma();
  const error = Object.assign(new Error('grounding'), { code: 'GROUNDING_UNUSABLE' });
  const stages = fakeStages({ evidenceUnitsError: error });

  await assert.rejects(() => service(prisma, stages).executeReasoningRun(RUN_ID));

  assert.equal(state.run!.status, 'failed');
  assert.equal(
    state.run!.failureCode,
    'reasoning_evidence_units_grounding_unusable'
  );
});

test('un error sin codigo cerrado libera la claim en vez de dejar running', async () => {
  const { prisma, state } = fakePrisma();
  const stages = fakeStages({ objectiveAnalysisError: new Error('boom') });

  await assert.rejects(() => service(prisma, stages).executeReasoningRun(RUN_ID));

  assert.equal(state.run!.status, 'pending');
  assert.equal(state.run!.failureCode, null);
});

// ---------------------------------------------------------------------------
// Finalización
// ---------------------------------------------------------------------------

test('resultArtifact y completed se escriben JUNTOS o no se escribe nada', async () => {
  const { prisma, state } = fakePrisma();
  const transitions: { status: string; hasResult: boolean }[] = [];
  const original = prisma.reasoningRun.updateMany;
  prisma.reasoningRun.updateMany = async (args: any) => {
    const outcome = await original(args);
    if (state.run) {
      transitions.push({
        status: state.run.status,
        hasResult: state.run.resultArtifact !== null
      });
    }
    return outcome;
  };

  await service(prisma, fakeStages()).executeReasoningRun(RUN_ID);

  // NINGUN estado intermedio con una de las dos cosas sin la otra.
  for (const step of transitions) {
    if (step.hasResult) assert.equal(step.status, 'completed');
    if (step.status === 'completed') assert.equal(step.hasResult, true);
  }
});

test('FILL-ONCE: otra finalizacion gana y su resultado NO se sobreescribe', async () => {
  const { prisma, state } = fakePrisma();
  const persisted = clone(expectedResult()) as Mutable;
  const stages = fakeStages();
  const original = stages.contextual.generateContextualReasoningForRun;
  stages.contextual.generateContextualReasoningForRun = async (id: string, claim?: any) => {
    const outcome = await original(id, claim);
    // Otra finalización completó el run mientras ésta razonaba.
    state.run!.status = 'completed';
    state.run!.resultArtifact = persisted;
    state.run!.completedAt = new Date('2020-01-01T00:00:00.000Z');
    return outcome;
  };

  const outcome = await service(prisma, stages).executeReasoningRun(RUN_ID);

  // Converge en lo persistido —la policy es determinista, así que ambos intentos
  // construyeron lo mismo— y no lo pisa: la fila conserva EL MISMO objeto.
  assert.deepEqual(outcome.result, persisted);
  assert.equal(state.run!.resultArtifact, persisted);
  assert.deepEqual(state.run!.completedAt, new Date('2020-01-01T00:00:00.000Z'));
});

test('FILL-ONCE: un resultado persistido DISTINTO no se pisa, se falla', async () => {
  const { prisma, state } = fakePrisma();
  const otro = clone(expectedResult()) as Mutable;
  otro.requirementResults[0].explanation = 'Otro render historico.';
  const stages = fakeStages();
  const original = stages.contextual.generateContextualReasoningForRun;
  stages.contextual.generateContextualReasoningForRun = async (id: string, claim?: any) => {
    const outcome = await original(id, claim);
    state.run!.status = 'completed';
    state.run!.resultArtifact = otro;
    return outcome;
  };

  assert.equal(
    await codeOf(() => service(prisma, stages).executeReasoningRun(RUN_ID)),
    'FINAL_RESULT_NOT_PERSISTABLE'
  );
  assert.equal(state.run!.resultArtifact, otro);
});

test('un fallo terminal que gana la carrera impide la finalizacion', async () => {
  const { prisma, state } = fakePrisma();
  const stages = fakeStages();
  const original = stages.contextual.generateContextualReasoningForRun;
  stages.contextual.generateContextualReasoningForRun = async (id: string, claim?: any) => {
    const outcome = await original(id, claim);
    // Otro camino marca el run como fallido mientras esta ejecucion razonaba.
    state.run!.status = 'failed';
    state.run!.failureCode = 'reasoning_provider_invalid_output';
    return outcome;
  };

  assert.equal(
    await codeOf(() => service(prisma, stages).executeReasoningRun(RUN_ID)),
    'FINAL_RESULT_NOT_PERSISTABLE'
  );
  assert.equal(state.run!.resultArtifact, null);
  assert.equal(state.run!.status, 'failed');
});

test('un dueño que perdio la claim no puede completar el run', async () => {
  const { prisma, state } = fakePrisma();
  const stages = fakeStages();
  const original = stages.contextual.generateContextualReasoningForRun;
  stages.contextual.generateContextualReasoningForRun = async (id: string, claim?: any) => {
    const outcome = await original(id, claim);
    state.run!.status = 'pending'; // la claim ya no es de esta ejecución
    return outcome;
  };

  assert.equal(
    await codeOf(() => service(prisma, stages).executeReasoningRun(RUN_ID)),
    'FINAL_RESULT_NOT_PERSISTABLE'
  );
  assert.equal(state.run!.resultArtifact, null);
});

test('failed y resultArtifact presente es imposible por este camino', async () => {
  const { prisma, state } = fakePrisma();
  const stages = fakeStages({
    contextualError: new ContextualReasoningStageError('PROVIDER_INVALID_OUTPUT', {
      invariant: 'x',
      reasoningRunId: RUN_ID
    })
  });
  await assert.rejects(() => service(prisma, stages).executeReasoningRun(RUN_ID));
  assert.equal(state.run!.status, 'failed');
  assert.equal(state.run!.resultArtifact, null);
});

test('un resultado que no verifica no completa el run', async () => {
  const { prisma, state } = fakePrisma();
  const stages = fakeStages();
  // El análisis persistido en la fila deja de cubrir al Requirement, así que la
  // verificación cruzada del resultado falla.
  stages.objectiveAnalysis.ensureObjectiveAnalysisForRun = async (runId: string) => {
    state.run!.objectiveAnalysisArtifact = analysisArtifact(['req_09']);
    return {
      reasoningRunId: runId,
      artifact: analysisArtifact(['req_01']),
      providerCalled: true,
      effectiveModelVerification: null
    };
  };

  await assert.rejects(() => service(prisma, stages).executeReasoningRun(RUN_ID));
  assert.equal(state.run!.resultArtifact, null);
  assert.equal(state.run!.status, 'failed');
  assert.equal(
    state.run!.failureCode,
    'reasoning_final_result_not_persistable'
  );
});

test('un run inexistente no ejecuta nada', async () => {
  const { prisma } = fakePrisma();
  const stages = fakeStages();
  assert.equal(
    await codeOf(() => service(prisma, stages).executeReasoningRun('run-desconocido')),
    'REASONING_RUN_NOT_FOUND'
  );
  assert.equal(stages.calls.objectiveAnalysis, 0);
});

test('un snapshot ilegible corta antes de la claim', async () => {
  const { prisma, state } = fakePrisma({
    run: { objectiveDefinitionSnapshot: { schemaVersion: 'otra_cosa' } }
  });
  const stages = fakeStages();
  assert.equal(
    await codeOf(() => service(prisma, stages).executeReasoningRun(RUN_ID)),
    'POLICY_INPUT_INCONSISTENT'
  );
  assert.equal(stages.calls.objectiveAnalysis, 0);
  assert.equal(state.run!.status, 'pending');
});

// ---------------------------------------------------------------------------
// Superficie y privacidad
// ---------------------------------------------------------------------------

test('el orquestador recibe SOLO el id del run', () => {
  // Sin `ownerUserId`: la autorización es de F3.7, y meterla acá crearía una
  // segunda autoridad sobre quién puede ver qué.
  assert.equal(
    ReasoningRunExecutionService.prototype.executeReasoningRun.length,
    1
  );
});

test('los errores no llevan texto del Objective ni de la evidencia', async () => {
  const { prisma } = fakePrisma({ run: { status: 'running' } });
  try {
    await service(prisma, fakeStages()).executeReasoningRun(RUN_ID);
    assert.fail('deberia fallar');
  } catch (error: unknown) {
    const serialized = JSON.stringify({
      message: (error as Error).message,
      ...(error as Record<string, unknown>)
    });
    for (const secret of [
      CONFIRMED_REQUIREMENT_TEXT,
      'diseno de APIs REST',
      'Contenido declarado sobre APIs REST',
      'Exposicion formativa'
    ]) {
      assert.ok(!serialized.includes(secret), secret);
    }
  }
});

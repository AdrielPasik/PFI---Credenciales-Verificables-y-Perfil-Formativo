/**
 * El motor F3 del holder, ejecutado sobre `VerificationRun`.
 *
 * Lo que se defiende:
 *
 *   1. El puerto de tabla traduce SOLO la clave del inventario y falla cerrado sin
 *      ella (un `findMany` sin run leeria todos los inventarios publicos).
 *   2. El lifecycle REAL -- claim, policy, verificacion y completado atomico --
 *      funciona identico sobre la tabla publica. Las tres etapas semanticas se
 *      doblan (cubiertas por F3.3/F3.4/F3.5), como en el test del holder.
 *   3. `beforeProviderStage` detiene el run SIN iniciar la etapa y lo deja
 *      `failed` con `execution_authorization_withdrawn`; sin la opcion, el motor
 *      se comporta como antes.
 *
 *     REAL_PROVIDER_CALLS: 0
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyDeterministicReasoningPolicy } from '../reasoning-run/deterministic-epistemic-policy';
import { ContextualReasoningStageError } from '../reasoning-run/reasoning-run-contextual-reasoning.errors';
import { ReasoningRunArtifactSlotService } from '../reasoning-run/reasoning-run-artifact-slot.service';
import { ReasoningRunExecutionClaimService } from '../reasoning-run/reasoning-run-execution-claim.service';
import { ReasoningRunExecutionService } from '../reasoning-run/reasoning-run-execution.service';
import { verificationRunTable } from '../reasoning-run/reasoning-run-table';
import {
  CONFIRMED_REQUIREMENT_TEXT,
  clone,
  validEvidenceUnits,
  validExecutionMetadata,
  validObjectiveAnalysis,
  validResult,
  type Mutable
} from '../reasoning-run/__fixtures__/reasoning-run-artifacts.fixture';
import { ExecutionAuthorizationWithdrawnError } from './verification-execution.service';
import { matchesRow } from './__fixtures__/public-verification.fixture';

const RUN_ID = 'vrun-1';

function snapshot(): Mutable {
  return {
    schemaVersion: 'objective_definition_v1',
    objectiveType: 'EMPLOYMENT',
    objectiveContext: 'Backend Developer Junior en equipo de plataforma',
    source: { inputType: 'DIRECT_STRUCTURED_INPUT', originalText: null },
    requirements: [
      {
        requirementId: 'req_01',
        order: 1,
        requirementText: CONFIRMED_REQUIREMENT_TEXT,
        provenance: { kind: 'DIRECT_STRUCTURED_INPUT', sourceQuote: null },
        qualifiers: []
      }
    ]
  };
}

function contextualAggregate(): Mutable {
  const result = clone(validResult().requirementResults[0]) as Mutable;
  delete result.finalState;
  delete result.policyTrace;
  delete result.explanation;
  return { schemaVersion: 'contextual_reasoning_v1', requirementResults: [result] };
}

/** SOLO las dos tablas publicas. Si el motor tocara `reasoningRun`, esto explota. */
function fakeVerificationPrisma() {
  const run: Record<string, any> = {
    id: RUN_ID,
    verificationRequestId: 'req-row-1',
    sharingGrantId: 'grant-1',
    status: 'pending',
    failureCode: null,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    executionAttempts: 1,
    objectiveDefinitionSnapshot: snapshot(),
    objectiveAnalysisArtifact: validObjectiveAnalysis(),
    evidenceUnitsArtifact: validEvidenceUnits(),
    resultArtifact: null,
    executionMetadata: validExecutionMetadata()
  };
  const inventoryQueries: unknown[] = [];
  const prisma = {
    verificationRun: {
      findUnique: async ({ where }: any) => (where.id === run.id ? { ...run } : null),
      updateMany: async ({ where, data }: any) => {
        if (!matchesRow(run, where)) return { count: 0 };
        Object.assign(run, data);
        return { count: 1 };
      }
    },
    verificationRunInventoryItem: {
      findMany: async (args: unknown) => {
        inventoryQueries.push(args);
        return [];
      }
    }
  };
  return { prisma, run, inventoryQueries };
}

function stages(behaviour: { contextualTransient?: boolean } = {}) {
  const calls: string[] = [];
  return {
    calls,
    objectiveAnalysis: {
      ensureObjectiveAnalysisForRun: async (id: string) => {
        calls.push('OA');
        return { reasoningRunId: id, artifact: validObjectiveAnalysis(), providerCalled: false, effectiveModelVerification: null };
      }
    },
    evidenceUnits: {
      ensureEvidenceUnitsForRun: async (id: string) => {
        calls.push('EU');
        return { reasoningRunId: id, artifact: validEvidenceUnits(), providerCalled: false, effectiveModelVerification: null, includedSourceCount: 1 };
      }
    },
    contextual: {
      generateContextualReasoningForRun: async (id: string) => {
        calls.push('CTX');
        if (behaviour.contextualTransient) {
          throw new ContextualReasoningStageError('PROVIDER_TRANSPORT_FAILURE', {
            invariant: 'no_usable_semantic_response',
            reasoningRunId: id,
            requirementId: 'req_01'
          });
        }
        return { reasoningRunId: id, contextualReasoning: contextualAggregate(), providerCallsMade: 1, effectiveModelVerification: null };
      }
    }
  };
}

function engine(prisma: any, doubles: ReturnType<typeof stages>) {
  const table = verificationRunTable(prisma);
  const slots = new ReasoningRunArtifactSlotService(prisma, table);
  const claims = new ReasoningRunExecutionClaimService(prisma, table);
  return new ReasoningRunExecutionService(
    prisma,
    claims,
    slots,
    doubles.objectiveAnalysis as never,
    doubles.evidenceUnits as never,
    doubles.contextual as never,
    table
  );
}

// ---------------------------------------------------------------------------

test('PUERTO: el inventario traduce reasoningRunId -> verificationRunId y conserva el resto', async () => {
  const { prisma, inventoryQueries } = fakeVerificationPrisma();
  await verificationRunTable(prisma as never).inventory.findMany({
    where: { reasoningRunId: RUN_ID, disposition: 'INCLUDED' },
    orderBy: { runLocalSourceId: 'asc' }
  } as never);
  assert.deepEqual(inventoryQueries, [
    { where: { disposition: 'INCLUDED', verificationRunId: RUN_ID }, orderBy: { runLocalSourceId: 'asc' } }
  ]);
});

test('PUERTO: sin clave de run el inventario falla CERRADO y no consulta', async () => {
  const { prisma, inventoryQueries } = fakeVerificationPrisma();
  const table = verificationRunTable(prisma as never);
  await assert.rejects(
    async () => table.inventory.findMany({ where: { disposition: 'INCLUDED' } } as never),
    /verification_run_inventory_query_requires_run_id/
  );
  await assert.rejects(async () => table.inventory.findMany({} as never));
  assert.equal(inventoryQueries.length, 0);
});

test('LIFECYCLE REAL sobre VerificationRun: claim, etapas, policy y completado atomico', async () => {
  const { prisma, run } = fakeVerificationPrisma();
  const doubles = stages();

  const outcome = await engine(prisma, doubles).executeReasoningRun(RUN_ID);

  assert.equal(outcome.executed, true);
  assert.deepEqual(doubles.calls, ['OA', 'EU', 'CTX']);
  assert.equal(run.status, 'completed');
  assert.ok(run.completedAt instanceof Date);
  assert.ok(run.startedAt instanceof Date);
  assert.equal(run.failureCode, null);
  assert.deepEqual(
    run.resultArtifact,
    applyDeterministicReasoningPolicy({
      definition: snapshot(),
      objectiveAnalysis: validObjectiveAnalysis(),
      evidenceUnits: validEvidenceUnits(),
      contextualReasoning: contextualAggregate()
    } as never)
  );
});

test('una segunda ejecucion de un run completado no vuelve a llamar etapas', async () => {
  const { prisma } = fakeVerificationPrisma();
  const doubles = stages();
  await engine(prisma, doubles).executeReasoningRun(RUN_ID);
  const again = await engine(prisma, doubles).executeReasoningRun(RUN_ID);
  assert.equal(again.executed, false);
  assert.deepEqual(doubles.calls, ['OA', 'EU', 'CTX']);
});

test('fallo TRANSITORIO: el run vuelve a pending sobre la tabla publica (reintentable)', async () => {
  const { prisma, run } = fakeVerificationPrisma();
  await assert.rejects(() => engine(prisma, stages({ contextualTransient: true })).executeReasoningRun(RUN_ID));
  assert.equal(run.status, 'pending');
  assert.equal(run.failureCode, null);
});

for (const stage of ['OBJECTIVE_ANALYSIS', 'EVIDENCE_UNITS', 'CONTEXTUAL_REASONING'] as const) {
  test(`HOOK: autorizacion retirada antes de ${stage} -> failed withdrawn, SIN iniciar la etapa`, async () => {
    const { prisma, run } = fakeVerificationPrisma();
    const doubles = stages();
    const seen: string[] = [];

    await assert.rejects(() =>
      engine(prisma, doubles).executeReasoningRun(RUN_ID, {
        beforeProviderStage: async (current) => {
          seen.push(current);
          if (current === stage) throw new ExecutionAuthorizationWithdrawnError();
        }
      })
    );

    const order = ['OBJECTIVE_ANALYSIS', 'EVIDENCE_UNITS', 'CONTEXTUAL_REASONING'];
    const stopAt = order.indexOf(stage);
    assert.deepEqual(seen, order.slice(0, stopAt + 1));
    assert.deepEqual(doubles.calls, ['OA', 'EU', 'CTX'].slice(0, stopAt), 'la etapa retirada no arranca');
    assert.equal(run.status, 'failed');
    assert.equal(run.failureCode, 'execution_authorization_withdrawn');
    assert.equal(run.resultArtifact, null);
    // Los artifacts de etapas previas se conservan: no se borra historia.
    assert.ok(run.objectiveAnalysisArtifact !== null);
  });
}

test('HOOK: se consulta en el orden exacto de las tres etapas con proveedor', async () => {
  const { prisma } = fakeVerificationPrisma();
  const seen: string[] = [];
  await engine(prisma, stages()).executeReasoningRun(RUN_ID, {
    beforeProviderStage: async (current) => {
      seen.push(current);
    }
  });
  assert.deepEqual(seen, ['OBJECTIVE_ANALYSIS', 'EVIDENCE_UNITS', 'CONTEXTUAL_REASONING']);
});

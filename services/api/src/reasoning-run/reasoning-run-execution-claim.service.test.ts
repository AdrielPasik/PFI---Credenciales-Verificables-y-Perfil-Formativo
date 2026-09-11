/**
 * Claim exclusiva de ejecución — slice F3.6.
 *
 * Se prueba el primitivo solo, sin etapas ni policy: quién gana, qué observa el
 * perdedor, y qué puede y qué no puede escribir cada uno.
 *
 *     REAL_PROVIDER_CALLS: 0
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { Prisma } from '@prisma/client';

import {
  eligibleRunStatusFor,
  ReasoningRunExecutionClaim,
  ReasoningRunExecutionClaimService
} from './reasoning-run-execution-claim.service';

const RUN_ID = 'run-1';

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

function fakePrisma(run: Record<string, unknown> = {}) {
  const state: { run: Record<string, any> | null } = {
    run: {
      id: RUN_ID,
      status: 'pending',
      failureCode: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      resultArtifact: null,
      ...run
    }
  };
  const prisma = {
    reasoningRun: {
      findUnique: async ({ where }: any) =>
        state.run && state.run.id === where.id ? { ...state.run } : null,
      updateMany: async ({ where, data }: any) => {
        const row = state.run;
        if (!row || row.id !== where.id) return { count: 0 };
        for (const [column, expected] of Object.entries(where)) {
          if (column === 'id') continue;
          if (!matchesFilter(row[column], expected)) return { count: 0 };
        }
        Object.assign(row, data);
        return { count: 1 };
      }
    }
  };
  return { service: new ReasoningRunExecutionClaimService(prisma as never), state };
}

// ---------------------------------------------------------------------------
// Adquisición
// ---------------------------------------------------------------------------

test('un run pending se reclama y queda running', async () => {
  const { service, state } = fakePrisma();
  const outcome = await service.claim(RUN_ID);

  assert.equal(outcome.kind, 'CLAIMED');
  assert.equal(state.run!.status, 'running');
  assert.ok(state.run!.startedAt instanceof Date);
});

test('de dos intentos concurrentes gana EXACTAMENTE uno', async () => {
  const { service, state } = fakePrisma();
  const outcomes = await Promise.all([service.claim(RUN_ID), service.claim(RUN_ID)]);

  const claimed = outcomes.filter((item) => item.kind === 'CLAIMED');
  assert.equal(claimed.length, 1);
  const rejected = outcomes.find((item) => item.kind === 'NOT_CLAIMABLE');
  assert.equal(rejected?.kind, 'NOT_CLAIMABLE');
  assert.equal(state.run!.status, 'running');
});

test('un run ya running NO se roba', async () => {
  // NON_RECOVERABLE_RUNNING_CLAIM: sin token de dueño ni lease, no hay forma de
  // distinguir un dueño vivo de uno muerto, así que nunca se reclama por encima.
  const { service } = fakePrisma({ status: 'running', startedAt: new Date() });
  const outcome = await service.claim(RUN_ID);
  assert.equal(outcome.kind, 'NOT_CLAIMABLE');
});

test('un run viejo en running sigue sin poder robarse', async () => {
  // Un `startedAt` antiguo NO prueba que el dueño murió: una llamada al proveedor
  // puede tardar. No hay TTL, y por eso no hay robo.
  const { service } = fakePrisma({
    status: 'running',
    startedAt: new Date('2020-01-01T00:00:00.000Z')
  });
  assert.equal((await service.claim(RUN_ID)).kind, 'NOT_CLAIMABLE');
});

test('un run completed o failed no es reclamable', async () => {
  for (const status of ['completed', 'failed']) {
    const { service } = fakePrisma({ status });
    assert.equal((await service.claim(RUN_ID)).kind, 'NOT_CLAIMABLE', status);
  }
});

test('un run pending con failureCode no es reclamable', async () => {
  const { service } = fakePrisma({ failureCode: 'reasoning_execution_plan_mismatch' });
  assert.equal((await service.claim(RUN_ID)).kind, 'NOT_CLAIMABLE');
});

test('un run pending con resultado ya persistido no es reclamable', async () => {
  const { service } = fakePrisma({ resultArtifact: { schemaVersion: 'x' } });
  assert.equal((await service.claim(RUN_ID)).kind, 'NOT_CLAIMABLE');
});

test('un run inexistente se distingue de uno no reclamable', async () => {
  const { service } = fakePrisma();
  assert.equal((await service.claim('otro')).kind, 'RUN_NOT_FOUND');
});

// ---------------------------------------------------------------------------
// startedAt
// ---------------------------------------------------------------------------

test('startedAt marca el PRIMER intento y sobrevive al reintento', async () => {
  const { service, state } = fakePrisma();

  const first = await service.claim(RUN_ID);
  assert.equal(first.kind, 'CLAIMED');
  const primerIntento = state.run!.startedAt;

  await service.releaseForRetry((first as { claim: ReasoningRunExecutionClaim }).claim);
  assert.equal(state.run!.status, 'pending');
  assert.equal(state.run!.startedAt, primerIntento);

  const second = await service.claim(RUN_ID);
  assert.equal(second.kind, 'CLAIMED');
  assert.equal(state.run!.startedAt, primerIntento);
});

// ---------------------------------------------------------------------------
// Liberación y fallo
// ---------------------------------------------------------------------------

test('releaseForRetry devuelve el run a pending sin marcar fallo', async () => {
  const { service, state } = fakePrisma();
  const outcome = await service.claim(RUN_ID);
  await service.releaseForRetry((outcome as { claim: ReasoningRunExecutionClaim }).claim);

  assert.equal(state.run!.status, 'pending');
  assert.equal(state.run!.failureCode, null);
  assert.equal(state.run!.failedAt, null);
  assert.equal(state.run!.resultArtifact, null);
});

test('failClaimed marca failed con codigo y timestamp', async () => {
  const { service, state } = fakePrisma();
  const outcome = await service.claim(RUN_ID);
  await service.failClaimed(
    (outcome as { claim: ReasoningRunExecutionClaim }).claim,
    'reasoning_provider_invalid_output'
  );

  assert.equal(state.run!.status, 'failed');
  assert.equal(state.run!.failureCode, 'reasoning_provider_invalid_output');
  assert.ok(state.run!.failedAt instanceof Date);
  assert.equal(state.run!.resultArtifact, null);
});

test('un fallo tardio NO degrada un run ya completado', async () => {
  const { service, state } = fakePrisma();
  const outcome = await service.claim(RUN_ID);
  const claim = (outcome as { claim: ReasoningRunExecutionClaim }).claim;

  state.run!.status = 'completed';
  state.run!.resultArtifact = { schemaVersion: 'reasoning_run_result_v1' };

  await service.failClaimed(claim, 'reasoning_provider_invalid_output');

  assert.equal(state.run!.status, 'completed');
  assert.equal(state.run!.failureCode, null);
});

test('un release tardio NO reabre un run ya completado', async () => {
  const { service, state } = fakePrisma();
  const outcome = await service.claim(RUN_ID);
  const claim = (outcome as { claim: ReasoningRunExecutionClaim }).claim;

  state.run!.status = 'completed';
  state.run!.resultArtifact = { schemaVersion: 'reasoning_run_result_v1' };

  await service.releaseForRetry(claim);
  assert.equal(state.run!.status, 'completed');
});

test('un release tardio NO reabre un run ya fallido', async () => {
  const { service, state } = fakePrisma();
  const outcome = await service.claim(RUN_ID);
  const claim = (outcome as { claim: ReasoningRunExecutionClaim }).claim;

  state.run!.status = 'failed';
  state.run!.failureCode = 'reasoning_provider_invalid_output';

  await service.releaseForRetry(claim);
  assert.equal(state.run!.status, 'failed');
});

// ---------------------------------------------------------------------------
// La capability
// ---------------------------------------------------------------------------

test('una claim NO se puede construir desde afuera', () => {
  // El constructor es privado y el token de acuñado no se exporta. La garantía
  // real igual está en la base: una claim fabricada se encontraría con una fila
  // que no está en `running` y la etapa fallaría por no elegible.
  assert.throws(
    () => ReasoningRunExecutionClaim.mint(Symbol('otro'), RUN_ID, new Date()),
    /cannot_be_forged/
  );
});

test('la claim nombra la fila que reclamo', async () => {
  const { service } = fakePrisma();
  const outcome = await service.claim(RUN_ID);
  assert.equal(
    (outcome as { claim: ReasoningRunExecutionClaim }).claim.reasoningRunId,
    RUN_ID
  );
});

test('sin claim el estado elegible sigue siendo pending', () => {
  // La guarda de las etapas NO se ensancha: se desplaza sólo para quien reclamó.
  assert.equal(eligibleRunStatusFor(undefined), 'pending');
});

test('con claim el estado elegible es running', async () => {
  const { service } = fakePrisma();
  const outcome = await service.claim(RUN_ID);
  assert.equal(
    eligibleRunStatusFor((outcome as { claim: ReasoningRunExecutionClaim }).claim),
    'running'
  );
});

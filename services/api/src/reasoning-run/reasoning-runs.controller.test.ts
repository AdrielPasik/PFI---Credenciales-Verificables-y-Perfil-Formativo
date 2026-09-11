/**
 * Superficie `/me/reasoning-runs` — F3.7.
 *
 * DECISIÓN DE TEST, la misma de F2.2: el `ReasoningRunPrivateService` es el REAL,
 * sobre un Prisma en memoria. Falsear la capa de aplicación convertiría los tests
 * de allowlist, de indistinguibilidad de existencia y de "leer no ejecuta" en
 * afirmaciones sobre el mock, que es justo lo que existen para comprobar.
 *
 * Sí se falsean las DOS fronteras de dominio —freeze y ejecución—, porque lo que
 * hay que poder contar es cuántas veces se las llama:
 *
 *     REAL_PROVIDER_CALLS: 0
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';

import { UserStatus } from '@prisma/client';

import { AuthGuard } from '../auth/auth.guard';
import { type AuthenticatedUser } from '../auth/auth.types';
import { ReasoningRunsController } from './reasoning-runs.controller';
import { ReasoningRunPrivateService } from './reasoning-run-private.service';
import { ReasoningRunExecutionError } from './reasoning-run-execution.errors';
import { ReasoningRunInputFreezeError } from './reasoning-run-input-freeze.errors';
import {
  clone,
  validEvidenceUnits,
  validObjectiveAnalysis,
  validResult,
  type Mutable
} from './__fixtures__/reasoning-run-artifacts.fixture';
import { applyDeterministicReasoningPolicy } from './deterministic-epistemic-policy';

const OWNER: AuthenticatedUser = {
  id: 'user-1',
  email: 'owner@smoke.local',
  did: null,
  status: UserStatus.active
};
const OTHER: AuthenticatedUser = { ...OWNER, id: 'user-2', email: 'other@smoke.local' };

const REQUIREMENT_TEXT = 'Diseno de APIs REST nivel intermedio en backend';

// ---------------------------------------------------------------------------
// Filas
// ---------------------------------------------------------------------------

function snapshot(ids: readonly string[] = ['req_01'], text = REQUIREMENT_TEXT): Mutable {
  return {
    schemaVersion: 'objective_definition_v1',
    objectiveType: 'EMPLOYMENT',
    objectiveContext: 'Backend Developer Junior en equipo de plataforma',
    source: {
      inputType: 'PASTED_TEXT',
      // El texto de origen vive en el snapshot y NO se publica. Lleva un
      // centinela unico, y ademas contiene la cita literal que F2 exige.
      originalText: 'SENTINELA-ORIGINAL-NO-PUBLICABLE. Buscamos backend con APIs REST.'
    },
    requirements: ids.map((requirementId, index) => ({
      requirementId,
      order: index + 1,
      requirementText: text,
      provenance: { kind: 'DERIVED_FROM_SOURCE_TEXT', sourceQuote: 'APIs REST' },
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

function contextualFor(ids: readonly string[]): Mutable {
  return {
    schemaVersion: 'contextual_reasoning_v1',
    requirementResults: ids.map((id) => {
      const r = clone(validResult().requirementResults[0]) as Mutable;
      delete r.finalState;
      delete r.policyTrace;
      delete r.explanation;
      r.requirementId = id;
      return r;
    })
  };
}

/** Artifact final REAL, producido por la policy de F3.6 sobre estas entradas. */
function resultArtifact(ids: readonly string[] = ['req_01'], text = REQUIREMENT_TEXT) {
  return applyDeterministicReasoningPolicy({
    definition: snapshot(ids, text),
    objectiveAnalysis: analysisArtifact(ids),
    evidenceUnits: validEvidenceUnits(),
    contextualReasoning: contextualFor(ids)
  } as never) as unknown as Mutable;
}

function runRow(overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    id: 'run-1',
    ownerUserId: OWNER.id,
    objectiveId: 'obj-1',
    objectiveTitleSnapshot: 'Backend Developer Junior',
    objectiveDefinitionSnapshot: snapshot(),
    status: 'pending',
    failureCode: null,
    resultArtifact: null,
    // Columnas internas que NUNCA pueden salir en una respuesta.
    executionMetadata: { provider: 'openai', model: 'modelo-interno-secreto' },
    objectiveAnalysisArtifact: analysisArtifact(),
    evidenceUnitsArtifact: validEvidenceUnits(),
    createdAt: new Date('2026-09-01T10:00:00.000Z'),
    startedAt: null,
    completedAt: null,
    failedAt: null,
    ...overrides
  };
}

function completedRunRow(overrides: Record<string, unknown> = {}) {
  return runRow({
    status: 'completed',
    resultArtifact: resultArtifact(),
    startedAt: new Date('2026-09-01T10:00:05.000Z'),
    completedAt: new Date('2026-09-01T10:00:30.000Z'),
    ...overrides
  });
}

// ---------------------------------------------------------------------------
// Dobles
// ---------------------------------------------------------------------------

function fakePrisma(rows: Record<string, any>[]) {
  const state = { rows: rows.map((row) => ({ ...row })), queries: [] as any[] };
  const matches = (row: any, where: any) =>
    Object.entries(where).every(([column, value]) => row[column] === value);

  const prisma = {
    reasoningRun: {
      findFirst: async ({ where, select }: any) => {
        state.queries.push(where);
        const row = state.rows.find((item) => matches(item, where));
        return row ? project(row, select) : null;
      },
      findMany: async ({ where, select }: any) => {
        state.queries.push(where);
        return state.rows
          .filter((item) => matches(item, where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((row) => project(row, select));
      }
    }
  };

  // `select` se respeta de verdad: si el service pidiera una columna que no
  // declaró, el test lo notaría en vez de dejarla pasar.
  function project(row: any, select: Record<string, boolean> | undefined) {
    if (!select) return { ...row };
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(select)) out[key] = row[key];
    return out;
  }

  return { prisma, state };
}

function fakeFreeze(behaviour: { runId?: string; error?: Error } = {}) {
  const calls: { ownerUserId: string; objectiveId: string }[] = [];
  return {
    calls,
    service: {
      createFrozenReasoningRunForUser: async (ownerUserId: string, objectiveId: string) => {
        calls.push({ ownerUserId, objectiveId });
        if (behaviour.error) throw behaviour.error;
        return { reasoningRunId: behaviour.runId ?? 'run-1' };
      }
    }
  };
}

function fakeExecution(behaviour: { error?: Error; onRun?: (id: string) => void } = {}) {
  const calls: string[] = [];
  return {
    calls,
    service: {
      executeReasoningRun: async (runId: string) => {
        calls.push(runId);
        if (behaviour.error) throw behaviour.error;
        behaviour.onRun?.(runId);
        return { reasoningRunId: runId, executed: true, providerLogicalCalls: 3 };
      }
    }
  };
}

function controllerFor(options: {
  rows?: Record<string, any>[];
  freeze?: ReturnType<typeof fakeFreeze>;
  execution?: ReturnType<typeof fakeExecution>;
}) {
  const { prisma, state } = fakePrisma(options.rows ?? []);
  const freeze = options.freeze ?? fakeFreeze();
  const execution = options.execution ?? fakeExecution();
  const service = new ReasoningRunPrivateService(
    prisma as never,
    freeze.service as never,
    execution.service as never
  );
  return {
    controller: new ReasoningRunsController(service),
    prisma: state,
    freeze,
    execution
  };
}

async function statusOf(run: () => Promise<unknown>): Promise<number> {
  try {
    await run();
  } catch (error: unknown) {
    assert.ok(error instanceof HttpException, String(error));
    return error.getStatus();
  }
  assert.fail('se esperaba una excepcion HTTP');
}

async function bodyOf(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (error: unknown) {
    assert.ok(error instanceof HttpException);
    return error.getResponse();
  }
  assert.fail('se esperaba una excepcion HTTP');
}

// ---------------------------------------------------------------------------
// Autenticación
// ---------------------------------------------------------------------------

test('toda la superficie exige autenticacion', () => {
  const guards = (Reflect.getMetadata('__guards__', ReasoningRunsController) ??
    []) as unknown[];
  assert.ok(guards.includes(AuthGuard));
});

test('el controller no habla con Prisma', () => {
  const source = ReasoningRunsController.toString();
  assert.ok(!source.includes('prisma'));
});

// ---------------------------------------------------------------------------
// Creación
// ---------------------------------------------------------------------------

test('crear usa el freeze service con el dueño autenticado', async () => {
  const freeze = fakeFreeze();
  const { controller, execution } = controllerFor({ rows: [runRow()], freeze });

  const detail = await controller.create(OWNER, { objectiveId: 'obj-1' });

  assert.deepEqual(freeze.calls, [{ ownerUserId: OWNER.id, objectiveId: 'obj-1' }]);
  assert.equal(detail.reasoningRunReference, 'run-1');
  assert.equal(detail.status, 'pending');
  // CREAR NO EJECUTA: congelar es barato, ejecutar compra llamadas al proveedor.
  assert.equal(execution.calls.length, 0);
});

test('crear NUNCA ejecuta, ni siquiera con el run listo', async () => {
  const { controller, execution, freeze } = controllerFor({ rows: [runRow()] });
  await controller.create(OWNER, { objectiveId: 'obj-1' });
  assert.equal(freeze.calls.length, 1);
  assert.equal(execution.calls.length, 0);
});

test('un run creado que nace failed SE DEVUELVE como recurso creado', async () => {
  // F3.2 congela un inventario con filas bloqueadas y persiste el run `failed`.
  // La operación de creación tuvo éxito: el recurso existe y es consultable.
  const { controller, execution } = controllerFor({
    rows: [
      runRow({
        status: 'failed',
        failureCode: 'reasoning_input_freeze_blocked',
        failedAt: new Date('2026-09-01T10:00:01.000Z')
      })
    ]
  });

  const detail = await controller.create(OWNER, { objectiveId: 'obj-1' });

  assert.equal(detail.status, 'failed');
  assert.equal(detail.failureCategory, 'EVIDENCE_PREPARATION_BLOCKED');
  assert.equal(detail.result, null);
  assert.equal(execution.calls.length, 0);
});

test('un Objective ajeno o inexistente da 404 y no crea nada', async () => {
  const freeze = fakeFreeze({
    error: new ReasoningRunInputFreezeError('OBJECTIVE_NOT_FOUND', {
      invariant: 'objective_does_not_exist_for_this_owner'
    })
  });
  const { controller } = controllerFor({ rows: [], freeze });

  const status = await statusOf(() => controller.create(OTHER, { objectiveId: 'obj-1' }));
  assert.equal(status, HttpStatus.NOT_FOUND);
});

test('un Objective corrupto es 500 generico, no un 404 enganioso', async () => {
  const freeze = fakeFreeze({
    error: new ReasoningRunInputFreezeError('OBJECTIVE_DEFINITION_CORRUPT', {
      invariant: 'persisted_objective_definition_must_verify'
    })
  });
  const { controller } = controllerFor({ rows: [], freeze });

  const status = await statusOf(() => controller.create(OWNER, { objectiveId: 'obj-1' }));
  assert.equal(status, HttpStatus.INTERNAL_SERVER_ERROR);
});

test('el body rechaza autoridad del servidor y campos desconocidos', async () => {
  const { controller, freeze } = controllerFor({ rows: [runRow()] });
  const rejected = [
    { objectiveId: 'obj-1', ownerUserId: 'user-9' },
    { objectiveId: 'obj-1', credentialIds: ['c1'] },
    { objectiveId: 'obj-1', requirements: [] },
    { objectiveId: 'obj-1', model: 'gpt-x' },
    { objectiveId: 'obj-1', status: 'completed' },
    { objectiveId: 'obj-1', desconocido: 1 },
    { objectiveId: '' },
    { objectiveId: 42 },
    {},
    []
  ];
  for (const body of rejected) {
    await assert.rejects(
      () => controller.create(OWNER, body),
      BadRequestException,
      JSON.stringify(body)
    );
  }
  // Ninguno llegó al dominio.
  assert.equal(freeze.calls.length, 0);
});

// ---------------------------------------------------------------------------
// Lectura y privacidad de existencia
// ---------------------------------------------------------------------------

test('la lista trae solo los runs del usuario', async () => {
  const { controller, prisma } = controllerFor({
    rows: [
      runRow({ id: 'run-1' }),
      runRow({ id: 'run-2', ownerUserId: OTHER.id })
    ]
  });

  const mine = await controller.list(OWNER);
  assert.deepEqual(mine.map((item) => item.reasoningRunReference), ['run-1']);

  // El filtro va EN LA CONSULTA, no en el controller.
  assert.ok(prisma.queries.every((where) => where.ownerUserId !== undefined));
});

test('un run ajeno y uno inexistente son INDISTINGUIBLES', async () => {
  const { controller } = controllerFor({ rows: [runRow({ ownerUserId: OWNER.id })] });

  const foreignStatus = await statusOf(() => controller.get(OTHER, 'run-1'));
  const foreignBody = await bodyOf(() => controller.get(OTHER, 'run-1'));
  const missingStatus = await statusOf(() => controller.get(OTHER, 'run-inexistente'));
  const missingBody = await bodyOf(() => controller.get(OTHER, 'run-inexistente'));

  assert.equal(foreignStatus, HttpStatus.NOT_FOUND);
  assert.equal(missingStatus, HttpStatus.NOT_FOUND);
  // Mismo cuerpo, byte a byte: nada distingue "no es tuyo" de "no existe".
  assert.deepEqual(foreignBody, missingBody);
});

test('leer NUNCA ejecuta', async () => {
  const { controller, execution } = controllerFor({
    rows: [completedRunRow(), runRow({ id: 'run-2' })]
  });

  await controller.list(OWNER);
  await controller.get(OWNER, 'run-1');

  assert.equal(execution.calls.length, 0);
});

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

test('NINGUN campo interno llega a la respuesta', async () => {
  const { controller } = controllerFor({
    rows: [
      completedRunRow({
        // Columna futura desconocida: tampoco puede colarse.
        campoFuturoSensible: 'FILTRACION',
        failureCode: null
      })
    ]
  });

  const detail = await controller.get(OWNER, 'run-1');
  const list = await controller.list(OWNER);
  const serialized = JSON.stringify({ detail, list });

  for (const forbidden of [
    'FILTRACION',
    'campoFuturoSensible',
    'executionMetadata',
    'modelo-interno-secreto',
    'objectiveAnalysisArtifact',
    'evidenceUnitsArtifact',
    'resultArtifact',
    'policyTrace',
    'preGuardState',
    'hardFactualFailure',
    'failureCode',
    'ownerUserId',
    'validations',
    'jointClaimCeiling',
    'weakerClaimSearch',
    'compositionAssessment',
    'observabilityAssessment',
    'evaluatedEvidence',
    'semanticUnresolved',
    'sourceSha256',
    'artifactBlobSha256',
    'selectedAnalysisRunSourceId',
    // El texto original del Objective vive en el snapshot y NO se publica acá.
    'SENTINELA-ORIGINAL-NO-PUBLICABLE',
    'chainOfThought',
    'scratchpad',
    'hiddenReasoning',
    'globalScore',
    'fitPercentage',
    'matchPercentage',
    'overallFit'
  ]) {
    assert.ok(!serialized.includes(forbidden), forbidden);
  }
});

test('las claves del detalle son exactamente la allowlist', async () => {
  const { controller } = controllerFor({ rows: [completedRunRow()] });
  const detail = await controller.get(OWNER, 'run-1');

  assert.deepEqual(Object.keys(detail).sort(), [
    'completedAt',
    'createdAt',
    'failedAt',
    'failureCategory',
    'objective',
    'reasoningRunReference',
    'result',
    'startedAt',
    'status'
  ]);
  assert.deepEqual(Object.keys(detail.objective).sort(), [
    'objectiveContext',
    'objectiveReference',
    'objectiveType',
    'requirements',
    'title'
  ]);
  assert.deepEqual(Object.keys(detail.result!.requirementResults[0]).sort(), [
    'explanation',
    'finalState',
    'requirementId',
    'requirementText'
  ]);
});

test('mutar la respuesta no toca el artifact interno', async () => {
  const { controller, prisma } = controllerFor({ rows: [completedRunRow()] });
  const detail = await controller.get(OWNER, 'run-1');

  (detail.result!.requirementResults[0] as any).finalState = 'MANIPULADO';
  (detail.objective.requirements[0] as any).requirementText = 'MANIPULADO';

  const persisted = prisma.rows[0];
  assert.notEqual(persisted.resultArtifact.requirementResults[0].finalState, 'MANIPULADO');
  assert.notEqual(
    persisted.objectiveDefinitionSnapshot.requirements[0].requirementText,
    'MANIPULADO'
  );
});

// ---------------------------------------------------------------------------
// Historia
// ---------------------------------------------------------------------------

test('la historia se lee del SNAPSHOT, no del Objective actual', async () => {
  // El run congeló el Requirement A. El Objective de hoy dice B — y el DTO no
  // tiene forma de llegar a B, porque nunca consulta la tabla Objective.
  const historic = 'REQUISITO-HISTORICO-A';
  const { controller } = controllerFor({
    rows: [
      completedRunRow({
        objectiveDefinitionSnapshot: snapshot(['req_01'], historic),
        objectiveTitleSnapshot: 'TITULO-HISTORICO',
        resultArtifact: resultArtifact(['req_01'], historic)
      })
    ]
  });

  const detail = await controller.get(OWNER, 'run-1');
  assert.equal(detail.objective.requirements[0].requirementText, historic);
  assert.equal(detail.objective.title, 'TITULO-HISTORICO');
  assert.equal(detail.result!.requirementResults[0].requirementText, historic);

  const summary = (await controller.list(OWNER))[0];
  assert.equal(summary.objectiveTitle, 'TITULO-HISTORICO');
});

test('una historia ilegible FALLA CERRADO, sin resultado a medias', async () => {
  const corrupt = clone(resultArtifact()) as Mutable;
  corrupt.requirementResults[0].finalState = 'MAGNIFICO';

  const cases: Record<string, any>[] = [
    // `completed` con resultado corrupto.
    completedRunRow({ resultArtifact: corrupt }),
    // `completed` sin resultado.
    completedRunRow({ resultArtifact: null }),
    // Snapshot ilegible.
    completedRunRow({ objectiveDefinitionSnapshot: { schemaVersion: 'otra' } }),
    // El resultado responde por Requirements que no son los del snapshot.
    completedRunRow({
      objectiveDefinitionSnapshot: snapshot(['req_01', 'req_02']),
      resultArtifact: resultArtifact(['req_01'])
    })
  ];

  for (const [index, row] of cases.entries()) {
    const { controller, execution } = controllerFor({ rows: [row] });
    const status = await statusOf(() => controller.get(OWNER, 'run-1'));
    assert.equal(status, HttpStatus.INTERNAL_SERVER_ERROR, `caso ${index}`);
    // Fallar cerrado NO significa recomputar.
    assert.equal(execution.calls.length, 0, `caso ${index}`);
  }
});

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

test('ejecutar entra por el orquestador de mas alto nivel', async () => {
  const execution = fakeExecution({
    onRun: () => {
      /* el estado real lo relee el service */
    }
  });
  const { controller } = controllerFor({ rows: [completedRunRow()], execution });

  await controller.execute(OWNER, 'run-1');
  assert.deepEqual(execution.calls, ['run-1']);
});

test('SEGURIDAD: ejecutar un run ajeno da 404 y CERO ejecuciones', async () => {
  const { controller, execution } = controllerFor({
    rows: [runRow({ ownerUserId: OWNER.id })]
  });

  const status = await statusOf(() => controller.execute(OTHER, 'run-1'));

  assert.equal(status, HttpStatus.NOT_FOUND);
  // La autorización ocurre ANTES de la claim: nunca se intentó ejecutar.
  assert.equal(execution.calls.length, 0);
});

test('ejecutar un run inexistente da 404 y CERO ejecuciones', async () => {
  const { controller, execution } = controllerFor({ rows: [runRow()] });
  const status = await statusOf(() => controller.execute(OWNER, 'run-inexistente'));
  assert.equal(status, HttpStatus.NOT_FOUND);
  assert.equal(execution.calls.length, 0);
});

test('un run ya reclamado responde 409 sin filtrar nada del proveedor', async () => {
  const execution = fakeExecution({
    error: new ReasoningRunExecutionError('EXECUTION_ALREADY_CLAIMED', {
      invariant: 'another_execution_owns_this_run',
      reasoningRunId: 'run-1',
      observedStatus: 'running'
    })
  });
  const { controller } = controllerFor({ rows: [runRow({ status: 'running' })], execution });

  const status = await statusOf(() => controller.execute(OWNER, 'run-1'));
  const body = await bodyOf(() => controller.execute(OWNER, 'run-1'));

  assert.equal(status, HttpStatus.CONFLICT);
  assert.equal((body as any).code, 'EXECUTION_ALREADY_RUNNING');
  // No se dice si el dueño sigue vivo, ni cuánto lleva, ni qué está haciendo.
  assert.ok(!JSON.stringify(body).includes('running'));
});

test('un run terminalmente fallido responde 409 y no se reejecuta', async () => {
  const execution = fakeExecution({
    error: new ReasoningRunExecutionError('RUN_TERMINALLY_FAILED', {
      invariant: 'a_failed_run_is_not_restarted_in_place',
      reasoningRunId: 'run-1'
    })
  });
  const { controller } = controllerFor({
    rows: [runRow({ status: 'failed', failureCode: 'reasoning_provider_invalid_output' })],
    execution
  });

  const body = await bodyOf(() => controller.execute(OWNER, 'run-1'));
  assert.equal((body as any).statusCode, HttpStatus.CONFLICT);
  assert.equal((body as any).code, 'RUN_TERMINALLY_FAILED');
});

test('un fallo TRANSITORIO responde 503 generico y el run sigue reintentable', async () => {
  const transient = Object.assign(new Error('provider timeout'), {
    code: 'PROVIDER_TRANSPORT_FAILURE'
  });
  const execution = fakeExecution({ error: transient });
  const { controller } = controllerFor({ rows: [runRow()], execution });

  const status = await statusOf(() => controller.execute(OWNER, 'run-1'));
  const body = await bodyOf(() => controller.execute(OWNER, 'run-1'));

  assert.equal(status, HttpStatus.SERVICE_UNAVAILABLE);
  assert.equal((body as any).code, 'EXECUTION_TEMPORARILY_UNAVAILABLE');
  const text = JSON.stringify(body);
  for (const leak of ['PROVIDER_TRANSPORT_FAILURE', 'provider', 'timeout', 'openai']) {
    assert.ok(!text.toLowerCase().includes(leak.toLowerCase()), leak);
  }
});

test('el mismo execute es el REINTENTO de un run pending', async () => {
  const execution = fakeExecution();
  const { controller } = controllerFor({ rows: [runRow({ status: 'pending' })], execution });

  await controller.execute(OWNER, 'run-1');
  await controller.execute(OWNER, 'run-1');

  // No hay `/retry`: sería un segundo nombre para la misma operación.
  assert.deepEqual(execution.calls, ['run-1', 'run-1']);
  const routes = Object.getOwnPropertyNames(ReasoningRunsController.prototype);
  assert.ok(!routes.includes('retry'));
  assert.ok(!routes.includes('cancel'));
  assert.ok(!routes.includes('reset'));
});

test('un fallo interno desconocido NO se anuncia como reintentable', async () => {
  // Que la fila haya quedado en `pending` no convierte un error que no
  // declaramos en transitorio.
  const execution = fakeExecution({ error: new Error('algo raro') });
  const { controller } = controllerFor({ rows: [runRow({ status: 'pending' })], execution });

  const status = await statusOf(() => controller.execute(OWNER, 'run-1'));
  assert.equal(status, HttpStatus.INTERNAL_SERVER_ERROR);
});

test('un fallo interno de ejecucion no filtra su causa', async () => {
  const execution = fakeExecution({
    error: new ReasoningRunExecutionError('DETERMINISTIC_POLICY_VERSION_MISMATCH', {
      invariant: 'frozen_plan_policy_version_must_match_this_process',
      reasoningRunId: 'run-1'
    })
  });
  const { controller } = controllerFor({ rows: [runRow()], execution });

  const body = await bodyOf(() => controller.execute(OWNER, 'run-1'));
  const text = JSON.stringify(body);
  assert.equal((body as any).statusCode, HttpStatus.INTERNAL_SERVER_ERROR);
  for (const leak of ['POLICY_VERSION', 'plan', 'policy', 'frozen']) {
    assert.ok(!text.toLowerCase().includes(leak.toLowerCase()), leak);
  }
  // En 5xx tampoco viaja el código: sólo el mensaje genérico.
  assert.equal((body as any).code, undefined);
});

test('ejecutar un run ya completado devuelve el mismo resultado persistido', async () => {
  const execution = fakeExecution();
  const { controller } = controllerFor({ rows: [completedRunRow()], execution });

  const first = await controller.get(OWNER, 'run-1');
  const second = await controller.execute(OWNER, 'run-1');

  assert.equal(second.status, 'completed');
  assert.deepEqual(second, first);
  // El orquestador se llama —y él decide devolver lo persistido con 0 llamadas
  // al proveedor—, pero la respuesta HTTP es estable.
  assert.deepEqual(execution.calls, ['run-1']);
});

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

test('los CINCO estados finales se preservan exactos', async () => {
  const states = [
    'SUPPORTED',
    'PARTIALLY_SUPPORTED',
    'INSUFFICIENT_EVIDENCE',
    'NOT_ASSESSABLE',
    'ABSTAIN'
  ];
  for (const state of states) {
    const artifact = clone(resultArtifact()) as Mutable;
    artifact.requirementResults[0].finalState = state;
    const { controller } = controllerFor({
      rows: [completedRunRow({ resultArtifact: artifact })]
    });
    const detail = await controller.get(OWNER, 'run-1');
    assert.equal(detail.result!.requirementResults[0].finalState, state);
  }
});

test('el resultado NO se resume, ni se puntua, ni se rankea', async () => {
  const { controller } = controllerFor({ rows: [completedRunRow()] });
  const detail = await controller.get(OWNER, 'run-1');

  // Sin estado final del Objective: los estados son POR Requirement.
  assert.deepEqual(Object.keys(detail.result!), ['requirementResults']);
  assert.equal('finalState' in (detail.result as any), false);
  assert.equal('score' in (detail.result as any), false);
});

test('la explicacion es EXACTAMENTE la del artifact determinista', async () => {
  const artifact = resultArtifact();
  const { controller } = controllerFor({
    rows: [completedRunRow({ resultArtifact: artifact })]
  });
  const detail = await controller.get(OWNER, 'run-1');

  // Copiada literal: no se reescribe, no se resume, no pasa por otro modelo.
  assert.equal(
    detail.result!.requirementResults[0].explanation,
    artifact.requirementResults[0].explanation
  );
});

test('un run no completado no expone resultado', async () => {
  for (const status of ['pending', 'running', 'failed']) {
    const { controller } = controllerFor({ rows: [runRow({ status })] });
    const detail = await controller.get(OWNER, 'run-1');
    assert.equal(detail.result, null, status);
  }
});

test('el failureCode interno se proyecta a una categoria cerrada', async () => {
  const cases: [string | null, string | null][] = [
    ['reasoning_input_freeze_blocked', 'EVIDENCE_PREPARATION_BLOCKED'],
    ['reasoning_provider_invalid_output', 'EXECUTION_FAILED'],
    // Un token interno FUTURO no puede ensanchar la API sola.
    ['reasoning_codigo_que_no_existe_todavia', 'EXECUTION_FAILED'],
    [null, null]
  ];
  for (const [internal, expected] of cases) {
    const { controller } = controllerFor({
      rows: [runRow({ status: internal ? 'failed' : 'pending', failureCode: internal })]
    });
    const detail = await controller.get(OWNER, 'run-1');
    assert.equal(detail.failureCategory, expected, String(internal));
  }
});

test('dos ejecuciones HTTP simultaneas: una gana, la otra recibe conflicto', () => {
  // La exclusion la decide la CLAIM del dominio, no un mutex en el controller.
  // Este test comprueba la semantica HTTP resultante, no reimplementa la carrera.
  const source = ReasoningRunsController.toString();
  for (const token of ['Mutex', 'lock', 'semaphore', 'inFlight']) {
    assert.ok(!source.includes(token), token);
  }
});

test('el perdedor de la carrera ve 409 y el ganador su resultado', async () => {
  let claimed = false;
  const execution = {
    calls: [] as string[],
    service: {
      executeReasoningRun: async (runId: string) => {
        execution.calls.push(runId);
        if (claimed) {
          throw new ReasoningRunExecutionError('EXECUTION_ALREADY_CLAIMED', {
            invariant: 'another_execution_owns_this_run',
            reasoningRunId: runId
          });
        }
        claimed = true;
        return { reasoningRunId: runId, executed: true, providerLogicalCalls: 3 };
      }
    }
  };
  const { controller } = controllerFor({
    rows: [completedRunRow()],
    execution: execution as never
  });

  const [first, second] = await Promise.allSettled([
    controller.execute(OWNER, 'run-1'),
    controller.execute(OWNER, 'run-1')
  ]);

  const fulfilled = [first, second].filter((r) => r.status === 'fulfilled');
  const rejected = [first, second].filter((r) => r.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);

  const error = (rejected[0] as PromiseRejectedResult).reason;
  assert.ok(error instanceof HttpException);
  assert.equal(error.getStatus(), HttpStatus.CONFLICT);
  assert.equal((error.getResponse() as any).code, 'EXECUTION_ALREADY_RUNNING');
});

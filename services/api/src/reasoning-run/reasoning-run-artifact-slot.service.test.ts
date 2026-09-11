/**
 * Servicio de slots de etapa — F3.1.
 *
 * Prisma se reemplaza por un doble en memoria que implementa `findUnique`,
 * `updateMany` y `findMany` con la MISMA semantica condicional que usa el
 * servicio. Es lo que permite probar el compare-and-set sin base: no se aplica
 * ninguna migracion y no se escribe en ningun `DATABASE_URL`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { Prisma } from '@prisma/client';

import {
  clone,
  validEvidenceUnits,
  validExecutionMetadata,
  validObjectiveAnalysis,
  validResult
} from './__fixtures__/reasoning-run-artifacts.fixture';
import { ReasoningRunSlotError } from './reasoning-run-artifact-slot.errors';
import { ReasoningRunArtifactSlotService } from './reasoning-run-artifact-slot.service';

const RUN_ID = 'run-1';

function objectiveSnapshot(requirementIds: readonly string[] = ['req_01']) {
  return {
    schemaVersion: 'objective_definition_v1',
    objectiveType: 'EMPLOYMENT',
    objectiveContext: 'Backend Developer Junior',
    source: { inputType: 'DIRECT_STRUCTURED_INPUT', originalText: null },
    requirements: requirementIds.map((requirementId, index) => ({
      requirementId,
      order: index + 1,
      // Contiene las dos citas de `validObjectiveAnalysis()`: el anclaje de
      // qualifiers se verifica contra ESTE texto.
      requirementText: `Requisito ${index + 1}: APIs REST nivel intermedio en backend`,
      provenance: { kind: 'DIRECT_STRUCTURED_INPUT', sourceQuote: null },
      qualifiers: []
    }))
  };
}

interface FakeRun {
  id: string;
  status: string;
  failureCode: string | null;
  objectiveDefinitionSnapshot: unknown;
  objectiveAnalysisArtifact: unknown;
  evidenceUnitsArtifact: unknown;
  resultArtifact: unknown;
  executionMetadata: unknown;
}

/** Igualdad directa, o el sentinel `Prisma.DbNull` que exigen las columnas Json. */
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

interface FakeInventoryItem {
  disposition: string;
  runLocalSourceId: string | null;
  sourceSha256: string | null;
}

/**
 * `updateMany` respeta el `where`, que es exactamente la condicion del
 * compare-and-set. Un doble que ignorara ese filtro haria pasar el test justo
 * donde importa que falle.
 *
 * Y respeta la forma REAL del filtro de Prisma para columnas `Json?`:
 * `{ equals: Prisma.DbNull }`, no `null`. Un doble que aceptara `null` estaria
 * validando un CAS que en runtime no compila la query.
 */
function fakePrisma(options: {
  run?: FakeRun | null;
  inventory?: FakeInventoryItem[];
} = {}) {
  const state: { run: FakeRun | null } = {
    run:
      options.run === undefined
        ? {
            id: RUN_ID,
            status: 'pending',
            failureCode: null,
            objectiveDefinitionSnapshot: objectiveSnapshot(),
            objectiveAnalysisArtifact: null,
            evidenceUnitsArtifact: null,
            resultArtifact: null,
            executionMetadata: null
          }
        : options.run
  };
  const inventory = options.inventory ?? [
    {
      disposition: 'INCLUDED',
      runLocalSourceId: 'src_01',
      sourceSha256: 'a'.repeat(64)
    }
  ];
  const writes: string[] = [];
  const filters: Record<string, unknown>[] = [];

  const prisma = {
    reasoningRun: {
      findUnique: async ({ where }: any) =>
        state.run && state.run.id === where.id ? { ...state.run } : null,
      updateMany: async ({ where, data }: any) => {
        filters.push(where);
        const run = state.run;
        if (!run || run.id !== where.id) return { count: 0 };
        for (const [column, expected] of Object.entries(where)) {
          if (column === 'id') continue;
          if (!matchesFilter((run as any)[column], expected)) return { count: 0 };
        }
        Object.assign(run, data);
        writes.push(Object.keys(data)[0]);
        return { count: 1 };
      }
    },
    reasoningRunInventoryItem: {
      findMany: async () => inventory.map((item) => ({ ...item }))
    }
  };

  return { prisma, state, writes, filters };
}

function service(prisma: unknown): ReasoningRunArtifactSlotService {
  return new ReasoningRunArtifactSlotService(prisma as never);
}

async function expectSlotCode(
  fn: () => Promise<unknown>,
  code: string
): Promise<void> {
  try {
    await fn();
  } catch (error: unknown) {
    assert.ok(error instanceof ReasoningRunSlotError, String(error));
    assert.equal(error.code, code);
    return;
  }
  throw new Error(`expected ${code} but nothing was thrown`);
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

test('un run sin ningun slot lleno devuelve los cuatro en null', async () => {
  const { prisma } = fakePrisma();
  const artifacts = await service(prisma).readReasoningRunArtifacts(RUN_ID);
  assert.equal(artifacts.objectiveAnalysis, null);
  assert.equal(artifacts.evidenceUnits, null);
  assert.equal(artifacts.result, null);
  assert.equal(artifacts.executionMetadata, null);
});

test('un run inexistente falla con NOT_FOUND', async () => {
  const { prisma } = fakePrisma({ run: null });
  await expectSlotCode(
    () => service(prisma).readReasoningRunArtifacts(RUN_ID),
    'REASONING_RUN_NOT_FOUND'
  );
});

// ---------------------------------------------------------------------------
// ABSENT -> PRESENT
// ---------------------------------------------------------------------------

test('ABSENT: se llena el Objective Analysis y queda legible', async () => {
  const { prisma, state, writes } = fakePrisma();
  const filled = await service(prisma).fillObjectiveAnalysisArtifact(
    RUN_ID,
    validObjectiveAnalysis()
  );
  assert.equal(filled.requirements[0].requirementId, 'req_01');
  assert.deepEqual(writes, ['objectiveAnalysisArtifact']);
  assert.ok(state.run?.objectiveAnalysisArtifact);
});

test('ABSENT: se llena el catalogo de EvidenceUnits', async () => {
  const { prisma, writes } = fakePrisma();
  const filled = await service(prisma).fillEvidenceUnitsArtifact(
    RUN_ID,
    validEvidenceUnits()
  );
  assert.equal(filled.evidenceUnits.length, 1);
  assert.deepEqual(writes, ['evidenceUnitsArtifact']);
});

test('los dos primeros slots son INDEPENDIENTES entre si', async () => {
  // F3.0 auditó que `sourceObservabilityFacts` no depende del Objective Analysis,
  // asi que cualquiera de los dos puede llenarse primero.
  const first = fakePrisma();
  await service(first.prisma).fillEvidenceUnitsArtifact(
    RUN_ID,
    validEvidenceUnits()
  );
  await service(first.prisma).fillObjectiveAnalysisArtifact(
    RUN_ID,
    validObjectiveAnalysis()
  );
  assert.deepEqual(first.writes, [
    'evidenceUnitsArtifact',
    'objectiveAnalysisArtifact'
  ]);
});

test('executionMetadata se llena fill-once, sin API generica de update', async () => {
  const { prisma, writes } = fakePrisma();
  const svc = service(prisma);
  await svc.fillExecutionMetadata(RUN_ID, validExecutionMetadata());
  assert.deepEqual(writes, ['executionMetadata']);
  assert.equal(
    typeof (svc as unknown as Record<string, unknown>).updateExecutionMetadata,
    'undefined'
  );
});

// ---------------------------------------------------------------------------
// Idempotencia y conflicto
// ---------------------------------------------------------------------------

test('PRESENT con el MISMO artifact: idempotente y CERO escrituras', async () => {
  const { prisma, writes } = fakePrisma();
  const svc = service(prisma);
  await svc.fillObjectiveAnalysisArtifact(RUN_ID, validObjectiveAnalysis());
  const again = await svc.fillObjectiveAnalysisArtifact(
    RUN_ID,
    validObjectiveAnalysis()
  );
  assert.equal(again.requirements[0].requirementId, 'req_01');
  assert.equal(writes.length, 1, 'no debe haber una segunda escritura');
});

test('la igualdad ignora el ORDEN de las claves, no el contenido', async () => {
  // Igualdad estructural verificada sobre JSON canonico: el mismo artifact
  // serializado distinto sigue siendo el mismo artifact.
  const { prisma, writes } = fakePrisma();
  const svc = service(prisma);
  await svc.fillEvidenceUnitsArtifact(RUN_ID, validEvidenceUnits());

  const reordered = clone(validEvidenceUnits());
  const unit = reordered.evidenceUnits[0];
  reordered.evidenceUnits[0] = {
    extractionQuality: unit.extractionQuality,
    sourceTrace: unit.sourceTrace,
    evidenceUnitId: unit.evidenceUnitId,
    exactQuote: unit.exactQuote,
    claimType: unit.claimType,
    contextAfter: unit.contextAfter,
    contextBefore: unit.contextBefore,
    normalizedProposition: unit.normalizedProposition,
    interpretationProvenance: unit.interpretationProvenance,
    sectionLabel: unit.sectionLabel,
    semanticQualifiers: unit.semanticQualifiers
  };

  await svc.fillEvidenceUnitsArtifact(RUN_ID, reordered);
  assert.equal(writes.length, 1);
});

test('PRESENT con OTRO artifact: conflicto determinista y sin escribir', async () => {
  const { prisma, writes } = fakePrisma();
  const svc = service(prisma);
  await svc.fillObjectiveAnalysisArtifact(RUN_ID, validObjectiveAnalysis());

  const different = validObjectiveAnalysis();
  different.requirements[0].epistemicTarget = 'INDIVIDUAL_ACHIEVEMENT';

  await expectSlotCode(
    () => svc.fillObjectiveAnalysisArtifact(RUN_ID, different),
    'STAGE_ARTIFACT_CONFLICT'
  );
  assert.equal(writes.length, 1, 'un conflicto nunca escribe');
});

// ---------------------------------------------------------------------------
// Corrupcion
// ---------------------------------------------------------------------------

test('un slot persistido corrupto falla y NUNCA se sobreescribe', async () => {
  const { prisma, state, writes } = fakePrisma();
  state.run!.evidenceUnitsArtifact = { schemaVersion: 'evidence_units_v1' };

  await expectSlotCode(
    () => service(prisma).readReasoningRunArtifacts(RUN_ID),
    'STAGE_ARTIFACT_CORRUPT'
  );
  await expectSlotCode(
    () => service(prisma).fillEvidenceUnitsArtifact(RUN_ID, validEvidenceUnits()),
    'STAGE_ARTIFACT_CORRUPT'
  );
  assert.equal(writes.length, 0);
  assert.deepEqual(state.run!.evidenceUnitsArtifact, {
    schemaVersion: 'evidence_units_v1'
  });
});

test('un snapshot de Objective corrupto se detecta al usarlo', async () => {
  const { prisma, state } = fakePrisma();
  state.run!.objectiveDefinitionSnapshot = { schemaVersion: 'nope' };
  await expectSlotCode(
    () =>
      service(prisma).fillObjectiveAnalysisArtifact(
        RUN_ID,
        validObjectiveAnalysis()
      ),
    'OBJECTIVE_SNAPSHOT_CORRUPT'
  );
});

// ---------------------------------------------------------------------------
// La autoridad viene de la BASE, no del llamante
// ---------------------------------------------------------------------------

test('el analisis se valida contra el Objective PERSISTIDO', async () => {
  // El llamante no puede pasar "los requirementIds que el cree": el servicio los
  // lee del snapshot congelado en la fila. Aca el run exige dos y el artifact
  // trae uno.
  const { prisma } = fakePrisma();
  const { state } = fakePrisma();
  void state;
  const two = fakePrisma();
  two.state.run!.objectiveDefinitionSnapshot = objectiveSnapshot([
    'req_01',
    'req_02'
  ]);

  await assert.rejects(
    () =>
      service(two.prisma).fillObjectiveAnalysisArtifact(
        RUN_ID,
        validObjectiveAnalysis()
      ),
    /REQUIREMENT_COVERAGE_INCOMPLETE/
  );
  assert.equal(two.writes.length, 0);
  void prisma;
});

test('las EvidenceUnits se validan contra el inventario PERSISTIDO', async () => {
  const { prisma, writes } = fakePrisma({
    inventory: [
      {
        disposition: 'EXCLUDED_ALTERNATE_REPRESENTATION',
        runLocalSourceId: null,
        sourceSha256: 'a'.repeat(64)
      }
    ]
  });
  await assert.rejects(
    () => service(prisma).fillEvidenceUnitsArtifact(RUN_ID, validEvidenceUnits()),
    /SOURCE_REFERENCE_NOT_GROUNDED/
  );
  assert.equal(writes.length, 0);
});

// ---------------------------------------------------------------------------
// Dependencia de etapas del resultado
// ---------------------------------------------------------------------------

test('el resultado NO puede llenarse antes que las dos etapas previas', async () => {
  const scenarios: ReadonlyArray<readonly string[]> = [
    [],
    ['objectiveAnalysis'],
    ['evidenceUnits']
  ];
  for (const prefill of scenarios) {
    const { prisma, writes } = fakePrisma();
    const svc = service(prisma);
    if (prefill.includes('objectiveAnalysis')) {
      await svc.fillObjectiveAnalysisArtifact(RUN_ID, validObjectiveAnalysis());
    }
    if (prefill.includes('evidenceUnits')) {
      await svc.fillEvidenceUnitsArtifact(RUN_ID, validEvidenceUnits());
    }
    const before = writes.length;
    await expectSlotCode(
      () => svc.fillResultArtifact(RUN_ID, validResult()),
      'PREVIOUS_STAGE_ARTIFACT_MISSING'
    );
    assert.equal(writes.length, before, 'el result no debe escribirse');
  }
});

test('con las dos etapas presentes, el resultado se acepta', async () => {
  const { prisma, writes } = fakePrisma();
  const svc = service(prisma);
  await svc.fillObjectiveAnalysisArtifact(RUN_ID, validObjectiveAnalysis());
  await svc.fillEvidenceUnitsArtifact(RUN_ID, validEvidenceUnits());
  const result = await svc.fillResultArtifact(RUN_ID, validResult());
  assert.equal(result.requirementResults[0].requirementId, 'req_01');
  assert.deepEqual(writes, [
    'objectiveAnalysisArtifact',
    'evidenceUnitsArtifact',
    'resultArtifact'
  ]);
});

test('un resultado con referencias irresolubles no se persiste', async () => {
  for (const mutate of [
    (raw: any) => {
      raw.requirementResults[0].requirementId = 'req_09';
    },
    (raw: any) => {
      raw.requirementResults[0].evaluatedEvidence[0].evidenceUnitId = 'eu_09';
    }
  ]) {
    const { prisma, writes } = fakePrisma();
    const svc = service(prisma);
    await svc.fillObjectiveAnalysisArtifact(RUN_ID, validObjectiveAnalysis());
    await svc.fillEvidenceUnitsArtifact(RUN_ID, validEvidenceUnits());

    const raw = validResult();
    mutate(raw);
    await assert.rejects(() => svc.fillResultArtifact(RUN_ID, raw));
    assert.equal(writes.length, 2, 'los slots previos quedan intactos');
  }
});

test('un fill fallido deja los slots anteriores SIN TOCAR', async () => {
  const { prisma, state } = fakePrisma();
  const svc = service(prisma);
  await svc.fillObjectiveAnalysisArtifact(RUN_ID, validObjectiveAnalysis());
  const analysisBefore = JSON.stringify(state.run!.objectiveAnalysisArtifact);

  await assert.rejects(() =>
    svc.fillEvidenceUnitsArtifact(RUN_ID, { schemaVersion: 'evidence_units_v1' })
  );

  assert.equal(
    JSON.stringify(state.run!.objectiveAnalysisArtifact),
    analysisBefore
  );
  assert.equal(state.run!.evidenceUnitsArtifact, null);
});

// ---------------------------------------------------------------------------
// Alcance: F3.1 no implementa lifecycle
// ---------------------------------------------------------------------------

test('el servicio no expone lifecycle ni llama a ningun proveedor', async () => {
  const svc = service(fakePrisma().prisma) as unknown as Record<string, unknown>;
  for (const method of [
    'startRun',
    'executeRun',
    'completeRun',
    'failRun',
    'retryRun',
    'updateStatus'
  ]) {
    assert.equal(typeof svc[method], 'undefined', `${method} no pertenece a F3.1`);
  }
});


// ---------------------------------------------------------------------------
// Hardening del CAS — F3.3B
// ---------------------------------------------------------------------------

test('el CAS del analisis exige el estado del run en la MISMA query', async () => {
  // No alcanza con mirar `status` antes de la llamada al proveedor: entre esa
  // lectura y esta escritura hay una llamada de red entera. Si el estado no viaja
  // en el `where`, un fallo terminal concurrente y este exito escriben columnas
  // distintas de la misma fila sin verse.
  const { prisma, filters } = fakePrisma();
  await service(prisma).fillObjectiveAnalysisArtifact(
    RUN_ID,
    validObjectiveAnalysis()
  );

  assert.equal(filters.length, 1);
  const where = filters[0];
  assert.equal(where.status, 'pending');
  assert.equal(where.failureCode, null);
  assert.deepEqual(where.objectiveAnalysisArtifact, { equals: Prisma.DbNull });
});

test('un run ya fallado NO puede ganar un artifact de etapa', async () => {
  const { prisma, state, writes } = fakePrisma();
  state.run!.status = 'failed';
  state.run!.failureCode = 'reasoning_execution_plan_mismatch';

  await expectSlotCode(
    () =>
      service(prisma).fillObjectiveAnalysisArtifact(
        RUN_ID,
        validObjectiveAnalysis()
      ),
    'RUN_NOT_ELIGIBLE_FOR_STAGE_WRITE'
  );
  assert.deepEqual(writes, []);
  assert.equal(state.run!.objectiveAnalysisArtifact, null);
});

test('un failureCode sin status failed tambien bloquea la escritura', async () => {
  // La guarda mira las DOS columnas: un run marcado con causa de fallo ya no es
  // elegible aunque su `status` todavia no se haya movido.
  const { prisma, state } = fakePrisma();
  state.run!.failureCode = 'reasoning_objective_analysis_invalid_output';

  await expectSlotCode(
    () =>
      service(prisma).fillObjectiveAnalysisArtifact(
        RUN_ID,
        validObjectiveAnalysis()
      ),
    'RUN_NOT_ELIGIBLE_FOR_STAGE_WRITE'
  );
});

test('carrera perdida y slot inconsistente NO comparten codigo', async () => {
  // Un run elegible cuyo CAS no aplica sobre un slot ABSENT sigue siendo una
  // imposibilidad, y tiene que decirlo con su propio codigo.
  const { prisma, state } = fakePrisma();
  const original = prisma.reasoningRun.updateMany;
  prisma.reasoningRun.updateMany = async () => ({ count: 0 });
  void original;

  await expectSlotCode(
    () =>
      service(prisma).fillObjectiveAnalysisArtifact(
        RUN_ID,
        validObjectiveAnalysis()
      ),
    'STAGE_ARTIFACT_SLOT_INCONSISTENT'
  );
  assert.equal(state.run!.status, 'pending');
});

test('el slot de EvidenceUnits tambien exige el estado del run', async () => {
  // Desde F3.4 esta etapa tiene fallos terminales compitiendo por su fila, asi
  // que su CAS carga la misma guarda que el de Objective Analysis.
  const { prisma, filters } = fakePrisma();
  await service(prisma).fillEvidenceUnitsArtifact(RUN_ID, validEvidenceUnits());

  assert.equal(filters.length, 1);
  assert.equal(filters[0].status, 'pending');
  assert.equal(filters[0].failureCode, null);
});

test('el slot del RESULTADO sigue sin guarda: no hay lifecycle generico', async () => {
  // El hardening es minimo y deliberado. `resultArtifact` no tiene todavia un
  // fallo terminal compitiendo por su fila; la tendra cuando F3.5 exista.
  const { prisma, state, filters } = fakePrisma();
  state.run!.objectiveAnalysisArtifact = validObjectiveAnalysis();
  state.run!.evidenceUnitsArtifact = validEvidenceUnits();

  await service(prisma).fillResultArtifact(RUN_ID, validResult());

  assert.equal(filters.length, 1);
  assert.equal('status' in filters[0], false);
  assert.equal('failureCode' in filters[0], false);
});

/**
 * Servicio interno de Objectives — F2.1.
 *
 * Prisma se falsea con un store en memoria, siguiendo la convención de
 * `analysis-run-execution.service.test.ts`. El fake modela DOS cosas que los
 * tests realmente necesitan y que un doble trivial no daría:
 *
 *   1. `updateMany` es CONDICIONAL de verdad: sólo toca las filas que cumplen el
 *      `where`, y devuelve cuántas tocó. Sin eso, el compare-and-set de la
 *      revisión no se estaría probando.
 *   2. `$transaction` revierte el store si el callback lanza. Sin eso, el test
 *      de rollback afirmaría algo sobre nada.
 *
 * El validador y el builder son los REALES: falsearlos convertiría los tests de
 * consistencia fila/artifact en afirmaciones sobre el mock.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ObjectiveDefinitionError,
  ObjectiveRowError
} from './objective-definition.errors';
import {
  buildObjectiveDefinitionV1,
  type ObjectiveDefinitionInput
} from './objective-definition.builder';
import { ObjectivesService, type CreateObjectiveInput } from './objectives.service';

const OWNER = 'user-1';
const OTHER_OWNER = 'user-2';

const ORIGINAL_TEXT =
  'Buscamos perfil backend. Requisitos: APIs REST y testing automatizado backend.';

function pastedDefinition(
  overrides: Partial<ObjectiveDefinitionInput> = {}
): ObjectiveDefinitionInput {
  return {
    objectiveType: 'EMPLOYMENT',
    objectiveContext: 'Backend Developer Junior',
    sourceInputType: 'PASTED_TEXT',
    sourceOriginalText: ORIGINAL_TEXT,
    requirements: [
      {
        requirementText: 'APIs REST',
        provenanceKind: 'DERIVED_FROM_SOURCE_TEXT',
        sourceQuote: 'APIs REST'
      },
      {
        requirementText: 'Testing automatizado backend',
        provenanceKind: 'DERIVED_FROM_SOURCE_TEXT',
        sourceQuote: 'testing automatizado backend'
      }
    ],
    ...overrides
  };
}

function directDefinition(): ObjectiveDefinitionInput {
  return {
    objectiveType: 'ADMISSION',
    objectiveContext: '',
    sourceInputType: 'DIRECT_STRUCTURED_INPUT',
    sourceOriginalText: null,
    requirements: [
      {
        requirementText: 'Fundamentos de estadística inferencial',
        provenanceKind: 'DIRECT_STRUCTURED_INPUT'
      }
    ]
  };
}

const createInput = (
  title = 'Backend Junior — Empresa X',
  definition = pastedDefinition()
): CreateObjectiveInput => ({ title, definition });

// ---------------------------------------------------------------------------
// Fake de Prisma
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  ownerUserId: string;
  objectiveType: string;
  title: string;
  definition: unknown;
  supersedesObjectiveId: string | null;
  status: string;
  createdAt: Date;
}

function setup(options: { createFails?: boolean; clockStart?: number } = {}) {
  const rows: Row[] = [];
  let sequence = 0;
  let clock = options.clockStart ?? 1_700_000_000_000;
  let createFails = options.createFails ?? false;
  const calls = { creates: 0, updateManys: 0, transactions: 0 };

  const matches = (row: Row, where: Record<string, any>): boolean =>
    Object.entries(where).every(([key, value]) => (row as any)[key] === value);

  const project = (row: Row, select: Record<string, boolean>): Record<string, unknown> =>
    Object.fromEntries(Object.keys(select).map((key) => [key, (row as any)[key]]));

  /**
   * Cliente ligado a un undo log.
   *
   * Prisma le pasa al callback de `$transaction` un cliente PROPIO, y aqui pasa
   * lo mismo: cada transaccion escribe en su propio log. Un log compartido a
   * nivel de setup se rompe con dos transacciones concurrentes -- el rollback de
   * una deshacia lo que habia escrito la otra. (Version anterior de este fake;
   * la corrigio el test de concurrencia.)
   */
  const makeClient = (undo: Array<() => void> | null): any => ({
    objective: {
      async create(args: any) {
        calls.creates += 1;
        if (createFails) throw new Error('create fallo');
        sequence += 1;
        clock += 1000;
        const row: Row = { id: `obj-${sequence}`, createdAt: new Date(clock), ...args.data };
        rows.push(row);
        undo?.push(() => {
          const at = rows.indexOf(row);
          if (at >= 0) rows.splice(at, 1);
        });
        return project(row, args.select);
      },
      async findFirst(args: any) {
        const found = rows.find((row) => matches(row, args.where));
        return found ? project(found, args.select) : null;
      },
      async findMany(args: any) {
        return rows
          .filter((row) => matches(row, args.where))
          .sort(
            (left, right) =>
              right.createdAt.getTime() - left.createdAt.getTime() ||
              right.id.localeCompare(left.id)
          )
          .map((row) => project(row, args.select));
      },
      async updateMany(args: any) {
        calls.updateManys += 1;
        // Condicional de verdad: el where decide y el count es el real.
        const affected = rows.filter((row) => matches(row, args.where));
        for (const row of affected) {
          const previous = { ...row };
          undo?.push(() => Object.assign(row, previous));
          Object.assign(row, args.data);
        }
        return { count: affected.length };
      }
    },
    async $transaction(callback: (tx: any) => Promise<unknown>) {
      calls.transactions += 1;
      const log: Array<() => void> = [];
      try {
        return await callback(makeClient(log));
      } catch (error) {
        for (const revert of log.reverse()) revert();
        throw error;
      }
    }
  });

  const client = makeClient(null);

  return {
    calls,
    service: new ObjectivesService(client as never),
    rows: () => rows.map((row) => ({ ...row })),
    /** Hace fallar todo `create` posterior, incluidos los de una transaccion. */
    breakCreate: () => {
      createFails = true;
    }
  };
}

async function expectRowError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ObjectiveRowError, String(error));
    assert.equal(error.code, code);
    return error;
  }
  throw new assert.AssertionError({ message: `se esperaba ${code} y resolvio` });
}

// ---------------------------------------------------------------------------
// Creación
// ---------------------------------------------------------------------------

test('create: persists a finalized Objective in a single write', async () => {
  const { service, calls, rows } = setup();

  const objective = await service.createForUser(OWNER, createInput());

  assert.equal(objective.ownerUserId, OWNER);
  assert.equal(objective.status, 'active');
  assert.equal(objective.supersedesObjectiveId, null);
  assert.equal(calls.creates, 1, 'una sola escritura: no hay draft');
  assert.equal(calls.transactions, 0, 'la creación base no necesita transacción');
  assert.equal(rows().length, 1);
});

test('create: the server owns schemaVersion, requirementId and order', async () => {
  const { service } = setup();

  const objective = await service.createForUser(OWNER, createInput());

  assert.equal(objective.definition.schemaVersion, 'objective_definition_v1');
  assert.deepEqual(
    objective.definition.requirements.map((requirement) => requirement.requirementId),
    ['req_01', 'req_02']
  );
  assert.deepEqual(
    objective.definition.requirements.map((requirement) => requirement.order),
    [1, 2]
  );
});

test('create: row objectiveType equals the artifact one', async () => {
  const { service, rows } = setup();

  const objective = await service.createForUser(OWNER, createInput());
  const [row] = rows();

  assert.equal(objective.objectiveType, 'EMPLOYMENT');
  assert.equal(row.objectiveType, 'EMPLOYMENT');
  assert.equal((row.definition as any).objectiveType, 'EMPLOYMENT');
});

test('create: title is preserved exactly, and blank is rejected', async () => {
  const { service } = setup();

  const objective = await service.createForUser(OWNER, createInput('  Oferta X  '));
  assert.equal(objective.title, '  Oferta X  ', 'sin trim silencioso');

  await expectRowError(
    service.createForUser(OWNER, createInput('   ')),
    'OBJECTIVE_TITLE_INVALID'
  );
});

test('create: an invalid definition is rejected before any write', async () => {
  const { service, calls } = setup();

  await assert.rejects(
    service.createForUser(
      OWNER,
      createInput('Oferta', pastedDefinition({ requirements: [] }))
    ),
    ObjectiveDefinitionError
  );
  assert.equal(calls.creates, 0, 'nada llega a la base');
});

test('create: a non-literal quote is rejected before any write', async () => {
  const { service, calls } = setup();

  await assert.rejects(
    service.createForUser(
      OWNER,
      createInput(
        'Oferta',
        pastedDefinition({
          requirements: [
            {
              requirementText: 'GraphQL',
              provenanceKind: 'DERIVED_FROM_SOURCE_TEXT',
              sourceQuote: 'GraphQL'
            }
          ]
        })
      )
    ),
    ObjectiveDefinitionError
  );
  assert.equal(calls.creates, 0);
});

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

test('read: the owner gets their Objective back, re-verified', async () => {
  const { service } = setup();
  const created = await service.createForUser(OWNER, createInput());

  const read = await service.getForUser(OWNER, created.id);

  assert.equal(read.id, created.id);
  assert.equal(read.definition.requirements.length, 2);
  assert.ok(Object.isFrozen(read));
  assert.ok(Object.isFrozen(read.definition));
});

test('read: another user cannot read it, and cannot tell it exists', async () => {
  const { service } = setup();
  const created = await service.createForUser(OWNER, createInput());

  const foreign = await expectRowError(
    service.getForUser(OTHER_OWNER, created.id),
    'OBJECTIVE_NOT_FOUND'
  );
  const missing = await expectRowError(
    service.getForUser(OWNER, 'obj-inexistente'),
    'OBJECTIVE_NOT_FOUND'
  );

  // Mismo código y mismo invariante: ajeno e inexistente son indistinguibles.
  assert.equal(foreign.detail.invariant, missing.detail.invariant);
});

test('read: a persisted definition that violates the contract is corruption', async () => {
  const { service, rows } = setup();
  const created = await service.createForUser(OWNER, createInput());

  // Alguien tocó la fila por fuera del camino de escritura.
  const stored = rows()[0].definition as any;
  (service as any).prisma.objective.findFirst = async () => ({
    id: created.id,
    ownerUserId: OWNER,
    objectiveType: 'EMPLOYMENT',
    title: 'x',
    status: 'active',
    supersedesObjectiveId: null,
    createdAt: new Date(),
    definition: { ...stored, requirements: [] }
  });

  const error = await expectRowError(
    service.getForUser(OWNER, created.id),
    'OBJECTIVE_DEFINITION_CORRUPT'
  );
  // Se conserva el código del validador para poder diagnosticar sin releer.
  assert.match(error.detail.invariant, /REQUIREMENTS_EMPTY/);
});

test('read: a row whose objectiveType diverges from the artifact is rejected', async () => {
  const { service } = setup();
  const created = await service.createForUser(OWNER, createInput());
  const stored = await service.getForUser(OWNER, created.id);

  (service as any).prisma.objective.findFirst = async () => ({
    id: created.id,
    ownerUserId: OWNER,
    // La columna dice OTHER, el artifact sigue diciendo EMPLOYMENT.
    objectiveType: 'OTHER',
    title: 'x',
    status: 'active',
    supersedesObjectiveId: null,
    createdAt: new Date(),
    definition: stored.definition
  });

  await expectRowError(
    service.getForUser(OWNER, created.id),
    'OBJECTIVE_TYPE_MISMATCH'
  );
});

// ---------------------------------------------------------------------------
// Listado
// ---------------------------------------------------------------------------

test('list: scoped to the owner, active by default, newest first', async () => {
  const { service } = setup();
  const first = await service.createForUser(OWNER, createInput('Primera'));
  const second = await service.createForUser(OWNER, createInput('Segunda'));
  await service.createForUser(OTHER_OWNER, createInput('De otro'));

  const listed = await service.listForUser(OWNER);

  assert.deepEqual(
    listed.map((item) => item.id),
    [second.id, first.id],
    'createdAt descendente'
  );
  assert.ok(!listed.some((item) => item.title === 'De otro'));
});

test('list: filters by objectiveType using the column', async () => {
  const { service } = setup();
  await service.createForUser(OWNER, createInput('Empleo'));
  await service.createForUser(OWNER, createInput('Admisión', directDefinition()));

  const admissions = await service.listForUser(OWNER, { objectiveType: 'ADMISSION' });

  assert.equal(admissions.length, 1);
  assert.equal(admissions[0].title, 'Admisión');
});

test('list: does not load the definition', async () => {
  const { service } = setup();
  await service.createForUser(OWNER, createInput());

  const [summary] = await service.listForUser(OWNER);

  assert.deepEqual(Object.keys(summary).sort(), [
    'createdAt',
    'id',
    'objectiveType',
    'status',
    'supersedesObjectiveId',
    'title'
  ]);
  assert.ok(!('definition' in summary));
});

test('list: superseded objectives are excluded unless asked for', async () => {
  const { service } = setup();
  const first = await service.createForUser(OWNER, createInput('V1'));
  await service.createRevisionForUser(OWNER, first.id, createInput('V2'));

  const active = await service.listForUser(OWNER);
  const superseded = await service.listForUser(OWNER, { status: 'superseded' });

  assert.deepEqual(active.map((item) => item.title), ['V2']);
  assert.deepEqual(superseded.map((item) => item.title), ['V1']);
});

// ---------------------------------------------------------------------------
// Revisión
// ---------------------------------------------------------------------------

test('revision: creates a new immutable row and supersedes the previous one', async () => {
  const { service, calls, rows } = setup();
  const first = await service.createForUser(OWNER, createInput('V1'));

  const second = await service.createRevisionForUser(OWNER, first.id, createInput('V2'));

  assert.equal(second.status, 'active');
  assert.equal(second.supersedesObjectiveId, first.id);
  assert.notEqual(second.id, first.id);
  assert.equal(calls.transactions, 1, 'atómico');

  const previous = rows().find((row) => row.id === first.id);
  assert.equal(previous?.status, 'superseded');
});

test('revision: the previous row keeps every immutable field untouched', async () => {
  const { service, rows } = setup();
  const first = await service.createForUser(OWNER, createInput('V1'));
  const before = rows().find((row) => row.id === first.id);

  // Contenido distinto pero MISMO `objectiveType`: la continuidad de tipo (F2.2)
  // impide cambiarlo, y lo que este test quiere comprobar es que el predecesor
  // no se toca, no que se pueda cambiar el tipo.
  await service.createRevisionForUser(
    OWNER,
    first.id,
    createInput(
      'V2',
      pastedDefinition({
        objectiveContext: 'Contexto revisado',
        requirements: [
          {
            requirementText: 'APIs REST',
            provenanceKind: 'DERIVED_FROM_SOURCE_TEXT',
            sourceQuote: 'APIs REST'
          }
        ]
      })
    )
  );

  const after = rows().find((row) => row.id === first.id);
  assert.equal(after?.ownerUserId, before?.ownerUserId);
  assert.equal(after?.objectiveType, before?.objectiveType);
  assert.equal(after?.title, before?.title);
  assert.deepEqual(after?.definition, before?.definition);
  assert.equal(after?.createdAt.getTime(), before?.createdAt.getTime());
  assert.equal(after?.supersedesObjectiveId, null);
  // Lo ÚNICO que cambió:
  assert.equal(before?.status, 'active');
  assert.equal(after?.status, 'superseded');
});

test('revision: an invalid definition never touches the previous status', async () => {
  const { service, calls, rows } = setup();
  const first = await service.createForUser(OWNER, createInput('V1'));

  await assert.rejects(
    service.createRevisionForUser(
      OWNER,
      first.id,
      createInput('V2', pastedDefinition({ requirements: [] }))
    ),
    ObjectiveDefinitionError
  );

  assert.equal(rows().find((row) => row.id === first.id)?.status, 'active');
  assert.equal(calls.transactions, 0, 'ni siquiera se abre la transacción');
});

test("revision: another user's Objective cannot be revised", async () => {
  const { service, rows } = setup();
  const first = await service.createForUser(OWNER, createInput('V1'));

  await expectRowError(
    service.createRevisionForUser(OTHER_OWNER, first.id, createInput('V2')),
    'OBJECTIVE_NOT_FOUND'
  );
  assert.equal(rows().find((row) => row.id === first.id)?.status, 'active');
  assert.equal(rows().length, 1);
});

test('revision: an already superseded Objective cannot be revised again', async () => {
  const { service, rows } = setup();
  const first = await service.createForUser(OWNER, createInput('V1'));
  await service.createRevisionForUser(OWNER, first.id, createInput('V2'));

  await expectRowError(
    service.createRevisionForUser(OWNER, first.id, createInput('V3')),
    'OBJECTIVE_NOT_ACTIVE'
  );
  assert.equal(rows().length, 2, 'no se creó una tercera fila');
});

test('revision: a revision MAY change the objectiveType', async () => {
  // REVISION_TYPE_CONTINUITY: NOT_REQUIRED.
  //
  // F2.0 no congeló igualdad de tipo entre versiones. `objectiveType` es un
  // discriminante de contexto y la estructura de Requirements es común, así que
  // corregir una clasificación es una revisión legítima. Lo que hace que esto
  // sea una revisión es `supersedesObjectiveId`, no que coincida el tipo.
  const { service, rows } = setup();
  const first = await service.createForUser(OWNER, createInput('V1'));

  const second = await service.createRevisionForUser(
    OWNER,
    first.id,
    createInput('V2', directDefinition())
  );

  assert.equal(second.objectiveType, 'ADMISSION');
  assert.equal(second.definition.objectiveType, 'ADMISSION');
  assert.equal(second.supersedesObjectiveId, first.id);

  // El predecesor conserva SU tipo y su artifact: la fila anterior nunca cambia
  // de contenido.
  const previous = rows().find((row) => row.id === first.id);
  assert.equal(previous?.objectiveType, 'EMPLOYMENT');
  assert.equal((previous?.definition as any).objectiveType, 'EMPLOYMENT');
  assert.equal(previous?.status, 'superseded');
});

test('revision: two concurrent revisions produce exactly one winner', async () => {
  const { service, rows } = setup();
  const first = await service.createForUser(OWNER, createInput('V1'));

  const results = await Promise.allSettled([
    service.createRevisionForUser(OWNER, first.id, createInput('A')),
    service.createRevisionForUser(OWNER, first.id, createInput('B'))
  ]);

  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactamente un ganador');
  assert.equal(rejected.length, 1);

  // El perdedor recibe un conflicto determinista, no un error genérico.
  const reason = (rejected[0] as PromiseRejectedResult).reason;
  assert.ok(reason instanceof ObjectiveRowError);
  assert.ok(
    reason.code === 'OBJECTIVE_REVISION_CONFLICT' || reason.code === 'OBJECTIVE_NOT_ACTIVE',
    `código inesperado: ${reason.code}`
  );

  // Y sobre todo: una sola sucesora. Sin UNIQUE en la base, esto lo garantiza el
  // compare-and-set del camino de escritura.
  const successors = rows().filter((row) => row.supersedesObjectiveId === first.id);
  assert.equal(successors.length, 1);
});

test('revision: if creating the successor fails, the previous stays active', async () => {
  const { service, rows, breakCreate } = setup();
  const first = await service.createForUser(OWNER, createInput('V1'));

  // A partir de aquí, todo `create` falla -- incluido el de la transacción.
  breakCreate();

  await assert.rejects(
    service.createRevisionForUser(OWNER, first.id, createInput('V2'))
  );

  // La transacción revirtió el `superseded`.
  assert.equal(rows().find((row) => row.id === first.id)?.status, 'active');
  assert.equal(rows().length, 1);
});

// ---------------------------------------------------------------------------
// Qualifiers: el servidor siempre emite []
// ---------------------------------------------------------------------------

test('builder: always emits an empty qualifiers array', () => {
  const built = buildObjectiveDefinitionV1(pastedDefinition());

  assert.equal(built.requirements.length, 2);
  for (const requirement of built.requirements) {
    assert.deepEqual(requirement.qualifiers, []);
  }
});

test('builder: the caller has no authority over qualifiers', () => {
  // No se le pide al caller un dato cuyo único valor válido es vacío. Un
  // `qualifiers` en el input no existe en el tipo, y si alguien lo cuela igual
  // el builder lo ignora: lo que llega al artifact es siempre [].
  const contaminated = pastedDefinition();
  (contaminated.requirements[0] as any).qualifiers = [
    { kind: 'contexto', value: 'backend', sourcePhrase: null }
  ];

  const built = buildObjectiveDefinitionV1(contaminated);
  assert.deepEqual(built.requirements[0].qualifiers, []);
});

test('a persisted Objective with empty qualifiers re-validates on read', async () => {
  const { service } = setup();
  const created = await service.createForUser(OWNER, createInput());

  const read = await service.getForUser(OWNER, created.id);

  for (const requirement of read.definition.requirements) {
    assert.deepEqual(requirement.qualifiers, []);
  }
});

// ---------------------------------------------------------------------------
// Límite aceptado: no hay tamper-evidence at rest
// ---------------------------------------------------------------------------

test('LIMIT: an out-of-band swap for ANOTHER valid artifact is NOT detected', async () => {
  // OBJECTIVE_TAMPER_EVIDENT_AT_REST: NO
  //
  // La re-verificación en lectura detecta corrupción y mismatch de tipo, pero NO
  // detecta que un `objective_definition_v1` válido haya sido reemplazado fuera
  // de banda por otro artifact válido con el mismo objectiveType de fila. Se fija
  // como límite conocido en vez de dejarlo implícito: sin fingerprint no hay
  // forma de distinguirlos, y F2.1 decidió no agregarlo.
  const { service } = setup();
  const created = await service.createForUser(OWNER, createInput('Original'));

  const swapped = buildObjectiveDefinitionV1(
    pastedDefinition({
      objectiveContext: 'REQUISITOS SUSTITUIDOS',
      requirements: [
        {
          requirementText: 'Otra cosa completamente distinta',
          provenanceKind: 'DIRECT_STRUCTURED_INPUT'
        }
      ],
      sourceInputType: 'DIRECT_STRUCTURED_INPUT',
      sourceOriginalText: null
    })
  );

  (service as any).prisma.objective.findFirst = async () => ({
    id: created.id,
    ownerUserId: OWNER,
    objectiveType: 'EMPLOYMENT',
    title: 'Original',
    status: 'active',
    supersedesObjectiveId: null,
    createdAt: new Date(),
    definition: swapped
  });

  const read = await service.getForUser(OWNER, created.id);

  // Pasa la verificación entera. Ésa es exactamente la limitación.
  assert.equal(read.definition.objectiveContext, 'REQUISITOS SUSTITUIDOS');
  assert.equal(read.definition.requirements.length, 1);
});

// ---------------------------------------------------------------------------
// Superficie del servicio
// ---------------------------------------------------------------------------

test('surface: there is no generic update, no delete, no publish, no share', () => {
  // Una fila finalizada no se edita. Que no exista el método es la garantía;
  // un test que sólo comprobara "no lo llamamos" no diría nada.
  const surface = Object.getOwnPropertyNames(ObjectivesService.prototype)
    .filter((name) => name !== 'constructor')
    .filter((name) => !name.startsWith('_'));

  assert.deepEqual(surface.sort(), [
    'createForUser',
    'createRevisionForUser',
    'getForUser',
    'listForUser',
    'normalizeTitle',
    'toVerifiedObjective'
  ]);
  for (const forbidden of ['update', 'delete', 'publish', 'share', 'archive']) {
    assert.ok(
      !surface.some((name) => name.toLowerCase().includes(forbidden)),
      `no debe existir una operación ${forbidden}`
    );
  }
});

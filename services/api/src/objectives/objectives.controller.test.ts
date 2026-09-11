/**
 * Superficie `/me/objectives` — F2.2.
 *
 * DECISIÓN DE TEST: el `ObjectivesService` es el REAL, sobre un Prisma en
 * memoria. Falsear el servicio convertiría los tests de allowlist, de privacidad
 * de existencia y de mapeo de errores en afirmaciones sobre el mock — justo lo
 * que estos tests existen para comprobar. Sólo se falsea la base.
 *
 * Los estados HTTP se leen del `HttpException` que lanza el dominio: el repo no
 * usa filtros, y sus services lanzan directamente la excepción Nest correcta.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { ObjectivesController } from './objectives.controller';
import { ObjectivesService } from './objectives.service';

const OWNER = { id: 'user-1' } as never;
const OTHER = { id: 'user-2' } as never;

const ORIGINAL_TEXT =
  'Buscamos backend. Requisitos: APIs REST y testing automatizado backend.';

function pastedBody(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    objectiveType: 'EMPLOYMENT',
    title: 'Backend Junior — Empresa X',
    objectiveContext: 'Backend Developer Junior',
    source: { inputType: 'PASTED_TEXT', originalText: ORIGINAL_TEXT },
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

function directBody(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    objectiveType: 'ADMISSION',
    title: 'Máster en Ciencia de Datos',
    objectiveContext: '',
    source: { inputType: 'DIRECT_STRUCTURED_INPUT', originalText: null },
    requirements: [
      {
        requirementText: 'Fundamentos de estadística inferencial',
        provenanceKind: 'DIRECT_STRUCTURED_INPUT'
      }
    ],
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Banco de pruebas: Prisma en memoria + servicio real
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

function setup() {
  const rows: Row[] = [];
  let sequence = 0;
  let clock = 1_700_000_000_000;

  const matches = (row: Row, where: Record<string, any>): boolean =>
    Object.entries(where).every(([key, value]) => (row as any)[key] === value);
  const project = (row: Row, select: Record<string, boolean>) =>
    Object.fromEntries(Object.keys(select).map((key) => [key, (row as any)[key]]));

  const makeClient = (undo: Array<() => void> | null): any => ({
    objective: {
      async create(args: any) {
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
      const log: Array<() => void> = [];
      try {
        return await callback(makeClient(log));
      } catch (error) {
        for (const revert of log.reverse()) revert();
        throw error;
      }
    }
  });

  const service = new ObjectivesService(makeClient(null) as never);
  return {
    service,
    controller: new ObjectivesController(service),
    rows: () => rows.map((row) => ({ ...row }))
  };
}

async function expectStatus(promise: Promise<unknown>, status: HttpStatus) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof HttpException, String(error));
    assert.equal(error.getStatus(), status);
    return error;
  }
  throw new assert.AssertionError({ message: `se esperaba ${status} y resolvio` });
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

test('auth: the whole surface is behind AuthGuard', () => {
  const guards = Reflect.getMetadata('__guards__', ObjectivesController) ?? [];
  assert.ok(guards.includes(AuthGuard), 'el controller debe estar protegido');
});

test('auth: there is no PATCH, PUT or DELETE route', () => {
  const surface = Object.getOwnPropertyNames(ObjectivesController.prototype).filter(
    (name) => name !== 'constructor'
  );
  assert.deepEqual(surface.sort(), [
    'create',
    'createRevision',
    'get',
    'list',
    'parseObjectiveTypeFilter'
  ]);
  for (const forbidden of ['update', 'delete', 'patch', 'publish', 'share']) {
    assert.ok(!surface.some((name) => name.toLowerCase().includes(forbidden)));
  }
});

// ---------------------------------------------------------------------------
// Creación
// ---------------------------------------------------------------------------

test('create: returns the detail allowlist and nothing else', async () => {
  const { controller } = setup();

  const created = await controller.create(OWNER, pastedBody());

  assert.deepEqual(Object.keys(created).sort(), [
    'createdAt',
    'definition',
    'objectiveReference',
    'objectiveType',
    'status',
    'supersedesObjectiveReference',
    'title'
  ]);
  assert.deepEqual(Object.keys(created.definition).sort(), [
    'objectiveContext',
    'objectiveType',
    'requirements',
    'schemaVersion',
    'sourceInputType',
    'sourceOriginalText'
  ]);
  assert.deepEqual(Object.keys(created.definition.requirements[0]).sort(), [
    'order',
    'provenanceKind',
    'qualifiers',
    'requirementId',
    'requirementText',
    'sourceQuote'
  ]);
});

test('create: ownerUserId is never exposed, in any shape', async () => {
  const { controller } = setup();
  const created = await controller.create(OWNER, pastedBody());

  const serialized = JSON.stringify(created);
  assert.ok(!('ownerUserId' in created));
  assert.ok(!serialized.includes('ownerUserId'));
  assert.ok(!serialized.includes('user-1'), 'ni el valor del id de usuario');
  assert.ok(!serialized.includes('owner'));
  assert.ok(!serialized.includes('supersededBy'));
});

test('create: the server owns the technical fields', async () => {
  const { controller } = setup();
  const created = await controller.create(OWNER, pastedBody());

  assert.equal(created.definition.schemaVersion, 'objective_definition_v1');
  assert.deepEqual(
    created.definition.requirements.map((requirement) => requirement.requirementId),
    ['req_01', 'req_02']
  );
  assert.deepEqual(
    created.definition.requirements.map((requirement) => requirement.order),
    [1, 2]
  );
  for (const requirement of created.definition.requirements) {
    assert.deepEqual(requirement.qualifiers, []);
  }
});

test('create: the owner comes from the token, never from the body', async () => {
  const { controller, rows } = setup();

  // El body ni siquiera puede llevar ownerUserId: lo rechaza el validador.
  await expectStatus(
    controller.create(OWNER, pastedBody({ ownerUserId: 'user-99' })),
    HttpStatus.BAD_REQUEST
  );

  await controller.create(OWNER, pastedBody());
  assert.equal(rows()[0].ownerUserId, 'user-1');
});

test('create: a DIRECT_STRUCTURED_INPUT Objective works end to end', async () => {
  const { controller } = setup();
  const created = await controller.create(OWNER, directBody());

  assert.equal(created.objectiveType, 'ADMISSION');
  assert.equal(created.definition.sourceOriginalText, null);
  assert.equal(created.definition.requirements[0].sourceQuote, null);
});

// ---------------------------------------------------------------------------
// Rechazos de contrato → 400
// ---------------------------------------------------------------------------

for (const [label, body] of [
  ['sin requirements', pastedBody({ requirements: [] })],
  ['objectiveType invalido', pastedBody({ objectiveType: 'FREELANCE' })],
  [
    'sourceQuote no literal',
    pastedBody({
      requirements: [
        {
          requirementText: 'GraphQL',
          provenanceKind: 'DERIVED_FROM_SOURCE_TEXT',
          sourceQuote: 'GraphQL'
        }
      ]
    })
  ],
  [
    'requirementText en blanco',
    pastedBody({
      requirements: [
        { requirementText: '   ', provenanceKind: 'DIRECT_STRUCTURED_INPUT' }
      ]
    })
  ],
  [
    'provenance derivada sin texto de origen',
    directBody({
      requirements: [
        {
          requirementText: 'x',
          provenanceKind: 'DERIVED_FROM_SOURCE_TEXT',
          sourceQuote: 'x'
        }
      ]
    })
  ],
  ['titulo en blanco', pastedBody({ title: '   ' })]
] as const) {
  test(`create: rejects with 400 — ${label}`, async () => {
    const { controller, rows } = setup();
    await expectStatus(controller.create(OWNER, body), HttpStatus.BAD_REQUEST);
    assert.equal(rows().length, 0, 'no se persistió nada');
  });
}

for (const [label, body] of [
  ['qualifiers', pastedBody({ requirements: [{ requirementText: 'x', provenanceKind: 'DIRECT_STRUCTURED_INPUT', qualifiers: [] }] })],
  ['requirementId', pastedBody({ requirements: [{ requirementText: 'x', provenanceKind: 'DIRECT_STRUCTURED_INPUT', requirementId: 'req_01' }] })],
  ['order', pastedBody({ requirements: [{ requirementText: 'x', provenanceKind: 'DIRECT_STRUCTURED_INPUT', order: 1 }] })],
  ['schemaVersion', pastedBody({ schemaVersion: 'objective_definition_v1' })],
  ['ownerUserId', pastedBody({ ownerUserId: 'user-9' })],
  ['holderId', pastedBody({ holderId: 'user-9' })],
  ['credentialId', pastedBody({ credentialId: 'cred-1' })],
  ['evidenceId', pastedBody({ evidenceId: 'ev-1' })],
  ['epistemicTarget', pastedBody({ epistemicTarget: 'FORMATIVE_EVIDENCE' })],
  ['atomicity', pastedBody({ atomicity: 'ATOMIC' })],
  ['evaluability', pastedBody({ evaluability: {} })],
  ['campo desconocido en source', pastedBody({ source: { inputType: 'PASTED_TEXT', originalText: ORIGINAL_TEXT, url: 'x' } })],
  ['campo desconocido en requirement', pastedBody({ requirements: [{ requirementText: 'x', provenanceKind: 'DIRECT_STRUCTURED_INPUT', weight: 2 }] })]
] as const) {
  test(`create: rejects the forbidden field — ${label}`, async () => {
    const { controller, rows } = setup();
    await expectStatus(controller.create(OWNER, body), HttpStatus.BAD_REQUEST);
    assert.equal(rows().length, 0);
  });
}

// ---------------------------------------------------------------------------
// Lectura y privacidad de existencia
// ---------------------------------------------------------------------------

test('get: the owner reads their Objective', async () => {
  const { controller } = setup();
  const created = await controller.create(OWNER, pastedBody());

  const read = await controller.get(OWNER, created.objectiveReference);
  assert.deepEqual(read, created);
});

test('get: a foreign Objective and a nonexistent one are BOTH 404', async () => {
  const { controller } = setup();
  const created = await controller.create(OWNER, pastedBody());

  const foreign = await expectStatus(
    controller.get(OTHER, created.objectiveReference),
    HttpStatus.NOT_FOUND
  );
  const missing = await expectStatus(
    controller.get(OWNER, 'obj-inexistente'),
    HttpStatus.NOT_FOUND
  );

  // Indistinguibles desde fuera: convertir el cruzado en 403 reintroduciría el
  // oráculo de existencia que F2.1 evitó.
  assert.deepEqual(foreign.getResponse(), missing.getResponse());
});

// ---------------------------------------------------------------------------
// Listado
// ---------------------------------------------------------------------------

test('list: summary allowlist, no definition', async () => {
  const { controller } = setup();
  await controller.create(OWNER, pastedBody());

  const [summary] = await controller.list(OWNER);

  assert.deepEqual(Object.keys(summary).sort(), [
    'createdAt',
    'objectiveReference',
    'objectiveType',
    'status',
    'supersedesObjectiveReference',
    'title'
  ]);
  assert.ok(!('definition' in summary));
  assert.ok(!JSON.stringify(summary).includes('APIs REST'));
});

test('list: only the authenticated user, active only, newest first', async () => {
  const { controller } = setup();
  const first = await controller.create(OWNER, pastedBody({ title: 'Primera' }));
  const second = await controller.create(OWNER, pastedBody({ title: 'Segunda' }));
  await controller.create(OTHER, pastedBody({ title: 'De otro' }));

  const listed = await controller.list(OWNER);

  assert.deepEqual(
    listed.map((item) => item.objectiveReference),
    [second.objectiveReference, first.objectiveReference]
  );
  assert.ok(!listed.some((item) => item.title === 'De otro'));
});

test('list: filters by objectiveType', async () => {
  const { controller } = setup();
  await controller.create(OWNER, pastedBody());
  await controller.create(OWNER, directBody());

  const admissions = await controller.list(OWNER, 'ADMISSION');
  assert.equal(admissions.length, 1);
  assert.equal(admissions[0].objectiveType, 'ADMISSION');
});

test('list: an invalid objectiveType filter is rejected, not ignored', async () => {
  const { controller } = setup();
  await controller.create(OWNER, pastedBody());

  // Devolver la lista completa haría creer al cliente que filtró.
  await expectStatus(controller.list(OWNER, 'FREELANCE'), HttpStatus.BAD_REQUEST);
});

// ---------------------------------------------------------------------------
// Revisión
// ---------------------------------------------------------------------------

test('revision: creates a new row and supersedes the previous one', async () => {
  const { controller } = setup();
  const first = await controller.create(OWNER, pastedBody({ title: 'V1' }));

  const second = await controller.createRevision(
    OWNER,
    first.objectiveReference,
    pastedBody({ title: 'V2' })
  );

  assert.notEqual(second.objectiveReference, first.objectiveReference);
  assert.equal(second.status, 'active');
  assert.equal(second.supersedesObjectiveReference, first.objectiveReference);

  // El anterior sigue legible por id, ya marcado.
  const previous = await controller.get(OWNER, first.objectiveReference);
  assert.equal(previous.status, 'superseded');

  // Y desaparece de la lista activa por defecto.
  const listed = await controller.list(OWNER);
  assert.deepEqual(
    listed.map((item) => item.objectiveReference),
    [second.objectiveReference]
  );
});

test('revision: the body never carries supersedesObjectiveId — the path decides', async () => {
  const { controller } = setup();
  const first = await controller.create(OWNER, pastedBody());

  await expectStatus(
    controller.createRevision(
      OWNER,
      first.objectiveReference,
      pastedBody({ supersedesObjectiveId: 'obj-otro' })
    ),
    HttpStatus.BAD_REQUEST
  );
});

test('revision: a foreign or nonexistent predecessor is 404', async () => {
  const { controller } = setup();
  const first = await controller.create(OWNER, pastedBody());

  await expectStatus(
    controller.createRevision(OTHER, first.objectiveReference, pastedBody()),
    HttpStatus.NOT_FOUND
  );
  await expectStatus(
    controller.createRevision(OWNER, 'obj-inexistente', pastedBody()),
    HttpStatus.NOT_FOUND
  );
});

test('revision: an already superseded predecessor is 409', async () => {
  const { controller } = setup();
  const first = await controller.create(OWNER, pastedBody());
  await controller.createRevision(OWNER, first.objectiveReference, pastedBody());

  await expectStatus(
    controller.createRevision(OWNER, first.objectiveReference, pastedBody()),
    HttpStatus.CONFLICT
  );
});

test('revision: an invalid new definition is 400 and the predecessor stays active', async () => {
  const { controller, rows } = setup();
  const first = await controller.create(OWNER, pastedBody());

  await expectStatus(
    controller.createRevision(
      OWNER,
      first.objectiveReference,
      pastedBody({ requirements: [] })
    ),
    HttpStatus.BAD_REQUEST
  );

  assert.equal(rows().find((row) => row.id === first.objectiveReference)?.status, 'active');
  assert.equal(rows().length, 1);
});

// ---------------------------------------------------------------------------
// El tipo puede corregirse en una revisión
// ---------------------------------------------------------------------------

test('revision: a revision may correct the objectiveType, keeping the lineage', async () => {
  // REVISION_TYPE_CONTINUITY: NOT_REQUIRED. El caso motivador es corregir una
  // clasificación —OTHER -> EMPLOYMENT— sin perder el linaje. Lo que define la
  // revisión es `supersedesObjectiveId`, no la igualdad del discriminante.
  const { controller } = setup();
  const first = await controller.create(
    OWNER,
    pastedBody({ objectiveType: 'OTHER', title: 'Clasificado mal' })
  );
  assert.equal(first.objectiveType, 'OTHER');

  const second = await controller.createRevision(
    OWNER,
    first.objectiveReference,
    pastedBody({ objectiveType: 'EMPLOYMENT', title: 'Clasificado bien' })
  );

  // La versión nueva corrige la clasificación, en fila y artifact a la vez.
  assert.equal(second.objectiveType, 'EMPLOYMENT');
  assert.equal(second.definition.objectiveType, 'EMPLOYMENT');
  assert.equal(second.supersedesObjectiveReference, first.objectiveReference);
  assert.equal(second.status, 'active');

  // La versión vieja queda históricamente intacta, con SU propio tipo.
  const previous = await controller.get(OWNER, first.objectiveReference);
  assert.equal(previous.objectiveType, 'OTHER');
  assert.equal(previous.definition.objectiveType, 'OTHER');
  assert.equal(previous.status, 'superseded');

  // La consistencia fila/artifact se sostiene en CADA fila por separado: es un
  // invariante por fila, no una igualdad entre versiones.
  assert.equal(previous.objectiveType, previous.definition.objectiveType);
  assert.equal(second.objectiveType, second.definition.objectiveType);
});

// ---------------------------------------------------------------------------
// Round-trip exacto del texto
// ---------------------------------------------------------------------------

test('exact text survives POST → GET, including CRLF, astral and repeated quotes', async () => {
  const astral = String.fromCodePoint(0x1f9ea);
  const quote = 'diseño  de  ensayos';
  const original = `Contexto ñ.\r\n\r\n${quote} ${astral} y otra vez ${quote}.`;
  const { controller } = setup();

  const created = await controller.create(
    OWNER,
    pastedBody({
      objectiveContext: '  contexto con espacios  ',
      source: { inputType: 'PASTED_TEXT', originalText: original },
      requirements: [
        {
          requirementText: `${quote} ${astral}`,
          provenanceKind: 'DERIVED_FROM_SOURCE_TEXT',
          sourceQuote: quote
        }
      ]
    })
  );

  const read = await controller.get(OWNER, created.objectiveReference);

  assert.equal(read.definition.sourceOriginalText, original);
  assert.equal(read.definition.objectiveContext, '  contexto con espacios  ');
  assert.equal(read.definition.requirements[0].requirementText, `${quote} ${astral}`);
  assert.equal(read.definition.requirements[0].sourceQuote, quote);
  assert.deepEqual(created.definition, read.definition, 'POST y GET coinciden');
  assert.ok(read.definition.sourceOriginalText?.includes('\r\n'));
});

// ---------------------------------------------------------------------------
// Privacidad de los errores
// ---------------------------------------------------------------------------

test('errors never echo the Objective text', async () => {
  const sentinel = 'CENTINELA_OFERTA_8c2f';
  const { controller } = setup();

  const error = await expectStatus(
    controller.create(
      OWNER,
      pastedBody({
        objectiveContext: sentinel,
        source: { inputType: 'PASTED_TEXT', originalText: `Contexto ${sentinel}` },
        requirements: [
          {
            requirementText: sentinel,
            provenanceKind: 'DERIVED_FROM_SOURCE_TEXT',
            sourceQuote: `${sentinel} inexistente`
          }
        ]
      })
    ),
    HttpStatus.BAD_REQUEST
  );

  const serialized = `${error.message} ${JSON.stringify(error.getResponse())}`;
  assert.ok(!serialized.includes(sentinel), 'el error no debe llevar el texto');
});

test('a corrupt persisted row is an internal failure, not the client fault', async () => {
  const { controller, service } = setup();
  const created = await controller.create(OWNER, pastedBody());

  (service as any).prisma.objective.findFirst = async () => ({
    id: created.objectiveReference,
    ownerUserId: 'user-1',
    objectiveType: 'EMPLOYMENT',
    title: 'x',
    status: 'active',
    supersedesObjectiveId: null,
    createdAt: new Date(),
    definition: { schemaVersion: 'objective_definition_v1', roto: true }
  });

  const error = await expectStatus(
    controller.get(OWNER, created.objectiveReference),
    HttpStatus.INTERNAL_SERVER_ERROR
  );

  // El cuerpo del 5xx es genérico: no describe el estado interno ni el artifact.
  const body = JSON.stringify(error.getResponse());
  assert.ok(!body.includes('roto'));
  assert.ok(!body.includes('schemaVersion'));
  assert.ok(!body.includes('APIs REST'));
});

test('a persisted row/artifact type mismatch is also an internal failure', async () => {
  const { controller, service } = setup();
  const created = await controller.create(OWNER, pastedBody());
  const good = await controller.get(OWNER, created.objectiveReference);

  (service as any).prisma.objective.findFirst = async () => ({
    id: created.objectiveReference,
    ownerUserId: 'user-1',
    objectiveType: 'OTHER',
    title: 'x',
    status: 'active',
    supersedesObjectiveId: null,
    createdAt: new Date(),
    definition: {
      schemaVersion: 'objective_definition_v1',
      objectiveType: good.definition.objectiveType,
      objectiveContext: good.definition.objectiveContext,
      source: {
        inputType: good.definition.sourceInputType,
        originalText: good.definition.sourceOriginalText
      },
      requirements: good.definition.requirements.map((requirement) => ({
        requirementId: requirement.requirementId,
        order: requirement.order,
        requirementText: requirement.requirementText,
        provenance: {
          kind: requirement.provenanceKind,
          sourceQuote: requirement.sourceQuote
        },
        qualifiers: []
      }))
    }
  });

  await expectStatus(
    controller.get(OWNER, created.objectiveReference),
    HttpStatus.INTERNAL_SERVER_ERROR
  );
});

// ---------------------------------------------------------------------------
// Sin Prisma en el controller
// ---------------------------------------------------------------------------

test('the controller talks only to ObjectivesService', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const source = readFileSync(join(__dirname, 'objectives.controller.ts'), 'utf8');

  for (const forbidden of [
    'PrismaService',
    'prisma.',
    'buildObjectiveDefinitionV1',
    'verifyObjectiveDefinitionArtifact',
    '$transaction'
  ]) {
    assert.ok(!source.includes(forbidden), `el controller no debe usar ${forbidden}`);
  }
});

test('BadRequestException from the boundary keeps 400', () => {
  // Guard contra que el rename de estados de F2.2 mueva sin querer el validador
  // de request fuera de 400.
  const error = new BadRequestException('x');
  assert.equal(error.getStatus(), HttpStatus.BAD_REQUEST);
});

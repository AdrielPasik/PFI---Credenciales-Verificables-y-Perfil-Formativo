/**
 * Frontera HTTP estricta de `/me/objectives` — F2.2.
 *
 * Lo que se prueba aquí es que un campo que el cliente no puede aportar sea
 * RECHAZADO, no ignorado en silencio. Que el builder interno también los ignore
 * es defensa en profundidad, no la política.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException } from '@nestjs/common';

import { mapCreateObjectiveRequest } from './objective-request.validator';

const ORIGINAL_TEXT = 'Buscamos backend. Requisitos: APIs REST y testing automatizado.';

function validPastedBody(): Record<string, any> {
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
      }
    ]
  };
}

function validDirectBody(): Record<string, any> {
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
    ]
  };
}

function expectRejection(body: unknown, messagePattern?: RegExp) {
  try {
    mapCreateObjectiveRequest(body);
  } catch (error) {
    assert.ok(error instanceof BadRequestException, String(error));
    if (messagePattern) assert.match(String(error.message), messagePattern);
    return error;
  }
  throw new assert.AssertionError({ message: 'se esperaba un rechazo y fue aceptado' });
}

// ---------------------------------------------------------------------------
// Requests válidos
// ---------------------------------------------------------------------------

test('accepts a PASTED_TEXT body and maps it to the builder input', () => {
  const mapped = mapCreateObjectiveRequest(validPastedBody());

  assert.equal(mapped.title, 'Backend Junior — Empresa X');
  assert.equal(mapped.definition.objectiveType, 'EMPLOYMENT');
  assert.equal(mapped.definition.sourceInputType, 'PASTED_TEXT');
  assert.equal(mapped.definition.sourceOriginalText, ORIGINAL_TEXT);
  assert.equal(mapped.definition.requirements.length, 1);
  assert.equal(mapped.definition.requirements[0].sourceQuote, 'APIs REST');
});

test('accepts a DIRECT_STRUCTURED_INPUT body, with sourceQuote omitted', () => {
  const mapped = mapCreateObjectiveRequest(validDirectBody());

  assert.equal(mapped.definition.sourceOriginalText, null);
  assert.equal(mapped.definition.requirements[0].sourceQuote, null);
});

test('the mapped input carries no qualifiers field at all', () => {
  const mapped = mapCreateObjectiveRequest(validPastedBody());

  assert.deepEqual(Object.keys(mapped.definition).sort(), [
    'objectiveContext',
    'objectiveType',
    'requirements',
    'sourceInputType',
    'sourceOriginalText'
  ]);
  assert.deepEqual(Object.keys(mapped.definition.requirements[0]).sort(), [
    'provenanceKind',
    'requirementText',
    'sourceQuote'
  ]);
});

// ---------------------------------------------------------------------------
// El servidor es dueño de los campos técnicos
// ---------------------------------------------------------------------------

for (const key of ['schemaVersion', 'definition', 'status', 'supersedesObjectiveId', 'createdAt', 'id'] as const) {
  test(`rejects the server-owned root field ${key}`, () => {
    const body = validPastedBody();
    body[key] = 'lo-que-sea';
    expectRejection(body, /lo establece el servidor/);
  });
}

for (const key of ['requirementId', 'order', 'qualifiers'] as const) {
  test(`rejects the server-owned requirement field ${key}`, () => {
    const body = validPastedBody();
    body.requirements[0][key] = key === 'order' ? 1 : 'x';
    expectRejection(body, /lo establece el servidor/);
  });
}

test('rejects qualifiers even when empty — the field simply does not exist', () => {
  // `objective_definition_v1` exige []. El cliente no lo manda: lo pone el
  // servidor. Aceptar `[]` "porque coincide" enseñaría un contrato que no es.
  const body = validPastedBody();
  body.requirements[0].qualifiers = [];
  expectRejection(body, /qualifiers lo establece el servidor/);
});

// ---------------------------------------------------------------------------
// La autoridad sale del token
// ---------------------------------------------------------------------------

for (const key of ['ownerUserId', 'userId', 'holderId', 'subjectUserId', 'issuerId'] as const) {
  test(`rejects the authority field ${key}`, () => {
    const body = validPastedBody();
    body[key] = 'user-99';
    expectRejection(body, /la identidad sale del token/);
  });
}

// ---------------------------------------------------------------------------
// Fronteras epistémicas
// ---------------------------------------------------------------------------

for (const key of [
  'credentialId',
  'credentialIds',
  'evidenceId',
  'evidenceUnits',
  'analysisRunId',
  'epistemicTarget',
  'atomicity',
  'evaluability',
  'objectiveAnalysisStatus',
  'facets'
] as const) {
  test(`rejects the out-of-contract field ${key}`, () => {
    const body = validPastedBody();
    body[key] = 'x';
    expectRejection(body, /no forma parte del contrato de un Objective/);
  });
}

test('rejects Objective Analysis fields nested in a requirement too', () => {
  const body = validPastedBody();
  body.requirements[0].epistemicTarget = 'FORMATIVE_EVIDENCE';
  expectRejection(body, /no forma parte del contrato de un Objective/);
});

// ---------------------------------------------------------------------------
// Campos desconocidos
// ---------------------------------------------------------------------------

test('rejects an unknown root field', () => {
  const body = validPastedBody();
  body.notes = 'algo';
  expectRejection(body, /no forma parte del contrato publico/);
});

test('rejects an unknown nested source field', () => {
  const body = validPastedBody();
  body.source.url = 'https://ejemplo';
  expectRejection(body, /body\.source\.url/);
});

test('rejects an unknown requirement field', () => {
  const body = validPastedBody();
  body.requirements[0].weight = 3;
  expectRejection(body, /body\.requirements\[0\]\.weight/);
});

// ---------------------------------------------------------------------------
// Forma
// ---------------------------------------------------------------------------

test('rejects a non-object body', () => {
  for (const body of [null, 'texto', 42, []]) {
    expectRejection(body, /debe ser un objeto/);
  }
});

test('rejects an objectiveType outside the closed set', () => {
  const body = validPastedBody();
  body.objectiveType = 'FREELANCE';
  expectRejection(body, /body\.objectiveType/);
});

test('rejects a provenanceKind outside the closed set', () => {
  const body = validPastedBody();
  body.requirements[0].provenanceKind = 'AI_PROPOSED';
  expectRejection(body, /provenanceKind/);
});

test('rejects a non-string title and a non-string context', () => {
  expectRejection({ ...validPastedBody(), title: 42 }, /body\.title/);
  expectRejection({ ...validPastedBody(), objectiveContext: null }, /body\.objectiveContext/);
});

test('rejects a non-array requirements', () => {
  expectRejection({ ...validPastedBody(), requirements: {} }, /debe ser un array/);
});

test('rejects a source that is not an object', () => {
  expectRejection({ ...validPastedBody(), source: 'PASTED_TEXT' }, /body\.source/);
});

test('rejects an originalText that is neither string nor null', () => {
  const body = validPastedBody();
  body.source.originalText = 42;
  expectRejection(body, /string o null/);
});

// ---------------------------------------------------------------------------
// Sin transformaciones
// ---------------------------------------------------------------------------

test('preserves strings exactly — no trim, no NFC, no newline rewriting', () => {
  const messy = '  Requisito con  espacios\r\ny CRLF  ';
  const body = validPastedBody();
  body.title = '  Título con espacios  ';
  body.objectiveContext = '  contexto  ';
  body.source.originalText = `Prefacio ${messy} cierre`;
  body.requirements = [
    {
      requirementText: messy,
      provenanceKind: 'DERIVED_FROM_SOURCE_TEXT',
      sourceQuote: messy
    }
  ];

  const mapped = mapCreateObjectiveRequest(body);

  assert.equal(mapped.title, '  Título con espacios  ');
  assert.equal(mapped.definition.objectiveContext, '  contexto  ');
  assert.equal(mapped.definition.requirements[0].requirementText, messy);
  assert.equal(mapped.definition.requirements[0].sourceQuote, messy);
  assert.ok(mapped.definition.sourceOriginalText?.includes('\r\n'));
});

test('the HTTP boundary does NOT duplicate the deep semantics of F2.1', () => {
  // Un `sourceQuote` que no está en el texto pasa el validador de request: esa
  // comprobación tiene UNA sola autoridad y vive en F2.1. Duplicarla aquí
  // crearía dos verdades que se pueden desincronizar.
  const body = validPastedBody();
  body.requirements[0].sourceQuote = 'GraphQL que no aparece';

  const mapped = mapCreateObjectiveRequest(body);
  assert.equal(mapped.definition.requirements[0].sourceQuote, 'GraphQL que no aparece');
});

test('an empty requirements array passes the boundary and is rejected by F2.1', () => {
  // Mismo criterio: "al menos un Requirement" es semántica del artifact.
  const mapped = mapCreateObjectiveRequest({ ...validPastedBody(), requirements: [] });
  assert.deepEqual(mapped.definition.requirements, []);
});

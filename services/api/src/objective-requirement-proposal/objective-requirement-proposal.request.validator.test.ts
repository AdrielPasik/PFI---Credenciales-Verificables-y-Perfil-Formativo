/**
 * Validador del request — slice P2.2.
 *
 * El punto central: el texto crudo llega al AI service EXACTAMENTE como se envió.
 * Cualquier trim, NFC o arreglo de fines de línea desplazaría cada offset del
 * artefacto, y el desplazamiento sería silencioso.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_OBJECTIVE_CHARACTERS } from './objective-requirement-proposal.contract';
import { ObjectiveRequirementProposalError } from './objective-requirement-proposal.errors';
import {
  mapObjectiveRequirementProposalRequest
} from './objective-requirement-proposal.request.validator';

const RAW = '- Experiencia minima de 3 anos.\n';

function body(overrides: Record<string, unknown> = {}): unknown {
  return { objectiveType: 'EMPLOYMENT', title: 'Titulo', rawObjectiveText: RAW, ...overrides };
}

function expectRejection(input: unknown, detail: string, code = 'INVALID_OBJECTIVE_INPUT'): void {
  assert.throws(
    () => mapObjectiveRequirementProposalRequest(input),
    (error: unknown) => {
      assert.ok(error instanceof ObjectiveRequirementProposalError);
      assert.equal(error.code, code);
      assert.match(error.detail, new RegExp(detail));
      return true;
    }
  );
}

test('acepta el cuerpo mínimo y devuelve exactamente tres campos', () => {
  const input = mapObjectiveRequirementProposalRequest(body());
  assert.deepEqual(Object.keys(input).sort(), [
    'objectiveType',
    'rawObjectiveText',
    'title'
  ]);
});

test('preserva el texto crudo byte a byte: sin trim, sin NFC, sin tocar CRLF', () => {
  const raw = '  \r\n- Titulo universitario.\r\n\r\n  ';
  const input = mapObjectiveRequirementProposalRequest(body({ rawObjectiveText: raw }));
  assert.equal(input.rawObjectiveText, raw);

  // Composición Unicode: "é" precompuesta vs. descompuesta son textos distintos y
  // deben seguir siéndolo. Normalizar cambiaría la cuenta de code points.
  const precompuesta = 'Requisito: gestión de equipos.';
  const descompuesta = 'Requisito: gestión de equipos.';
  assert.notEqual(precompuesta, descompuesta);
  assert.equal(
    mapObjectiveRequirementProposalRequest(body({ rawObjectiveText: descompuesta }))
      .rawObjectiveText,
    descompuesta
  );
});

test('rechaza cualquier clave fuera de la allowlist', () => {
  expectRejection(body({ cualquierCosa: 1 }), 'unknown_field:cualquierCosa');
  // La allowlist no depende de la lista explícita: una clave inventada cae igual.
  expectRejection(body({ schemaVersion: 'v1' }), 'unknown_field:schemaVersion');
});

test('nombra explícitamente las claves de holder y de ejecución', () => {
  for (const campo of [
    'ownerUserId',
    'userId',
    'holderId',
    'subjectUserId',
    'credentials',
    'profile',
    'skills',
    'evidenceUnits',
    'reasoningRunId',
    'objectiveId',
    'provider',
    'model',
    'requestedModel',
    'reasoningEffort',
    'promptVersion',
    'candidates',
    'candidateId'
  ]) {
    expectRejection(body({ [campo]: 'x' }), `forbidden_field:${campo}`);
  }
});

test('rechaza un cuerpo que no es objeto', () => {
  for (const invalido of [null, 'texto', 42, [], undefined]) {
    expectRejection(invalido, 'body_not_an_object');
  }
});

test('rechaza un objectiveType que no existe en el enum', () => {
  expectRejection(body({ objectiveType: 'TRABAJO' }), 'objective_type_invalid');
  expectRejection(body({ objectiveType: undefined }), 'objective_type_invalid');
});

test('acepta los cuatro tipos reales y OTHER', () => {
  for (const tipo of ['EMPLOYMENT', 'SCHOLARSHIP', 'ADMISSION', 'EQUIVALENCE', 'OTHER']) {
    const input = mapObjectiveRequirementProposalRequest(body({ objectiveType: tipo }));
    assert.equal(input.objectiveType, tipo);
  }
});

test('el título es opcional: un Objective sin título es legítimo', () => {
  const sinTitulo = mapObjectiveRequirementProposalRequest(body({ title: undefined }));
  assert.equal(sinTitulo.title, '');
  const vacio = mapObjectiveRequirementProposalRequest(body({ title: '' }));
  assert.equal(vacio.title, '');
});

test('rechaza un título que no es string o desmedido', () => {
  expectRejection(body({ title: 7 }), 'title_not_a_string');
  expectRejection(body({ title: 'x'.repeat(501) }), 'title_too_long');
});

test('rechaza un texto crudo ausente, no-string o en blanco', () => {
  expectRejection(body({ rawObjectiveText: undefined }), 'raw_objective_text_not_a_string');
  expectRejection(body({ rawObjectiveText: 123 }), 'raw_objective_text_not_a_string');
  for (const blanco of ['', '   ', '\n\t  \r\n']) {
    expectRejection(body({ rawObjectiveText: blanco }), 'raw_objective_text_empty');
  }
});

test('el límite se mide en code points, no en unidades UTF-16', () => {
  // Un emoji fuera del BMP pesa 2 unidades UTF-16. Medir con `.length` rechazaría
  // textos que sí entran en una sola llamada.
  const justoEnElLimite = '🙂'.repeat(MAX_OBJECTIVE_CHARACTERS);
  assert.equal(justoEnElLimite.length, MAX_OBJECTIVE_CHARACTERS * 2);
  const input = mapObjectiveRequirementProposalRequest(
    body({ rawObjectiveText: justoEnElLimite })
  );
  assert.equal(Array.from(input.rawObjectiveText).length, MAX_OBJECTIVE_CHARACTERS);

  expectRejection(
    body({ rawObjectiveText: '🙂'.repeat(MAX_OBJECTIVE_CHARACTERS + 1) }),
    'exceeds_single_call_budget',
    'OBJECTIVE_TOO_LARGE'
  );
});

test('un Objective demasiado grande NO se trunca ni se segmenta: se rechaza', () => {
  // Truncar produciría una propuesta parcial que se ve completa, y ése es
  // exactamente el fallo silencioso que el código de error evita.
  expectRejection(
    body({ rawObjectiveText: 'x'.repeat(MAX_OBJECTIVE_CHARACTERS + 1) }),
    'exceeds_single_call_budget',
    'OBJECTIVE_TOO_LARGE'
  );
});

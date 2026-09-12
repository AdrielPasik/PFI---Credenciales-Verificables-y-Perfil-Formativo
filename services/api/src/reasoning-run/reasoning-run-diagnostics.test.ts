/**
 * Evento de diagnostico de fallos del ai-service — P2.4 OBS.
 *
 * El evento existe para poder responder tres preguntas sin reproducir el fallo.
 * Lo que se prueba aca es que responda esas tres y NADA mas: un canal de
 * diagnostico que se vuelva generoso es una fuga con mejor nombre.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { type Logger } from '@nestjs/common';

import {
  REASONING_AI_SERVICE_FAILURE_EVENT,
  logReasoningAiServiceFailure
} from './reasoning-run-diagnostics';

/** Logger falso: solo guarda lo que recibe. */
function fakeLogger(): { logger: Logger; calls: unknown[] } {
  const calls: unknown[] = [];
  const logger = {
    error: (payload: unknown) => calls.push(payload)
  } as unknown as Logger;
  return { logger, calls };
}

test('el evento lleva exactamente los campos previstos', () => {
  const { logger, calls } = fakeLogger();

  logReasoningAiServiceFailure(logger, {
    stage: 'contextual_reasoning',
    operationalCode: 'reasoning_contextual_reasoning_invalid_output',
    upstreamCode: 'PROVIDER_INVALID_OUTPUT',
    upstreamSubcode: 'provider_output_unexpected_keys',
    reasoningRunReference: 'run-1',
    requirementReference: 'req_03'
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    event: REASONING_AI_SERVICE_FAILURE_EVENT,
    stage: 'contextual_reasoning',
    operationalCode: 'reasoning_contextual_reasoning_invalid_output',
    upstreamCode: 'PROVIDER_INVALID_OUTPUT',
    upstreamSubcode: 'provider_output_unexpected_keys',
    reasoningRunReference: 'run-1',
    requirementReference: 'req_03'
  });
});

test('sin Requirement no se inventa la clave', () => {
  // Objective Analysis y Evidence Units son UNA llamada por run: no tienen
  // Requirement al que referirse, y una clave vacia sugeriria que si.
  const { logger, calls } = fakeLogger();

  logReasoningAiServiceFailure(logger, {
    stage: 'evidence_units',
    operationalCode: 'reasoning_evidence_units_invalid_output',
    upstreamCode: 'PROVIDER_INVALID_OUTPUT',
    upstreamSubcode: 'provider_evidence_units_not_a_list',
    reasoningRunReference: 'run-1'
  });

  assert.deepEqual(Object.keys(calls[0] as object).sort(), [
    'event',
    'operationalCode',
    'reasoningRunReference',
    'stage',
    'upstreamCode',
    'upstreamSubcode'
  ]);
});

test('el evento NO transporta contenido de nadie', () => {
  const { logger, calls } = fakeLogger();

  logReasoningAiServiceFailure(logger, {
    stage: 'contextual_reasoning',
    operationalCode: 'reasoning_contextual_reasoning_invalid_output',
    upstreamCode: 'PROVIDER_INVALID_OUTPUT',
    upstreamSubcode: 'provider_output_unexpected_keys',
    reasoningRunReference: 'run-1',
    requirementReference: 'req_03'
  });

  const serialized = JSON.stringify(calls[0]);
  for (const forbidden of [
    'SECRET_API_KEY_SENTINEL',
    'REQUIREMENT_TEXT_SENTINEL',
    'EVIDENCE_TEXT_SENTINEL',
    'RAW_PROVIDER_OUTPUT_SENTINEL',
    'Bearer',
    'Authorization',
    'openai',
    'gpt-',
    'prompt',
    'requirementText',
    'objectiveContext',
    'excerpt',
    'src_',
    'eu_',
    'charStart',
    'sourceSha256',
    'storageKey'
  ]) {
    assert.ok(!serialized.includes(forbidden), `el evento publica "${forbidden}"`);
  }
});

test('la firma no admite un objeto abierto: solo tokens y referencias', () => {
  // Guard de intencion. Si alguien agrega un campo libre al evento, este test
  // se lo va a hacer notar antes de que llegue a un log.
  const { logger, calls } = fakeLogger();

  logReasoningAiServiceFailure(logger, {
    stage: 'objective_analysis',
    operationalCode: 'reasoning_objective_analysis_invalid_output',
    upstreamCode: 'PROVIDER_INVALID_OUTPUT',
    upstreamSubcode: 'requirement_count_mismatch',
    reasoningRunReference: 'run-1'
  });

  for (const value of Object.values(calls[0] as Record<string, unknown>)) {
    assert.equal(typeof value, 'string');
    assert.ok((value as string).length <= 80);
  }
});

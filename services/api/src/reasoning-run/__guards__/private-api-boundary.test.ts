/**
 * Guard estructural de la frontera de la API privada — slice F3.7.
 *
 * Los tests de comportamiento comprueban que HOY la ejecución entra por el
 * orquestador. Éste comprueba que SIGA siendo así: se lee el código fuente y se
 * falla si la capa HTTP/aplicación importa una etapa semántica.
 *
 * POR QUÉ IMPORTA. Si mañana alguien llamara a `ensureObjectiveAnalysisForRun`
 * desde el controller para "adelantar trabajo", se saltaría la claim exclusiva y
 * dos peticiones concurrentes podrían comprar las mismas observaciones del
 * proveedor. La exclusión mutua vive en `executeReasoningRun`, así que ése tiene
 * que seguir siendo el único camino.
 *
 * Mismo estilo que `source-extraction/__guards__/`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(__dirname, '..');

const read = (file: string): string => readFileSync(join(DIR, file), 'utf8');

/**
 * El codigo SIN comentarios.
 *
 * Los archivos de esta capa documentan explicitamente que NO exponen
 * `executionMetadata`, el proveedor ni el plan — y esa prosa es justamente lo que
 * queremos conservar. Un guard que buscara el token en el archivo entero
 * castigaria la documentacion en vez de la fuga: lo que importa es si el simbolo
 * se USA, no si se lo nombra para decir que no se usa.
 */
function readCode(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

/** Los módulos de etapa semántica y la policy pura. */
const FORBIDDEN_MODULES = [
  './reasoning-run-objective-analysis.service',
  './reasoning-run-evidence-units.service',
  './reasoning-run-contextual-reasoning.service',
  './deterministic-epistemic-policy',
  './reasoning-run-execution-claim.service'
];

/** Los símbolos que ejecutan una etapa o aplican la policy. */
const FORBIDDEN_SYMBOLS = [
  'ensureObjectiveAnalysisForRun',
  'ensureEvidenceUnitsForRun',
  'generateContextualReasoningForRun',
  'applyDeterministicReasoningPolicy',
  'ReasoningRunExecutionClaim'
];

const API_LAYER = [
  'reasoning-runs.controller.ts',
  'reasoning-run-private.service.ts',
  'reasoning-run.mapper.ts',
  'reasoning-run-request.validator.ts'
];

test('la capa de API no importa ninguna etapa semantica', () => {
  for (const file of API_LAYER) {
    const source = readCode(file);
    for (const module of FORBIDDEN_MODULES) {
      assert.ok(
        !source.includes(`from '${module}'`),
        `${file} importa ${module}`
      );
    }
  }
});

test('la capa de API no nombra ninguna operacion de etapa', () => {
  for (const file of API_LAYER) {
    const source = readCode(file);
    for (const symbol of FORBIDDEN_SYMBOLS) {
      assert.ok(!source.includes(symbol), `${file} usa ${symbol}`);
    }
  }
});

test('la ejecucion entra EXCLUSIVAMENTE por el orquestador', () => {
  const source = readCode('reasoning-run-private.service.ts');
  assert.ok(source.includes('executeReasoningRun'));

  // Una sola llamada en todo el archivo: no hay un segundo camino de ejecución.
  const calls = source.match(/\.executeReasoningRun\(/g) ?? [];
  assert.equal(calls.length, 1);
});

test('la capa de API no conoce proveedor, modelo ni plan', () => {
  // Lo que no se nombra no se puede filtrar en una respuesta.
  const forbidden = [
    'openai',
    'OpenAI',
    'promptVersion',
    'adapterVersion',
    'reasoningEffort',
    'ai_service_error_v1',
    'AiServiceClient',
    'PROVIDER_TRANSPORT_FAILURE:',
    'executionMetadata'
  ];
  for (const file of ['reasoning-runs.controller.ts', 'reasoning-run.mapper.ts']) {
    const source = readCode(file);
    for (const token of forbidden) {
      assert.ok(!source.includes(token), `${file} menciona ${token}`);
    }
  }
});

test('el controller no consulta la base', () => {
  const source = readCode('reasoning-runs.controller.ts');
  for (const token of ['PrismaService', 'prisma.', 'findFirst', 'findMany', 'updateMany']) {
    assert.ok(!source.includes(token), `el controller usa ${token}`);
  }
});

test('la superficie privada no expone mutaciones de recuperacion', () => {
  const source = readCode('reasoning-runs.controller.ts');
  // V1 congeló `NON_RECOVERABLE_RUNNING_CLAIM`: no hay forma segura de rescatar
  // un run varado, así que la API no ofrece una que no puede cumplir.
  for (const token of [
    '@Delete',
    '@Patch',
    '@Put',
    "'retry'",
    "'cancel'",
    "'reset'",
    "'force-complete'",
    'canRecover',
    'forceRetry'
  ]) {
    assert.ok(!source.includes(token), `el controller expone ${token}`);
  }
});

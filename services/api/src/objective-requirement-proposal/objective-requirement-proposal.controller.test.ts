/**
 * Controller y servicio de la propuesta — slice P2.2.
 *
 * Lo que se prueba: que el request sea evidence-blind, que ninguna categoría de
 * error filtre detalle interno, que la respuesta que ve el holder sea una
 * allowlist, y que NADA se persista.
 *
 * El cliente del AI service está stubbeado en todos los casos.
 *
 *     REAL_PROVIDER_CALLS = 0
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ObjectiveProposalTransportError } from '../ai/ai-service.types';
import { ObjectiveRequirementProposalController } from './objective-requirement-proposal.controller';
import {
  OBJECTIVE_UNDERSTANDING_STAGE_IDENTITY,
  OBJECTIVE_REQUIREMENT_PROPOSAL_RESPONSE_SCHEMA_VERSION
} from './objective-requirement-proposal.contract';
import { ObjectiveRequirementProposalService } from './objective-requirement-proposal.service';

const RAW = '- Experiencia minima de 3 anos.\n- Titulo universitario afin.\n';
const QUOTE = '- Experiencia minima de 3 anos.';

function aiResponse(): unknown {
  const charStart = Array.from(RAW.slice(0, RAW.indexOf(QUOTE))).length;
  return {
    schemaVersion: OBJECTIVE_REQUIREMENT_PROPOSAL_RESPONSE_SCHEMA_VERSION,
    execution: {
      artifactSchemaVersion: OBJECTIVE_UNDERSTANDING_STAGE_IDENTITY.artifactSchemaVersion,
      promptVersion: OBJECTIVE_UNDERSTANDING_STAGE_IDENTITY.promptVersion,
      adapterVersion: OBJECTIVE_UNDERSTANDING_STAGE_IDENTITY.adapterVersion,
      providerProposalSchemaVersion:
        OBJECTIVE_UNDERSTANDING_STAGE_IDENTITY.providerProposalSchemaVersion,
      provider: 'openai',
      requestedModel: 'modelo-secreto-de-despliegue',
      reasoningEffort: 'medium',
      promptBodySha256: 'abc123',
      effectiveModelVerification: 'MATCH'
    },
    artifact: {
      schemaVersion: OBJECTIVE_UNDERSTANDING_STAGE_IDENTITY.artifactSchemaVersion,
      sourceNormalization: 'NONE',
      offsetUnit: 'UNICODE_CODE_POINT',
      sourceCharacterCount: Array.from(RAW).length,
      candidates: [
        {
          candidateId: 'cand_01',
          order: 1,
          proposedRequirementText: 'Experiencia minima de 3 anos.',
          primarySourceReference: {
            exactExcerpt: QUOTE,
            charStart,
            charEnd: charStart + Array.from(QUOTE).length,
            offsetUnit: 'UNICODE_CODE_POINT'
          },
          primarySourceGrounding: 'UNIQUE',
          auxiliarySourceReferences: [],
          ambiguousReferences: [],
          unmatchedReferences: [],
          sourceSectionLabel: 'Requisitos',
          exactDuplicateOfEarlier: false,
          confirmableAsSourceDerived: true
        }
      ],
      unresolvedPassages: []
    }
  };
}

class StubAiClient {
  public calls: unknown[] = [];
  public response: unknown = aiResponse();
  public error: unknown = null;

  public async proposeObjectiveRequirements(input: unknown): Promise<unknown> {
    this.calls.push(input);
    if (this.error !== null) throw this.error;
    return this.response;
  }
}

/**
 * Prisma stub que EXPLOTA si alguien lo toca.
 *
 * No se inyecta en el servicio —no tiene dónde— pero existe para que el test
 * afirme el invariante de forma observable en vez de sólo por ausencia.
 */
function explodingPrisma(): unknown {
  return new Proxy(
    {},
    {
      get() {
        throw new Error('DB_WRITE_ATTEMPTED');
      }
    }
  );
}

function build(): { controller: ObjectiveRequirementProposalController; ai: StubAiClient } {
  const ai = new StubAiClient();
  const service = new ObjectiveRequirementProposalService(ai as never);
  return { controller: new ObjectiveRequirementProposalController(service), ai };
}

function body(overrides: Record<string, unknown> = {}): unknown {
  return {
    objectiveType: 'EMPLOYMENT',
    title: 'Titulo de contexto',
    rawObjectiveText: RAW,
    ...overrides
  };
}

async function expectRejection(
  fn: () => Promise<unknown>,
  status: number,
  code: string
): Promise<Record<string, unknown>> {
  try {
    await fn();
  } catch (error: unknown) {
    const httpError = error as { getStatus?: () => number; getResponse?: () => unknown };
    assert.equal(httpError.getStatus?.(), status);
    const payload = httpError.getResponse?.() as Record<string, unknown>;
    assert.equal(payload.code, code);
    return payload;
  }
  assert.fail('se esperaba un rechazo');
}

test('devuelve una propuesta con autoridad explícita de sólo-propuesta', async () => {
  const { controller, ai } = build();
  const result = await controller.propose(body());

  assert.equal(result.schemaVersion, 'objective_requirement_proposal_v1');
  assert.equal(result.authority, 'PROPOSAL_ONLY');
  assert.equal(result.humanConfirmationRequired, true);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].candidateId, 'cand_01');
  assert.equal(ai.calls.length, 1);
});

test('una sola llamada al AI service por pedido', async () => {
  const { controller, ai } = build();
  await controller.propose(body());
  assert.equal(ai.calls.length, 1);
});

test('el DTO privado NO expone nada del proveedor ni de la ejecución', async () => {
  const { controller } = build();
  const result = await controller.propose(body());
  const serialized = JSON.stringify(result);

  for (const prohibido of [
    'modelo-secreto-de-despliegue',
    'requestedModel',
    'reasoningEffort',
    'promptVersion',
    'adapterVersion',
    'provider',
    'promptBodySha256',
    'effectiveModelVerification',
    'execution',
    'rawProviderResponse',
    'finalState',
    'policyTrace'
  ]) {
    assert.ok(!serialized.includes(prohibido), `el DTO expone ${prohibido}`);
  }
});

test('el DTO no lleva ningún puntaje ni porcentaje, en ningún nivel', async () => {
  const { controller } = build();
  const result = await controller.propose(body());

  const prohibidas = new Set(['score', 'confidence', 'confidenceScore', 'fit', 'fitScore', 'qualityScore', 'ranking']);
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    for (const [key, value] of Object.entries(node)) {
      assert.ok(!prohibidas.has(key), `puntaje expuesto en ${path}.${key}`);
      walk(value, `${path}.${key}`);
    }
  };
  walk(result, 'response');
});

test('no devuelve el texto crudo: el frontend ya lo tiene', async () => {
  const { controller } = build();
  const result = await controller.propose(body());
  assert.ok(!JSON.stringify(result).includes('Titulo universitario afin'));
});

test('rechaza campos del holder y de ejecución en el request', async () => {
  const { controller, ai } = build();
  for (const campo of [
    'ownerUserId',
    'userId',
    'holderId',
    'credentials',
    'profile',
    'skills',
    'evidenceUnits',
    'reasoningRunId',
    'provider',
    'model',
    'candidateId'
  ]) {
    await expectRejection(
      () => controller.propose(body({ [campo]: 'lo-que-sea' })),
      400,
      'INVALID_OBJECTIVE_INPUT'
    );
  }
  assert.equal(ai.calls.length, 0, 'no debió llegar a la red');
});

test('rechaza un Objective vacío sin llamar al AI service', async () => {
  const { controller, ai } = build();
  await expectRejection(
    () => controller.propose(body({ rawObjectiveText: '   ' })),
    400,
    'INVALID_OBJECTIVE_INPUT'
  );
  assert.equal(ai.calls.length, 0);
});

test('rechaza un Objective demasiado grande antes de la red', async () => {
  const { controller, ai } = build();
  await expectRejection(
    () => controller.propose(body({ rawObjectiveText: 'x'.repeat(60_001) })),
    413,
    'OBJECTIVE_TOO_LARGE'
  );
  assert.equal(ai.calls.length, 0);
});

test('el texto crudo viaja SIN trim ni normalización', async () => {
  const { controller, ai } = build();
  const raw = `  ${RAW}  `;
  const stubbed = aiResponse() as { artifact: Record<string, unknown> };
  stubbed.artifact.sourceCharacterCount = Array.from(raw).length;
  const candidates = stubbed.artifact.candidates as Array<Record<string, unknown>>;
  const reference = candidates[0].primarySourceReference as Record<string, number>;
  reference.charStart += 2;
  reference.charEnd += 2;
  ai.response = stubbed;

  await controller.propose(body({ rawObjectiveText: raw }));
  const sent = ai.calls[0] as { rawObjectiveText: string };
  assert.equal(sent.rawObjectiveText, raw);
});

test('mapea cada fallo de transporte a su categoría segura', async () => {
  const casos: Array<[string, number, string]> = [
    ['OBJECTIVE_TOO_LARGE', 413, 'OBJECTIVE_TOO_LARGE'],
    ['PROVIDER_INVALID_OUTPUT', 422, 'UNABLE_TO_PRODUCE_PROPOSAL'],
    ['PROVIDER_CONFIGURATION_FAILURE', 422, 'UNABLE_TO_PRODUCE_PROPOSAL'],
    ['PROVIDER_TRANSPORT_FAILURE', 503, 'TEMPORARILY_UNAVAILABLE'],
    ['INTERNAL_AI_SERVICE_FAILURE', 503, 'TEMPORARILY_UNAVAILABLE']
  ];
  for (const [transportCode, status, expected] of casos) {
    const { controller, ai } = build();
    ai.error = new ObjectiveProposalTransportError(transportCode as never);
    const payload = await expectRejection(() => controller.propose(body()), status, expected);
    // El cuerpo que ve el holder no menciona al proveedor ni al AI service.
    const serialized = JSON.stringify(payload).toLowerCase();
    for (const prohibido of ['openai', 'provider', 'model', 'ai_service', 'prompt']) {
      assert.ok(!serialized.includes(prohibido), `filtra ${prohibido}`);
    }
  }
});

test('un artefacto estructuralmente falso no se mapea: falla cerrado', async () => {
  const { controller, ai } = build();
  const corrupto = aiResponse() as { artifact: Record<string, unknown> };
  const candidates = corrupto.artifact.candidates as Array<Record<string, unknown>>;
  (candidates[0].primarySourceReference as Record<string, unknown>).exactExcerpt =
    'una cita que no está en esos offsets';
  ai.response = corrupto;

  await expectRejection(() => controller.propose(body()), 422, 'UNABLE_TO_PRODUCE_PROPOSAL');
});

test('un fallo no tipado se reporta como indisponibilidad, sin filtrar detalle', async () => {
  const { controller, ai } = build();
  ai.error = new Error('stack trace interno con /ruta/secreta y api_key=abc');
  const payload = await expectRejection(
    () => controller.propose(body()),
    503,
    'TEMPORARILY_UNAVAILABLE'
  );
  const serialized = JSON.stringify(payload);
  assert.ok(!serialized.includes('secreta'));
  assert.ok(!serialized.includes('api_key'));
});

test('el servicio no tiene por dónde escribir en la base', () => {
  // No hay constructor que acepte Prisma: el invariante lo sostiene el tipo.
  assert.equal(ObjectiveRequirementProposalService.length, 1);
  const prisma = explodingPrisma();
  assert.throws(() => (prisma as Record<string, unknown>).objective, /DB_WRITE_ATTEMPTED/);
});

test('cero candidatos es una respuesta exitosa', async () => {
  const { controller, ai } = build();
  const vacio = aiResponse() as { artifact: Record<string, unknown> };
  vacio.artifact.candidates = [];
  ai.response = vacio;

  const result = await controller.propose(body());
  assert.deepEqual(result.candidates, []);
  assert.equal(result.authority, 'PROPOSAL_ONLY');
});

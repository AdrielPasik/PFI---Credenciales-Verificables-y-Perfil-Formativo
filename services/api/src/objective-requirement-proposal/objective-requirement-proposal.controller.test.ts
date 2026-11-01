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
  OBJECTIVE_REQUIREMENT_EXTRACTION_POLICY_VERSION,
  OBJECTIVE_REQUIREMENT_SELECTION_POLICY_VERSION,
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
      effectiveModelVerification: 'MATCH',
      // El ai-service declara el presupuesto que acoto esta ejecucion y las
      // politicas con que extrajo y eligio; NestJS lo verifica contra lo que pidio
      // (15 para el titular).
      requestedMaxProposedRequirements: 15,
      extractionPolicyVersion: OBJECTIVE_REQUIREMENT_EXTRACTION_POLICY_VERSION,
      selectionPolicyVersion: OBJECTIVE_REQUIREMENT_SELECTION_POLICY_VERSION,
      selection: {
        applied: false,
        extractedCandidateCount: 1,
        selectedCandidateCount: 1,
        omittedCandidateCount: 0,
        providerLogicalCalls: 1
      }
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
      omittedCandidates: [],
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
  ai.response = responseWithCandidates(0);

  const result = await controller.propose(body());
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.omittedCandidates, []);
  assert.equal(result.authority, 'PROPOSAL_ONLY');
});

// ---------------------------------------------------------------------------
// P0: presupuesto de seleccion del titular (tope 15)
// ---------------------------------------------------------------------------

/**
 * `count` elegidos y `omitted` que la seleccion del ai-service dejo afuera, con
 * los conteos de `execution.selection` coherentes con ambas listas.
 */
function responseWithCandidates(count: number, omitted = 0): unknown {
  const stubbed = aiResponse() as {
    execution: Record<string, unknown>;
    artifact: Record<string, unknown>;
  };
  const [template] = stubbed.artifact.candidates as Array<Record<string, unknown>>;
  const numbered = (order: number, number: number) => ({
    ...template,
    candidateId: `cand_${String(number).padStart(2, '0')}`,
    order,
    proposedRequirementText: `Requisito ${number}`
  });
  stubbed.artifact.candidates = Array.from({ length: count }, (_unused, index) =>
    numbered(index + 1, index + 1)
  );
  stubbed.artifact.omittedCandidates = Array.from({ length: omitted }, (_unused, index) =>
    numbered(index + 1, count + index + 1)
  );
  stubbed.execution.selection = {
    applied: omitted > 0,
    extractedCandidateCount: count + omitted,
    selectedCandidateCount: count,
    omittedCandidateCount: omitted,
    providerLogicalCalls: omitted > 0 ? 2 : 1
  };
  return stubbed;
}

test('P0: el titular pide la propuesta con un presupuesto de 15', async () => {
  const { controller, ai } = build();
  await controller.propose(body());

  const sent = ai.calls[0] as { maxProposedRequirements: unknown };
  assert.equal(sent.maxProposedRequirements, 15);
  assert.equal(ai.calls.length, 1);
});

test('P0: 15 es un tope, no una meta -- una propuesta de 4 se acepta tal cual', async () => {
  const { controller, ai } = build();
  ai.response = responseWithCandidates(4);

  const result = await controller.propose(body());
  assert.equal(result.candidates.length, 4);
});

test('P0: exactamente 15 candidatos se aceptan', async () => {
  const { controller, ai } = build();
  ai.response = responseWithCandidates(15);

  const result = await controller.propose(body());
  assert.equal(result.candidates.length, 15);
});

test('P0: 50 extraidos -> 15 elegidos por seleccion y 35 visibles como omitidos', async () => {
  const { controller, ai } = build();
  ai.response = responseWithCandidates(15, 35);

  const result = await controller.propose(body());
  assert.equal(result.candidates.length, 15);
  assert.equal(result.omittedCandidates.length, 35);
  // Los omitidos tienen exactamente la forma de un candidato: el cliente puede
  // usarlos para sustituir sin otro pedido.
  assert.deepEqual(
    Object.keys(result.omittedCandidates[0]).sort(),
    Object.keys(result.candidates[0]).sort()
  );
  assert.equal(ai.calls.length, 1);
});

test('P0: si el ai-service igual devolviera 50 elegidos, NO se recortan -- falla cerrada', async () => {
  const { controller, ai } = build();
  ai.response = responseWithCandidates(50);

  const payload = await expectRejection(
    () => controller.propose(body()),
    422,
    'UNABLE_TO_PRODUCE_PROPOSAL'
  );
  // El cuerpo seguro no filtra el detalle interno ni ningun candidato.
  assert.equal(JSON.stringify(payload).includes('Requisito'), false);
  assert.equal(ai.calls.length, 1);
});

test('P0: el DTO no expone el presupuesto ni las politicas declaradas por el ai-service', async () => {
  const { controller, ai } = build();
  ai.response = responseWithCandidates(15, 3);
  const serialized = JSON.stringify(await controller.propose(body()));
  for (const internal of [
    'requestedMaxProposedRequirements',
    'extractionPolicyVersion',
    'selectionPolicyVersion',
    'providerLogicalCalls'
  ]) {
    assert.equal(serialized.includes(internal), false, internal);
  }
});

test('P0: la propuesta registra duracion y volumen, sin ningun texto del titular', async () => {
  const ai = new StubAiClient();
  ai.response = responseWithCandidates(6, 2);
  const service = new ObjectiveRequirementProposalService(ai as never);
  const events: unknown[] = [];
  (service as unknown as { logger: unknown }).logger = {
    log: (event: unknown) => events.push(event),
    error: (event: unknown) => events.push(event)
  };
  const controller = new ObjectiveRequirementProposalController(service);

  await controller.propose(body());

  assert.equal(events.length, 1);
  const event = events[0] as Record<string, unknown>;
  assert.equal(event.event, 'objective_requirement_proposal_timing');
  assert.equal(event.outcome, 'proposed');
  assert.equal(event.candidateCount, 6);
  assert.equal(event.omittedCandidateCount, 2);
  assert.equal(event.maxRequirements, 15);
  assert.equal(typeof event.durationMs, 'number');
  const serialized = JSON.stringify(event);
  for (const sensitive of [RAW, QUOTE, 'Titulo de contexto', 'Requisito 1', 'Requisito 7']) {
    assert.equal(serialized.includes(sensitive), false, sensitive);
  }
});

test('P0: un fallo de la propuesta tambien queda medido, con su codigo cerrado', async () => {
  const ai = new StubAiClient();
  ai.response = responseWithCandidates(16);
  const service = new ObjectiveRequirementProposalService(ai as never);
  const events: Array<Record<string, unknown>> = [];
  (service as unknown as { logger: unknown }).logger = {
    log: (event: Record<string, unknown>) => events.push(event),
    error: (event: Record<string, unknown>) => events.push(event)
  };

  await assert.rejects(() => service.propose({
    objectiveType: 'EMPLOYMENT',
    title: 'Titulo de contexto',
    rawObjectiveText: RAW
  } as never, 15));

  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, 'failed');
  assert.equal(events[0].errorCode, 'UNABLE_TO_PRODUCE_PROPOSAL');
  assert.equal(events[0].candidateCount, null);
});

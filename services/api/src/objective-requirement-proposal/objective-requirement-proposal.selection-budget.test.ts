/**
 * Presupuesto de seleccion de la propuesta — cota publica de 12 requisitos.
 *
 * EL DEFECTO QUE CIERRA. Un aviso de empleo real produjo 34 candidatos. La
 * confirmacion publica rechaza mas de 12, asi que lo que se exponia no era una
 * propuesta larga: era un estado que el verificador no podia confirmar nunca.
 *
 * LO QUE NO SE HACE: `candidates.slice(0, 12)`. Los primeros doce en orden de
 * fuente no son los doce materialmente relevantes —en un aviso tipico son ocho
 * oraciones de responsabilidades— y el titulo requerido, el idioma y el
 * excluyente suelen estar despues. Recortar deja afuera lo que importa sin que
 * nadie se entere.
 *
 * DOS COMPROBACIONES INDEPENDIENTES, y ninguna reemplaza a la otra:
 *
 *   el AI service DECLARA que acoto esta ejecucion  -> si no, el bloque de
 *                                                      seleccion pudo no llegar
 *   el artefacto se CUENTA                          -> decirlo no es haberlo hecho
 *
 * El holder no manda presupuesto y su camino queda intacto: es parte del contrato
 * y se prueba explicitamente.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { AiServiceClient } from '../ai/ai-service.client';
import {
  OBJECTIVE_REQUIREMENT_PROPOSAL_RESPONSE_SCHEMA_VERSION,
  OBJECTIVE_UNDERSTANDING_STAGE_IDENTITY
} from './objective-requirement-proposal.contract';
import { ObjectiveProposalArtifactInvariantError } from './objective-requirement-proposal.errors';
import { ObjectiveRequirementProposalError } from './objective-requirement-proposal.errors';
import { ObjectiveRequirementProposalService } from './objective-requirement-proposal.service';
import { verifyObjectiveProposalResponse } from './objective-requirement-proposal.verifier';

const PUBLIC_MAXIMUM = 12;

const RAW = '- Experiencia minima de 3 anos.\n- Titulo universitario afin.\n';
const QUOTE = '- Experiencia minima de 3 anos.';

function reference() {
  const charStart = Array.from(RAW.slice(0, RAW.indexOf(QUOTE))).length;
  return {
    exactExcerpt: QUOTE,
    charStart,
    charEnd: charStart + Array.from(QUOTE).length,
    offsetUnit: 'UNICODE_CODE_POINT'
  };
}

function candidate(order: number) {
  return {
    candidateId: `cand_${String(order).padStart(2, '0')}`,
    order,
    proposedRequirementText: `Requisito ${order}`,
    primarySourceReference: reference(),
    primarySourceGrounding: 'UNIQUE',
    auxiliarySourceReferences: [],
    ambiguousReferences: [],
    unmatchedReferences: [],
    sourceSectionLabel: 'Requisitos',
    exactDuplicateOfEarlier: false,
    confirmableAsSourceDerived: true
  };
}

function response(count: number, executionOverrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: OBJECTIVE_REQUIREMENT_PROPOSAL_RESPONSE_SCHEMA_VERSION,
    execution: {
      artifactSchemaVersion: OBJECTIVE_UNDERSTANDING_STAGE_IDENTITY.artifactSchemaVersion,
      promptVersion: OBJECTIVE_UNDERSTANDING_STAGE_IDENTITY.promptVersion,
      adapterVersion: OBJECTIVE_UNDERSTANDING_STAGE_IDENTITY.adapterVersion,
      providerProposalSchemaVersion:
        OBJECTIVE_UNDERSTANDING_STAGE_IDENTITY.providerProposalSchemaVersion,
      provider: 'openai',
      reasoningEffort: 'medium',
      requestedMaxProposedRequirements: PUBLIC_MAXIMUM,
      ...executionOverrides
    },
    artifact: {
      schemaVersion: OBJECTIVE_UNDERSTANDING_STAGE_IDENTITY.artifactSchemaVersion,
      sourceNormalization: 'NONE',
      offsetUnit: 'UNICODE_CODE_POINT',
      sourceCharacterCount: Array.from(RAW).length,
      candidates: Array.from({ length: count }, (_unused, index) => candidate(index + 1)),
      unresolvedPassages: []
    }
  };
}

function expectInvariant(input: unknown, fragment: string, maxCandidates?: number): void {
  assert.throws(
    () => verifyObjectiveProposalResponse(input, RAW, { maxCandidates }),
    (error: unknown) => {
      assert.ok(error instanceof ObjectiveProposalArtifactInvariantError);
      assert.match(error.detail, new RegExp(fragment));
      return true;
    }
  );
}

// ---------------------------------------------------------------------------
// Verificacion independiente
// ---------------------------------------------------------------------------

test('exactamente el maximo se acepta', () => {
  const verified = verifyObjectiveProposalResponse(response(PUBLIC_MAXIMUM), RAW, {
    maxCandidates: PUBLIC_MAXIMUM
  });
  assert.equal(verified.candidates.length, PUBLIC_MAXIMUM);
});

test('uno de mas invalida la propuesta entera', () => {
  expectInvariant(response(PUBLIC_MAXIMUM + 1), 'candidates_exceed_requested_maximum', PUBLIC_MAXIMUM);
});

test('34 candidatos no se recortan a 12: se descartan', () => {
  expectInvariant(response(34), 'candidates_exceed_requested_maximum', PUBLIC_MAXIMUM);
});

test('un servicio que no declara haber acotado no es de fiar', () => {
  // Sin la declaracion, el bloque de seleccion pudo no haber llegado nunca al
  // prompt: que entren 3 candidatos seria suerte, no contrato.
  expectInvariant(
    response(3, { requestedMaxProposedRequirements: undefined }),
    'requested_maximum_not_honored',
    PUBLIC_MAXIMUM
  );
});

test('un tope distinto del pedido tampoco sirve', () => {
  expectInvariant(
    response(3, { requestedMaxProposedRequirements: 30 }),
    'requested_maximum_not_honored',
    PUBLIC_MAXIMUM
  );
});

test('sin presupuesto no hay tope: el camino del holder queda intacto', () => {
  const unbounded = response(34, { requestedMaxProposedRequirements: undefined });
  const verified = verifyObjectiveProposalResponse(unbounded, RAW);
  assert.equal(verified.candidates.length, 34);
});

// ---------------------------------------------------------------------------
// El servicio compartido
// ---------------------------------------------------------------------------

class StubAiServiceClient {
  readonly bodies: Record<string, unknown>[] = [];

  constructor(private readonly payload: unknown) {}

  async proposeObjectiveRequirements(input: Record<string, unknown>): Promise<unknown> {
    this.bodies.push(input);
    return this.payload;
  }
}

function serviceWith(payload: unknown): {
  service: ObjectiveRequirementProposalService;
  client: StubAiServiceClient;
} {
  const client = new StubAiServiceClient(payload);
  const service = new ObjectiveRequirementProposalService(
    client as unknown as AiServiceClient
  );
  return { service, client };
}

const INPUT = {
  objectiveType: 'EMPLOYMENT' as const,
  title: 'Titulo de contexto',
  rawObjectiveText: RAW
};

test('el holder no manda presupuesto', async () => {
  const { service, client } = serviceWith(
    response(20, { requestedMaxProposedRequirements: undefined })
  );
  const proposal = await service.propose(INPUT);

  assert.equal(client.bodies[0].maxProposedRequirements, null);
  assert.equal(proposal.candidates.length, 20);
});

test('el verificador publico manda su tope y lo obtiene', async () => {
  const { service, client } = serviceWith(response(PUBLIC_MAXIMUM));
  const proposal = await service.propose(INPUT, PUBLIC_MAXIMUM);

  assert.equal(client.bodies[0].maxProposedRequirements, PUBLIC_MAXIMUM);
  assert.ok(proposal.candidates.length >= 1);
  assert.ok(proposal.candidates.length <= PUBLIC_MAXIMUM);
});

test('una propuesta excedida sale por el camino de salida inutilizable', async () => {
  const { service } = serviceWith(response(34));
  await assert.rejects(
    () => service.propose(INPUT, PUBLIC_MAXIMUM),
    (error: unknown) => {
      assert.ok(error instanceof ObjectiveRequirementProposalError);
      // El MISMO codigo que cualquier otra salida que no cumple el contrato: no
      // se inventa una taxonomia nueva para esto.
      assert.equal(error.code, 'UNABLE_TO_PRODUCE_PROPOSAL');
      return true;
    }
  );
});

test('no se acepta parcialmente: ningun candidato sobrevive al rechazo', async () => {
  const { service } = serviceWith(response(13));
  await assert.rejects(() => service.propose(INPUT, PUBLIC_MAXIMUM));
});

// ---------------------------------------------------------------------------
// Nada de esto introduce puntaje, ranking ni ajuste
// ---------------------------------------------------------------------------

test('la propuesta acotada no trae lenguaje de puntaje ni de ajuste', async () => {
  const { service } = serviceWith(response(PUBLIC_MAXIMUM));
  const proposal = await service.propose(INPUT, PUBLIC_MAXIMUM);
  const serialized = JSON.stringify(proposal).toLowerCase();

  for (const forbidden of ['score', 'ranking', 'confidence', '"fit"', 'porcentaje']) {
    assert.ok(!serialized.includes(forbidden), `no debe aparecer ${forbidden}`);
  }
});

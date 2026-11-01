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
 * Con presupuesto, el AI service extrae sin cupo y, si sobran, elige en una
 * etapa de seleccion; lo que queda afuera viaja en `omittedCandidates` y se
 * verifica igual que lo elegido. Sin presupuesto (la etapa evaluada en P2.1) no
 * hay politica, ni seleccion, ni omitidos.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { AiServiceClient } from '../ai/ai-service.client';
import {
  OBJECTIVE_REQUIREMENT_EXTRACTION_POLICY_VERSION,
  OBJECTIVE_REQUIREMENT_PROPOSAL_RESPONSE_SCHEMA_VERSION,
  OBJECTIVE_REQUIREMENT_SELECTION_POLICY_VERSION,
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

function candidate(order: number, number: number = order) {
  return {
    candidateId: `cand_${String(number).padStart(2, '0')}`,
    order,
    proposedRequirementText: `Requisito ${number}`,
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

/**
 * Respuesta ACOTADA, como la produce el AI service cuando recibe un tope:
 * `count` elegidos y `omitted` que la seleccion dejo afuera.
 */
function response(
  count: number,
  executionOverrides: Record<string, unknown> = {},
  omitted = 0,
  artifactOverrides: Record<string, unknown> = {}
) {
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
      extractionPolicyVersion: OBJECTIVE_REQUIREMENT_EXTRACTION_POLICY_VERSION,
      selectionPolicyVersion: OBJECTIVE_REQUIREMENT_SELECTION_POLICY_VERSION,
      selection: {
        applied: omitted > 0,
        extractedCandidateCount: count + omitted,
        selectedCandidateCount: count,
        omittedCandidateCount: omitted,
        providerLogicalCalls: omitted > 0 ? 2 : 1
      },
      ...executionOverrides
    },
    artifact: {
      schemaVersion: OBJECTIVE_UNDERSTANDING_STAGE_IDENTITY.artifactSchemaVersion,
      sourceNormalization: 'NONE',
      offsetUnit: 'UNICODE_CODE_POINT',
      sourceCharacterCount: Array.from(RAW).length,
      candidates: Array.from({ length: count }, (_unused, index) => candidate(index + 1)),
      omittedCandidates: Array.from({ length: omitted }, (_unused, index) =>
        candidate(index + 1, count + index + 1)
      ),
      unresolvedPassages: [],
      ...artifactOverrides
    }
  };
}

/** Respuesta SIN tope: la etapa evaluada en P2.1, sin politica ni seleccion. */
function unbounded(count: number) {
  const base = response(count, {
    requestedMaxProposedRequirements: undefined,
    extractionPolicyVersion: undefined,
    selectionPolicyVersion: undefined,
    selection: undefined
  });
  const { omittedCandidates: _omitted, ...artifact } = base.artifact;
  return { ...base, artifact };
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

test('sin presupuesto no hay tope ni omitidos: la etapa P2.1 queda intacta', () => {
  const verified = verifyObjectiveProposalResponse(unbounded(34), RAW);
  assert.equal(verified.candidates.length, 34);
  assert.deepEqual(verified.omittedCandidates, []);
});

test('sin presupuesto, una lista de omitidos no tiene de donde salir', () => {
  const forged = { ...unbounded(3) };
  forged.artifact = { ...forged.artifact, omittedCandidates: [] } as typeof forged.artifact;
  expectInvariant(forged, 'omitted_candidates_without_requested_maximum');
});

// ---------------------------------------------------------------------------
// Politicas y seleccion
// ---------------------------------------------------------------------------

test('una propuesta sin la politica de extraccion vigente se rechaza', () => {
  expectInvariant(
    response(3, { extractionPolicyVersion: undefined }),
    'extraction_policy_mismatch',
    PUBLIC_MAXIMUM
  );
  expectInvariant(
    response(3, { extractionPolicyVersion: 'product_requirement_extraction_v0' }),
    'extraction_policy_mismatch',
    PUBLIC_MAXIMUM
  );
});

test('una propuesta con otra politica de seleccion se rechaza', () => {
  expectInvariant(
    response(3, { selectionPolicyVersion: 'otra' }),
    'selection_policy_mismatch',
    PUBLIC_MAXIMUM
  );
});

test('con seleccion, los omitidos se verifican y se devuelven', () => {
  const verified = verifyObjectiveProposalResponse(response(PUBLIC_MAXIMUM, {}, 22), RAW, {
    maxCandidates: PUBLIC_MAXIMUM
  });
  assert.equal(verified.candidates.length, PUBLIC_MAXIMUM);
  assert.equal(verified.omittedCandidates.length, 22);
  assert.equal(verified.omittedCandidates[0].candidateId, 'cand_13');
  assert.equal(verified.omittedCandidates[0].order, 1);
});

test('un omitido con la cita corrida invalida la propuesta entera', () => {
  const tampered = response(PUBLIC_MAXIMUM, {}, 2);
  const omitted = tampered.artifact.omittedCandidates[1];
  omitted.primarySourceReference = { ...omitted.primarySourceReference, charStart: 1 };
  expectInvariant(tampered, 'primary_reference_excerpt_does_not_match_source', PUBLIC_MAXIMUM);
});

test('un id omitido no puede repetir uno elegido', () => {
  const tampered = response(PUBLIC_MAXIMUM, {}, 1);
  tampered.artifact.omittedCandidates[0].candidateId = 'cand_01';
  expectInvariant(tampered, 'candidate_id_duplicated', PUBLIC_MAXIMUM);
});

test('los conteos declarados tienen que cerrar con lo que llego', () => {
  const declared = response(PUBLIC_MAXIMUM, {}, 3);
  expectInvariant(
    { ...declared, execution: { ...declared.execution, selection: { ...declared.execution.selection, omittedCandidateCount: 2 } } },
    'selection_counts_mismatch',
    PUBLIC_MAXIMUM
  );
  expectInvariant(
    { ...declared, execution: { ...declared.execution, selection: { ...declared.execution.selection, applied: false } } },
    'selection_applied_inconsistent_with_omitted',
    PUBLIC_MAXIMUM
  );
});

test('con tope, la lista de omitidos es obligatoria aunque este vacia', () => {
  expectInvariant(
    response(3, {}, 0, { omittedCandidates: undefined }),
    'omitted_candidates_not_a_list',
    PUBLIC_MAXIMUM
  );
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

test('sin presupuesto el servicio no lo inventa', async () => {
  const { service, client } = serviceWith(unbounded(20));
  const proposal = await service.propose(INPUT);

  assert.equal(client.bodies[0].maxProposedRequirements, null);
  assert.equal(proposal.candidates.length, 20);
  assert.deepEqual(proposal.omittedCandidates, []);
});

test('el verificador publico manda su tope y lo obtiene', async () => {
  const { service, client } = serviceWith(response(PUBLIC_MAXIMUM));
  const proposal = await service.propose(INPUT, PUBLIC_MAXIMUM);

  assert.equal(client.bodies[0].maxProposedRequirements, PUBLIC_MAXIMUM);
  assert.ok(proposal.candidates.length >= 1);
  assert.ok(proposal.candidates.length <= PUBLIC_MAXIMUM);
});

test('los omitidos llegan al DTO por allowlist, sin campos de ejecucion', async () => {
  const { service } = serviceWith(response(PUBLIC_MAXIMUM, {}, 5));
  const proposal = await service.propose(INPUT, PUBLIC_MAXIMUM);

  assert.equal(proposal.omittedCandidates.length, 5);
  assert.deepEqual(
    Object.keys(proposal.omittedCandidates[0]).sort(),
    Object.keys(proposal.candidates[0]).sort()
  );
  const serialized = JSON.stringify(proposal);
  for (const internal of ['selectionPolicyVersion', 'extractionPolicyVersion', 'providerLogicalCalls']) {
    assert.ok(!serialized.includes(internal), `no debe exponerse ${internal}`);
  }
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
  const { service } = serviceWith(response(PUBLIC_MAXIMUM, {}, 4));
  const proposal = await service.propose(INPUT, PUBLIC_MAXIMUM);
  const serialized = JSON.stringify(proposal).toLowerCase();

  for (const forbidden of ['score', 'ranking', 'confidence', '"fit"', 'porcentaje']) {
    assert.ok(!serialized.includes(forbidden), `no debe aparecer ${forbidden}`);
  }
});

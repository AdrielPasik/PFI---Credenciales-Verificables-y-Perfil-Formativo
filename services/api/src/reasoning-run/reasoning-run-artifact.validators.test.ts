/**
 * Validadores de los tres artifacts de etapa — F3.1.
 *
 * Un solo archivo para los tres porque comparten primitivas y las familias de
 * claves prohibidas: separarlos triplicaria la misma bateria de negativos.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clone,
  validEvidenceUnits,
  validExecutionMetadata,
  validObjectiveAnalysis,
  validResult,
  type Mutable
} from './__fixtures__/reasoning-run-artifacts.fixture';
import { ReasoningRunArtifactError } from './reasoning-run-artifact.errors';
import { verifyEvidenceUnitsArtifact } from './evidence-units-artifact.validator';
import { verifyObjectiveAnalysisArtifact } from './objective-analysis-artifact.validator';
import { verifyReasoningExecutionMetadata } from './reasoning-execution-metadata.validator';
import { verifyReasoningRunResultArtifact } from './reasoning-run-result-artifact.validator';
import { SOURCE_PROVENANCE_TOKENS } from './reasoning-run-artifact.types';
import {
  ISSUER_DECLARED,
  deriveSourceProvenanceV1
} from './source-provenance';

function expectCode(fn: () => unknown, code: string): ReasoningRunArtifactError {
  try {
    fn();
  } catch (error: unknown) {
    assert.ok(
      error instanceof ReasoningRunArtifactError,
      `expected ReasoningRunArtifactError, got ${String(error)}`
    );
    assert.equal(error.code, code);
    return error;
  }
  throw new Error(`expected ${code} but nothing was thrown`);
}

// ---------------------------------------------------------------------------
// Casos validos
// ---------------------------------------------------------------------------

test('los tres artifacts validos pasan y salen congelados', () => {
  const analysis = verifyObjectiveAnalysisArtifact(validObjectiveAnalysis());
  const units = verifyEvidenceUnitsArtifact(validEvidenceUnits());
  const result = verifyReasoningRunResultArtifact(validResult());

  assert.equal(analysis.requirements.length, 1);
  assert.equal(units.evidenceUnits.length, 1);
  assert.equal(result.requirementResults[0].finalState, 'PARTIALLY_SUPPORTED');

  for (const artifact of [analysis, units, result]) {
    assert.ok(Object.isFrozen(artifact));
  }
  assert.ok(Object.isFrozen(analysis.requirements[0].evaluability));
  assert.ok(Object.isFrozen(units.evidenceUnits[0].sourceTrace));
  assert.ok(
    Object.isFrozen(result.requirementResults[0].weakerClaimSearch.candidate)
  );
});

test('la salida verificada esta DESACOPLADA del input', () => {
  const input = validObjectiveAnalysis();
  const verified = verifyObjectiveAnalysisArtifact(input);

  input.requirements[0].epistemicTarget = 'UNRESOLVED';
  input.requirements[0].qualifiers.push({ kind: 'x' });

  assert.equal(verified.requirements[0].epistemicTarget, 'FORMATIVE_EVIDENCE');
  assert.equal(verified.requirements[0].qualifiers.length, 2);
});

test('la inmutabilidad es PROFUNDA: no se puede mutar una rama anidada', () => {
  const verified = verifyEvidenceUnitsArtifact(validEvidenceUnits());
  assert.throws(() => {
    (verified.evidenceUnits[0].sourceTrace as any).charStart = 999;
  });
  assert.throws(() => {
    (verified.preparation.sourceObservabilityFacts as any).push({});
  });
});

test('contextBefore y contextAfter vacios son validos', () => {
  // Una cita al principio de la fuente no tiene contexto previo. Tratarlo como
  // error obligaria al productor a inventar texto.
  const artifact = validEvidenceUnits();
  artifact.evidenceUnits[0].contextBefore = '';
  artifact.evidenceUnits[0].contextAfter = '';
  const verified = verifyEvidenceUnitsArtifact(artifact);
  assert.equal(verified.evidenceUnits[0].contextBefore, '');
});

test('sectionLabel, segmentId y pageNumber nulos son validos', () => {
  const artifact = validEvidenceUnits();
  artifact.evidenceUnits[0].sectionLabel = null;
  artifact.evidenceUnits[0].sourceTrace.segmentId = null;
  artifact.evidenceUnits[0].sourceTrace.pageNumber = null;
  const verified = verifyEvidenceUnitsArtifact(artifact);
  assert.equal(verified.evidenceUnits[0].sectionLabel, null);
});

test('contenido unicode astral sobrevive intacto', () => {
  const artifact = validEvidenceUnits();
  const astral = 'diseño \u{1D11E} de APIs \u{1F600}';
  artifact.evidenceUnits[0].exactQuote = astral;
  artifact.evidenceUnits[0].sourceTrace.exactExcerpt = astral;
  const verified = verifyEvidenceUnitsArtifact(artifact);
  assert.equal(verified.evidenceUnits[0].exactQuote, astral);
});

// ---------------------------------------------------------------------------
// schemaVersion y forma
// ---------------------------------------------------------------------------

test('schemaVersion equivocado se rechaza en los tres', () => {
  for (const [fixture, verify] of [
    [validObjectiveAnalysis, verifyObjectiveAnalysisArtifact],
    [validEvidenceUnits, verifyEvidenceUnitsArtifact],
    [validResult, verifyReasoningRunResultArtifact]
  ] as const) {
    const artifact = fixture();
    artifact.schemaVersion = 'objective_analysis_v2';
    expectCode(() => verify(artifact), 'SCHEMA_VERSION_UNSUPPORTED');
  }
});

test('input que no es objeto se rechaza', () => {
  for (const value of [null, 42, 'x', [], true]) {
    expectCode(
      () => verifyObjectiveAnalysisArtifact(value),
      'SCHEMA_INVALID'
    );
  }
});

test('clave extra en la raiz se rechaza', () => {
  const artifact = validObjectiveAnalysis();
  artifact.extraRootKey = 1;
  expectCode(
    () => verifyObjectiveAnalysisArtifact(artifact),
    'UNKNOWN_PROPERTY'
  );
});

test('clave extra anidada se rechaza', () => {
  const artifact = validEvidenceUnits();
  artifact.evidenceUnits[0].sourceTrace.credentialId = 'cred-1';
  expectCode(() => verifyEvidenceUnitsArtifact(artifact), 'UNKNOWN_PROPERTY');
});

test('campo obligatorio ausente se rechaza', () => {
  const artifact = validObjectiveAnalysis();
  delete artifact.requirements[0].normalizedRequirement;
  expectCode(() => verifyObjectiveAnalysisArtifact(artifact), 'SCHEMA_INVALID');
});

test('texto obligatorio en blanco se rechaza', () => {
  const artifact = validObjectiveAnalysis();
  artifact.requirements[0].epistemicTargetRationale = '   ';
  expectCode(() => verifyObjectiveAnalysisArtifact(artifact), 'TEXT_EMPTY');
});

// ---------------------------------------------------------------------------
// Vocabularios cerrados
// ---------------------------------------------------------------------------

test('cada token de enum del candidato congelado se acepta', () => {
  for (const target of [
    'FORMATIVE_EVIDENCE',
    'INDIVIDUAL_ACHIEVEMENT',
    'UNRESOLVED'
  ]) {
    const artifact = validObjectiveAnalysis();
    artifact.requirements[0].epistemicTarget = target;
    artifact.requirements[0].validations = [];
    assert.equal(
      verifyObjectiveAnalysisArtifact(artifact).requirements[0].epistemicTarget,
      target
    );
  }

  for (const state of [
    'SUPPORTED',
    'PARTIALLY_SUPPORTED',
    'INSUFFICIENT_EVIDENCE',
    'NOT_ASSESSABLE',
    'ABSTAIN'
  ]) {
    const artifact = validResult();
    artifact.requirementResults[0].finalState = state;
    assert.equal(
      verifyReasoningRunResultArtifact(artifact).requirementResults[0].finalState,
      state
    );
  }
});

test('token fuera del vocabulario se rechaza', () => {
  const artifact = validResult();
  artifact.requirementResults[0].finalState = 'SUPPORTED_ENOUGH';
  expectCode(
    () => verifyReasoningRunResultArtifact(artifact),
    'ENUM_TOKEN_UNSUPPORTED'
  );
});

test('un relation inventado se rechaza', () => {
  const artifact = validResult();
  artifact.requirementResults[0].evaluatedEvidence[0].relation = 'STRONG_SUPPORT';
  expectCode(
    () => verifyReasoningRunResultArtifact(artifact),
    'ENUM_TOKEN_UNSUPPORTED'
  );
});

test('mode de preparation distinto de FULL_SCAN se rechaza', () => {
  const artifact = validEvidenceUnits();
  artifact.preparation.mode = 'SAMPLED';
  expectCode(
    () => verifyEvidenceUnitsArtifact(artifact),
    'ENUM_TOKEN_UNSUPPORTED'
  );
});

// ---------------------------------------------------------------------------
// Identificadores
// ---------------------------------------------------------------------------

test('requirementId con formato invalido se rechaza', () => {
  const artifact = validObjectiveAnalysis();
  artifact.requirements[0].requirementId = 'requirement-1';
  expectCode(
    () => verifyObjectiveAnalysisArtifact(artifact),
    'IDENTIFIER_FORMAT_INVALID'
  );
});

test('runLocalSourceId con formato invalido se rechaza', () => {
  const artifact = validEvidenceUnits();
  artifact.evidenceUnits[0].sourceTrace.sourceId = 'source-1';
  expectCode(
    () => verifyEvidenceUnitsArtifact(artifact),
    'IDENTIFIER_FORMAT_INVALID'
  );
});

test('requirementId duplicado en el analisis se rechaza', () => {
  const artifact = validObjectiveAnalysis();
  artifact.requirements.push(clone(artifact.requirements[0]));
  expectCode(
    () => verifyObjectiveAnalysisArtifact(artifact),
    'IDENTIFIER_DUPLICATED'
  );
});

test('evidenceUnitId duplicado en el catalogo se rechaza', () => {
  const artifact = validEvidenceUnits();
  artifact.evidenceUnits.push(clone(artifact.evidenceUnits[0]));
  artifact.preparation.evidenceUnitIds = ['eu_01', 'eu_01'];
  expectCode(
    () => verifyEvidenceUnitsArtifact(artifact),
    'IDENTIFIER_DUPLICATED'
  );
});

test('dos resultados para el mismo Requirement se rechazan', () => {
  const artifact = validResult();
  artifact.requirementResults.push(clone(artifact.requirementResults[0]));
  expectCode(
    () => verifyReasoningRunResultArtifact(artifact),
    'IDENTIFIER_DUPLICATED'
  );
});

test('localFacetKey duplicado dentro de un Requirement se rechaza', () => {
  const artifact = validResult();
  artifact.requirementResults[0].facets.push(
    clone(artifact.requirementResults[0].facets[0])
  );
  expectCode(
    () => verifyReasoningRunResultArtifact(artifact),
    'FACET_KEY_DUPLICATED'
  );
});

test('qualifierId solo existe para MATERIAL_QUALIFIER', () => {
  const withId = validObjectiveAnalysis();
  withId.requirements[0].qualifiers[1].qualifierId = 'q_02';
  expectCode(
    () => verifyObjectiveAnalysisArtifact(withId),
    'IDENTIFIER_FORMAT_INVALID'
  );

  const withoutId = validObjectiveAnalysis();
  withoutId.requirements[0].qualifiers[0].qualifierId = null;
  expectCode(
    () => verifyObjectiveAnalysisArtifact(withoutId),
    'IDENTIFIER_FORMAT_INVALID'
  );
});

// ---------------------------------------------------------------------------
// Spans
// ---------------------------------------------------------------------------

test('span invertido o vacio se rechaza', () => {
  for (const [start, end] of [
    [30, 10],
    [12, 12]
  ]) {
    const artifact = validEvidenceUnits();
    artifact.evidenceUnits[0].sourceTrace.charStart = start;
    artifact.evidenceUnits[0].sourceTrace.charEnd = end;
    expectCode(() => verifyEvidenceUnitsArtifact(artifact), 'SPAN_INVALID');
  }
});

test('offsets no enteros o negativos se rechazan', () => {
  for (const value of [-1, 1.5, '12', null]) {
    const artifact = validEvidenceUnits();
    artifact.evidenceUnits[0].sourceTrace.charStart = value;
    expectCode(() => verifyEvidenceUnitsArtifact(artifact), 'SPAN_INVALID');
  }
});

test('sourceSha256 que no es hex de 64 se rechaza', () => {
  const artifact = validEvidenceUnits();
  artifact.evidenceUnits[0].sourceTrace.sourceSha256 = 'ABC';
  expectCode(() => verifyEvidenceUnitsArtifact(artifact), 'SCHEMA_INVALID');
});

// ---------------------------------------------------------------------------
// Coherencia interna del catalogo
// ---------------------------------------------------------------------------

test('el indice de preparation debe coincidir con el catalogo', () => {
  const artifact = validEvidenceUnits();
  artifact.preparation.evidenceUnitIds = ['eu_02'];
  expectCode(
    () => verifyEvidenceUnitsArtifact(artifact),
    'EVIDENCE_UNIT_REFERENCE_UNKNOWN'
  );
});

test('un grupo de redundancia no puede citar unidades inexistentes', () => {
  const artifact = validEvidenceUnits();
  artifact.preparation.exactRedundancyGroups = [['eu_01', 'eu_09']];
  expectCode(
    () => verifyEvidenceUnitsArtifact(artifact),
    'EVIDENCE_UNIT_REFERENCE_UNKNOWN'
  );
});

test('dos observability facts para la misma fuente se rechazan', () => {
  const artifact = validEvidenceUnits();
  artifact.preparation.sourceObservabilityFacts.push(
    clone(artifact.preparation.sourceObservabilityFacts[0])
  );
  expectCode(
    () => verifyEvidenceUnitsArtifact(artifact),
    'IDENTIFIER_DUPLICATED'
  );
});

// ---------------------------------------------------------------------------
// DELTA_A: la busqueda de claim mas debil es observable
// ---------------------------------------------------------------------------

test('status FOUND sin candidato se rechaza', () => {
  const artifact = validResult();
  artifact.requirementResults[0].weakerClaimSearch.candidate = null;
  expectCode(
    () => verifyReasoningRunResultArtifact(artifact),
    'SCHEMA_INVALID'
  );
});

test('status NONE con candidato se rechaza', () => {
  const artifact = validResult();
  artifact.requirementResults[0].weakerClaimSearch.status = 'NONE';
  expectCode(
    () => verifyReasoningRunResultArtifact(artifact),
    'SCHEMA_INVALID'
  );
});

test('status NONE sin candidato es valido', () => {
  const artifact = validResult();
  artifact.requirementResults[0].weakerClaimSearch = {
    status: 'NONE',
    rationale: 'No se identifico una version defendible.',
    candidate: null
  };
  artifact.requirementResults[0].policyTrace.weakerSearchStatus = 'NONE';
  artifact.requirementResults[0].policyTrace.continuityStatus = null;
  artifact.requirementResults[0].policyTrace.materialUsefulness = null;
  const verified = verifyReasoningRunResultArtifact(artifact);
  assert.equal(verified.requirementResults[0].weakerClaimSearch.candidate, null);
});

test('shiftReason null es un valor legitimo del contrato congelado', () => {
  const verified = verifyReasoningRunResultArtifact(validResult());
  assert.equal(
    verified.requirementResults[0].weakerClaimSearch.candidate
      ?.continuityAssessment.shiftReason,
    null
  );
});

// ---------------------------------------------------------------------------
// Familias de claves prohibidas
// ---------------------------------------------------------------------------

test('un campo de chain-of-thought se rechaza con su propio codigo', () => {
  for (const key of [
    'chainOfThought',
    'scratchpad',
    'hiddenReasoning',
    'internalDeliberation',
    'modelThoughts'
  ]) {
    const artifact = validResult();
    artifact.requirementResults[0][key] = 'razonamiento privado';
    const error = expectCode(
      () => verifyReasoningRunResultArtifact(artifact),
      'CHAIN_OF_THOUGHT_FIELD_NOT_ALLOWED'
    );
    assert.equal(error.observed, key);
  }
});

test('un score global se rechaza con su propio codigo', () => {
  for (const key of ['globalScore', 'fitPercentage', 'objectiveFinalState', 'rank']) {
    const artifact = validResult();
    artifact[key] = 82;
    expectCode(
      () => verifyReasoningRunResultArtifact(artifact),
      'GLOBAL_SCORE_FIELD_NOT_ALLOWED'
    );
  }
});

test('los campos que produccion retiro se rechazan con su propio codigo', () => {
  const decomposition = validObjectiveAnalysis();
  decomposition.decompositionStatus = 'RESOLVED';
  expectCode(
    () => verifyObjectiveAnalysisArtifact(decomposition),
    'EXPERIMENTAL_FIELD_NOT_ALLOWED'
  );

  const quote = validObjectiveAnalysis();
  quote.requirements[0].requirementQuote = 'APIs REST';
  expectCode(
    () => verifyObjectiveAnalysisArtifact(quote),
    'EXPERIMENTAL_FIELD_NOT_ALLOWED'
  );

  const core = validObjectiveAnalysis();
  core.requirements[0].continuityCore = { statement: 'x' };
  expectCode(
    () => verifyObjectiveAnalysisArtifact(core),
    'EXPERIMENTAL_FIELD_NOT_ALLOWED'
  );

  const lineage = validEvidenceUnits();
  lineage.evidenceUnits[0].lineageId = 'cred-1';
  expectCode(
    () => verifyEvidenceUnitsArtifact(lineage),
    'EXPERIMENTAL_FIELD_NOT_ALLOWED'
  );

  const verified = validEvidenceUnits();
  verified.evidenceUnits[0].technicallyVerified = true;
  expectCode(
    () => verifyEvidenceUnitsArtifact(verified),
    'EXPERIMENTAL_FIELD_NOT_ALLOWED'
  );
});

// ---------------------------------------------------------------------------
// sourceProvenance: AUTORIDAD DE ASERCION, un solo token
// ---------------------------------------------------------------------------

test('ISSUER_DECLARED es aceptado y es el UNICO token del vocabulario', () => {
  const verified = verifyEvidenceUnitsArtifact(validEvidenceUnits());
  assert.deepEqual([...verified.sources], [
    { sourceId: 'src_01', sourceProvenance: 'ISSUER_DECLARED' }
  ]);
  assert.deepEqual([...SOURCE_PROVENANCE_TOKENS], ['ISSUER_DECLARED']);
});

test('la provenance vive UNA vez por fuente, no por EvidenceUnit', () => {
  // En el candidato congelado nace como propiedad de la fuente y el builder la
  // copia a cada unidad. Repetir la copia en el artifact persistido haria
  // representable que dos unidades de la misma fuente tuvieran autoridades
  // distintas, que es imposible.
  const artifact = validEvidenceUnits();
  artifact.evidenceUnits[0].sourceProvenance = 'ISSUER_DECLARED';
  expectCode(() => verifyEvidenceUnitsArtifact(artifact), 'UNKNOWN_PROPERTY');
});

test('sourceProvenance ausente o null se rechaza: es REQUERIDO', () => {
  for (const mutate of [
    (artifact: Mutable) => {
      delete artifact.sources[0].sourceProvenance;
    },
    (artifact: Mutable) => {
      artifact.sources[0].sourceProvenance = null;
    }
  ]) {
    const artifact = validEvidenceUnits();
    mutate(artifact);
    expectCode(
      () => verifyEvidenceUnitsArtifact(artifact),
      'SOURCE_PROVENANCE_INVALID'
    );
  }
});

test('los tokens del experimento y los inventados se rechazan', () => {
  // Ninguno de estos es "un token mas que falta": son otra semantica. Por eso el
  // codigo es propio y no el generico de enum.
  for (const token of [
    'INSTITUTIONALLY_DECLARED',
    'SYSTEM_GENERATED',
    'SYSTEM_DECLARED',
    'ISSUER_SUBMITTED_DOCUMENT',
    'ISSUER_SUBMITTED_TEXT',
    'OTHER',
    'UNKNOWN',
    '',
    'cualquier cosa'
  ]) {
    const artifact = validEvidenceUnits();
    artifact.sources[0].sourceProvenance = token;
    const error = expectCode(
      () => verifyEvidenceUnitsArtifact(artifact),
      'SOURCE_PROVENANCE_INVALID'
    );
    assert.match(error.invariant, /assertion_authority/);
  }
});

test('el casing del token es exacto', () => {
  for (const token of ['issuer_declared', 'Issuer_Declared', 'ISSUER_DECLARED ']) {
    const artifact = validEvidenceUnits();
    artifact.sources[0].sourceProvenance = token;
    expectCode(
      () => verifyEvidenceUnitsArtifact(artifact),
      'SOURCE_PROVENANCE_INVALID'
    );
  }
});

test('una clave extra dentro de la declaracion de fuente se rechaza', () => {
  const artifact = validEvidenceUnits();
  artifact.sources[0].representationOrigin = 'SYSTEM_GENERATED';
  expectCode(() => verifyEvidenceUnitsArtifact(artifact), 'UNKNOWN_PROPERTY');
});

test('dos declaraciones para la misma fuente se rechazan', () => {
  const artifact = validEvidenceUnits();
  artifact.sources.push({ sourceId: 'src_01', sourceProvenance: 'ISSUER_DECLARED' });
  expectCode(
    () => verifyEvidenceUnitsArtifact(artifact),
    'SOURCE_DECLARATION_DUPLICATE'
  );
});

test('una EvidenceUnit que cita una fuente NO declarada se rechaza', () => {
  // Sin declaracion no hay autoridad de asercion fijada para ese material.
  const artifact = validEvidenceUnits();
  artifact.sources = [];
  expectCode(
    () => verifyEvidenceUnitsArtifact(artifact),
    'SOURCE_DECLARATION_MISSING'
  );
});

test('los tres caminos productivos derivan el MISMO token', () => {
  // Y la funcion no recibe nada que permita distinguir manual de generado: esa
  // rama no es representable, que es exactamente el punto.
  assert.equal(deriveSourceProvenanceV1('DOCUMENT_EVIDENCE'), 'ISSUER_DECLARED');
  assert.equal(deriveSourceProvenanceV1('TEXT_EVIDENCE'), 'ISSUER_DECLARED');
  assert.equal(ISSUER_DECLARED, 'ISSUER_DECLARED');
});

// ---------------------------------------------------------------------------
// Privacidad de los errores
// ---------------------------------------------------------------------------

test('PRIVACIDAD: un error nunca lleva contenido del holder', () => {
  const sentinel = 'SENTINEL_NOMBRE_APELLIDO_DNI_12345678';
  const artifact = validEvidenceUnits();
  artifact.evidenceUnits[0].exactQuote = sentinel;
  artifact.evidenceUnits[0].sourceTrace.exactExcerpt = sentinel;
  artifact.evidenceUnits[0].normalizedProposition = sentinel;
  // El fallo lo dispara otra cosa: el span, no el texto.
  artifact.evidenceUnits[0].sourceTrace.charEnd = 0;

  const error = expectCode(
    () => verifyEvidenceUnitsArtifact(artifact),
    'SPAN_INVALID'
  );

  const surfaces = [
    error.message,
    error.invariant,
    error.path ?? '',
    error.observed ?? '',
    JSON.stringify(error.getResponse()),
    JSON.stringify(error),
    String(error.stack ?? '')
  ];
  for (const surface of surfaces) {
    assert.ok(
      !surface.includes(sentinel),
      `contenido del holder filtrado en: ${surface.slice(0, 200)}`
    );
  }
});

test('PRIVACIDAD: un enum invalido enorme se acota antes de reportarse', () => {
  const sentinel = 'X'.repeat(5000);
  const artifact = validResult();
  artifact.requirementResults[0].finalState = sentinel;
  const error = expectCode(
    () => verifyReasoningRunResultArtifact(artifact),
    'ENUM_TOKEN_UNSUPPORTED'
  );
  assert.ok((error.observed ?? '').length <= 64);
});

// ---------------------------------------------------------------------------
// executionMetadata
// ---------------------------------------------------------------------------

test('un plan de ejecucion COMPLETO es valido y sale congelado', () => {
  const verified = verifyReasoningExecutionMetadata(validExecutionMetadata());
  assert.equal(verified.objectiveAnalysis.provider?.model, 'test-model');
  assert.equal(verified.objectiveAnalysis.provider?.reasoningEffort, 'medium');
  assert.equal(
    verified.contextualReasoning.promptVersion,
    'product_contextual_reasoning_v1'
  );
  assert.ok(Object.isFrozen(verified));
  assert.ok(Object.isFrozen(verified.objectiveAnalysis.provider));
});

test('las tres identidades duraderas quedan en el plan', () => {
  // Es la razon por la que el artifact existe: poder responder historicamente
  // con que contrato, que prompt y que adapter salio cada etapa.
  const verified = verifyReasoningExecutionMetadata(validExecutionMetadata());
  for (const stage of [
    verified.objectiveAnalysis,
    verified.evidenceUnits,
    verified.contextualReasoning
  ]) {
    assert.ok(stage.artifactSchemaVersion.length > 0);
    assert.ok((stage.promptVersion ?? '').length > 0);
    assert.ok(stage.adapterVersion.length > 0);
    assert.ok((stage.provider?.model ?? '').length > 0);
  }
});

test('el plan sale DESACOPLADO del input', () => {
  const input = validExecutionMetadata();
  const verified = verifyReasoningExecutionMetadata(input);
  input.objectiveAnalysis.provider.model = 'otro-modelo';
  assert.equal(verified.objectiveAnalysis.provider?.model, 'test-model');
});

test('un stage de openai SIN reasoningEffort se rechaza', () => {
  // El wrapper congelado manda `reasoning.effort` en cada llamada: un plan que no
  // lo declare describe una configuracion semantica distinta de la que se
  // ejecutara.
  const metadata = validExecutionMetadata();
  metadata.objectiveAnalysis.provider.reasoningEffort = null;
  expectCode(
    () => verifyReasoningExecutionMetadata(metadata),
    'SCHEMA_INVALID'
  );
});

test('un reasoningEffort fuera del vocabulario congelado se rechaza', () => {
  for (const effort of ['high', 'low', 'minimal', 'MEDIUM', '', 'medio']) {
    const metadata = validExecutionMetadata();
    metadata.objectiveAnalysis.provider.reasoningEffort = effort;
    expectCode(
      () => verifyReasoningExecutionMetadata(metadata),
      'ENUM_TOKEN_UNSUPPORTED'
    );
  }
});

test('un proveedor que no acepta effort no puede declararlo', () => {
  const metadata = validExecutionMetadata();
  metadata.objectiveAnalysis.provider = {
    provider: 'anthropic',
    model: 'test-model',
    reasoningEffort: 'medium'
  };
  expectCode(
    () => verifyReasoningExecutionMetadata(metadata),
    'SCHEMA_INVALID'
  );
});

test('un proveedor desconocido se rechaza', () => {
  const metadata = validExecutionMetadata();
  metadata.objectiveAnalysis.provider.provider = 'internal';
  expectCode(
    () => verifyReasoningExecutionMetadata(metadata),
    'ENUM_TOKEN_UNSUPPORTED'
  );
});

test('provider null significa PROVIDERLESS, nunca "todavia no se sabe"', () => {
  // Y por eso arrastra al prompt: una etapa sin proveedor no tiene prompt que
  // enviar. Declarar uno afirmaria algo que nadie va a mandar.
  const providerless = validExecutionMetadata();
  providerless.contextualReasoning.provider = null;
  providerless.contextualReasoning.promptVersion = null;
  const verified = verifyReasoningExecutionMetadata(providerless);
  assert.equal(verified.contextualReasoning.provider, null);
  assert.equal(verified.contextualReasoning.promptVersion, null);

  const halfway = validExecutionMetadata();
  halfway.contextualReasoning.provider = null;
  expectCode(
    () => verifyReasoningExecutionMetadata(halfway),
    'SCHEMA_INVALID'
  );

  const promptless = validExecutionMetadata();
  promptless.contextualReasoning.promptVersion = null;
  expectCode(
    () => verifyReasoningExecutionMetadata(promptless),
    'SCHEMA_INVALID'
  );
});

test('un plan INCOMPLETO no es escribible', () => {
  // Con fill-once, una etapa "para completar despues" no podria completarse
  // nunca. Por eso las tres son requeridas.
  for (const stage of [
    'objectiveAnalysis',
    'evidenceUnits',
    'contextualReasoning'
  ]) {
    const metadata = validExecutionMetadata();
    delete metadata[stage];
    expectCode(
      () => verifyReasoningExecutionMetadata(metadata),
      'SCHEMA_INVALID'
    );
  }
});

test('cada stage plan debe nombrar SU propio schema de artifact', () => {
  const metadata = validExecutionMetadata();
  metadata.objectiveAnalysis.artifactSchemaVersion = 'evidence_units_v1';
  expectCode(
    () => verifyReasoningExecutionMetadata(metadata),
    'SCHEMA_VERSION_UNSUPPORTED'
  );
});

test('executionMetadata rechaza un proveedor a medias', () => {
  const metadata = validExecutionMetadata();
  delete metadata.objectiveAnalysis.provider.model;
  expectCode(
    () => verifyReasoningExecutionMetadata(metadata),
    'SCHEMA_INVALID'
  );
});

test('executionMetadata rechaza strings vacios en vez de aceptarlos como ausencia', () => {
  const metadata = validExecutionMetadata();
  metadata.objectiveAnalysis.provider.model = '';
  expectCode(() => verifyReasoningExecutionMetadata(metadata), 'TEXT_EMPTY');
});

test('executionMetadata rechaza claves de secreto y de observacion', () => {
  // Ni secretos ni cosas que sean OBSERVACION en vez de plan: latencia, tokens,
  // el modelo efectivo o la respuesta cruda no pertenecen a una configuracion.
  for (const key of [
    'apiKey',
    'baseUrl',
    'latencyMs',
    'usage',
    'effectiveModel',
    'rawResponse'
  ]) {
    const metadata = validExecutionMetadata();
    metadata[key] = 'x';
    expectCode(
      () => verifyReasoningExecutionMetadata(metadata),
      'UNKNOWN_PROPERTY'
    );
  }

  const nested = validExecutionMetadata();
  nested.objectiveAnalysis.provider.effectiveModel = 'gpt-otro';
  expectCode(
    () => verifyReasoningExecutionMetadata(nested),
    'UNKNOWN_PROPERTY'
  );
});

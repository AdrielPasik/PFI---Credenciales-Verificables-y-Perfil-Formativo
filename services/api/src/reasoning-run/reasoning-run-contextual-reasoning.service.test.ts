/**
 * Ejecución productiva del razonamiento contextual — F3.5.
 *
 * CERO llamadas reales. Lo que se prueba acá es lo que la granularidad congelada
 * hace observable: N Requirements ⇒ N llamadas, en el orden del snapshot, y CERO
 * llamadas después de la primera que falla.
 *
 * Los servicios de slots y el cargador de grounding son los REALES sobre un
 * Prisma falso: la reverificación de autoridades persistidas es justamente lo que
 * este slice agrega, y falsearla dejaría sin probar lo único importante.
 */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { createHash } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { ObjectiveAnalysisTransportError } from '../ai/ai-service.types';
import { canonicalJson } from '../source-extraction/canonical-json';
import { computeArtifactFingerprint } from '../source-extraction/source-extraction-artifact.invariants';
import { validateSourceExtractionArtifactShape } from '../source-extraction/source-extraction-artifact.validator';
import { SourceExtractionSlotService } from '../source-extraction/source-extraction-slot.service';
import { ReasoningRunArtifactSlotService } from './reasoning-run-artifact-slot.service';
import { ReasoningRunGroundingLoader } from './reasoning-run-grounding.loader';
import { ReasoningRunContextualReasoningService } from './reasoning-run-contextual-reasoning.service';
import { ContextualReasoningStageError } from './reasoning-run-contextual-reasoning.errors';
import {
  CONTEXTUAL_REASONING_STAGE_IDENTITY,
  EVIDENCE_UNITS_STAGE_IDENTITY,
  OBJECTIVE_ANALYSIS_STAGE_IDENTITY,
  REASONING_EXECUTION_MODEL_ENV
} from './product-stage-identity';

const RUN_ID = 'run-1';
const MODEL = 'gpt-5.6-terra';
const SOURCE_SHA = 'a'.repeat(64);
const ARS_ID = 'ars-1';
const TEXT = 'Curso de APIs REST.\n\nContenidos: endpoints y testing.';
const REQ_TEXT_A = 'Diseno de APIs REST';
const REQ_TEXT_B = 'Control de versiones en equipo';

/** La frase literal que cada Requirement puede citar como base. */
const BASIS_BY_TEXT: Record<string, string> = {
  [REQ_TEXT_A]: 'APIs REST',
  [REQ_TEXT_B]: 'Control de versiones'
};

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function withFingerprint(artifact: Record<string, unknown>): Record<string, unknown> {
  return {
    ...artifact,
    artifactContentFingerprint: computeArtifactFingerprint(
      validateSourceExtractionArtifactShape({
        ...artifact,
        artifactContentFingerprint: '0'.repeat(64)
      }) as never
    )
  };
}

function extractionArtifact(): Record<string, unknown> {
  return withFingerprint({
    schemaVersion: 'source_extraction_v1',
    sourceType: 'TEXT',
    source: { textEvidenceId: 'te_1', sourceSha256: SOURCE_SHA },
    extractionIdentity: {
      schemaVersion: 'source_extraction_v1',
      implementationVersion: 'test',
      parserProfile: 'TEXT_DIRECT'
    },
    sourceNormalizationApplied: 'PRODUCT_NFC_LINEENDINGS_TRIM',
    offsetUnit: 'UNICODE_CODE_POINT',
    coverageStatus: 'FULL',
    pages: [],
    documentCanonicalText: TEXT,
    segments: [
      { segmentId: 'd:0-19', pageIndex: null, charStart: 0, charEnd: 19, exactExcerpt: TEXT.slice(0, 19) },
      { segmentId: 'd:21-53', pageIndex: null, charStart: 21, charEnd: 53, exactExcerpt: TEXT.slice(21, 53) }
    ],
    diagnostics: [],
    artifactContentFingerprint: '0'.repeat(64)
  });
}

function persistedExtraction() {
  const json = canonicalJson(extractionArtifact());
  return { json, blobSha: sha256(json) };
}

function objectiveSnapshot(requirements: { id: string; text: string }[]): any {
  return {
    schemaVersion: 'objective_definition_v1',
    objectiveType: 'EMPLOYMENT',
    objectiveContext: 'Backend Developer Junior',
    source: { inputType: 'DIRECT_STRUCTURED_INPUT', originalText: null },
    requirements: requirements.map((item, index) => ({
      requirementId: item.id,
      order: index + 1,
      requirementText: item.text,
      provenance: { kind: 'DIRECT_STRUCTURED_INPUT', sourceQuote: null },
      qualifiers: []
    }))
  };
}

function analysisArtifact(requirements: { id: string; text: string }[]): any {
  return {
    schemaVersion: 'objective_analysis_v1',
    requirements: requirements.map(({ id, text }) => ({
      requirementId: id,
      epistemicTarget: 'FORMATIVE_EVIDENCE',
      epistemicTargetRationale: 'Pide formacion.',
      atomicity: 'ATOMIC',
      evaluability: {
        requiredEvidenceType: 'FORMATIVE_EVIDENCE',
        formativeEvidenceCapable: true,
        rationale: 'Evaluable.'
      },
      qualifiers: [
        {
          qualifierId: 'q_01',
          kind: 'tecnologia',
          value: 'REST',
          // Ancla LITERAL del texto de ESTE Requirement.
          sourcePhrase: BASIS_BY_TEXT[text],
          role: 'MATERIAL_QUALIFIER',
          rationale: 'Acota.'
        }
      ],
      normalizedRequirement: 'Formacion.',
      validations: [
        {
          taxonomy: 'SEMANTIC_CONSISTENCY',
          code: 'EPISTEMIC_TARGET_CLASSIFICATION',
          status: 'MANUAL_ADJUDICATION_REQUIRED',
          artifactRef: id,
          detail: 'FORMATIVE_EVIDENCE',
          affectsEpistemicState: false
        }
      ]
    }))
  };
}

function evidenceCatalog(): any {
  return {
    schemaVersion: 'evidence_units_v1',
    sources: [{ sourceId: 'src_01', sourceProvenance: 'ISSUER_DECLARED' }],
    evidenceUnits: [
      {
        evidenceUnitId: 'eu_01',
        normalizedProposition: 'Cubre APIs REST.',
        claimType: 'DECLARED_CONTENT',
        semanticQualifiers: [],
        exactQuote: TEXT.slice(0, 19),
        contextBefore: '',
        contextAfter: '',
        sectionLabel: null,
        sourceTrace: {
          sourceId: 'src_01',
          sourceSha256: SOURCE_SHA,
          segmentId: 'd:0-19',
          pageNumber: null,
          charStart: 0,
          charEnd: 19,
          exactExcerpt: TEXT.slice(0, 19)
        },
        interpretationProvenance: 'AI_INFERRED',
        extractionQuality: 'FULL'
      }
    ],
    preparation: {
      mode: 'FULL_SCAN',
      evidenceUnitIds: ['eu_01'],
      exactRedundancyGroups: [],
      sourceObservabilityFacts: [
        {
          sourceId: 'src_01',
          coverageStatus: 'FULL',
          observedEvidenceUnitIds: ['eu_01'],
          extractionDiagnostics: []
        }
      ],
      discardedEvidenceProposalCount: 0
    },
    validations: []
  };
}

function contextualResult(requirementId: string, basisPhrase: string): any {
  return {
    requirementId,
    evaluatedEvidence: [
      {
        evidenceUnitId: 'eu_01',
        relation: 'LIMITED_SCOPE',
        supportedQualifierIds: ['q_01'],
        missingQualifierIds: [],
        evidenceContribution: 'Menor alcance.',
        rationale: 'Mismo nucleo.'
      }
    ],
    facets: [],
    compositionAssessment: {
      mode: 'NONE',
      nonRedundantEvidenceUnitIds: ['eu_01'],
      jointlySupportsFullRequirement: false,
      integrationRequired: false,
      integrationDemonstrated: false,
      integrationEvidenceIds: [],
      missingFacetLocalKeys: [],
      unresolved: false,
      rationale: 'Una unidad.'
    },
    fullClaimAssessment: {
      status: 'NOT_REACHED',
      supportedQualifierIds: ['q_01'],
      missingQualifierIds: [],
      coveredFacetLocalKeys: [],
      missingFacetLocalKeys: [],
      rationale: 'No alcanza.'
    },
    jointClaimCeiling: { text: 'Formacion.', supportingEvidenceUnitIds: ['eu_01'] },
    observabilityAssessment: {
      incompleteSourceAssessments: [],
      independentObservableSupport: 'WEAKER_CLAIM',
      observabilityStatus: 'SUFFICIENT',
      rationale: 'Completa.'
    },
    weakerClaimSearch: {
      status: 'FOUND',
      rationale: 'Buscada.',
      candidate: {
        text: 'Version introductoria.',
        supportingEvidenceUnitIds: ['eu_01'],
        derivedFromJointClaimCeiling: 'YES',
        droppedQualifierIds: [],
        droppedFacetLocalKeys: [],
        continuityAssessment: {
          status: 'YES',
          transformation: 'CONSTITUTIVE_REDUCTION',
          requirementBasisPhrases: [basisPhrase],
          constitutiveProjection: 'Mas general.',
          explicitlyRelaxed: [],
          externalTargetIntroduced: 'NO',
          shiftReason: null,
          rationale: 'Mismo target.'
        },
        materialUsefulness: 'YES',
        usefulnessRationale: 'Aporta.'
      }
    },
    semanticUnresolved: false,
    unresolvedReason: ''
  };
}

function envelope(requirementId: string, basisPhrase: string): any {
  return {
    schemaVersion: 'product_contextual_reasoning_response_v1',
    execution: {
      artifactSchemaVersion: 'reasoning_run_result_v1',
      contextualResultSchemaVersion: 'contextual_reasoning_v1',
      promptVersion: CONTEXTUAL_REASONING_STAGE_IDENTITY.promptVersion,
      adapterVersion: CONTEXTUAL_REASONING_STAGE_IDENTITY.adapterVersion,
      provider: 'openai',
      requestedModel: MODEL,
      reasoningEffort: 'medium',
      effectiveModelVerification: 'MATCH'
    },
    contextualResult: contextualResult(requirementId, basisPhrase),
    validations: []
  };
}

function frozenPlan(overrides: Record<string, unknown> = {}): any {
  const stage = (identity: any) => ({
    artifactSchemaVersion: identity.artifactSchemaVersion,
    promptVersion: identity.promptVersion,
    adapterVersion: identity.adapterVersion,
    provider: { provider: 'openai', model: MODEL, reasoningEffort: 'medium' }
  });
  return {
    schemaVersion: 'reasoning_execution_metadata_v1',
    reasonerContractVersion: 'product_reasoner_v1',
    deterministicPolicyVersion: 'product_epistemic_policy_v1',
    objectiveAnalysis: stage(OBJECTIVE_ANALYSIS_STAGE_IDENTITY),
    evidenceUnits: stage(EVIDENCE_UNITS_STAGE_IDENTITY),
    contextualReasoning: { ...stage(CONTEXTUAL_REASONING_STAGE_IDENTITY), ...overrides }
  };
}

function matchesFilter(actual: unknown, expected: unknown): boolean {
  if (
    expected !== null &&
    typeof expected === 'object' &&
    'equals' in (expected as Record<string, unknown>)
  ) {
    const target = (expected as Record<string, unknown>).equals;
    if (target === Prisma.DbNull) return actual === null || actual === undefined;
    return actual === target;
  }
  return actual === expected;
}

function fakePrisma(
  options: { run?: Record<string, unknown>; requirements?: { id: string; text: string }[] } = {}
) {
  const requirements = options.requirements ?? [{ id: 'req_01', text: REQ_TEXT_A }];
  const { json, blobSha } = persistedExtraction();
  const state: { run: Record<string, any> | null } = {
    run: {
      id: RUN_ID,
      status: 'pending',
      failureCode: null,
      failedAt: null,
      objectiveDefinitionSnapshot: objectiveSnapshot(requirements),
      objectiveAnalysisArtifact: analysisArtifact(requirements),
      evidenceUnitsArtifact: evidenceCatalog(),
      resultArtifact: null,
      executionMetadata: frozenPlan(),
      ...options.run
    }
  };

  const prisma = {
    reasoningRun: {
      findUnique: async ({ where }: any) =>
        state.run && state.run.id === where.id ? { ...state.run } : null,
      updateMany: async ({ where, data }: any) => {
        const run = state.run;
        if (!run || run.id !== where.id) return { count: 0 };
        for (const [column, expected] of Object.entries(where)) {
          if (column === 'id') continue;
          if (!matchesFilter(run[column], expected)) return { count: 0 };
        }
        Object.assign(run, data);
        return { count: 1 };
      }
    },
    reasoningRunInventoryItem: {
      findMany: async () => [
        {
          disposition: 'INCLUDED',
          runLocalSourceId: 'src_01',
          sourceSha256: SOURCE_SHA,
          selectedAnalysisRunSourceId: ARS_ID,
          artifactBlobSha256: blobSha
        }
      ]
    },
    analysisRunSource: {
      findUnique: async ({ where }: any) =>
        where.id === ARS_ID
          ? {
              extractionArtifactCanonicalJson: json,
              artifactBlobSha256: blobSha,
              extractionDerivationTrust: 'PRIMARY_EXTRACTION'
            }
          : null
    }
  };

  return { prisma, state };
}

interface AiCall {
  requirement: { requirementId: string; requirementText: string };
  evidenceUnits: unknown[];
  [key: string]: unknown;
}

function fakeAi(
  behaviour: { failAt?: string; error?: Error; response?: (id: string) => unknown } = {}
) {
  const calls: AiCall[] = [];
  const ai = {
    analyzeContextualReasoning: async (input: AiCall) => {
      calls.push(input);
      const id = input.requirement.requirementId;
      if (behaviour.failAt === id) {
        throw behaviour.error ?? new Error('unexpected');
      }
      if (behaviour.response) return behaviour.response(id);
      // La cita de continuidad se toma del texto de ESTE Requirement.
      return envelope(id, BASIS_BY_TEXT[(input.requirement as any).requirementText]);
    }
  };
  return { ai, calls };
}

function service(prisma: unknown, ai: unknown): ReasoningRunContextualReasoningService {
  return new ReasoningRunContextualReasoningService(
    prisma as never,
    new ReasoningRunArtifactSlotService(prisma as never),
    new ReasoningRunGroundingLoader(
      prisma as never,
      new SourceExtractionSlotService(prisma as never)
    ),
    ai as never
  );
}

function withModel(context: TestContext, model: string | null = MODEL): void {
  const previous = process.env[REASONING_EXECUTION_MODEL_ENV];
  if (model === null) delete process.env[REASONING_EXECUTION_MODEL_ENV];
  else process.env[REASONING_EXECUTION_MODEL_ENV] = model;
  context.after(() => {
    if (previous === undefined) delete process.env[REASONING_EXECUTION_MODEL_ENV];
    else process.env[REASONING_EXECUTION_MODEL_ENV] = previous;
  });
}

async function expectStageCode(
  fn: () => Promise<unknown>,
  code: string
): Promise<ContextualReasoningStageError> {
  try {
    await fn();
  } catch (error: unknown) {
    assert.ok(error instanceof ContextualReasoningStageError, String(error));
    assert.equal(error.code, code);
    return error;
  }
  throw new Error(`expected ${code} but nothing was thrown`);
}

const TWO = [
  { id: 'req_01', text: REQ_TEXT_A },
  { id: 'req_02', text: REQ_TEXT_B }
];
const FOUR = [
  ...TWO,
  { id: 'req_03', text: REQ_TEXT_A },
  { id: 'req_04', text: REQ_TEXT_B }
];

// ---------------------------------------------------------------------------
// Granularidad: N Requirements ⇒ N llamadas
// ---------------------------------------------------------------------------

test('N Requirements producen EXACTAMENTE N llamadas', async (context) => {
  withModel(context);
  const { prisma } = fakePrisma({ requirements: FOUR });
  const { ai, calls } = fakeAi();

  const outcome = await service(prisma, ai).generateContextualReasoningForRun(RUN_ID);

  assert.equal(calls.length, 4);
  assert.equal(outcome.providerCallsMade, 4);
  assert.equal(outcome.contextualReasoning.requirementResults.length, 4);
});

test('el orden de ejecucion es el del snapshot del Objective', async (context) => {
  withModel(context);
  const { prisma } = fakePrisma({ requirements: FOUR });
  const { ai, calls } = fakeAi();

  await service(prisma, ai).generateContextualReasoningForRun(RUN_ID);

  assert.deepEqual(
    calls.map((call) => call.requirement.requirementId),
    ['req_01', 'req_02', 'req_03', 'req_04']
  );
});

test('cada llamada lleva el catalogo COMPLETO', async (context) => {
  withModel(context);
  const { prisma } = fakePrisma({ requirements: TWO });
  const { ai, calls } = fakeAi();

  await service(prisma, ai).generateContextualReasoningForRun(RUN_ID);

  for (const call of calls) {
    assert.deepEqual(
      (call.evidenceUnits as any[]).map((unit) => unit.evidenceUnitId),
      ['eu_01']
    );
  }
});

test('el agregado conserva el orden y lo arma codigo confiable', async (context) => {
  withModel(context);
  const { prisma } = fakePrisma({ requirements: TWO });
  const { ai } = fakeAi();

  const outcome = await service(prisma, ai).generateContextualReasoningForRun(RUN_ID);

  assert.equal(outcome.contextualReasoning.schemaVersion, 'contextual_reasoning_v1');
  assert.deepEqual(
    outcome.contextualReasoning.requirementResults.map((item) => item.requirementId),
    ['req_01', 'req_02']
  );
});

// ---------------------------------------------------------------------------
// FAIL-FAST
// ---------------------------------------------------------------------------

test('salida invalida en req_02 de 4: cero llamadas para req_03 y req_04', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma({ requirements: FOUR });
  const { ai, calls } = fakeAi({
    failAt: 'req_02',
    error: new ObjectiveAnalysisTransportError('PROVIDER_INVALID_OUTPUT', 502)
  });

  const error = await expectStageCode(
    () => service(prisma, ai).generateContextualReasoningForRun(RUN_ID),
    'PROVIDER_INVALID_OUTPUT'
  );

  assert.equal(calls.length, 2, 'se corta en el primero que falla');
  assert.deepEqual(
    calls.map((call) => call.requirement.requirementId),
    ['req_01', 'req_02']
  );
  assert.equal(error.requirementId, 'req_02');
  assert.equal(error.providerCallsMade, 2);
  assert.equal(state.run!.failureCode, 'reasoning_contextual_reasoning_invalid_output');
});

test('un fallo determinista de configuracion tambien corta', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma({ requirements: FOUR });
  const { ai, calls } = fakeAi({
    failAt: 'req_02',
    error: new ObjectiveAnalysisTransportError('PROVIDER_CONFIGURATION_FAILURE', 424)
  });

  await expectStageCode(
    () => service(prisma, ai).generateContextualReasoningForRun(RUN_ID),
    'PROVIDER_CONFIGURATION_FAILURE'
  );
  assert.equal(calls.length, 2);
  assert.equal(state.run!.failureCode, 'reasoning_provider_configuration_invalid');
});

test('un desajuste de modelo efectivo en req_02 corta', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma({ requirements: FOUR });
  const { ai, calls } = fakeAi({
    failAt: 'req_02',
    error: new ObjectiveAnalysisTransportError('EXECUTION_PLAN_MISMATCH', 409)
  });

  await expectStageCode(
    () => service(prisma, ai).generateContextualReasoningForRun(RUN_ID),
    'EXECUTION_PLAN_MISMATCH'
  );
  // Que req_01 haya dado MATCH no autoriza a seguir bajo otra observacion.
  assert.equal(calls.length, 2);
  assert.equal(state.run!.failureCode, 'reasoning_execution_plan_mismatch');
});

test('un fallo transitorio en req_02 deja el run intacto y reintentable', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma({ requirements: FOUR });
  const { ai, calls } = fakeAi({
    failAt: 'req_02',
    error: new ObjectiveAnalysisTransportError('PROVIDER_TRANSPORT_FAILURE', 503)
  });

  await expectStageCode(
    () => service(prisma, ai).generateContextualReasoningForRun(RUN_ID),
    'PROVIDER_TRANSPORT_FAILURE'
  );

  assert.equal(calls.length, 2);
  assert.equal(state.run!.status, 'pending');
  assert.equal(state.run!.failureCode, null);
  assert.equal(state.run!.resultArtifact, null);
});

test('el reintento vuelve a empezar por el PRIMER Requirement', async (context) => {
  // No hay checkpoint: "cuales ya salieron bien" no es un hecho que exista.
  withModel(context);
  const { prisma } = fakePrisma({ requirements: TWO });
  let failNext = true;
  const calls: string[] = [];
  const ai = {
    analyzeContextualReasoning: async (input: any) => {
      const id = input.requirement.requirementId;
      calls.push(id);
      if (failNext && id === 'req_02') {
        failNext = false;
        throw new ObjectiveAnalysisTransportError('PROVIDER_TRANSPORT_FAILURE', 503);
      }
      return envelope(id, BASIS_BY_TEXT[input.requirement.requirementText]);
    }
  };
  const target = service(prisma, ai);

  await assert.rejects(() => target.generateContextualReasoningForRun(RUN_ID));
  const outcome = await target.generateContextualReasoningForRun(RUN_ID);

  assert.deepEqual(calls, ['req_01', 'req_02', 'req_01', 'req_02']);
  assert.equal(outcome.providerCallsMade, 2);
  // Dos observaciones fisicas de req_01 en la vida del run: la etapa no es
  // idempotente y no se afirma que lo sea.
  assert.equal(calls.filter((id) => id === 'req_01').length, 2);
});

test('un resultado que responde por otro Requirement corta', async (context) => {
  withModel(context);
  const { prisma } = fakePrisma({ requirements: FOUR });
  const { ai, calls } = fakeAi({
    response: (id) => envelope(id === 'req_02' ? 'req_03' : id, 'APIs REST')
  });

  await expectStageCode(
    () => service(prisma, ai).generateContextualReasoningForRun(RUN_ID),
    'PROVIDER_INVALID_OUTPUT'
  );
  assert.equal(calls.length, 2);
});

// ---------------------------------------------------------------------------
// Autoridades previas
// ---------------------------------------------------------------------------

test('sin objectiveAnalysisArtifact no se llama al proveedor', async (context) => {
  withModel(context);
  const { prisma } = fakePrisma({ run: { objectiveAnalysisArtifact: null } });
  const { ai, calls } = fakeAi();

  await expectStageCode(
    () => service(prisma, ai).generateContextualReasoningForRun(RUN_ID),
    'PREVIOUS_STAGE_ARTIFACT_MISSING'
  );
  assert.equal(calls.length, 0);
});

test('sin evidenceUnitsArtifact no se llama al proveedor', async (context) => {
  withModel(context);
  const { prisma } = fakePrisma({ run: { evidenceUnitsArtifact: null } });
  const { ai, calls } = fakeAi();

  await expectStageCode(
    () => service(prisma, ai).generateContextualReasoningForRun(RUN_ID),
    'PREVIOUS_STAGE_ARTIFACT_MISSING'
  );
  assert.equal(calls.length, 0);
});

test('un artifact previo corrupto no se llama y mata el run', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma({
    run: { objectiveAnalysisArtifact: { schemaVersion: 'otra_cosa' } }
  });
  const { ai, calls } = fakeAi();

  await expectStageCode(
    () => service(prisma, ai).generateContextualReasoningForRun(RUN_ID),
    'PERSISTED_AUTHORITY_UNUSABLE'
  );
  assert.equal(calls.length, 0);
  assert.equal(state.run!.failureCode, 'reasoning_contextual_authority_unusable');
});

test('un snapshot de Objective corrupto no se llama', async (context) => {
  withModel(context);
  const { prisma } = fakePrisma({ run: { objectiveDefinitionSnapshot: { schemaVersion: 'x' } } });
  const { ai, calls } = fakeAi();

  await expectStageCode(
    () => service(prisma, ai).generateContextualReasoningForRun(RUN_ID),
    'PERSISTED_AUTHORITY_UNUSABLE'
  );
  assert.equal(calls.length, 0);
});

test('un excerpt manipulado despues de F3.4 no se llama', async (context) => {
  // Que F3.4 lo haya verificado al escribirlo no dice nada del estado de hoy.
  withModel(context);
  const tampered = evidenceCatalog();
  tampered.evidenceUnits[0].exactQuote = 'Curso de PYTHON.';
  tampered.evidenceUnits[0].sourceTrace.exactExcerpt = 'Curso de PYTHON.';
  const { prisma, state } = fakePrisma({ run: { evidenceUnitsArtifact: tampered } });
  const { ai, calls } = fakeAi();

  await expectStageCode(
    () => service(prisma, ai).generateContextualReasoningForRun(RUN_ID),
    'PERSISTED_AUTHORITY_UNUSABLE'
  );
  assert.equal(calls.length, 0);
  assert.equal(state.run!.failureCode, 'reasoning_contextual_authority_unusable');
});

test('un run ya fallado no ejecuta la etapa', async (context) => {
  withModel(context);
  const { prisma } = fakePrisma({
    run: { status: 'failed', failureCode: 'reasoning_input_freeze_blocked' }
  });
  const { ai, calls } = fakeAi();

  await expectStageCode(
    () => service(prisma, ai).generateContextualReasoningForRun(RUN_ID),
    'RUN_NOT_ELIGIBLE'
  );
  assert.equal(calls.length, 0);
});

test('un run que ya tiene resultado final no se reejecuta', async (context) => {
  withModel(context);
  const { prisma } = fakePrisma({ run: { resultArtifact: { schemaVersion: 'x' } } });
  const { ai, calls } = fakeAi();

  await expectStageCode(
    () => service(prisma, ai).generateContextualReasoningForRun(RUN_ID),
    'RUN_NOT_ELIGIBLE'
  );
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

test('deriva del plan contextual: cero llamadas y run failed', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma({
    run: { executionMetadata: frozenPlan({ promptVersion: 'product_contextual_reasoning_v0' }) }
  });
  const { ai, calls } = fakeAi();

  await expectStageCode(
    () => service(prisma, ai).generateContextualReasoningForRun(RUN_ID),
    'EXECUTION_PLAN_MISMATCH'
  );
  assert.equal(calls.length, 0);
  assert.equal(state.run!.failureCode, 'reasoning_execution_plan_mismatch');
});

test('el plan usa el artifact de la ETAPA, no el contrato transitorio', async (context) => {
  // `artifactSchemaVersion` de `contextualReasoning` es `reasoning_run_result_v1`:
  // el transitorio tiene version propia y NO lo reemplaza. Un plan que lo
  // reemplazara no llega siquiera a compararse — el validador de
  // `reasoning_execution_metadata_v1` lo rechaza como corrupto, porque cada etapa
  // debe nombrar SU propio artifact.
  withModel(context);
  const { prisma } = fakePrisma({
    run: { executionMetadata: frozenPlan({ artifactSchemaVersion: 'contextual_reasoning_v1' }) }
  });
  const { ai, calls } = fakeAi();

  await expectStageCode(
    () => service(prisma, ai).generateContextualReasoningForRun(RUN_ID),
    'PERSISTED_AUTHORITY_UNUSABLE'
  );
  assert.equal(calls.length, 0);
});

test('sin modelo configurado no se congela un plan a medias', async (context) => {
  withModel(context, null);
  const { prisma, state } = fakePrisma({ run: { executionMetadata: null } });
  const { ai, calls } = fakeAi();

  await expectStageCode(
    () => service(prisma, ai).generateContextualReasoningForRun(RUN_ID),
    'EXECUTION_CONFIGURATION_MISSING'
  );
  assert.equal(calls.length, 0);
  assert.equal(state.run!.executionMetadata, null);
});

// ---------------------------------------------------------------------------
// Persistencia: F3.5 NO escribe nada
// ---------------------------------------------------------------------------

test('un exito NO persiste resultArtifact ni completa el run', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma({ requirements: TWO });
  const { ai } = fakeAi();

  await service(prisma, ai).generateContextualReasoningForRun(RUN_ID);

  assert.equal(state.run!.resultArtifact, null);
  assert.equal(state.run!.status, 'pending');
  assert.equal(state.run!.failureCode, null);
});

test('la marca terminal exige resultArtifact ausente', async (context) => {
  // Lo que protege no es un exito de F3.5 —no existe— sino un final YA PERSISTIDO
  // por F3.6, que un intento tardio de F3.5 no puede pisar.
  withModel(context);
  const { prisma, state } = fakePrisma({ requirements: TWO });
  const filters: any[] = [];
  const original = prisma.reasoningRun.updateMany;
  prisma.reasoningRun.updateMany = async (args: any) => {
    filters.push(args.where);
    return original(args);
  };
  const { ai } = fakeAi({
    failAt: 'req_01',
    error: new ObjectiveAnalysisTransportError('PROVIDER_INVALID_OUTPUT', 502)
  });

  await assert.rejects(() => service(prisma, ai).generateContextualReasoningForRun(RUN_ID));

  const terminal = filters.find((where) => 'resultArtifact' in where);
  assert.ok(terminal);
  assert.equal(terminal.status, 'pending');
  assert.equal(terminal.failureCode, null);
  assert.deepEqual(terminal.resultArtifact, { equals: Prisma.DbNull });
  void state;
});

// ---------------------------------------------------------------------------
// Lo que viaja
// ---------------------------------------------------------------------------

test('el request no lleva material crudo de fuente ni semantica legacy', async (context) => {
  withModel(context);
  const { prisma } = fakePrisma();
  const { ai, calls } = fakeAi();

  await service(prisma, ai).generateContextualReasoningForRun(RUN_ID);

  const serialized = JSON.stringify(calls[0]);
  for (const forbidden of [
    'documentCanonicalText',
    'source_extraction_v1',
    'storageKey',
    'credentialId',
    'documentEvidenceId',
    'textEvidenceId',
    ARS_ID,
    'semanticAnalysis',
    'formativeProfile',
    'artifactContentFingerprint'
  ]) {
    assert.ok(!serialized.includes(forbidden), forbidden);
  }
});

test('la provenance viaja proyectada por fuente', async (context) => {
  withModel(context);
  const { prisma } = fakePrisma();
  const { ai, calls } = fakeAi();

  await service(prisma, ai).generateContextualReasoningForRun(RUN_ID);

  assert.deepEqual(calls[0].sources, [
    { sourceId: 'src_01', sourceProvenance: 'ISSUER_DECLARED', coverageStatus: 'FULL' }
  ]);
});

test('cada llamada recibe SOLO su Requirement', async (context) => {
  withModel(context);
  const { prisma } = fakePrisma({ requirements: TWO });
  const { ai, calls } = fakeAi();

  await service(prisma, ai).generateContextualReasoningForRun(RUN_ID);

  for (const call of calls) {
    assert.equal(typeof call.requirement.requirementId, 'string');
    assert.equal('requirements' in call, false, 'no viaja el conjunto');
  }
});

test('el metodo no recibe NINGUNA autoridad del llamante', () => {
  // Si el llamante pudiera pasar el Objective, podria pasar OTRO Objective, y el
  // snapshot congelado dejaria de ser la autoridad del run.
  //
  // F3.6 agrego un SEGUNDO parametro que NO es autoridad: la claim de ejecucion
  // es una capability que nombra la fila ya reclamada, no un dato contra el cual
  // validar. Sigue sin haber forma de pasar Requirements, inventario ni catalogo.
  assert.equal(
    ReasoningRunContextualReasoningService.prototype.generateContextualReasoningForRun.length,
    2
  );
});

// ---------------------------------------------------------------------------
// Privacidad
// ---------------------------------------------------------------------------

test('los errores no filtran texto del Requirement', async (context) => {
  withModel(context);
  const { prisma } = fakePrisma({ requirements: TWO });
  const { ai } = fakeAi({
    failAt: 'req_02',
    error: new ObjectiveAnalysisTransportError('PROVIDER_INVALID_OUTPUT', 502)
  });

  const error = await expectStageCode(
    () => service(prisma, ai).generateContextualReasoningForRun(RUN_ID),
    'PROVIDER_INVALID_OUTPUT'
  );
  assert.ok(!error.message.includes(REQ_TEXT_A));
  assert.ok(!error.message.includes(REQ_TEXT_B));
  assert.equal(error.requirementId, 'req_02');
});

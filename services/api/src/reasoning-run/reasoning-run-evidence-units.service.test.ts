/**
 * Ejecución productiva del catálogo de EvidenceUnits — F3.4.
 *
 * CERO llamadas reales: el `AiServiceClient` se falsea y cuenta invocaciones.
 *
 * Los servicios de slots son los REALES sobre un Prisma falso — el de artifacts y
 * el de extracción—, porque lo único que importa de verdad acá es que la
 * verificación contra el inventario, la verificación source-addressable y el
 * compare-and-set corran de punta a punta.
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
import { ReasoningRunGroundingLoader } from './reasoning-run-grounding.loader';
import { ReasoningRunArtifactSlotService } from './reasoning-run-artifact-slot.service';
import { ReasoningRunEvidenceUnitsService } from './reasoning-run-evidence-units.service';
import { EvidenceUnitsStageError } from './reasoning-run-evidence-units.errors';
import {
  EVIDENCE_UNITS_STAGE_IDENTITY,
  OBJECTIVE_ANALYSIS_STAGE_IDENTITY,
  CONTEXTUAL_REASONING_STAGE_IDENTITY,
  REASONING_EXECUTION_MODEL_ENV
} from './product-stage-identity';

const RUN_ID = 'run-1';
const MODEL = 'gpt-5.6-terra';
const SOURCE_SHA = 'a'.repeat(64);
const ANALYSIS_RUN_SOURCE_ID = 'ars-1';
const TEXT = 'Curso de APIs REST.\n\nContenidos: endpoints y testing.';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** El fingerprint REAL, recomputado igual que lo hace el verificador de F0. */
function withFingerprint(artifact: Record<string, unknown>): Record<string, unknown> {
  const fingerprint = computeArtifactFingerprint(
    validateSourceExtractionArtifactShape({
      ...artifact,
      artifactContentFingerprint: '0'.repeat(64)
    }) as never
  );
  return { ...artifact, artifactContentFingerprint: fingerprint };
}

function extractionArtifact(canonical = TEXT): Record<string, unknown> {
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
    documentCanonicalText: canonical,
    segments: [
      { segmentId: 'd:0-19', pageIndex: null, charStart: 0, charEnd: 19, exactExcerpt: canonical.slice(0, 19) },
      { segmentId: 'd:21-53', pageIndex: null, charStart: 21, charEnd: 53, exactExcerpt: canonical.slice(21, 53) }
    ],
    diagnostics: [],
    artifactContentFingerprint: '0'.repeat(64)
  });
}

/** El JSON canónico persistido y su SHA, tal como los guarda F1.4. */
function persistedExtraction(canonical = TEXT) {
  const json = canonicalJson(extractionArtifact(canonical));
  return { json, blobSha: sha256(json) };
}

function evidenceUnit(overrides: Record<string, any> = {}): any {
  const trace = {
    sourceId: 'src_01',
    sourceSha256: SOURCE_SHA,
    segmentId: 'd:0-19',
    pageNumber: null,
    charStart: 0,
    charEnd: 19,
    exactExcerpt: TEXT.slice(0, 19),
    ...(overrides.sourceTrace ?? {})
  };
  return {
    evidenceUnitId: 'eu_01',
    normalizedProposition: 'El curso cubre APIs REST.',
    claimType: 'DECLARED_CONTENT',
    semanticQualifiers: [],
    exactQuote: trace.exactExcerpt,
    contextBefore: '',
    contextAfter: '',
    sectionLabel: null,
    sourceTrace: trace,
    interpretationProvenance: 'AI_INFERRED',
    extractionQuality: 'FULL'
  };
}

function catalogArtifact(units: any[] = [evidenceUnit()], sourceIds = ['src_01']): any {
  return {
    schemaVersion: 'evidence_units_v1',
    sources: sourceIds.map((sourceId) => ({
      sourceId,
      sourceProvenance: 'ISSUER_DECLARED'
    })),
    evidenceUnits: units,
    preparation: {
      mode: 'FULL_SCAN',
      evidenceUnitIds: units.map((item) => item.evidenceUnitId),
      exactRedundancyGroups: [],
      sourceObservabilityFacts: sourceIds.map((sourceId) => ({
        sourceId,
        coverageStatus: 'FULL',
        observedEvidenceUnitIds: units
          .filter((item) => item.sourceTrace.sourceId === sourceId)
          .map((item) => item.evidenceUnitId),
        extractionDiagnostics: []
      })),
      discardedEvidenceProposalCount: 0
    },
    validations: []
  };
}

function envelope(artifact: any = catalogArtifact()): any {
  return {
    schemaVersion: 'product_evidence_units_response_v1',
    execution: {
      artifactSchemaVersion: 'evidence_units_v1',
      promptVersion: EVIDENCE_UNITS_STAGE_IDENTITY.promptVersion,
      adapterVersion: EVIDENCE_UNITS_STAGE_IDENTITY.adapterVersion,
      provider: 'openai',
      requestedModel: MODEL,
      reasoningEffort: 'medium',
      providerCalled: true,
      effectiveModelVerification: 'MATCH'
    },
    artifact
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
    evidenceUnits: { ...stage(EVIDENCE_UNITS_STAGE_IDENTITY), ...overrides },
    contextualReasoning: stage(CONTEXTUAL_REASONING_STAGE_IDENTITY)
  };
}

interface FakeRun {
  id: string;
  status: string;
  failureCode: string | null;
  failedAt: Date | null;
  objectiveDefinitionSnapshot: unknown;
  objectiveAnalysisArtifact: unknown;
  evidenceUnitsArtifact: unknown;
  resultArtifact: unknown;
  executionMetadata: unknown;
}

interface FakeInventoryItem {
  disposition: string;
  runLocalSourceId: string | null;
  sourceSha256: string | null;
  selectedAnalysisRunSourceId: string | null;
  artifactBlobSha256: string | null;
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
  options: {
    run?: Partial<FakeRun>;
    inventory?: FakeInventoryItem[];
    extractionSlots?: Record<string, any>;
  } = {}
) {
  const { json, blobSha } = persistedExtraction();
  const state: { run: FakeRun | null } = {
    run: {
      id: RUN_ID,
      status: 'pending',
      failureCode: null,
      failedAt: null,
      objectiveDefinitionSnapshot: null,
      objectiveAnalysisArtifact: null,
      evidenceUnitsArtifact: null,
      resultArtifact: null,
      executionMetadata: null,
      ...options.run
    }
  };
  const inventory = options.inventory ?? [
    {
      disposition: 'INCLUDED',
      runLocalSourceId: 'src_01',
      sourceSha256: SOURCE_SHA,
      selectedAnalysisRunSourceId: ANALYSIS_RUN_SOURCE_ID,
      artifactBlobSha256: blobSha
    }
  ];
  const extractionSlots = options.extractionSlots ?? {
    [ANALYSIS_RUN_SOURCE_ID]: {
      extractionArtifactCanonicalJson: json,
      artifactBlobSha256: blobSha,
      extractionDerivationTrust: 'PRIMARY_EXTRACTION'
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
          if (!matchesFilter((run as any)[column], expected)) return { count: 0 };
        }
        Object.assign(run, data);
        return { count: 1 };
      }
    },
    reasoningRunInventoryItem: {
      findMany: async ({ where }: any) =>
        inventory
          .filter((item) => !where?.disposition || item.disposition === where.disposition)
          .map((item) => ({ ...item }))
    },
    analysisRunSource: {
      findUnique: async ({ where }: any) => extractionSlots[where.id] ?? null
    }
  };

  return { prisma, state, inventory, blobSha, json };
}

function fakeAi(behaviour: { response?: unknown; throws?: Error } = {}) {
  const calls: any[] = [];
  const ai = {
    analyzeEvidenceUnits: async (input: any) => {
      calls.push(input);
      if (behaviour.throws) throw behaviour.throws;
      return behaviour.response ?? envelope();
    }
  };
  return { ai, calls };
}

function service(prisma: unknown, ai: unknown): ReasoningRunEvidenceUnitsService {
  return new ReasoningRunEvidenceUnitsService(
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
): Promise<EvidenceUnitsStageError> {
  try {
    await fn();
  } catch (error: unknown) {
    assert.ok(error instanceof EvidenceUnitsStageError, String(error));
    assert.equal(error.code, code);
    return error;
  }
  throw new Error(`expected ${code} but nothing was thrown`);
}

// ---------------------------------------------------------------------------
// Camino feliz
// ---------------------------------------------------------------------------

test('un run pendiente congela el plan, llama UNA vez y persiste el catalogo', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma();
  const { ai, calls } = fakeAi();

  const outcome = await service(prisma, ai).ensureEvidenceUnitsForRun(RUN_ID);

  assert.equal(calls.length, 1);
  assert.equal(outcome.providerCalled, true);
  assert.equal(outcome.includedSourceCount, 1);
  assert.equal(outcome.artifact.evidenceUnits.length, 1);
  assert.notEqual(state.run!.evidenceUnitsArtifact, null);
  assert.notEqual(state.run!.executionMetadata, null);
});

test('el run exitoso queda pending: falta el razonamiento contextual', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma();
  await service(prisma, fakeAi().ai).ensureEvidenceUnitsForRun(RUN_ID);

  assert.equal(state.run!.status, 'pending');
  assert.equal(state.run!.failureCode, null);
});

test('el metodo no recibe NINGUNA autoridad del llamante', () => {
  // Si el llamante pudiera pasar el Objective, podria pasar OTRO Objective, y el
  // snapshot congelado dejaria de ser la autoridad del run.
  //
  // F3.6 agrego un SEGUNDO parametro que NO es autoridad: la claim de ejecucion
  // es una capability que nombra la fila ya reclamada, no un dato contra el cual
  // validar. Sigue sin haber forma de pasar Requirements, inventario ni catalogo.
  assert.equal(
    ReasoningRunEvidenceUnitsService.prototype.ensureEvidenceUnitsForRun.length,
    2
  );
});

test('NO exige objectiveAnalysisArtifact: las etapas son independientes', async (context) => {
  withModel(context);
  const { prisma } = fakePrisma({ run: { objectiveAnalysisArtifact: null } });
  const outcome = await service(prisma, fakeAi().ai).ensureEvidenceUnitsForRun(RUN_ID);
  assert.equal(outcome.providerCalled, true);
});

// ---------------------------------------------------------------------------
// Autoridad del grounding set
// ---------------------------------------------------------------------------

test('solo viajan fuentes INCLUDED, con su binding congelado', async (context) => {
  withModel(context);
  const { blobSha } = persistedExtraction();
  const { prisma } = fakePrisma({
    inventory: [
      {
        disposition: 'INCLUDED',
        runLocalSourceId: 'src_01',
        sourceSha256: SOURCE_SHA,
        selectedAnalysisRunSourceId: ANALYSIS_RUN_SOURCE_ID,
        artifactBlobSha256: blobSha
      },
      {
        disposition: 'EXCLUDED_NO_SOURCE',
        runLocalSourceId: null,
        sourceSha256: null,
        selectedAnalysisRunSourceId: null,
        artifactBlobSha256: null
      }
    ]
  });
  const { ai, calls } = fakeAi();

  await service(prisma, ai).ensureEvidenceUnitsForRun(RUN_ID);

  assert.deepEqual(calls[0].sources.map((item: any) => item.sourceId), ['src_01']);
});

test('el request no lleva identidad de nuestra base', async (context) => {
  withModel(context);
  const { prisma } = fakePrisma();
  const { ai, calls } = fakeAi();

  await service(prisma, ai).ensureEvidenceUnitsForRun(RUN_ID);

  assert.deepEqual(Object.keys(calls[0]).sort(), [
    'correlationId',
    'executionPlan',
    'schemaVersion',
    'sources'
  ]);
  assert.deepEqual(Object.keys(calls[0].sources[0]).sort(), [
    'canonicalText',
    'coverageStatus',
    'diagnostics',
    'pages',
    'segments',
    'sourceId',
    'sourceSha256'
  ]);

  const serialized = JSON.stringify(calls[0]);
  for (const forbidden of [
    'credentialId',
    'documentEvidenceId',
    'textEvidenceId',
    ANALYSIS_RUN_SOURCE_ID,
    'artifactBlobSha256',
    'objective',
    'requirement'
  ]) {
    assert.ok(!serialized.includes(forbidden), forbidden);
  }
});

test('no se busca otra extraccion ni se llama a la orquestacion', async (context) => {
  withModel(context);
  const { prisma } = fakePrisma();
  let otherLookups = 0;
  const original = prisma.analysisRunSource.findUnique;
  prisma.analysisRunSource.findUnique = async (args: any) => {
    if (args.where.id !== ANALYSIS_RUN_SOURCE_ID) otherLookups += 1;
    return original(args);
  };

  await service(prisma, fakeAi().ai).ensureEvidenceUnitsForRun(RUN_ID);
  assert.equal(otherLookups, 0, 'se reusa el candidato congelado, no se reelige');
});

// ---------------------------------------------------------------------------
// Grounding inutilizable
// ---------------------------------------------------------------------------

test('un slot de extraccion ausente mata el run sin llamar', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma({
    extractionSlots: {
      [ANALYSIS_RUN_SOURCE_ID]: {
        extractionArtifactCanonicalJson: null,
        artifactBlobSha256: null,
        extractionDerivationTrust: null
      }
    }
  });
  const { ai, calls } = fakeAi();

  await expectStageCode(
    () => service(prisma, ai).ensureEvidenceUnitsForRun(RUN_ID),
    'GROUNDING_INPUT_UNUSABLE'
  );
  assert.equal(calls.length, 0);
  assert.equal(state.run!.status, 'failed');
  assert.equal(state.run!.failureCode, 'reasoning_evidence_units_grounding_unusable');
});

test('un artifactBlobSha256 que ya no coincide mata el run sin llamar', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma();
  const { ai, calls } = fakeAi();
  // El inventario congeló otro SHA que el que tiene el slot hoy.
  const inventoryRow = (await prisma.reasoningRunInventoryItem.findMany({ where: {} }))[0];
  void inventoryRow;
  prisma.reasoningRunInventoryItem.findMany = async () => [
    {
      disposition: 'INCLUDED',
      runLocalSourceId: 'src_01',
      sourceSha256: SOURCE_SHA,
      selectedAnalysisRunSourceId: ANALYSIS_RUN_SOURCE_ID,
      artifactBlobSha256: 'f'.repeat(64)
    }
  ];

  await expectStageCode(
    () => service(prisma, ai).ensureEvidenceUnitsForRun(RUN_ID),
    'GROUNDING_INPUT_UNUSABLE'
  );
  assert.equal(calls.length, 0);
  assert.equal(state.run!.failureCode, 'reasoning_evidence_units_grounding_unusable');
});

test('una extraccion corrupta mata el run sin llamar', async (context) => {
  withModel(context);
  const { prisma } = fakePrisma({
    extractionSlots: {
      [ANALYSIS_RUN_SOURCE_ID]: {
        extractionArtifactCanonicalJson: '{"schemaVersion":"otra_cosa"}',
        artifactBlobSha256: sha256('{"schemaVersion":"otra_cosa"}'),
        extractionDerivationTrust: 'PRIMARY_EXTRACTION'
      }
    },
    inventory: [
      {
        disposition: 'INCLUDED',
        runLocalSourceId: 'src_01',
        sourceSha256: SOURCE_SHA,
        selectedAnalysisRunSourceId: ANALYSIS_RUN_SOURCE_ID,
        artifactBlobSha256: sha256('{"schemaVersion":"otra_cosa"}')
      }
    ]
  });
  const { ai, calls } = fakeAi();

  await expectStageCode(
    () => service(prisma, ai).ensureEvidenceUnitsForRun(RUN_ID),
    'GROUNDING_INPUT_UNUSABLE'
  );
  assert.equal(calls.length, 0);
});

test('una sola fuente rota bloquea la etapa entera', async (context) => {
  // No hay ejecucion parcial: el universo del stage o sirve entero o no se llama.
  withModel(context);
  const { blobSha } = persistedExtraction();
  const { prisma } = fakePrisma({
    inventory: [
      {
        disposition: 'INCLUDED',
        runLocalSourceId: 'src_01',
        sourceSha256: SOURCE_SHA,
        selectedAnalysisRunSourceId: ANALYSIS_RUN_SOURCE_ID,
        artifactBlobSha256: blobSha
      },
      {
        disposition: 'INCLUDED',
        runLocalSourceId: 'src_02',
        sourceSha256: SOURCE_SHA,
        selectedAnalysisRunSourceId: 'ars-missing',
        artifactBlobSha256: blobSha
      }
    ]
  });
  const { ai, calls } = fakeAi();

  await expectStageCode(
    () => service(prisma, ai).ensureEvidenceUnitsForRun(RUN_ID),
    'GROUNDING_INPUT_UNUSABLE'
  );
  assert.equal(calls.length, 0);
});

test('el fallo de grounding NO reescribe la disposicion del inventario', async (context) => {
  withModel(context);
  const { prisma, inventory } = fakePrisma({
    extractionSlots: {
      [ANALYSIS_RUN_SOURCE_ID]: {
        extractionArtifactCanonicalJson: null,
        artifactBlobSha256: null,
        extractionDerivationTrust: null
      }
    }
  });

  await expectStageCode(
    () => service(prisma, fakeAi().ai).ensureEvidenceUnitsForRun(RUN_ID),
    'GROUNDING_INPUT_UNUSABLE'
  );
  assert.equal(inventory[0].disposition, 'INCLUDED');
});

// ---------------------------------------------------------------------------
// Idempotencia y elegibilidad
// ---------------------------------------------------------------------------

test('con el catalogo ya persistido no se llama al proveedor', async (context) => {
  withModel(context);
  const { prisma } = fakePrisma({
    run: { evidenceUnitsArtifact: catalogArtifact(), executionMetadata: frozenPlan() }
  });
  const { ai, calls } = fakeAi();

  const outcome = await service(prisma, ai).ensureEvidenceUnitsForRun(RUN_ID);
  assert.equal(calls.length, 0);
  assert.equal(outcome.providerCalled, false);
});

test('un catalogo persistido corrupto no se sobreescribe ni llama', async (context) => {
  withModel(context);
  const { prisma } = fakePrisma({
    run: { evidenceUnitsArtifact: { schemaVersion: 'otra_cosa' } }
  });
  const { ai, calls } = fakeAi();

  await assert.rejects(() => service(prisma, ai).ensureEvidenceUnitsForRun(RUN_ID));
  assert.equal(calls.length, 0);
});

test('un run ya fallado no ejecuta la etapa', async (context) => {
  withModel(context);
  const { prisma } = fakePrisma({
    run: { status: 'failed', failureCode: 'reasoning_input_freeze_blocked' }
  });
  const { ai, calls } = fakeAi();

  await expectStageCode(
    () => service(prisma, ai).ensureEvidenceUnitsForRun(RUN_ID),
    'RUN_NOT_ELIGIBLE'
  );
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

test('un plan congelado que ya no describe la configuracion mata el run', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma({
    run: { executionMetadata: frozenPlan({ promptVersion: 'product_evidence_units_v0' }) }
  });
  const { ai, calls } = fakeAi();

  await expectStageCode(
    () => service(prisma, ai).ensureEvidenceUnitsForRun(RUN_ID),
    'EXECUTION_PLAN_MISMATCH'
  );
  assert.equal(calls.length, 0);
  assert.equal(state.run!.failureCode, 'reasoning_execution_plan_mismatch');
});

test('un plan ya persistido no se reescribe', async (context) => {
  withModel(context);
  const frozen = frozenPlan();
  const { prisma, state } = fakePrisma({ run: { executionMetadata: frozen } });

  await service(prisma, fakeAi().ai).ensureEvidenceUnitsForRun(RUN_ID);
  assert.deepEqual(state.run!.executionMetadata, frozen);
});

test('sin modelo configurado no se congela un plan a medias', async (context) => {
  withModel(context, null);
  const { prisma, state } = fakePrisma();
  const { ai, calls } = fakeAi();

  await expectStageCode(
    () => service(prisma, ai).ensureEvidenceUnitsForRun(RUN_ID),
    'EXECUTION_CONFIGURATION_MISSING'
  );
  assert.equal(calls.length, 0);
  assert.equal(state.run!.executionMetadata, null);
  assert.equal(state.run!.status, 'pending');
});

// ---------------------------------------------------------------------------
// Verificación independiente antes de persistir
// ---------------------------------------------------------------------------

test('un excerpt manipulado por el AI service no se persiste', async (context) => {
  // NestJS no confia en que Python haya anclado bien: recomputa contra el
  // artifact que ESTE proceso verifico.
  withModel(context);
  const { prisma, state } = fakePrisma();
  const tampered = evidenceUnit();
  tampered.sourceTrace.exactExcerpt = 'Curso de PYTHON.';
  tampered.exactQuote = 'Curso de PYTHON.';
  const { ai } = fakeAi({ response: envelope(catalogArtifact([tampered])) });

  await expectStageCode(
    () => service(prisma, ai).ensureEvidenceUnitsForRun(RUN_ID),
    'PROVIDER_INVALID_OUTPUT'
  );
  assert.equal(state.run!.evidenceUnitsArtifact, null);
  assert.equal(state.run!.failureCode, 'reasoning_evidence_units_invalid_output');
});

test('un offset manipulado no se persiste', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma();
  const tampered = evidenceUnit();
  tampered.sourceTrace.charStart = 5;
  const { ai } = fakeAi({ response: envelope(catalogArtifact([tampered])) });

  await expectStageCode(
    () => service(prisma, ai).ensureEvidenceUnitsForRun(RUN_ID),
    'PROVIDER_INVALID_OUTPUT'
  );
  assert.equal(state.run!.evidenceUnitsArtifact, null);
});

test('una fuente que no esta en el inventario no puede aparecer', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma();
  const foreign = evidenceUnit({ sourceTrace: { sourceId: 'src_99' } });
  const { ai } = fakeAi({
    response: envelope(catalogArtifact([foreign], ['src_01', 'src_99']))
  });

  await expectStageCode(
    () => service(prisma, ai).ensureEvidenceUnitsForRun(RUN_ID),
    'PROVIDER_INVALID_OUTPUT'
  );
  assert.equal(state.run!.evidenceUnitsArtifact, null);
});

test('un catalogo que no declara todas las fuentes INCLUDED se rechaza', async (context) => {
  withModel(context);
  const { blobSha } = persistedExtraction();
  const { prisma } = fakePrisma({
    inventory: [
      {
        disposition: 'INCLUDED',
        runLocalSourceId: 'src_01',
        sourceSha256: SOURCE_SHA,
        selectedAnalysisRunSourceId: ANALYSIS_RUN_SOURCE_ID,
        artifactBlobSha256: blobSha
      },
      {
        disposition: 'INCLUDED',
        runLocalSourceId: 'src_02',
        sourceSha256: SOURCE_SHA,
        selectedAnalysisRunSourceId: ANALYSIS_RUN_SOURCE_ID,
        artifactBlobSha256: blobSha
      }
    ]
  });
  // Declara sólo una de las dos fuentes incluidas.
  const { ai } = fakeAi({ response: envelope(catalogArtifact([evidenceUnit()], ['src_01'])) });

  await expectStageCode(
    () => service(prisma, ai).ensureEvidenceUnitsForRun(RUN_ID),
    'PROVIDER_INVALID_OUTPUT'
  );
});

// ---------------------------------------------------------------------------
// Taxonomía de fallos
// ---------------------------------------------------------------------------

test('un fallo de transporte deja el run intacto y reintentable', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma();
  const { ai } = fakeAi({
    throws: new ObjectiveAnalysisTransportError('PROVIDER_TRANSPORT_FAILURE', 503)
  });

  await expectStageCode(
    () => service(prisma, ai).ensureEvidenceUnitsForRun(RUN_ID),
    'PROVIDER_TRANSPORT_FAILURE'
  );
  assert.equal(state.run!.status, 'pending');
  assert.equal(state.run!.failureCode, null);
});

test('un rechazo determinista del proveedor mata el run', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma();
  const { ai } = fakeAi({
    throws: new ObjectiveAnalysisTransportError('PROVIDER_CONFIGURATION_FAILURE', 424)
  });

  await expectStageCode(
    () => service(prisma, ai).ensureEvidenceUnitsForRun(RUN_ID),
    'PROVIDER_CONFIGURATION_FAILURE'
  );
  assert.equal(state.run!.status, 'failed');
  assert.equal(state.run!.failureCode, 'reasoning_provider_configuration_invalid');
});

test('una salida completa e invalida mata el run sin volver a preguntar', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma();
  const { ai, calls } = fakeAi({
    throws: new ObjectiveAnalysisTransportError('PROVIDER_INVALID_OUTPUT', 502)
  });

  await expectStageCode(
    () => service(prisma, ai).ensureEvidenceUnitsForRun(RUN_ID),
    'PROVIDER_INVALID_OUTPUT'
  );
  assert.equal(calls.length, 1);
  assert.equal(state.run!.failureCode, 'reasoning_evidence_units_invalid_output');
});

test('un envelope que no se entiende es fallo interno, no del proveedor', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma();
  const { ai } = fakeAi({ response: { schemaVersion: 'otra_version' } });

  await expectStageCode(
    () => service(prisma, ai).ensureEvidenceUnitsForRun(RUN_ID),
    'INTERNAL_AI_SERVICE_FAILURE'
  );
  assert.equal(state.run!.status, 'pending');
});

// ---------------------------------------------------------------------------
// Coherencia de la fila
// ---------------------------------------------------------------------------

test('un run failed nunca queda con catalogo de etapa', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma();
  const { ai } = fakeAi({
    throws: new ObjectiveAnalysisTransportError('PROVIDER_INVALID_OUTPUT', 502)
  });

  await assert.rejects(() => service(prisma, ai).ensureEvidenceUnitsForRun(RUN_ID));
  assert.equal(state.run!.status, 'failed');
  assert.equal(state.run!.evidenceUnitsArtifact, null);
});

test('el CAS del catalogo exige el estado del run en la MISMA query', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma();
  const filters: any[] = [];
  const original = prisma.reasoningRun.updateMany;
  prisma.reasoningRun.updateMany = async (args: any) => {
    filters.push(args.where);
    return original(args);
  };

  await service(prisma, fakeAi().ai).ensureEvidenceUnitsForRun(RUN_ID);

  const artifactWrite = filters.find((where) => 'evidenceUnitsArtifact' in where);
  assert.ok(artifactWrite);
  assert.equal(artifactWrite.status, 'pending');
  assert.equal(artifactWrite.failureCode, null);
  assert.deepEqual(artifactWrite.evidenceUnitsArtifact, { equals: Prisma.DbNull });
  void state;
});

test('un run marcado failed no puede ganar un catalogo', async (context) => {
  withModel(context);
  const { prisma, state } = fakePrisma();
  const { ai } = fakeAi();
  const original = prisma.reasoningRun.updateMany;
  // Un fallo terminal concurrente entra justo antes de la escritura del artifact.
  prisma.reasoningRun.updateMany = async (args: any) => {
    if ('evidenceUnitsArtifact' in args.where && args.data.evidenceUnitsArtifact) {
      state.run!.status = 'failed';
      state.run!.failureCode = 'reasoning_provider_configuration_invalid';
    }
    return original(args);
  };

  await assert.rejects(() => service(prisma, ai).ensureEvidenceUnitsForRun(RUN_ID));
  assert.equal(state.run!.evidenceUnitsArtifact, null);
});

// ---------------------------------------------------------------------------
// Privacidad
// ---------------------------------------------------------------------------

test('los errores no filtran texto canonico ni excerpts', async (context) => {
  withModel(context);
  const { prisma } = fakePrisma({
    extractionSlots: {
      [ANALYSIS_RUN_SOURCE_ID]: {
        extractionArtifactCanonicalJson: null,
        artifactBlobSha256: null,
        extractionDerivationTrust: null
      }
    }
  });

  const error = await expectStageCode(
    () => service(prisma, fakeAi().ai).ensureEvidenceUnitsForRun(RUN_ID),
    'GROUNDING_INPUT_UNUSABLE'
  );
  assert.ok(!error.message.includes('Curso de APIs REST'));
  assert.equal(error.runLocalSourceId, 'src_01');
});

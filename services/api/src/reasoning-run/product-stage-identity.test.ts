/**
 * Identidad de ejecución productiva de las tres etapas — F3.3B.
 *
 * ESTE ARCHIVO ES EL MECANISMO, no una formalidad. §21.11 de F3.3A permitió
 * congelar hoy un plan que nombra etapas que todavía no existen apoyándose en dos
 * cosas: que la deriva falle cerrado, y que exista UNA sola fuente de constantes
 * que F3.4 y F3.5 tengan que importar. Sin lo segundo, lo primero sería una
 * promesa de prosa.
 *
 * Si un slice futuro cambia una de estas versiones, este test se cae. Ésa es la
 * idea: convertir la divergencia silenciosa en un cambio visible.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTEXTUAL_REASONING_STAGE_IDENTITY,
  EVIDENCE_UNITS_STAGE_IDENTITY,
  OBJECTIVE_ANALYSIS_REQUEST_SCHEMA_VERSION,
  OBJECTIVE_ANALYSIS_RESPONSE_SCHEMA_VERSION,
  OBJECTIVE_ANALYSIS_STAGE_IDENTITY,
  PRODUCT_DETERMINISTIC_POLICY_VERSION,
  PRODUCT_EXECUTION_PROVIDER,
  PRODUCT_REASONER_CONTRACT_VERSION,
  PRODUCT_REASONING_EFFORT,
  REASONING_EXECUTION_MODEL_ENV,
  configuredExecutionModel
} from './product-stage-identity';
import { verifyReasoningExecutionMetadata } from './reasoning-execution-metadata.validator';
import {
  EVIDENCE_UNITS_SCHEMA_VERSION,
  OBJECTIVE_ANALYSIS_SCHEMA_VERSION,
  REASONING_EXECUTION_METADATA_SCHEMA_VERSION,
  REASONING_RUN_RESULT_SCHEMA_VERSION
} from './reasoning-run-artifact.types';

test('las nueve identidades congeladas son exactamente estas', () => {
  assert.deepEqual(OBJECTIVE_ANALYSIS_STAGE_IDENTITY, {
    artifactSchemaVersion: 'objective_analysis_v1',
    promptVersion: 'product_objective_analysis_v1',
    adapterVersion: 'product_objective_analysis_adapter_v1'
  });
  assert.deepEqual(EVIDENCE_UNITS_STAGE_IDENTITY, {
    artifactSchemaVersion: 'evidence_units_v1',
    promptVersion: 'product_evidence_units_v1',
    adapterVersion: 'product_evidence_units_adapter_v1'
  });
  assert.deepEqual(CONTEXTUAL_REASONING_STAGE_IDENTITY, {
    artifactSchemaVersion: 'reasoning_run_result_v1',
    promptVersion: 'product_contextual_reasoning_v1',
    adapterVersion: 'product_contextual_reasoning_adapter_v1'
  });
});

test('cada etapa nombra SU propio artifact', () => {
  assert.equal(
    OBJECTIVE_ANALYSIS_STAGE_IDENTITY.artifactSchemaVersion,
    OBJECTIVE_ANALYSIS_SCHEMA_VERSION
  );
  assert.equal(
    EVIDENCE_UNITS_STAGE_IDENTITY.artifactSchemaVersion,
    EVIDENCE_UNITS_SCHEMA_VERSION
  );
  assert.equal(
    CONTEXTUAL_REASONING_STAGE_IDENTITY.artifactSchemaVersion,
    REASONING_RUN_RESULT_SCHEMA_VERSION
  );
});

test('ninguna version productiva reutiliza la del ancestro de investigacion', () => {
  // `b24_objective_epistemic_target_es_v1.0.0` identifica al candidato congelado.
  // El prompt y el adapter productivos son otros.
  const versions = [
    OBJECTIVE_ANALYSIS_STAGE_IDENTITY,
    EVIDENCE_UNITS_STAGE_IDENTITY,
    CONTEXTUAL_REASONING_STAGE_IDENTITY
  ].flatMap((identity) => [identity.promptVersion, identity.adapterVersion]);

  for (const version of versions) {
    assert.ok(!version.startsWith('b24'), version);
    assert.ok(version.startsWith('product_'), version);
  }
});

test('un plan construido con estas constantes supera el validador congelado', () => {
  // La correspondencia es EJECUTABLE, no una nota al pie: si una identidad
  // dejara de encajar en `reasoning_execution_metadata_v1`, esto se cae.
  const stage = (identity: {
    artifactSchemaVersion: string;
    promptVersion: string;
    adapterVersion: string;
  }) => ({
    artifactSchemaVersion: identity.artifactSchemaVersion,
    promptVersion: identity.promptVersion,
    adapterVersion: identity.adapterVersion,
    provider: {
      provider: PRODUCT_EXECUTION_PROVIDER,
      model: 'algun-modelo',
      reasoningEffort: PRODUCT_REASONING_EFFORT
    }
  });

  const metadata = verifyReasoningExecutionMetadata({
    schemaVersion: REASONING_EXECUTION_METADATA_SCHEMA_VERSION,
    reasonerContractVersion: PRODUCT_REASONER_CONTRACT_VERSION,
    deterministicPolicyVersion: PRODUCT_DETERMINISTIC_POLICY_VERSION,
    objectiveAnalysis: stage(OBJECTIVE_ANALYSIS_STAGE_IDENTITY),
    evidenceUnits: stage(EVIDENCE_UNITS_STAGE_IDENTITY),
    contextualReasoning: stage(CONTEXTUAL_REASONING_STAGE_IDENTITY)
  });

  assert.equal(metadata.objectiveAnalysis.provider?.reasoningEffort, 'medium');
});

test('en V1 ninguna etapa es providerless', () => {
  // El runtime congelado hace TRES `provider.complete`. `provider: null` sigue
  // existiendo con su significado —PROVIDERLESS_BY_DESIGN— para una etapa futura
  // que lo necesite, no para las de hoy.
  assert.equal(PRODUCT_EXECUTION_PROVIDER, 'openai');
  assert.equal(PRODUCT_REASONING_EFFORT, 'medium');
});

test('el contrato de transporte esta versionado aparte del artifact', () => {
  assert.equal(
    OBJECTIVE_ANALYSIS_REQUEST_SCHEMA_VERSION,
    'product_objective_analysis_request_v1'
  );
  assert.equal(
    OBJECTIVE_ANALYSIS_RESPONSE_SCHEMA_VERSION,
    'product_objective_analysis_response_v1'
  );
  assert.notEqual(
    OBJECTIVE_ANALYSIS_RESPONSE_SCHEMA_VERSION,
    OBJECTIVE_ANALYSIS_STAGE_IDENTITY.artifactSchemaVersion
  );
});

test('el modelo es configuracion de despliegue, no identidad de etapa', () => {
  // Por eso no aparece en ninguna de las tres constantes: viaja en el plan
  // congelado, por run.
  for (const identity of [
    OBJECTIVE_ANALYSIS_STAGE_IDENTITY,
    EVIDENCE_UNITS_STAGE_IDENTITY,
    CONTEXTUAL_REASONING_STAGE_IDENTITY
  ]) {
    assert.equal('model' in identity, false);
  }

  const previous = process.env[REASONING_EXECUTION_MODEL_ENV];
  try {
    delete process.env[REASONING_EXECUTION_MODEL_ENV];
    assert.equal(configuredExecutionModel(), null);
    process.env[REASONING_EXECUTION_MODEL_ENV] = '   ';
    assert.equal(configuredExecutionModel(), null, 'en blanco no es configurado');
    process.env[REASONING_EXECUTION_MODEL_ENV] = ' un-modelo ';
    assert.equal(configuredExecutionModel(), 'un-modelo');
  } finally {
    if (previous === undefined) delete process.env[REASONING_EXECUTION_MODEL_ENV];
    else process.env[REASONING_EXECUTION_MODEL_ENV] = previous;
  }
});

test('NestJS no nombra ninguna credencial del proveedor', () => {
  // Los secretos viven solo en el entorno del AI service. Acá viaja el modelo
  // solicitado, que es plan.
  assert.equal(REASONING_EXECUTION_MODEL_ENV, 'REASONING_EXECUTION_MODEL');
  assert.ok(!REASONING_EXECUTION_MODEL_ENV.includes('KEY'));
  assert.ok(!REASONING_EXECUTION_MODEL_ENV.includes('SECRET'));
});

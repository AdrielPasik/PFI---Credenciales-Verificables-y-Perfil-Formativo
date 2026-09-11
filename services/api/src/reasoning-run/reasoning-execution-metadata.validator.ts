/**
 * Validador de `reasoning_execution_metadata_v1` — cierre de F3.3A.
 *
 * NO es un cuarto stage artifact. `executionMetadata` describe la CONFIGURACIÓN
 * con la que el run va a ejecutarse, no el output de ninguna etapa. Se valida
 * igual de estricto que los artifacts por la misma razón por la que existe: si
 * más adelante alguien pregunta "¿con qué reasoner, qué prompt y qué esfuerzo
 * salió este resultado?", la respuesta tiene que ser exacta o no sirve.
 *
 * ES UN PLAN COMPLETO Y UN COMPROMISO. Se congela fill-once ANTES de la primera
 * llamada a un proveedor, y describe las tres etapas —incluidas las que todavía
 * no corrieron—. Un plan parcial no es escribible: con fill-once, una etapa
 * futura que quedara "indeterminada" no podría completarse nunca.
 */

import {
  assertExactKeys,
  deepFreeze,
  expectEnum,
  expectNonBlankString,
  expectObject
} from './reasoning-run-artifact.primitives';
import { failArtifact } from './reasoning-run-artifact.errors';
import {
  EVIDENCE_UNITS_SCHEMA_VERSION,
  EXECUTION_PROVIDERS,
  OBJECTIVE_ANALYSIS_SCHEMA_VERSION,
  REASONING_EFFORT_TOKENS,
  REASONING_EXECUTION_METADATA_SCHEMA_VERSION,
  REASONING_RUN_RESULT_SCHEMA_VERSION,
  type ProviderPlan,
  type StageExecutionPlan,
  type VerifiedReasoningExecutionMetadata
} from './reasoning-run-artifact.types';

const ROOT_KEYS = new Set([
  'schemaVersion',
  'reasonerContractVersion',
  'deterministicPolicyVersion',
  'objectiveAnalysis',
  'evidenceUnits',
  'contextualReasoning'
]);
const STAGE_KEYS = new Set([
  'artifactSchemaVersion',
  'promptVersion',
  'adapterVersion',
  'provider'
]);
const PROVIDER_KEYS = new Set(['provider', 'model', 'reasoningEffort']);

/** El proveedor cuyo wrapper congelado manda `reasoning.effort` en cada llamada. */
const EFFORT_REQUIRED_PROVIDER = 'openai';

/**
 * El plan de proveedor de una etapa.
 *
 * `model` es el SOLICITADO: es lo único que un plan puede prometer. El wrapper
 * congelado distingue `requested_model` de `effective_model`, y el segundo es una
 * observación posterior a la llamada — no pertenece a un plan.
 */
function verifyProviderPlan(raw: unknown, path: string): ProviderPlan {
  const value = expectObject(raw, path);
  assertExactKeys(value, PROVIDER_KEYS, path);

  const provider = expectEnum(
    value.provider,
    EXECUTION_PROVIDERS,
    `${path}.provider`
  );
  const model = expectNonBlankString(value.model, `${path}.model`);

  // El effort NO es opcional para openai: su wrapper lo envía siempre, así que un
  // plan sin él describiría una configuración semántica distinta de la que se va
  // a ejecutar.
  if (provider === EFFORT_REQUIRED_PROVIDER) {
    if (value.reasoningEffort === null) {
      failArtifact('SCHEMA_INVALID', {
        invariant: 'openai_stage_plan_must_declare_its_reasoning_effort',
        path: `${path}.reasoningEffort`,
        observed: provider
      });
    }
    return Object.freeze({
      provider,
      model,
      reasoningEffort: expectEnum(
        value.reasoningEffort,
        REASONING_EFFORT_TOKENS,
        `${path}.reasoningEffort`
      )
    });
  }

  // Para un proveedor que no acepta el parámetro, declararlo sería afirmar que se
  // envía algo que no se envía.
  if (value.reasoningEffort !== null) {
    failArtifact('SCHEMA_INVALID', {
      invariant: 'only_an_openai_stage_plan_declares_reasoning_effort',
      path: `${path}.reasoningEffort`,
      observed: provider
    });
  }

  return Object.freeze({ provider, model, reasoningEffort: null });
}

/**
 * El plan de una etapa.
 *
 * `provider: null` significa **una** sola cosa: esa etapa no invoca a ningún
 * proveedor por diseño del plan. Nunca "todavía no configurado". Y como una etapa
 * sin proveedor tampoco tiene prompt, las dos ausencias van juntas: permitir un
 * `promptVersion` sin proveedor dejaría afirmado un prompt que nadie va a enviar.
 */
function verifyStagePlan(
  raw: unknown,
  path: string,
  expectedArtifactSchemaVersion: string
): StageExecutionPlan {
  const value = expectObject(raw, path);
  assertExactKeys(value, STAGE_KEYS, path);

  const artifactSchemaVersion = expectNonBlankString(
    value.artifactSchemaVersion,
    `${path}.artifactSchemaVersion`
  );
  if (artifactSchemaVersion !== expectedArtifactSchemaVersion) {
    failArtifact('SCHEMA_VERSION_UNSUPPORTED', {
      invariant: 'stage_plan_must_name_its_own_artifact_schema',
      path: `${path}.artifactSchemaVersion`,
      observed: artifactSchemaVersion.slice(0, 64)
    });
  }

  const provider =
    value.provider === null
      ? null
      : verifyProviderPlan(value.provider, `${path}.provider`);

  const hasPrompt = value.promptVersion !== null;
  if (hasPrompt !== (provider !== null)) {
    failArtifact('SCHEMA_INVALID', {
      invariant: 'a_stage_has_a_prompt_if_and_only_if_it_has_a_provider',
      path: `${path}.promptVersion`,
      observed: provider === null ? 'providerless' : 'provider_backed'
    });
  }

  return Object.freeze({
    artifactSchemaVersion,
    promptVersion: hasPrompt
      ? expectNonBlankString(value.promptVersion, `${path}.promptVersion`)
      : null,
    adapterVersion: expectNonBlankString(
      value.adapterVersion,
      `${path}.adapterVersion`
    ),
    provider
  });
}

export function verifyReasoningExecutionMetadata(
  input: unknown
): VerifiedReasoningExecutionMetadata {
  const root = expectObject(input, 'executionMetadata');
  assertExactKeys(root, ROOT_KEYS, 'executionMetadata');

  if (root.schemaVersion !== REASONING_EXECUTION_METADATA_SCHEMA_VERSION) {
    failArtifact('SCHEMA_VERSION_UNSUPPORTED', {
      invariant: 'schema_version_must_be_the_single_supported_one',
      path: 'executionMetadata.schemaVersion',
      observed:
        typeof root.schemaVersion === 'string'
          ? root.schemaVersion.slice(0, 64)
          : typeof root.schemaVersion
    });
  }

  return deepFreeze({
    schemaVersion: REASONING_EXECUTION_METADATA_SCHEMA_VERSION,
    reasonerContractVersion: expectNonBlankString(
      root.reasonerContractVersion,
      'executionMetadata.reasonerContractVersion'
    ),
    // La policy determinista no tiene etapa con plan: no llama a nadie y no tiene
    // prompt. Su versión vive suelta a propósito.
    deterministicPolicyVersion: expectNonBlankString(
      root.deterministicPolicyVersion,
      'executionMetadata.deterministicPolicyVersion'
    ),
    objectiveAnalysis: verifyStagePlan(
      root.objectiveAnalysis,
      'executionMetadata.objectiveAnalysis',
      OBJECTIVE_ANALYSIS_SCHEMA_VERSION
    ),
    evidenceUnits: verifyStagePlan(
      root.evidenceUnits,
      'executionMetadata.evidenceUnits',
      EVIDENCE_UNITS_SCHEMA_VERSION
    ),
    contextualReasoning: verifyStagePlan(
      root.contextualReasoning,
      'executionMetadata.contextualReasoning',
      REASONING_RUN_RESULT_SCHEMA_VERSION
    )
  } as VerifiedReasoningExecutionMetadata);
}

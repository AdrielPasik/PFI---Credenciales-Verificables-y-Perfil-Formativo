/**
 * Contrato productivo de Objective Understanding en NestJS — slice P2.2.
 *
 * IDENTIDAD DE ETAPA DECLARADA EN LOS DOS LADOS, y ése es el punto. El AI service
 * declara qué prompt, qué adapter y qué schema de artefacto ejecutó; acá se
 * declara qué esperaba NestJS. El verificador los compara antes de mapear nada.
 *
 *     que el artefacto venga de la red interna NO lo hace confiable
 *
 * SIN `StageExecutionPlan`. Las tres etapas de F3 llevan un plan congelado por
 * ReasoningRun porque hay una fila cuya vida depende de él. Acá no hay run, no hay
 * fila y no hay nada que persistir: la propuesta es TRANSITORIA. Fabricar un plan
 * para que se pareciera a F3 sería inventar una promesa que nadie hizo.
 *
 * AUTORIDAD DEL PROVEEDOR: `PROPOSAL_ONLY`. Ni con `GENERALIZATION_SUPPORTED` en
 * P2.1 se crea un Objective automáticamente. La confirmación humana sigue siendo
 * obligatoria y vive en `POST /me/objectives`, que esta etapa NO llama.
 */

/** Versiones de transporte con el AI service. */
export const OBJECTIVE_REQUIREMENT_PROPOSAL_REQUEST_SCHEMA_VERSION =
  'product_objective_requirement_proposal_request_v1';
export const OBJECTIVE_REQUIREMENT_PROPOSAL_RESPONSE_SCHEMA_VERSION =
  'product_objective_requirement_proposal_response_v1';

/** Versión del artefacto transitorio, congelada por P2.0 §22.2. */
export const OBJECTIVE_REQUIREMENT_PROPOSAL_ARTIFACT_SCHEMA_VERSION =
  'objective_requirement_proposal_v1';

/**
 * Identidad productiva de la etapa. NO reutiliza el nombre del ancestro de
 * investigación: `OU_A2` identifica al candidato congelado de P2.1, y hacer pasar
 * el prompt productivo por ese identificador sería la misma confusión que F3.3A
 * prohibió para B2.4.1.
 */
export const OBJECTIVE_UNDERSTANDING_STAGE_IDENTITY = {
  artifactSchemaVersion: OBJECTIVE_REQUIREMENT_PROPOSAL_ARTIFACT_SCHEMA_VERSION,
  promptVersion: 'product_objective_understanding_v1',
  adapterVersion: 'product_objective_understanding_adapter_v1',
  providerProposalSchemaVersion: 'product_objective_understanding_proposal_v1'
} as const;

/** El único proveedor y el único esfuerzo soportados, los mismos que evaluó P2.1. */
export const OBJECTIVE_UNDERSTANDING_PROVIDER = 'openai';
export const OBJECTIVE_UNDERSTANDING_REASONING_EFFORT = 'medium';

/** Ancestro de investigación. Se cita para trazabilidad, nunca como versión. */
export const OBJECTIVE_UNDERSTANDING_RESEARCH_ANCESTOR = 'OU_A2';

/**
 * Único idioma con el que el contrato fue efectivamente validado (P2.1).
 *
 * El endpoint acepta texto en otro idioma —rechazarlo sería inventar una
 * restricción que la investigación no impuso— pero NO se afirma soporte evaluado
 * en inglés, y no hay ninguna capa de traducción.
 */
export const OBJECTIVE_UNDERSTANDING_VALIDATED_LANGUAGE = 'es';

/** Unidad de offset y política de normalización congeladas. */
export const OFFSET_UNIT_UNICODE_CODE_POINT = 'UNICODE_CODE_POINT';
export const SOURCE_NORMALIZATION_NONE = 'NONE';

/** Estados de anclaje que el código confiable puede afirmar (P2.0 §15). */
export const SOURCE_GROUNDING_STATUSES = ['UNIQUE', 'AMBIGUOUS', 'NOT_FOUND'] as const;
export type SourceGroundingStatus = typeof SOURCE_GROUNDING_STATUSES[number];

/**
 * Campos que el proveedor NUNCA puede aportar con autoridad, y que por lo tanto
 * no pueden aparecer en el artefacto verificado.
 *
 * Se declara acá y no sólo del lado de Python porque la verificación de NestJS es
 * INDEPENDIENTE: si dependiera de la lista del AI service, no verificaría nada.
 */
export const PROVIDER_FORBIDDEN_ARTIFACT_FIELDS = [
  'requirementId',
  'finalState',
  'confidence',
  'confidenceScore',
  'fit',
  'fitScore',
  'score',
  'owner',
  'ownerUserId',
  'subjectUserId',
  'provenance',
  'epistemicTarget',
  'evaluability',
  'formativeEvidenceCapable',
  'requiredEvidenceType',
  'policyTrace',
  'rawProviderResponse',
  'prompt',
  'promptVersion',
  'model',
  'requestedModel',
  'reasoningEffort',
  'provider'
] as const;

/** Tope de tamaño replicado del lado de NestJS para fallar antes de la red. */
export const MAX_OBJECTIVE_CHARACTERS = 60_000;

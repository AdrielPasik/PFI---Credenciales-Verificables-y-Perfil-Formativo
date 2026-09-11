/**
 * Identidad de ejecución productiva de las tres etapas — slice F3.3B.
 *
 * ESTE ARCHIVO ES LA ÚNICA FUENTE. F3.4 (`evidenceUnits`) y F3.5
 * (`contextualReasoning`) deben importar estas mismas constantes para sus
 * adapters, y ése es justamente el mecanismo que sostiene §21.11 de F3.3A:
 *
 *     un run creado hoy congela un plan que nombra etapas que todavía no existen
 *
 * Eso sólo es honesto si el nombre compromete a alguien. Lo hace por dos vías ya
 * congeladas: `CONFIG_DRIFT_POLICY: FAIL_CLOSED` —un plan que dice `v1` falla
 * cerrado si la etapa llega como `v2`— y esta fuente única, que convierte
 * divergir en un cambio visible en un archivo, con un test que lo fija. Sin lo
 * segundo, lo primero sería una promesa de prosa.
 *
 * FIJA NOMBRES Y VERSIONES, NADA MÁS. No diseña el prompt de F3.4, ni el
 * razonador de F3.5, ni la policy determinista. Declarar cómo se va a llamar una
 * etapa no es decidir qué va a hacer.
 *
 * NINGUNA DE ESTAS VERSIONES REUTILIZA LA DEL ANCESTRO DE INVESTIGACIÓN.
 * `b24_objective_epistemic_target_es_v1.0.0` identifica al candidato congelado
 * B2.4.1; el prompt y el adapter productivos son otros, y hacerlos pasar por el
 * mismo identificador sería la confusión que §6 de F3.3A prohibió.
 */

import {
  EVIDENCE_UNITS_SCHEMA_VERSION,
  OBJECTIVE_ANALYSIS_SCHEMA_VERSION,
  REASONING_RUN_RESULT_SCHEMA_VERSION
} from './reasoning-run-artifact.types';

/**
 * Identidad de una etapa productiva provider-backed.
 *
 * Sin `model`: el modelo es configuración de DESPLIEGUE, no identidad de etapa.
 * Por eso el plan congelado lo lleva por run y esta constante no.
 */
export interface ProductStageIdentity {
  readonly artifactSchemaVersion: string;
  readonly promptVersion: string;
  readonly adapterVersion: string;
}

/** Etapa 1 — clasificación evidence-blind de los Requirements confirmados. */
export const OBJECTIVE_ANALYSIS_STAGE_IDENTITY: ProductStageIdentity = {
  artifactSchemaVersion: OBJECTIVE_ANALYSIS_SCHEMA_VERSION,
  promptVersion: 'product_objective_analysis_v1',
  adapterVersion: 'product_objective_analysis_adapter_v1'
} as const;

/** Etapa 2 — catálogo de EvidenceUnits. F3.4 importa esto, no lo redefine. */
export const EVIDENCE_UNITS_STAGE_IDENTITY: ProductStageIdentity = {
  artifactSchemaVersion: EVIDENCE_UNITS_SCHEMA_VERSION,
  promptVersion: 'product_evidence_units_v1',
  adapterVersion: 'product_evidence_units_adapter_v1'
} as const;

/** Etapa 3 — razonamiento contextual unificado. F3.5 importa esto. */
export const CONTEXTUAL_REASONING_STAGE_IDENTITY: ProductStageIdentity = {
  artifactSchemaVersion: REASONING_RUN_RESULT_SCHEMA_VERSION,
  promptVersion: 'product_contextual_reasoning_v1',
  adapterVersion: 'product_contextual_reasoning_adapter_v1'
} as const;

/**
 * Contrato productivo global del reasoner y versión de la policy determinista.
 *
 * La policy va SUELTA, sin `StageExecutionPlan`: no llama a ningún proveedor y no
 * tiene prompt. Darle una entrada de etapa la haría parecer provider-backed.
 */
export const PRODUCT_REASONER_CONTRACT_VERSION = 'product_reasoner_v1';
export const PRODUCT_DETERMINISTIC_POLICY_VERSION = 'product_epistemic_policy_v1';

/**
 * El único proveedor y el único esfuerzo soportados en V1.
 *
 * `medium` es la configuración con la que se ejecutó el candidato aceptado, y el
 * wrapper productivo manda `reasoning.effort` en cada llamada a OpenAI.
 */
export const PRODUCT_EXECUTION_PROVIDER = 'openai';
export const PRODUCT_REASONING_EFFORT = 'medium';

/**
 * Contrato de transporte con el AI service. Se declara acá y no en el cliente
 * porque es identidad de etapa: si cambia, cambia lo que el run ejecuta.
 */
export const OBJECTIVE_ANALYSIS_REQUEST_SCHEMA_VERSION =
  'product_objective_analysis_request_v1';
export const OBJECTIVE_ANALYSIS_RESPONSE_SCHEMA_VERSION =
  'product_objective_analysis_response_v1';

export const EVIDENCE_UNITS_REQUEST_SCHEMA_VERSION =
  'product_evidence_units_request_v1';
export const EVIDENCE_UNITS_RESPONSE_SCHEMA_VERSION =
  'product_evidence_units_response_v1';

export const CONTEXTUAL_REASONING_REQUEST_SCHEMA_VERSION =
  'product_contextual_reasoning_request_v1';
export const CONTEXTUAL_REASONING_RESPONSE_SCHEMA_VERSION =
  'product_contextual_reasoning_response_v1';

/**
 * Variable de entorno de NestJS que nombra el modelo SOLICITADO.
 *
 * No es un secreto: es el modelo que el plan promete. Las credenciales del
 * proveedor viven exclusivamente en el entorno del AI service
 * —`OBJECTIVE_ANALYSIS_OPENAI_API_KEY`— y nunca pasan por acá.
 *
 * Que el AI service tenga su propia variable con el modelo NO es duplicación
 * accidental: es la premisa del guard. Los dos lados declaran lo que van a hacer
 * y se comparan antes de cada llamada; si divergen, el run falla cerrado en vez
 * de ejecutar bajo una configuración que nadie planificó.
 */
export const REASONING_EXECUTION_MODEL_ENV = 'REASONING_EXECUTION_MODEL';

/**
 * V1 congela el MISMO modelo solicitado para las tres etapas.
 *
 * Es una decisión de despliegue, no del contrato: el runtime congelado construía
 * un solo `StructuredProvider` y lo usaba para las tres llamadas. El contrato
 * mantiene una entrada por etapa precisamente para que un despliegue futuro pueda
 * diferenciarlas sin migración ni cambio de schema.
 */
export function configuredExecutionModel(): string | null {
  const configured = process.env[REASONING_EXECUTION_MODEL_ENV]?.trim();
  return configured && configured.length > 0 ? configured : null;
}

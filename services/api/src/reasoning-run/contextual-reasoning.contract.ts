/**
 * Contrato TRANSITORIO del razonamiento contextual — slice F3.5.
 *
 * NO ES UN ARTIFACT PERSISTIDO. No tiene columna, no tiene slot y no se guarda.
 * Cruza FastAPI → NestJS y de ahí va directo a F3.6 como entrada de policy, y por
 * eso necesita versión, propiedades exactas, enums cerrados y validación
 * independiente — lo mismo que se le exige a cualquier cosa que atraviese una
 * frontera de proceso.
 *
 * UNA SOLA AUTORIDAD POR HECHO. El tipo no se redefine: se DERIVA del final.
 *
 *     ContextualRequirementResult = RequirementResult
 *                                 − finalState
 *                                 − policyTrace
 *                                 − explanation
 *
 * Los tres restados son exactamente lo que F3.6 agrega de forma determinista. Con
 * `Omit` no puede haber deriva: si alguien cambia `RequirementResult`, este tipo
 * cambia con él o el compilador se queja. Copiar los campos a mano habría creado
 * dos definiciones del mismo hecho, que es justo lo que el contrato prohíbe.
 *
 * IDENTIDADES, y son dos cosas distintas que conviene no confundir:
 *
 *     executionMetadata.contextualReasoning.artifactSchemaVersion
 *         = reasoning_run_result_v1
 *       el artifact que la ETAPA produce, contando su mitad determinista
 *
 *     CONTEXTUAL_REASONING_CONTRACT_VERSION
 *         = contextual_reasoning_v1
 *       el contrato transitorio que viaja entre servicios
 *
 * El segundo NO reemplaza al primero. Es la misma relación que ya existe en las
 * otras dos etapas, donde el transporte
 * —`product_objective_analysis_response_v1`— tiene versión propia y distinta de
 * la del artifact.
 */

import {
  type RequirementResult
} from './reasoning-run-artifact.types';

/** El contrato transitorio POR REQUIREMENT. */
export type ContextualRequirementResult = Omit<
  RequirementResult,
  'finalState' | 'policyTrace' | 'explanation'
>;

export const CONTEXTUAL_REASONING_CONTRACT_VERSION = 'contextual_reasoning_v1';

/**
 * El agregado que se entrega a F3.6.
 *
 * Lo construye CÓDIGO CONFIABLE de NestJS recorriendo los Requirements en orden
 * del snapshot: el proveedor nunca produce este array. Cada entrada viene de una
 * llamada distinta, y ninguna de esas llamadas pudo ver a las otras.
 */
export interface ContextualReasoningV1 {
  readonly schemaVersion: typeof CONTEXTUAL_REASONING_CONTRACT_VERSION;
  readonly requirementResults: readonly ContextualRequirementResult[];
}

/**
 * Las claves EXACTAS del resultado por Requirement.
 *
 * Se declaran como dato y no como comentario porque el validador las usa para
 * rechazar cualquier propiedad extra — incluida `finalState`, que es la que un
 * proveedor podría intentar colar.
 */
export const CONTEXTUAL_RESULT_KEYS = new Set([
  'requirementId',
  'evaluatedEvidence',
  'facets',
  'compositionAssessment',
  'fullClaimAssessment',
  'jointClaimCeiling',
  'observabilityAssessment',
  'weakerClaimSearch',
  'semanticUnresolved',
  'unresolvedReason'
]);

/**
 * Lo que F3.6 agrega y F3.5 NO puede traer.
 *
 * `additionalProperties` ya los rechaza por ser extra, pero nombrarlos permite un
 * error específico: "el proveedor intentó decidir el estado final" dice mucho más
 * que "propiedad desconocida".
 */
export const POLICY_OWNED_KEYS = ['finalState', 'policyTrace', 'explanation'] as const;

/** Superficies que no existen en el contrato congelado y nadie puede introducir. */
export const FORBIDDEN_OUTPUT_KEYS = [
  'globalScore',
  'fitPercentage',
  'rank',
  'chainOfThought',
  'scratchpad',
  'hiddenReasoning',
  'internalDeliberation',
  'modelThoughts'
] as const;

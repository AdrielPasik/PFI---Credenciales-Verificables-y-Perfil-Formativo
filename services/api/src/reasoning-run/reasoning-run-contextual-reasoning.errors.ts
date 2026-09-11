/**
 * Errores de la orquestación del razonamiento contextual — slice F3.5.
 *
 * Misma distinción que ordena las etapas anteriores, porque decide lo mismo — si
 * se destruye trabajo:
 *
 *     TERMINAL      el run muere y NO se reintenta en la misma fila
 *     REINTENTABLE  el run queda intacto y puede volver a intentarse
 *
 * Y una particularidad de esta etapa, que conviene tener presente al leer los
 * códigos: F3.5 NO tiene checkpoint de éxito. Un fallo terminal en el
 * Requirement K descarta los resultados válidos de 1..K-1, porque nunca se
 * persistieron. Eso no es una pérdida de datos: es que el agregado que F3.6
 * necesita sólo existe si TODOS los Requirements terminaron.
 *
 * PRIVACIDAD: sólo ids internos y códigos cerrados. Nunca `requirementText`, ni
 * citas, ni el texto de un ceiling o de un claim más débil.
 */

import { HttpException, HttpStatus } from '@nestjs/common';

export const CONTEXTUAL_REASONING_STAGE_CODES = [
  /** No existe el `ReasoningRun`. */
  'REASONING_RUN_NOT_FOUND',
  /** El run ya terminó, o arrastra un `failureCode`. */
  'RUN_NOT_ELIGIBLE',
  /**
   * TERMINAL. Falta una etapa previa.
   *
   * F3.5 es la PRIMERA que necesita las dos: F3.1 las congeló como artifacts
   * independientes, y siguen siéndolo — producirlas por separado está bien, pero
   * razonar sin alguna de las dos no.
   */
  'PREVIOUS_STAGE_ARTIFACT_MISSING',
  /**
   * TERMINAL. Una autoridad persistida ya no verifica: el snapshot del Objective,
   * alguno de los dos artifacts previos, o el grounding congelado.
   *
   * NO se llama al proveedor. Que F3.4 lo haya verificado al escribirlo no dice
   * nada sobre el estado de la fila ahora.
   */
  'PERSISTED_AUTHORITY_UNUSABLE',
  /** TERMINAL. El plan congelado no describe lo que esta etapa ejecutaría. */
  'EXECUTION_PLAN_MISMATCH',
  /**
   * TERMINAL. El proveedor respondió entero y su salida no cumple el contrato —
   * forma, referencias, alcance de qualifier, facets o continuidad—.
   *
   * No se le vuelve a preguntar, y no se llama por los Requirements restantes.
   */
  'PROVIDER_INVALID_OUTPUT',
  /** TERMINAL. Rechazo determinista del proveedor. */
  'PROVIDER_CONFIGURATION_FAILURE',
  /**
   * REINTENTABLE. No se obtuvo respuesta semántica utilizable en algún
   * Requirement.
   *
   * El run queda intacto y el reintento vuelve a empezar por el PRIMER
   * Requirement: no hay checkpoint que permita retomar desde donde quedó.
   */
  'PROVIDER_TRANSPORT_FAILURE',
  /** REINTENTABLE. Falla del AI service que no es un desenlace de este run. */
  'INTERNAL_AI_SERVICE_FAILURE',
  /** REINTENTABLE. Falta el modelo configurado y no se puede congelar un plan. */
  'EXECUTION_CONFIGURATION_MISSING'
] as const;

export type ContextualReasoningStageCode =
  (typeof CONTEXTUAL_REASONING_STAGE_CODES)[number];

const STAGE_STATUS: Record<ContextualReasoningStageCode, HttpStatus> = {
  REASONING_RUN_NOT_FOUND: HttpStatus.NOT_FOUND,
  RUN_NOT_ELIGIBLE: HttpStatus.CONFLICT,
  PREVIOUS_STAGE_ARTIFACT_MISSING: HttpStatus.CONFLICT,
  PERSISTED_AUTHORITY_UNUSABLE: HttpStatus.INTERNAL_SERVER_ERROR,
  EXECUTION_PLAN_MISMATCH: HttpStatus.CONFLICT,
  PROVIDER_INVALID_OUTPUT: HttpStatus.BAD_GATEWAY,
  PROVIDER_CONFIGURATION_FAILURE: HttpStatus.FAILED_DEPENDENCY,
  PROVIDER_TRANSPORT_FAILURE: HttpStatus.SERVICE_UNAVAILABLE,
  INTERNAL_AI_SERVICE_FAILURE: HttpStatus.INTERNAL_SERVER_ERROR,
  EXECUTION_CONFIGURATION_MISSING: HttpStatus.SERVICE_UNAVAILABLE
};

export interface ContextualReasoningStageDetail {
  readonly invariant: string;
  readonly reasoningRunId?: string;
  /** El Requirement donde se cortó. Es un id local del Objective, no contenido. */
  readonly requirementId?: string;
  /** Cuántas llamadas se hicieron antes de cortar. Nunca contenido. */
  readonly providerCallsMade?: number;
}

export class ContextualReasoningStageError extends HttpException {
  public readonly code: ContextualReasoningStageCode;
  public readonly invariant: string;
  public readonly reasoningRunId?: string;
  public readonly requirementId?: string;
  public readonly providerCallsMade?: number;

  public constructor(
    code: ContextualReasoningStageCode,
    detail: ContextualReasoningStageDetail
  ) {
    super(`${code}: ${detail.invariant}`, STAGE_STATUS[code]);
    this.name = 'ContextualReasoningStageError';
    this.code = code;
    this.invariant = detail.invariant;
    this.reasoningRunId = detail.reasoningRunId;
    this.requirementId = detail.requirementId;
    this.providerCallsMade = detail.providerCallsMade;
  }
}

export function failContextualStage(
  code: ContextualReasoningStageCode,
  detail: ContextualReasoningStageDetail
): never {
  throw new ContextualReasoningStageError(code, detail);
}

/**
 * Códigos de fallo A NIVEL DE RUN que este slice puede persistir.
 *
 * El plan y la configuración del proveedor comparten código con las etapas
 * anteriores a propósito: el hecho es el mismo —el plan del run no sirve— y
 * duplicarlo por etapa obligaría a saber qué etapa falló para leer la fila.
 */
export const REASONING_CONTEXTUAL_REASONING_INVALID_OUTPUT =
  'reasoning_contextual_reasoning_invalid_output';
export const REASONING_CONTEXTUAL_AUTHORITY_UNUSABLE =
  'reasoning_contextual_authority_unusable';

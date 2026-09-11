/**
 * Errores de la orquestación del Objective Analysis — slice F3.3B.
 *
 * Espacio propio, por la misma razón que F3.2 tiene el suyo: éste responde
 * "¿pudo esta etapa ejecutarse y persistirse?", que no es ni "¿este artifact es
 * válido?" (F3.1) ni "¿este slot puede llenarse?" (slots).
 *
 * LA DISTINCIÓN QUE ORDENA TODO ESTE ARCHIVO:
 *
 *     TERMINAL      el run muere y NO se reintenta en la misma fila
 *     REINTENTABLE  el run queda intacto y puede volver a intentarse
 *
 * No es una etiqueta cosmética: decide si se destruye trabajo. Un plan que no
 * describe lo que se ejecutaría, o una salida completa que no cumple el contrato,
 * son hechos sobre ESTE run y lo matan. Un timeout, un AI service caído o un
 * request mal armado son problemas de infraestructura o de despliegue, y matar el
 * run por ellos destruiría trabajo por algo que se arregla redeployando.
 *
 * PRIVACIDAD: sólo ids internos, códigos cerrados y tokens de enum. Nunca
 * configuración de despliegue —ni el modelo esperado ni el encontrado—, nunca
 * texto del Objective, nunca la respuesta del proveedor.
 */

import { HttpException, HttpStatus } from '@nestjs/common';

export const OBJECTIVE_ANALYSIS_STAGE_CODES = [
  /** No existe el `ReasoningRun`. */
  'REASONING_RUN_NOT_FOUND',
  /**
   * El run ya terminó —failed, completed— o arrastra un `failureCode`.
   *
   * No se ejecuta la etapa sobre un run cerrado, y no se "reabre": un run
   * terminado es un hecho, no un estado a corregir.
   */
  'RUN_NOT_ELIGIBLE',
  /**
   * TERMINAL. La configuración productiva desplegada no coincide con el plan
   * congelado del run, o el AI service dijo lo mismo desde su lado.
   *
   * `CONFIG_DRIFT_POLICY: FAIL_CLOSED`. El plan es un compromiso; si ya no
   * describe lo que se ejecutaría, la ejecución sería materialmente otra y
   * necesita su propio run con su propio plan.
   */
  'EXECUTION_PLAN_MISMATCH',
  /**
   * TERMINAL. El proveedor respondió ENTERO y su salida no cumple el contrato
   * —forma inválida, conjunto de Requirements alterado, o un qualifier que no
   * cita literalmente el snapshot—.
   *
   * No se le vuelve a preguntar. Reintentar hasta que una salida pase los guards
   * no es robustez: es muestrear hasta que algo entre.
   */
  'PROVIDER_INVALID_OUTPUT',
  /**
   * TERMINAL. El proveedor rechazó la petición de forma DETERMINISTA: el modelo
   * del plan no existe, la credencial no sirve, o la petición fue rechazada
   * estructuralmente.
   *
   * Repetir el MISMO plan congelado no puede dar otro resultado, así que dejarlo
   * reintentable sería un bucle, no resiliencia. Corregir la configuración exige
   * un run nuevo con su propio plan — la misma lógica que `EXECUTION_PLAN_MISMATCH`.
   */
  'PROVIDER_CONFIGURATION_FAILURE',
  /**
   * REINTENTABLE. No se obtuvo ninguna respuesta semántica utilizable: timeout,
   * AI service caído, proveedor sin configurar.
   *
   * El artifact sigue ABSENT y el plan sigue coincidiendo, así que el reintento
   * en la MISMA fila está permitido.
   */
  'PROVIDER_TRANSPORT_FAILURE',
  /**
   * REINTENTABLE. Falla del AI service que no es ni plan ni salida del proveedor:
   * request mal armado, credencial interna rechazada, 5xx inesperado, envelope
   * que no se entiende.
   *
   * Es un bug de despliegue del lado de casa, no un desenlace de este run.
   */
  'INTERNAL_AI_SERVICE_FAILURE',
  /**
   * REINTENTABLE. Falta configuración productiva en NestJS —el modelo solicitado—
   * y sin ella no se puede congelar un plan completo.
   *
   * NO se escribe un plan incompleto para salir del paso: con fill-once, una
   * etapa "indeterminada" no podría completarse nunca.
   */
  'EXECUTION_CONFIGURATION_MISSING'
] as const;

export type ObjectiveAnalysisStageCode =
  (typeof OBJECTIVE_ANALYSIS_STAGE_CODES)[number];

const STAGE_STATUS: Record<ObjectiveAnalysisStageCode, HttpStatus> = {
  REASONING_RUN_NOT_FOUND: HttpStatus.NOT_FOUND,
  RUN_NOT_ELIGIBLE: HttpStatus.CONFLICT,
  EXECUTION_PLAN_MISMATCH: HttpStatus.CONFLICT,
  PROVIDER_INVALID_OUTPUT: HttpStatus.BAD_GATEWAY,
  PROVIDER_CONFIGURATION_FAILURE: HttpStatus.FAILED_DEPENDENCY,
  PROVIDER_TRANSPORT_FAILURE: HttpStatus.SERVICE_UNAVAILABLE,
  INTERNAL_AI_SERVICE_FAILURE: HttpStatus.INTERNAL_SERVER_ERROR,
  EXECUTION_CONFIGURATION_MISSING: HttpStatus.SERVICE_UNAVAILABLE
};

export interface ObjectiveAnalysisStageDetail {
  readonly invariant: string;
  readonly reasoningRunId?: string;
}

export class ObjectiveAnalysisStageError extends HttpException {
  public readonly code: ObjectiveAnalysisStageCode;
  public readonly invariant: string;
  public readonly reasoningRunId?: string;

  public constructor(
    code: ObjectiveAnalysisStageCode,
    detail: ObjectiveAnalysisStageDetail
  ) {
    super(`${code}: ${detail.invariant}`, STAGE_STATUS[code]);
    this.name = 'ObjectiveAnalysisStageError';
    this.code = code;
    this.invariant = detail.invariant;
    this.reasoningRunId = detail.reasoningRunId;
  }
}

export function failStage(
  code: ObjectiveAnalysisStageCode,
  detail: ObjectiveAnalysisStageDetail
): never {
  throw new ObjectiveAnalysisStageError(code, detail);
}

/**
 * Códigos de fallo A NIVEL DE RUN que este slice puede persistir.
 *
 * Cerrados, sin detalle y sin valores: siguen la convención de
 * `reasoning_input_freeze_blocked`. Nunca llevan el modelo esperado, el
 * encontrado, el effort ni texto de error — decir "esperaba X, encontré Y"
 * metería configuración de despliegue en un log.
 */
export const REASONING_EXECUTION_PLAN_MISMATCH = 'reasoning_execution_plan_mismatch';
export const REASONING_PROVIDER_CONFIGURATION_INVALID =
  'reasoning_provider_configuration_invalid';
export const REASONING_OBJECTIVE_ANALYSIS_INVALID_OUTPUT =
  'reasoning_objective_analysis_invalid_output';

/**
 * Errores de la ejecución completa de un ReasoningRun — slice F3.6.
 *
 * Vocabulario NUEVO y ACOTADO: sólo lo que no existía en las etapas. Todo lo que
 * ya tiene código —plan que no coincide, autoridad corrupta, salida inválida,
 * fallo de transporte— se propaga tal cual desde F3.3/F3.4/F3.5 y conserva su
 * `failureCode` a nivel de run. Duplicarlo por orquestador obligaría a saber
 * quién llamó para poder leer la fila.
 *
 * PRIVACIDAD: sólo ids internos, conteos y códigos cerrados. Nunca el Objective,
 * ni un Requirement, ni una proposición, ni una cita, ni una explicación final.
 */

import { HttpException, HttpStatus } from '@nestjs/common';

export const REASONING_RUN_EXECUTION_CODES = [
  /** No existe el `ReasoningRun`. */
  'REASONING_RUN_NOT_FOUND',
  /**
   * Otro orquestador tiene la claim, o el run ya no admite ejecución.
   *
   * CERO llamadas al proveedor. El perdedor de la carrera no ejecuta ninguna
   * etapa: la exclusión ocurre ANTES de comprar la primera observación, no
   * después.
   */
  'EXECUTION_ALREADY_CLAIMED',
  /**
   * El run ya terminó en `failed`.
   *
   * No se reinicia en la misma fila. Una observación epistemológica nueva es un
   * ReasoningRun nuevo.
   */
  'RUN_TERMINALLY_FAILED',
  /**
   * `completed` pero el `resultArtifact` falta o no verifica.
   *
   * Se falla CERRADO: no se recalcula, no se sobreescribe y no se llama a nadie.
   * Reescribir historia sería peor que no poder leerla.
   */
  'COMPLETED_RUN_RESULT_UNUSABLE',
  /**
   * La versión de policy congelada en el plan no es la que este proceso ejecuta.
   *
   * Se detecta ANTES de reclamar, así que no se compra ninguna observación.
   */
  'DETERMINISTIC_POLICY_VERSION_MISMATCH',
  /**
   * Las entradas verificadas no se corresponden entre sí al aplicar la policy.
   *
   * No es un fallo del proveedor: es que el conjunto Objective/análisis/catálogo/
   * razonamiento no encaja. Terminal.
   */
  'POLICY_INPUT_INCONSISTENT',
  /**
   * El resultado construido no supera su propia verificación, o no pudo
   * persistirse de forma coherente con el estado del run.
   */
  'FINAL_RESULT_NOT_PERSISTABLE'
] as const;

export type ReasoningRunExecutionCode =
  (typeof REASONING_RUN_EXECUTION_CODES)[number];

const EXECUTION_STATUS: Record<ReasoningRunExecutionCode, HttpStatus> = {
  REASONING_RUN_NOT_FOUND: HttpStatus.NOT_FOUND,
  EXECUTION_ALREADY_CLAIMED: HttpStatus.CONFLICT,
  RUN_TERMINALLY_FAILED: HttpStatus.CONFLICT,
  COMPLETED_RUN_RESULT_UNUSABLE: HttpStatus.INTERNAL_SERVER_ERROR,
  DETERMINISTIC_POLICY_VERSION_MISMATCH: HttpStatus.CONFLICT,
  POLICY_INPUT_INCONSISTENT: HttpStatus.INTERNAL_SERVER_ERROR,
  FINAL_RESULT_NOT_PERSISTABLE: HttpStatus.INTERNAL_SERVER_ERROR
};

export interface ReasoningRunExecutionDetail {
  readonly invariant: string;
  readonly reasoningRunId?: string;
  /** Id local del Objective, nunca contenido. */
  readonly requirementId?: string;
  /** Estado observado del run. Token cerrado del enum, nunca texto libre. */
  readonly observedStatus?: string;
}

export class ReasoningRunExecutionError extends HttpException {
  public readonly code: ReasoningRunExecutionCode;
  public readonly invariant: string;
  public readonly reasoningRunId?: string;
  public readonly requirementId?: string;
  public readonly observedStatus?: string;

  public constructor(
    code: ReasoningRunExecutionCode,
    detail: ReasoningRunExecutionDetail
  ) {
    super(`${code}: ${detail.invariant}`, EXECUTION_STATUS[code]);
    this.name = 'ReasoningRunExecutionError';
    this.code = code;
    this.invariant = detail.invariant;
    this.reasoningRunId = detail.reasoningRunId;
    this.requirementId = detail.requirementId;
    this.observedStatus = detail.observedStatus;
  }
}

export function failExecution(
  code: ReasoningRunExecutionCode,
  detail: ReasoningRunExecutionDetail
): never {
  throw new ReasoningRunExecutionError(code, detail);
}

/**
 * Códigos de fallo A NIVEL DE RUN que F3.6 puede persistir.
 *
 * `reasoning_execution_plan_mismatch` NO se agrega acá: ya existe en F3.3 y es
 * exactamente el mismo hecho —el plan congelado no describe lo que se ejecutaría—,
 * así que se reutiliza.
 */
export const REASONING_POLICY_INPUT_INCONSISTENT =
  'reasoning_policy_input_inconsistent';
export const REASONING_FINAL_RESULT_NOT_PERSISTABLE =
  'reasoning_final_result_not_persistable';

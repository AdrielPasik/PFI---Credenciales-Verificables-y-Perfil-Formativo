/**
 * Errores de la orquestación del catálogo de EvidenceUnits — slice F3.4.
 *
 * Misma distinción que ordena la etapa 1, porque decide lo mismo — si se destruye
 * trabajo:
 *
 *     TERMINAL      el run muere y NO se reintenta en la misma fila
 *     REINTENTABLE  el run queda intacto y puede volver a intentarse
 *
 * Espacio propio y no reutilizado: los códigos de etapa nombran hechos de ESTA
 * etapa, y compartir el enum haría representable un `GROUNDING_INPUT_UNUSABLE` en
 * un run de Objective Analysis, donde no significa nada.
 *
 * PRIVACIDAD: sólo ids internos y códigos cerrados. Nunca texto canónico, nunca
 * excerpts, nunca la propuesta del proveedor.
 */

import { HttpException, HttpStatus } from '@nestjs/common';

export const EVIDENCE_UNITS_STAGE_CODES = [
  /** No existe el `ReasoningRun`. */
  'REASONING_RUN_NOT_FOUND',
  /** El run ya terminó, o arrastra un `failureCode`. */
  'RUN_NOT_ELIGIBLE',
  /**
   * TERMINAL. El material de grounding congelado ya no es utilizable: falta el
   * slot de extracción, el artifact persistido no verifica, o un SHA congelado no
   * coincide.
   *
   * NO se llama al proveedor: sin input verificable no hay nada contra qué
   * anclar, y una propuesta sobre material que no se pudo verificar no podría
   * persistirse igual. Tampoco se toca la disposición del inventario: el
   * inventario dice lo que se observó cuando el run se congeló, y reescribirlo
   * ahora borraría el hecho.
   */
  'GROUNDING_INPUT_UNUSABLE',
  /** TERMINAL. El plan congelado no describe lo que esta etapa ejecutaría. */
  'EXECUTION_PLAN_MISMATCH',
  /** TERMINAL. El proveedor respondió entero y su salida no cumple el contrato. */
  'PROVIDER_INVALID_OUTPUT',
  /** TERMINAL. El proveedor rechazó la petición de forma determinista. */
  'PROVIDER_CONFIGURATION_FAILURE',
  /** REINTENTABLE. No se obtuvo ninguna respuesta semántica utilizable. */
  'PROVIDER_TRANSPORT_FAILURE',
  /** REINTENTABLE. Falla del AI service que no es un desenlace de este run. */
  'INTERNAL_AI_SERVICE_FAILURE',
  /** REINTENTABLE. Falta el modelo configurado y no se puede congelar un plan. */
  'EXECUTION_CONFIGURATION_MISSING'
] as const;

export type EvidenceUnitsStageCode = (typeof EVIDENCE_UNITS_STAGE_CODES)[number];

const STAGE_STATUS: Record<EvidenceUnitsStageCode, HttpStatus> = {
  REASONING_RUN_NOT_FOUND: HttpStatus.NOT_FOUND,
  RUN_NOT_ELIGIBLE: HttpStatus.CONFLICT,
  GROUNDING_INPUT_UNUSABLE: HttpStatus.INTERNAL_SERVER_ERROR,
  EXECUTION_PLAN_MISMATCH: HttpStatus.CONFLICT,
  PROVIDER_INVALID_OUTPUT: HttpStatus.BAD_GATEWAY,
  PROVIDER_CONFIGURATION_FAILURE: HttpStatus.FAILED_DEPENDENCY,
  PROVIDER_TRANSPORT_FAILURE: HttpStatus.SERVICE_UNAVAILABLE,
  INTERNAL_AI_SERVICE_FAILURE: HttpStatus.INTERNAL_SERVER_ERROR,
  EXECUTION_CONFIGURATION_MISSING: HttpStatus.SERVICE_UNAVAILABLE
};

export interface EvidenceUnitsStageDetail {
  readonly invariant: string;
  readonly reasoningRunId?: string;
  /** `runLocalSourceId`. Es un id local del run, nunca contenido. */
  readonly runLocalSourceId?: string;
}

export class EvidenceUnitsStageError extends HttpException {
  public readonly code: EvidenceUnitsStageCode;
  public readonly invariant: string;
  public readonly reasoningRunId?: string;
  public readonly runLocalSourceId?: string;

  public constructor(code: EvidenceUnitsStageCode, detail: EvidenceUnitsStageDetail) {
    super(`${code}: ${detail.invariant}`, STAGE_STATUS[code]);
    this.name = 'EvidenceUnitsStageError';
    this.code = code;
    this.invariant = detail.invariant;
    this.reasoningRunId = detail.reasoningRunId;
    this.runLocalSourceId = detail.runLocalSourceId;
  }
}

export function failEvidenceUnitsStage(
  code: EvidenceUnitsStageCode,
  detail: EvidenceUnitsStageDetail
): never {
  throw new EvidenceUnitsStageError(code, detail);
}

/**
 * Códigos de fallo A NIVEL DE RUN que este slice puede persistir.
 *
 * Cerrados y sin detalle, como `reasoning_input_freeze_blocked`. El plan y la
 * configuración del proveedor comparten código con la etapa 1 a propósito: el
 * hecho es el mismo —el plan del run no sirve— y duplicarlo por etapa obligaría a
 * quien lea la fila a saber qué etapa falló para entender el código.
 */
export const REASONING_EVIDENCE_UNITS_GROUNDING_UNUSABLE =
  'reasoning_evidence_units_grounding_unusable';
export const REASONING_EVIDENCE_UNITS_INVALID_OUTPUT =
  'reasoning_evidence_units_invalid_output';

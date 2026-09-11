/**
 * Errores del congelamiento de inputs — slice F3.2.
 *
 * Espacio propio, separado del de los artifacts (F3.1) y del de los slots: éste
 * responde "¿se puede congelar un universo de evidencia para este Objective y
 * este holder?".
 *
 * UNA DISTINCIÓN QUE ES EL CORAZÓN DE ESTE SLICE. Estos errores ABORTAN el
 * freeze; no son disposiciones de inventario. Una fila `BLOCKED_*` afirma un
 * hecho OBSERVADO sobre una fuente concreta, y sólo se persiste cuando el sistema
 * llegó a determinar qué pasó con ella. Una base caída, un timeout o una excepción
 * inesperada no son hechos sobre ninguna fuente: hacen fallar la transacción
 * entera, sin ReasoningRun a medias.
 *
 * PRIVACIDAD: sólo ids internos y códigos cerrados. Nunca contenido de
 * `TextEvidence`, texto canónico, excerpts, storage keys ni el `originalText` del
 * Objective.
 */

import { HttpException, HttpStatus } from '@nestjs/common';

export const REASONING_RUN_INPUT_FREEZE_CODES = [
  /**
   * El Objective no existe, o no pertenece al holder.
   *
   * UN SOLO código para los dos casos, a propósito: distinguirlos le diría a un
   * llamante si un id ajeno existe, que es exactamente el filtrado de existencia
   * que `/me/objectives` ya evita en F2.2.
   */
  'OBJECTIVE_NOT_FOUND',
  /**
   * El artifact `objective_definition_v1` persistido no supera el verificador de
   * F2. No se congela un run contra una definición que no se puede leer.
   */
  'OBJECTIVE_DEFINITION_CORRUPT'
] as const;

export type ReasoningRunInputFreezeCode =
  (typeof REASONING_RUN_INPUT_FREEZE_CODES)[number];

const FREEZE_STATUS: Record<ReasoningRunInputFreezeCode, HttpStatus> = {
  OBJECTIVE_NOT_FOUND: HttpStatus.NOT_FOUND,
  OBJECTIVE_DEFINITION_CORRUPT: HttpStatus.INTERNAL_SERVER_ERROR
};

export interface ReasoningRunInputFreezeDetail {
  readonly invariant: string;
  readonly objectiveId?: string;
}

export class ReasoningRunInputFreezeError extends HttpException {
  public readonly code: ReasoningRunInputFreezeCode;
  public readonly invariant: string;
  public readonly objectiveId?: string;

  public constructor(
    code: ReasoningRunInputFreezeCode,
    detail: ReasoningRunInputFreezeDetail
  ) {
    super(`${code}: ${detail.invariant}`, FREEZE_STATUS[code]);
    this.name = 'ReasoningRunInputFreezeError';
    this.code = code;
    this.invariant = detail.invariant;
    this.objectiveId = detail.objectiveId;
  }
}

export function failFreeze(
  code: ReasoningRunInputFreezeCode,
  detail: ReasoningRunInputFreezeDetail
): never {
  throw new ReasoningRunInputFreezeError(code, detail);
}

/**
 * Código de fallo A NIVEL DE RUN cuando el inventario congelado tiene al menos
 * una fila bloqueada.
 *
 * UNO SOLO, cerrado y sin detalle. No intenta codificar el submotivo de cada
 * item: un mismo run puede tener varias filas bloqueadas por causas distintas, y
 * elegir "la primera" como representante sería inventar una precedencia que nadie
 * decidió. La causa por item vive donde corresponde —en `disposition`— y, para el
 * fallo de integridad, la fila conserva además el candidato exacto que falló.
 *
 * Nunca lleva texto de error, ni ids concatenados, ni JSON dentro del String.
 */
export const REASONING_INPUT_FREEZE_BLOCKED = 'reasoning_input_freeze_blocked';

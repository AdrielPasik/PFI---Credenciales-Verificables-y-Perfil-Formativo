/**
 * Errores del servicio de slots de etapa — slice F3.1.
 *
 * Espacio separado del de los artifacts a proposito: aquellos responden "¿este
 * artifact es valido?", estos responden "¿este slot puede llenarse ahora?". Son
 * preguntas distintas y confundirlas haria imposible distinguir un artifact mal
 * formado de una etapa fuera de orden.
 *
 * PRIVACIDAD: solo ids internos e invariantes. Nunca contenido de artifact.
 */

import { HttpException, HttpStatus } from '@nestjs/common';

export const REASONING_RUN_SLOT_CODES = [
  /** No existe el `ReasoningRun`. */
  'REASONING_RUN_NOT_FOUND',
  /**
   * El slot ya estaba lleno con un artifact DISTINTO.
   *
   * No es last-write-wins y no se reintenta: un resultado distinto de la misma
   * etapa pertenece a OTRO run, no a una mutacion de este.
   */
  'STAGE_ARTIFACT_CONFLICT',
  /**
   * Lo persistido no supera su propio verificador.
   *
   * NUNCA se sobreescribe por esto. Un slot corrupto es un hecho a investigar, no
   * un permiso para pisar el historico.
   */
  'STAGE_ARTIFACT_CORRUPT',
  /** El snapshot del Objective persistido no supera el verificador de F2. */
  'OBJECTIVE_SNAPSHOT_CORRUPT',
  /**
   * Se intento llenar `resultArtifact` sin que las dos etapas previas esten
   * PRESENTES y verificadas.
   */
  'PREVIOUS_STAGE_ARTIFACT_MISSING',
  /** El compare-and-set no aplico sobre un slot que seguia ABSENT. */
  'STAGE_ARTIFACT_SLOT_INCONSISTENT',
  /**
   * El run ya no esta en un estado que admita escribir esta etapa.
   *
   * NO es corrupcion y NO es conflicto de artifact: el slot sigue ABSENT y la
   * fila esta perfectamente sana. Lo que paso es que el run ya termino —fallo
   * terminal concurrente, o un estado que este slice no produce— y escribir
   * ahora dejaria un run `failed` CON artifact de etapa, que es exactamente la
   * incoherencia de fila que el hardening del CAS existe para impedir.
   *
   * Se distingue de `STAGE_ARTIFACT_SLOT_INCONSISTENT` a proposito: aquel afirma
   * que algo imposible ocurrio; este afirma una carrera perdida, que es normal.
   */
  'RUN_NOT_ELIGIBLE_FOR_STAGE_WRITE'
] as const;

export type ReasoningRunSlotCode = (typeof REASONING_RUN_SLOT_CODES)[number];

const SLOT_STATUS: Record<ReasoningRunSlotCode, HttpStatus> = {
  REASONING_RUN_NOT_FOUND: HttpStatus.NOT_FOUND,
  STAGE_ARTIFACT_CONFLICT: HttpStatus.CONFLICT,
  STAGE_ARTIFACT_CORRUPT: HttpStatus.INTERNAL_SERVER_ERROR,
  OBJECTIVE_SNAPSHOT_CORRUPT: HttpStatus.INTERNAL_SERVER_ERROR,
  PREVIOUS_STAGE_ARTIFACT_MISSING: HttpStatus.CONFLICT,
  STAGE_ARTIFACT_SLOT_INCONSISTENT: HttpStatus.INTERNAL_SERVER_ERROR,
  RUN_NOT_ELIGIBLE_FOR_STAGE_WRITE: HttpStatus.CONFLICT
};

export interface ReasoningRunSlotDetail {
  readonly invariant: string;
  readonly reasoningRunId?: string;
  readonly slot?: string;
}

export class ReasoningRunSlotError extends HttpException {
  public readonly code: ReasoningRunSlotCode;
  public readonly invariant: string;
  public readonly reasoningRunId?: string;
  public readonly slot?: string;

  public constructor(
    code: ReasoningRunSlotCode,
    detail: ReasoningRunSlotDetail
  ) {
    super(`${code}: ${detail.invariant}`, SLOT_STATUS[code]);
    this.name = 'ReasoningRunSlotError';
    this.code = code;
    this.invariant = detail.invariant;
    this.reasoningRunId = detail.reasoningRunId;
    this.slot = detail.slot;
  }
}

export function failSlot(
  code: ReasoningRunSlotCode,
  detail: ReasoningRunSlotDetail
): never {
  throw new ReasoningRunSlotError(code, detail);
}

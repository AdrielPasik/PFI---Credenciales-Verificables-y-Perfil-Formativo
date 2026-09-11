/**
 * Modelo de error del extraction slot — slice F1.2.
 *
 * Tercer espacio de códigos, separado de los otros dos, porque responde una
 * tercera pregunta:
 *
 *     F0.4  "¿este artifact es internamente válido y fiel al contrato?"
 *     F0.5  "¿está atado a la fuente autoritativa que este run congeló?"
 *     F1.2  "¿lo que la base devolvió es exactamente lo que se persistió?"
 *
 * Un `ARTIFACT_BLOB_SHA_MISMATCH` dice que los bytes cambiaron bajo nuestros
 * pies; un `EXTRACTION_SLOT_CONFLICT` dice que la fila ya guarda otra cosa y no
 * la vamos a pisar. Son fallos con consecuencias distintas aguas arriba.
 *
 * PRIVACIDAD: un error NUNCA lleva el canonical JSON, `canonicalText`,
 * `exactExcerpt`, `diagnostic.detail` ni contenido de la fuente. Sólo
 * identificadores de dominio y el nombre del invariante.
 */

import { BadRequestException } from '@nestjs/common';

export const SOURCE_EXTRACTION_SLOT_CODES = [
  /** No existe el `AnalysisRunSource` pedido. */
  'ANALYSIS_RUN_SOURCE_NOT_FOUND',
  /** El slot está ABSENT: la fila existe pero nunca se extrajo. */
  'EXTRACTION_SLOT_ABSENT',
  /** Bundle parcialmente poblado: uno o dos campos null. Estado inválido. */
  'EXTRACTION_SLOT_INCONSISTENT',
  /** El slot ya está lleno con un bundle DISTINTO. Nunca se sobrescribe. */
  'EXTRACTION_SLOT_CONFLICT',
  /** El SHA recomputado sobre los bytes guardados no coincide con el testigo. */
  'ARTIFACT_BLOB_SHA_MISMATCH',
  /** Los bytes guardados no parsean como JSON. */
  'ARTIFACT_BLOB_JSON_INVALID',
  /** El artifact parseado no pasa la verificación interna de F0.4. */
  'ARTIFACT_VERIFICATION_FAILED',
  /**
   * Los bytes guardados son JSON válido y el artifact verifica, pero NO son la
   * serialización canónica del artifact. Invariante distinto del SHA de blob:
   * aquél detecta que los bytes cambiaron, éste que nunca fueron canónicos.
   */
  'ARTIFACT_CANONICAL_BLOB_MISMATCH'
] as const;

export type SourceExtractionSlotCode = typeof SOURCE_EXTRACTION_SLOT_CODES[number];

export interface SourceExtractionSlotDetail {
  invariant: string;
  analysisRunSourceId: string;
  /** Sólo cuando ayuda a ubicar el fallo, y nunca contenido. */
  presentFields?: string[];
}

export class SourceExtractionSlotError extends BadRequestException {
  public readonly code: SourceExtractionSlotCode;
  public readonly detail: SourceExtractionSlotDetail;

  public constructor(
    code: SourceExtractionSlotCode,
    detail: SourceExtractionSlotDetail
  ) {
    super(`source_extraction slot ${code}: ${detail.invariant}`);
    this.name = 'SourceExtractionSlotError';
    this.code = code;
    this.detail = detail;
  }
}

export function failSlot(
  code: SourceExtractionSlotCode,
  detail: SourceExtractionSlotDetail
): never {
  throw new SourceExtractionSlotError(code, detail);
}

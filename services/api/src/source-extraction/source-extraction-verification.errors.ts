/**
 * Modelo de error de la verificacion de `source_extraction_v1`.
 *
 * No devuelve `true`/`false`: F0.5 va a necesitar distinguir *por que* un
 * artifact fue rechazado — un fingerprint que no cierra y una cita desalineada
 * son fallos con consecuencias distintas aguas arriba.
 *
 * Extiende `BadRequestException` para comportarse como el resto de la capa API
 * (misma convencion que `semantic-analysis-artifact.validator.ts`), pero carga
 * ademas datos estructurados legibles por codigo.
 *
 * PRIVACIDAD: un error NUNCA lleva `canonicalText`, `exactExcerpt` ni ningun
 * fragmento del documento. Solo path, codigo de invariante e identificadores de
 * direccion (`pageIndex`, `segmentId`), que son coordenadas y no contenido.
 */

import { BadRequestException } from '@nestjs/common';

export const SOURCE_EXTRACTION_VERIFICATION_CODES = [
  /** No cumple la forma estructural del schema congelado. */
  'SCHEMA_INVALID',
  /** La material projection no es serializable bajo MINIMAL_DETERMINISTIC_JSON_V1. */
  'CANONICALIZATION_INVALID',
  /** El fingerprint recalculado no coincide con el declarado. */
  'FINGERPRINT_MISMATCH',
  /** Offsets, ids de segmento o direcciones de pagina invalidos o inconsistentes. */
  'ADDRESS_INVALID',
  /** El span no reconstruye el `exactExcerpt` declarado. */
  'ALIGNMENT_MISMATCH',
  /** `coverageStatus` no se deriva de los estados de pagina bajo su sourceType. */
  'COVERAGE_INCONSISTENT',
  /** Combinacion de diagnostico invalida, o fuera del orden canonico congelado. */
  'DIAGNOSTIC_INCONSISTENT',
  /** Campos incompatibles con el `sourceType` declarado. */
  'SOURCE_TYPE_INCONSISTENT'
] as const;

export type SourceExtractionVerificationCode =
  typeof SOURCE_EXTRACTION_VERIFICATION_CODES[number];

export interface SourceExtractionVerificationDetail {
  /** Path JSON del campo ofensor, p. ej. `segments[3].charEnd`. */
  path: string;
  /** Nombre estable del invariante violado, apto para consumo por codigo. */
  invariant: string;
  pageIndex?: number | null;
  segmentId?: string;
}

export class SourceExtractionVerificationError extends BadRequestException {
  public readonly code: SourceExtractionVerificationCode;
  public readonly detail: SourceExtractionVerificationDetail;

  public constructor(
    code: SourceExtractionVerificationCode,
    detail: SourceExtractionVerificationDetail
  ) {
    super(`source_extraction_v1 ${code}: ${detail.invariant} at ${detail.path}`);
    this.name = 'SourceExtractionVerificationError';
    this.code = code;
    this.detail = detail;
  }
}

export function fail(
  code: SourceExtractionVerificationCode,
  detail: SourceExtractionVerificationDetail
): never {
  throw new SourceExtractionVerificationError(code, detail);
}

/**
 * Modelo de error del trust gate de F0.5.
 *
 * Deliberadamente SEPARADO de los códigos de F0.4. Las dos capas responden
 * preguntas distintas y sus fallos tienen consecuencias distintas aguas arriba:
 *
 *     F0.4  ->  "¿este artifact es internamente válido y fiel al contrato?"
 *     F0.5  ->  "¿este artifact válido está atado a la fuente autoritativa
 *                que este AnalysisRun congeló?"
 *
 * Un `FINGERPRINT_MISMATCH` dice que el artifact miente sobre sí mismo; un
 * `SOURCE_SHA_MISMATCH` dice que el artifact es impecable pero habla de otra
 * fuente. Colapsarlos en un mismo espacio de códigos borraría esa diferencia.
 *
 * PRIVACIDAD: un error NUNCA lleva `canonicalText`, `exactExcerpt`,
 * `TextEvidence.content` ni bytes de la fuente. Solo identificadores de dominio
 * y el nombre del invariante.
 */

import { BadRequestException } from '@nestjs/common';

export const SOURCE_EXTRACTION_TRUST_CODES = [
  /** No existe el `AnalysisRunSource` pedido. */
  'ANALYSIS_RUN_SOURCE_NOT_FOUND',
  /** La fila viola el XOR documento/texto o su sha no tiene forma válida. */
  'ANALYSIS_RUN_SOURCE_INVALID',
  /** El `sourceType` del artifact no es el que declara la autoridad. */
  'SOURCE_TYPE_MISMATCH',
  /** La entidad fuente autoritativa no existe. */
  'SOURCE_ENTITY_NOT_FOUND',
  /** El id de fuente del artifact no es el autoritativo. */
  'SOURCE_ENTITY_MISMATCH',
  /** Algún sha de la cadena no coincide con el congelado por el run. */
  'SOURCE_SHA_MISMATCH',
  /** El `storageKey` del artifact no es el autoritativo. */
  'SOURCE_STORAGE_MISMATCH',
  /** No se pudieron leer los bytes autoritativos. */
  'SOURCE_READ_FAILED',
  /** El contenido almacenado dejó de ser punto fijo de la normalización. */
  'TEXT_NORMALIZATION_DRIFT',
  /** El texto canónico del artifact no es el contenido autoritativo. */
  'TEXT_CANONICAL_TEXT_MISMATCH',
  /** Dos bindings de una misma fuente declaran extraction identities distintas. */
  'EXTRACTION_IDENTITY_BINDING_CONFLICT',
  /** Un conjunto de bindings mezcla runs distintos. */
  'RUN_SCOPE_MISMATCH'
] as const;

export type SourceExtractionTrustCode = typeof SOURCE_EXTRACTION_TRUST_CODES[number];

export interface SourceExtractionTrustDetail {
  /** Nombre estable del invariante violado, apto para consumo por código. */
  invariant: string;
  analysisRunSourceId?: string;
  analysisRunId?: string;
  sourceType?: string;
  /** Id de la entidad fuente. Es un identificador de dominio, no contenido. */
  sourceEntityId?: string;
}

export class SourceExtractionTrustError extends BadRequestException {
  public readonly code: SourceExtractionTrustCode;
  public readonly detail: SourceExtractionTrustDetail;

  public constructor(
    code: SourceExtractionTrustCode,
    detail: SourceExtractionTrustDetail
  ) {
    super(`source_extraction trust gate ${code}: ${detail.invariant}`);
    this.name = 'SourceExtractionTrustError';
    this.code = code;
    this.detail = detail;
  }
}

export function failTrust(
  code: SourceExtractionTrustCode,
  detail: SourceExtractionTrustDetail
): never {
  throw new SourceExtractionTrustError(code, detail);
}

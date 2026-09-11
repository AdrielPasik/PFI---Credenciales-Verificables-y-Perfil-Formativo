/**
 * Modelo de error de la orquestacion de extraccion — slice F1.4.
 *
 * CUARTO espacio de codigos, separado de los otros tres, porque responde una
 * cuarta pregunta:
 *
 *     F0.4  "¿este artifact es internamente valido y fiel al contrato?"
 *     F0.5  "¿esta atado a la fuente autoritativa que este run congelo?"
 *     F1.2  "¿lo que la base devolvio es exactamente lo que se persistio?"
 *     F1.4  "¿esta fuente autoritativa admite siquiera intentar una extraccion,
 *            y con que material?"
 *
 * Todos estos fallos ocurren ANTES de llamar al productor. Son defectos propios
 * de la orquestacion: la autoridad no existe, se contradice, o describe una
 * fuente que el extractor V1 no cubre.
 *
 * LO QUE ESTE ESPACIO NO ABSORBE. Las capas de abajo ya tienen sus propios
 * errores y no se colapsan aca:
 *
 *     AiServiceClientError               transporte/productor
 *     SourceExtractionVerificationError  F0.4
 *     SourceExtractionTrustError         F0.5
 *     SourceExtractionSlotError          F1.2
 *     DocumentStorageError               lectura de storage
 *
 * Envolverlos en un unico `SOURCE_EXTRACTION_FAILED` borraria la diferencia
 * entre "el artifact miente", "S3 no responde" y "la fila ya guarda otra cosa",
 * que tienen consecuencias distintas aguas arriba.
 *
 * PRIVACIDAD: un error NUNCA lleva canonicalText, exactExcerpt, contenido de
 * TextEvidence, bytes de la fuente, storageKey ni el mimeType crudo. Solo
 * identificadores de dominio, el enum de kind y el nombre del invariante. La
 * distincion fina entre "no es kind pdf" y "el mimeType no es application/pdf"
 * viaja en el NOMBRE del invariante, no ecoando el valor recibido.
 */

import { BadRequestException } from '@nestjs/common';

export const SOURCE_EXTRACTION_ORCHESTRATION_CODES = [
  /** No existe el `AnalysisRunSource` pedido. */
  'ANALYSIS_RUN_SOURCE_NOT_FOUND_FOR_EXTRACTION',
  /**
   * La fila existe pero se contradice: viola el XOR documento/texto, su
   * `sourceType` no concuerda con la referencia que trae, o su sha congelado no
   * tiene forma valida. No se elige un camino "por mayoria".
   */
  'ANALYSIS_RUN_SOURCE_INVALID_FOR_EXTRACTION',
  /** La entidad fuente que el run congelo ya no existe. */
  'SOURCE_ENTITY_NOT_FOUND_FOR_EXTRACTION',
  /**
   * La `DocumentEvidence` autoritativa NO es una fuente PDF.
   *
   * `sourceType = document_evidence` no implica PDF: el producto tambien admite
   * PNG y JPEG. El extractor F0 V1 solo cubre PDF, y convertir una imagen
   * conocida por el dominio en un artifact PDF `FAILED` seria una mentira: el
   * `FAILED` significa "es una fuente PDF y no pudimos observarla", no "esto
   * nunca fue un PDF".
   */
  'DOCUMENT_SOURCE_NOT_SUPPORTED_FOR_EXTRACTION',
  /**
   * El snapshot autoritativo no es coherente consigo mismo: el sha de la entidad
   * fuente no es el congelado por el run, o la entidad pertenece a otra
   * credencial. Fail-fast antes del transporte; NO sustituye a F0.5, que vuelve
   * a establecer el binding despues de la respuesta.
   */
  'AUTHORITATIVE_SNAPSHOT_MISMATCH'
] as const;

export type SourceExtractionOrchestrationCode =
  typeof SOURCE_EXTRACTION_ORCHESTRATION_CODES[number];

export interface SourceExtractionOrchestrationDetail {
  /** Nombre estable del invariante violado, apto para consumo por codigo. */
  invariant: string;
  analysisRunSourceId: string;
  analysisRunId?: string;
  /** Id de la entidad fuente. Identificador de dominio, no contenido. */
  sourceEntityId?: string;
  /** Enum cerrado de dominio (`pdf` | `image`). Nunca el mimeType crudo. */
  documentKind?: string;
}

export class SourceExtractionOrchestrationError extends BadRequestException {
  public readonly code: SourceExtractionOrchestrationCode;
  public readonly detail: SourceExtractionOrchestrationDetail;

  public constructor(
    code: SourceExtractionOrchestrationCode,
    detail: SourceExtractionOrchestrationDetail
  ) {
    super(`source_extraction orchestration ${code}: ${detail.invariant}`);
    this.name = 'SourceExtractionOrchestrationError';
    this.code = code;
    this.detail = detail;
  }
}

export function failOrchestration(
  code: SourceExtractionOrchestrationCode,
  detail: SourceExtractionOrchestrationDetail
): never {
  throw new SourceExtractionOrchestrationError(code, detail);
}

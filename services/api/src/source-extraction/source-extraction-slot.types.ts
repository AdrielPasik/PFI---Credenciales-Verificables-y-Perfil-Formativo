/**
 * Tipos del extraction slot persistido — slice F1.2.
 *
 * Sin DTO público. Todo esto es interno: F1.2 no agrega superficie externa.
 */

import { type VerifiedSourceExtractionArtifact } from './source-extraction-artifact.types';
import { type ExtractionDerivationTrust } from './source-extraction-trust.types';

/**
 * Una extracción recuperada de la base y verificada de nuevo por completo.
 *
 * No expone el canonical JSON crudo: el consumidor normal quiere el artifact
 * verificado, y devolver además los bytes invitaría a usarlos sin verificar.
 * `artifactBlobSha256` sí se expone porque es el testigo con el que la lectura
 * ya comprobó los bytes, y sirve como referencia estable aguas arriba.
 */
export interface PersistedVerifiedSourceExtraction {
  readonly analysisRunSourceId: string;
  readonly artifact: VerifiedSourceExtractionArtifact;
  /** El valor PERSISTIDO. No se re-infiere desde `sourceType` en la lectura. */
  readonly extractionDerivationTrust: ExtractionDerivationTrust;
  readonly artifactBlobSha256: string;
}

/**
 * Resultado de leer el slot.
 *
 * Discriminado en vez de lanzar para los dos estados que son respuestas
 * legítimas y no fallos:
 *
 *   SOURCE_NOT_FOUND  la fila no existe
 *   SLOT_ABSENT       la fila existe y nunca se extrajo
 *
 * `SLOT_ABSENT` **no** es coverage `FAILED` ni fuente vacía. Un artifact `FAILED`
 * dice "identificamos la fuente y no pudimos leer su contenido"; un slot ABSENT
 * dice "nunca corrimos extracción sobre esta fuente". Colapsarlos convertiría la
 * ausencia de un intento en un resultado de observación.
 *
 * La corrupción sí lanza `SourceExtractionSlotError`: no es una respuesta, es un
 * fallo de integridad.
 */
export type SlotReadOutcome =
  | { readonly status: 'SOURCE_NOT_FOUND'; readonly analysisRunSourceId: string }
  | { readonly status: 'SLOT_ABSENT'; readonly analysisRunSourceId: string }
  | {
      readonly status: 'SLOT_PRESENT';
      readonly analysisRunSourceId: string;
      readonly extraction: PersistedVerifiedSourceExtraction;
    };

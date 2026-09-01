/**
 * Resultado del trust gate de F0.5.
 *
 * El nombre es `AuthoritativeSourceBoundExtraction` y no `TrustedExtraction`
 * a propósito: lo que F0.5 establece es **binding con la fuente autoritativa**,
 * que es menos de lo que la palabra "trusted" sugiere. Hay tres propiedades
 * distintas y no deben colapsarse bajo una sola palabra:
 *
 *     ARTIFACT_INTERNAL_INTEGRITY    verificada por F0.4
 *     AUTHORITATIVE_SOURCE_BINDING   verificada por F0.5  <- esto
 *     EXTRACTION_DERIVATION_TRUST    ver `extractionDerivationTrust`
 */

import { type VerifiedSourceExtractionArtifact } from './source-extraction-artifact.types';

/**
 * Cuán fuerte es la evidencia de que el texto canónico del artifact proviene
 * realmente de la fuente autoritativa. La asimetría entre PDF y TEXT es real y
 * se hace explícita en el dato para que F0.6 no tenga que adivinarla.
 */
export const EXTRACTION_DERIVATION_TRUST = [
  /**
   * TEXT. El contenido autoritativo ES el texto canónico, así que NestJS
   * comprueba igualdad exacta contra `TextEvidence.content`. La derivación queda
   * demostrada, no asumida.
   */
  'AUTHORITATIVE_CONTENT_MATCHED',
  /**
   * PDF. Los bytes autoritativos quedan verificados por SHA, pero NestJS NO
   * reejecuta pdfplumber/pypdf, así que no prueba de forma independiente que
   * `pages[].canonicalText` provenga de esos bytes bajo la `extractionIdentity`
   * declarada. Eso descansa en el productor de extracción como servicio interno
   * de cómputo: es una ASUNCIÓN ARQUITECTÓNICA explícita, no una demostración.
   */
  'PRODUCER_ASSUMED'
] as const;

export type ExtractionDerivationTrust = typeof EXTRACTION_DERIVATION_TRUST[number];

export interface AuthoritativeSourceBoundExtraction {
  readonly analysisRunId: string;
  readonly analysisRunSourceId: string;
  readonly sourceType: 'PDF_DOCUMENT' | 'TEXT';
  /** `DocumentEvidence.id` o `TextEvidence.id`, siempre el autoritativo. */
  readonly sourceEntityId: string;
  /** El SHA congelado por el run, ya verificado contra toda la cadena. */
  readonly sourceSha256: string;
  readonly extractionIdentity: VerifiedSourceExtractionArtifact['extractionIdentity'];
  readonly extractionDerivationTrust: ExtractionDerivationTrust;
  readonly artifact: VerifiedSourceExtractionArtifact;
}

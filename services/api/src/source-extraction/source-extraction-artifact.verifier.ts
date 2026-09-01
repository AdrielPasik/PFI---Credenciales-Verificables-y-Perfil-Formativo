/**
 * Verificador independiente de `source_extraction_v1` — slice F0.4.
 *
 * FRONTERA DE CONFIANZA. Esto verifica INTEGRIDAD INTERNA del artifact:
 *
 *     "¿Es este artifact internamente valido y fiel al contrato?"
 *
 * NO verifica —y no debe presentarse como si lo hiciera— la autoridad de
 * dominio:
 *
 *     "¿Corresponde este artifact valido a la fuente autoritativa congelada que
 *      este run tiene permitido usar?"
 *
 * Eso es F0.5, y requiere leer los bytes autoritativos (S3 / DocumentEvidence /
 * TextEvidence), cotejar contra `AnalysisRunSource` y hacer cumplir el binding
 * de una extraction identity por fuente. F0.4 no tiene acceso a nada de eso y no
 * lo simula: `source.sourceSha256` se valida solo en formato, nunca contra la
 * fuente real.
 *
 * INDEPENDENCIA. No invoca Python, ni FastAPI, ni deriva resultados esperados
 * preguntandole al productor. Implementa el contrato congelado por segunda vez,
 * en otro runtime, para que la garantia deje de ser "Python confiando en Python".
 */

import {
  assertSourceExtractionInvariants,
  computeArtifactFingerprint,
  derivePdfCoverage,
  deriveTextCoverage,
  materialProjection
} from './source-extraction-artifact.invariants';
import {
  type SourceExtractionArtifact,
  type VerifiedSourceExtractionArtifact
} from './source-extraction-artifact.types';
import { validateSourceExtractionArtifactShape } from './source-extraction-artifact.validator';

export {
  computeArtifactFingerprint,
  derivePdfCoverage,
  deriveTextCoverage,
  materialProjection
};
export * from './source-extraction-artifact.types';
export * from './source-extraction-verification.errors';
export { canonicalJson, canonicalPreimage, compareByCodePoint } from './canonical-json';
export {
  deriveBlockSpans,
  deriveCanonicalSegments,
  isPythonWhitespaceOnly,
  PYTHON_WHITESPACE_CODE_POINTS
} from './canonical-segmentation';
export { codePointLength, sliceByUnicodeCodePoints } from './code-points';

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

/**
 * Verifica un artifact no confiable y devuelve un snapshot verificado.
 *
 * El resultado es un objeto NUEVO —construido campo por campo por el validador,
 * sin compartir referencia con el input en ningun nivel— y profundamente
 * congelado. Las dos propiedades importan por la misma razon:
 *
 *     verificar A -> el llamador muta A -> F0.5 persiste A' sin verificar
 *
 * Al estar desacoplado, mutar el input despues de verificar no puede alterar lo
 * que se verificó; al estar congelado, tampoco puede alterarse el resultado. F0.5
 * puede tratarlo como un snapshot ya verificado, sin TOCTOU dentro del objeto.
 *
 * Levanta `SourceExtractionVerificationError` con un `code` determinístico. Nunca
 * devuelve un artifact parcialmente valido, y nunca repara ni coacciona el input.
 */
export function verifySourceExtractionArtifact(
  input: unknown
): VerifiedSourceExtractionArtifact {
  const artifact: SourceExtractionArtifact = validateSourceExtractionArtifactShape(input);
  assertSourceExtractionInvariants(artifact);
  return deepFreeze(artifact) as VerifiedSourceExtractionArtifact;
}

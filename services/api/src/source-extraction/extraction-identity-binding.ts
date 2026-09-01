/**
 * `REASONING_RUN_EXTRACTION_BINDING: EXACTLY_ONE_EXTRACTION_IDENTITY_PER_SOURCE`
 *
 * Un run no puede combinar EvidenceUnits derivadas de dos parsers distintos como
 * si fueran evidencia independiente. Dos razones, ambas fatales: la misma oración
 * vista por dos parsers se presentaría como dos observaciones que se corroboran
 * —composición no es acumulación—, y los dos artifacts tienen texto canónico
 * distinto, así que `(pageIndex, charStart, charEnd)` significaría cosas
 * distintas en cada uno y el run no tendría un único espacio de direcciones.
 *
 * ALCANCE REAL EN F0.5. Esto es una PRIMITIVA reutilizable, no una invariante
 * operacional del producto: como todavía no existe orquestación ni persistencia
 * que obligue a todos los artifacts de un run a pasar por acá, nada impide hoy
 * que un camino futuro la saltee. Volverla global pertenece a F0.6/F1, y no se
 * introduce estado ni persistencia sólo para simularlo ahora.
 *
 *     EXTRACTION_IDENTITY_BINDING_VALIDATOR:  IMPLEMENTED
 *     GLOBAL_RUN_BINDING_ENFORCEMENT:         NO — hasta el wiring de F0.6/F1
 */

import {
  failTrust,
  type SourceExtractionTrustDetail
} from './source-extraction-trust.errors';
import { type AuthoritativeSourceBoundExtraction } from './source-extraction-trust.types';

/**
 * Clave canónica de una extraction identity.
 *
 * Cubre los cuatro campos de PDF y los tres de TEXT: para PDF una diferencia en
 * `parserProfile` o en `dependencyFingerprint` es una identidad distinta, y para
 * TEXT lo es cualquiera de sus tres campos.
 */
function identityKey(
  identity: AuthoritativeSourceBoundExtraction['extractionIdentity']
): string {
  const dependencyFingerprint =
    'dependencyFingerprint' in identity ? identity.dependencyFingerprint : null;
  return [
    identity.schemaVersion,
    identity.implementationVersion,
    identity.parserProfile,
    dependencyFingerprint ?? '-'
  ].join('|');
}

/**
 * Exige una única extraction identity por `sourceSha256` dentro de un run.
 *
 * Repetir la MISMA identity para una misma fuente no es violación: el contrato
 * dice exactamente una IDENTIDAD, no necesariamente una única instancia de
 * artifact. No se amplía esa regla acá.
 */
export function assertSingleExtractionIdentityPerSourceForRun(
  analysisRunId: string,
  bindings: readonly AuthoritativeSourceBoundExtraction[]
): void {
  const identitiesBySource = new Map<string, { key: string; detail: SourceExtractionTrustDetail }>();

  for (const binding of bindings) {
    if (binding.analysisRunId !== analysisRunId) {
      // Un batch no puede mezclar runs: el binding de una-identity-por-fuente
      // sólo tiene sentido dentro del alcance de un run.
      failTrust('RUN_SCOPE_MISMATCH', {
        invariant: 'binding_belongs_to_another_run',
        analysisRunId,
        analysisRunSourceId: binding.analysisRunSourceId
      });
    }

    const key = identityKey(binding.extractionIdentity);
    const seen = identitiesBySource.get(binding.sourceSha256);

    if (seen === undefined) {
      identitiesBySource.set(binding.sourceSha256, {
        key,
        detail: {
          invariant: 'first_identity_for_source',
          analysisRunId,
          analysisRunSourceId: binding.analysisRunSourceId,
          sourceType: binding.sourceType,
          sourceEntityId: binding.sourceEntityId
        }
      });
      continue;
    }

    if (seen.key !== key) {
      failTrust('EXTRACTION_IDENTITY_BINDING_CONFLICT', {
        invariant: 'more_than_one_extraction_identity_for_one_source',
        analysisRunId,
        analysisRunSourceId: binding.analysisRunSourceId,
        sourceType: binding.sourceType,
        sourceEntityId: binding.sourceEntityId
      });
    }
  }
}

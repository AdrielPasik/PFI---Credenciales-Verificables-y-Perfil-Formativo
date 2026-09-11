/**
 * Derivación de `sourceProvenance` productiva — cierre del contrato.
 *
 * Existe por una razón concreta y no por prolijidad: F3.4 será el primer escritor
 * de EvidenceUnits y tendrá delante tres caminos productivos distintos. Sin un
 * punto único, la tentación evidente es ramificar por `label`,
 * `submittedByUserId` o por el patrón del contenido para "detectar" si el texto
 * lo escribió una persona o lo generó el backend.
 *
 * Esa rama sería **incorrecta**, no sólo innecesaria:
 *
 *   1. `sourceProvenance` es AUTORIDAD DE ASERCIÓN, no mecanismo de creación. Los
 *      tres caminos comparten autoridad —el emisor—, así que la respuesta es la
 *      misma para los tres.
 *   2. Aunque se quisiera distinguir, no se puede de forma confiable:
 *      `TextEvidence` no tiene campo de origen, `label` es texto libre del usuario
 *      en el camino manual, y la generación automática reutiliza cualquier fila
 *      `current` existente sin mirar de dónde vino.
 *
 * Por eso la función NO recibe nada que permita distinguirlos. Recibe el tipo de
 * fuente sólo para dejar por escrito —y testeable— que los dos tipos dan el mismo
 * token, en vez de que sea una coincidencia.
 */

import {
  SOURCE_PROVENANCE_TOKENS,
  type SourceProvenanceV1
} from './reasoning-run-artifact.types';

/** Los dos tipos de entidad de evidencia autoritativa del dominio. */
export type AuthoritativeSourceKind = 'DOCUMENT_EVIDENCE' | 'TEXT_EVIDENCE';

export const ISSUER_DECLARED: SourceProvenanceV1 = SOURCE_PROVENANCE_TOKENS[0];

/**
 * Siempre `ISSUER_DECLARED` en V1.
 *
 * La firma no admite `label`, ni `submittedByUserId`, ni el contenido: distinguir
 * manual de generado no es representable acá, que es exactamente el punto.
 */
export function deriveSourceProvenanceV1(
  sourceKind: AuthoritativeSourceKind
): SourceProvenanceV1 {
  void sourceKind;
  return ISSUER_DECLARED;
}

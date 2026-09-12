/**
 * Desenlaces de la proyección de evidencia — slice P2.4A.
 *
 * Códigos INTERNOS. Ninguno viaja al cliente: la capa de aplicación los traduce
 * enteros a `REASONING_RUN_HISTORY_UNREADABLE`, igual que hace con los fallos del
 * verificador del snapshot y del resultado. El cliente no necesita saber si lo
 * que no cerró fue el catálogo o el inventario, y decírselo describiría la
 * estructura interna del run.
 *
 * Existen separados del error de API por la misma razón que
 * `ObjectiveRowError` y `ReasoningRunApiError` existen separados: el módulo de
 * proyección es puro y no debe importar `HttpException`.
 */

export const EVIDENCE_PROJECTION_CODES = [
  /** El resultado cita un `eu_NN` que no está en el catálogo del mismo run. */
  'EVIDENCE_UNIT_NOT_IN_CATALOG',
  /** El `src_NN` del catálogo no está en el inventario congelado del run. */
  'SOURCE_NOT_IN_FROZEN_INVENTORY',
  /**
   * Una fila de inventario no describe una fuente citable: sin entidad de
   * evidencia, con las dos a la vez, o con un `runLocalSourceId` repetido.
   */
  'INVENTORY_SOURCE_BINDING_INCONSISTENT'
] as const;

export type EvidenceProjectionCode = (typeof EVIDENCE_PROJECTION_CODES)[number];

export class ReasoningRunEvidenceProjectionError extends Error {
  public readonly code: EvidenceProjectionCode;

  public constructor(code: EvidenceProjectionCode) {
    // El mensaje es el código y nada más: no se interpola el `src_NN`, ni el
    // `eu_NN`, ni un id de credencial. Un mensaje de error no es un lugar donde
    // publicar identificadores internos, ni siquiera en un log.
    super(code);
    this.name = 'ReasoningRunEvidenceProjectionError';
    this.code = code;
  }
}

export function failEvidenceProjection(code: EvidenceProjectionCode): never {
  throw new ReasoningRunEvidenceProjectionError(code);
}

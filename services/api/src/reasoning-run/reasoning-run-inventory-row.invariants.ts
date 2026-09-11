/**
 * Invariantes ROW-LOCAL de `ReasoningRunInventoryItem` — slice F3.1.
 *
 * ESPEJO EN TYPESCRIPT DE LOS DOS CHECK DE LA MIGRACION, no un segundo dueño de
 * la regla. La AUTORIDAD es la base: `ReasoningRunInventoryItem_row_family_shape`
 * y `ReasoningRunInventoryItem_selected_extraction_binding`. Este modulo existe
 * por dos razones concretas:
 *
 *   1. fallar temprano y con un error que se entienda, en vez de con un
 *      constraint violation de Postgres a mitad de una transaccion;
 *   2. poder testear la regla sin base, que es lo unico que F3.1 puede hacer
 *      —no aplica migraciones y no escribe en ninguna DB—.
 *
 * Es el mismo reparto que ya usa F1.1: el CHECK prohibe el bundle parcial, y la
 * disciplina de escritura vive en la aplicacion.
 *
 * F3.1 NO CONSTRUYE INVENTARIO. Estas son invariantes de PERSISTENCIA; las reglas
 * de seleccion —PDF sobre texto, `issued`/`current`, extraccion ausente— son de
 * F3.2 y no estan aca.
 */

import { HttpException, HttpStatus } from '@nestjs/common';

export const CREDENTIAL_LEVEL_DISPOSITIONS = [
  'EXCLUDED_CREDENTIAL_STATE_DRAFT',
  'EXCLUDED_CREDENTIAL_STATE_REVOKED',
  'EXCLUDED_NO_GROUNDING_SOURCE'
] as const;

export const SOURCE_LEVEL_DISPOSITIONS = [
  'INCLUDED',
  'EXCLUDED_SOURCE_SUPERSEDED',
  'EXCLUDED_UNSUPPORTED_TYPE',
  'EXCLUDED_ALTERNATE_REPRESENTATION',
  'BLOCKED_EXTRACTION_UNAVAILABLE',
  'BLOCKED_EXTRACTION_INTEGRITY_FAILURE'
] as const;

/**
 * Las nueve disposiciones persistibles en V1.
 *
 * `EXCLUDED_DUPLICATE_SOURCE` no esta, ni aca ni en el enum de Prisma: F3.0 lo
 * audito como inalcanzable con la identidad congelada.
 *
 * LOS DOS `BLOCKED_*` SON HECHOS DISTINTOS, y por eso son dos tokens:
 *
 *   BLOCKED_EXTRACTION_UNAVAILABLE
 *     no existe slot de extraccion persistido para la fuente seleccionada
 *
 *   BLOCKED_EXTRACTION_INTEGRITY_FAILURE
 *     habia una representacion presente, se la sometio a la frontera de
 *     integridad/trust de F1, y fallo
 *
 * Los dos hacen fallar el run operacionalmente y ninguno se convierte en
 * `ABSTAIN`, `INSUFFICIENT_EVIDENCE` ni `coverageStatus = FAILED`. Pero
 * "no hay nada persistido" y "hay algo persistido y no es confiable" no son la
 * misma observacion, y colapsarlas haria irreportable una violacion de
 * integridad en reposo.
 *
 * `BLOCKED_EXTRACTION_INTEGRITY_FAILURE` es la CLASE de disposicion, no la causa
 * exacta: la causa determinista —artifact corrupto, `artifactBlobSha256` que no
 * coincide, `sourceSha256` que no coincide, identidad de fuente que no coincide—
 * la distinguira `ReasoningRun.failureCode` cuando F3.2 sea quien la produzca.
 * No se crea una disposicion por invariante.
 *
 * Y NO ES UN CATCH-ALL. Solo se persiste cuando el sistema OBSERVO
 * deterministicamente la violacion. Base caida, timeout o excepcion interna
 * hacen fallar el run por `failureCode`, sin inventar una disposicion de
 * inventario que nunca llego a determinarse.
 */
export const INVENTORY_DISPOSITIONS = [
  ...CREDENTIAL_LEVEL_DISPOSITIONS,
  ...SOURCE_LEVEL_DISPOSITIONS
] as const;

export type InventoryDisposition = (typeof INVENTORY_DISPOSITIONS)[number];
export type CredentialLevelDisposition =
  (typeof CREDENTIAL_LEVEL_DISPOSITIONS)[number];

export const INVENTORY_ROW_CODES = [
  /** La disposicion no es una de las nueve persistibles en V1. */
  'DISPOSITION_UNSUPPORTED',
  /** Una fila credential-level trae identidad de fuente. */
  'CREDENTIAL_LEVEL_ROW_CARRIES_SOURCE',
  /** Una fila source-level no trae exactamente una entidad de evidencia. */
  'SOURCE_LEVEL_ROW_IDENTITY_INVALID',
  /** Una fila source-level no trae su SHA congelado. */
  'SOURCE_LEVEL_ROW_SHA_MISSING',
  /** Una fila INCLUDED no trae el bundle de binding completo. */
  'INCLUDED_ROW_BINDING_INCOMPLETE',
  /**
   * Una fila de fallo de integridad no conserva el candidato que fallo.
   *
   * HD-3 selecciona un candidato determinista ANTES de verificarlo, asi que
   * siempre hubo uno. Perder su id dejaria el fallo sin sujeto: se sabria que
   * algo no verifico, pero no que representacion.
   */
  'BLOCKED_INTEGRITY_ROW_MISSING_CANDIDATE',
  /**
   * Una fila de fallo de integridad trae el testigo de consistencia o el id
   * local de fuente. Los dos afirman que el artifact fue ACEPTADO, y no lo fue.
   */
  'BLOCKED_INTEGRITY_ROW_CARRIES_TRUSTED_BINDING',
  /** Una fila que no selecciono ninguna representacion trae binding. */
  'NON_INCLUDED_ROW_CARRIES_BINDING'
] as const;

export type InventoryRowCode = (typeof INVENTORY_ROW_CODES)[number];

export class ReasoningRunInventoryRowError extends HttpException {
  public readonly code: InventoryRowCode;
  public readonly invariant: string;
  public readonly observed?: string;

  public constructor(
    code: InventoryRowCode,
    invariant: string,
    observed?: string
  ) {
    super(`${code}: ${invariant}`, HttpStatus.INTERNAL_SERVER_ERROR);
    this.name = 'ReasoningRunInventoryRowError';
    this.code = code;
    this.invariant = invariant;
    this.observed = observed;
  }
}

function fail(
  code: InventoryRowCode,
  invariant: string,
  observed?: string
): never {
  throw new ReasoningRunInventoryRowError(code, invariant, observed);
}

/**
 * La forma de una fila candidata, antes de escribirla.
 *
 * `credentialId` no aparece como opcional en ningun lado: es NOT NULL en la
 * columna y requerido en las dos familias, y el tipo lo refleja.
 */
export interface InventoryRowShape {
  readonly credentialId: string;
  readonly disposition: string;
  readonly documentEvidenceId: string | null;
  readonly textEvidenceId: string | null;
  readonly sourceSha256: string | null;
  readonly selectedAnalysisRunSourceId: string | null;
  readonly artifactBlobSha256: string | null;
  readonly runLocalSourceId: string | null;
}

export function isCredentialLevelDisposition(
  disposition: string
): disposition is CredentialLevelDisposition {
  return (CREDENTIAL_LEVEL_DISPOSITIONS as readonly string[]).includes(
    disposition
  );
}

/**
 * Lanza si la fila no respeta su familia. No devuelve nada: o la fila es
 * escribible tal cual, o no lo es.
 */
export function assertInventoryRowShape(row: InventoryRowShape): void {
  if (!(INVENTORY_DISPOSITIONS as readonly string[]).includes(row.disposition)) {
    fail(
      'DISPOSITION_UNSUPPORTED',
      'disposition_must_be_one_of_the_nine_persisted_in_v1',
      row.disposition.slice(0, 64)
    );
  }

  if (isCredentialLevelDisposition(row.disposition)) {
    // La credencial quedo excluida ANTES de mirar sus fuentes, asi que la fila no
    // tiene ninguna. Traer una seria afirmar que se evaluo algo que no se evaluo.
    if (
      row.documentEvidenceId !== null ||
      row.textEvidenceId !== null ||
      row.sourceSha256 !== null
    ) {
      fail(
        'CREDENTIAL_LEVEL_ROW_CARRIES_SOURCE',
        'a_credential_level_row_has_no_source_identity',
        row.disposition
      );
    }
  } else {
    const hasDocument = row.documentEvidenceId !== null;
    const hasText = row.textEvidenceId !== null;
    if (hasDocument === hasText) {
      fail(
        'SOURCE_LEVEL_ROW_IDENTITY_INVALID',
        'a_source_level_row_has_exactly_one_evidence_entity',
        row.disposition
      );
    }
    if (row.sourceSha256 === null) {
      fail(
        'SOURCE_LEVEL_ROW_SHA_MISSING',
        'a_source_level_row_freezes_its_source_sha256',
        row.disposition
      );
    }
  }

  // TRES RAMAS, no dos. `selectedAnalysisRunSourceId` identifica al CANDIDATO
  // SELECCIONADO, y seleccionar no es lo mismo que usar con exito.
  if (row.disposition === 'INCLUDED') {
    if (
      row.selectedAnalysisRunSourceId === null ||
      row.artifactBlobSha256 === null ||
      row.runLocalSourceId === null
    ) {
      fail(
        'INCLUDED_ROW_BINDING_INCOMPLETE',
        'an_included_row_binds_the_exact_extraction_it_used'
      );
    }
    return;
  }

  if (row.disposition === 'BLOCKED_EXTRACTION_INTEGRITY_FAILURE') {
    // HD-3 selecciona por tiempo y verifica despues, asi que ACA HUBO un
    // candidato concreto. Perder su id perderia cual representacion disparo el
    // fallo, que es justamente lo que hay que poder auditar.
    if (row.selectedAnalysisRunSourceId === null) {
      fail(
        'BLOCKED_INTEGRITY_ROW_MISSING_CANDIDATE',
        'an_integrity_failure_row_preserves_the_candidate_that_failed',
        row.disposition
      );
    }
    // Pero NO se copia el testigo de consistencia ni el id local: el artifact no
    // fue aceptado como input confiable y no entro al grounding. Copiarlos
    // afirmaria lo contrario.
    if (row.artifactBlobSha256 !== null || row.runLocalSourceId !== null) {
      fail(
        'BLOCKED_INTEGRITY_ROW_CARRIES_TRUSTED_BINDING',
        'a_failed_candidate_never_becomes_a_trusted_grounding_input',
        row.disposition
      );
    }
    return;
  }

  // El resto no selecciono ninguna representacion. Prohibido incluso cuando esa
  // fuente TIENE extracciones historicas de F1 -- el caso del TextEvidence
  // alterno de una credencial con PDF. "No se selecciono nada" es distinto de
  // "se selecciono y fallo", y son dos disposiciones distintas.
  if (
    row.selectedAnalysisRunSourceId !== null ||
    row.artifactBlobSha256 !== null ||
    row.runLocalSourceId !== null
  ) {
    fail(
      'NON_INCLUDED_ROW_CARRIES_BINDING',
      'no_extraction_representation_was_selected_for_this_row',
      row.disposition
    );
  }
}

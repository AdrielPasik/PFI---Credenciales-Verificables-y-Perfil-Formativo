/**
 * Modelo de error del artifact `objective_definition_v1` — slice F2.1.
 *
 * Espacio propio, separado de los de F0.4 / F0.5 / F1.2 / F1.4, porque responde
 * otra pregunta: "¿este artifact es una definicion de Objective valida?".
 *
 * PRIVACIDAD: un error NUNCA lleva `originalText`, `requirementText`,
 * `objectiveContext`, `sourceQuote` ni el valor de un qualifier. Sólo la ruta
 * estructural (`definition.requirements[2].provenance`), el nombre del
 * invariante y, cuando ayuda, longitudes o enums cerrados. El texto del
 * Objective es contenido del usuario y no tiene por que aparecer en un log.
 */

import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';

export const OBJECTIVE_DEFINITION_CODES = [
  /** El input no es un objeto, o una rama no tiene el tipo esperado. */
  'SCHEMA_INVALID',
  /** Apareció una clave que el contrato no declara, en cualquier nivel. */
  'UNKNOWN_PROPERTY',
  /**
   * Apareció una clave de Objective Analysis. Se distingue de
   * `UNKNOWN_PROPERTY` a proposito: no es un error de forma del JSON, es un
   * intento de cruzar la frontera epistemica que fijó HD-1. Quien mande
   * `epistemicTarget` no se equivocó de tipo: se equivocó de capa.
   */
  'OBJECTIVE_ANALYSIS_FIELD_NOT_ALLOWED',
  /**
   * Apareció una clave de holder/credencial/evidencia como ESTRUCTURA. El
   * Objective es holder-independent y eso se comprueba estructuralmente, nunca
   * escaneando el texto libre.
   */
  'HOLDER_SCOPED_FIELD_NOT_ALLOWED',
  /** `schemaVersion` ausente o distinto del único soportado. */
  'SCHEMA_VERSION_UNSUPPORTED',
  /** `requirements` vacío: un Objective finalizado necesita al menos uno. */
  'REQUIREMENTS_EMPTY',
  /** `order` no es 1..N consecutivo, o `requirementId` no concuerda con él. */
  'REQUIREMENT_SEQUENCE_INVALID',
  /** Dos requirements comparten `requirementId`. */
  'REQUIREMENT_ID_DUPLICATED',
  /** Un texto obligatorio está vacío o es sólo whitespace. */
  'TEXT_EMPTY',
  /** `inputType` y `originalText` se contradicen. */
  'SOURCE_INPUT_INCONSISTENT',
  /** `provenance.kind` y `sourceQuote` se contradicen. */
  'PROVENANCE_INCONSISTENT',
  /**
   * `sourceQuote` no aparece LITERALMENTE dentro de `source.originalText`.
   * Equivalente directo del `REQUIREMENT_QUOTE_INVALID` del reasoner congelado
   * y del `exactExcerpt` de F0.
   */
  'SOURCE_QUOTE_NOT_LITERAL',
  /** `qualifier.sourcePhrase` no aparece literalmente en `requirementText`. */
  'QUALIFIER_PHRASE_NOT_LITERAL',
  /**
   * Se enviaron qualifiers con contenido.
   *
   * `objective_definition_v1` exige `qualifiers: []` y eso está CONGELADO para
   * siempre en esta schema version, no pendiente de decidir. Los qualifiers
   * estructurados, si alguna vez existen, entran por `objective_definition_v2`.
   *
   * El nombre anterior era `QUALIFIER_KIND_CONTRACT_REQUIRED`, que describía una
   * decisión abierta. Ya no lo está, y un código que dijera `REQUIRED` para algo
   * congelado se leería como un TODO sin terminar.
   */
  'QUALIFIERS_NOT_SUPPORTED_IN_V1'
] as const;

export type ObjectiveDefinitionCode = typeof OBJECTIVE_DEFINITION_CODES[number];

export interface ObjectiveDefinitionErrorDetail {
  /** Nombre estable del invariante, apto para consumo por código. */
  invariant: string;
  /** Ruta estructural. Nunca contenido: `definition.requirements[2].provenance`. */
  path: string;
  /** Sólo enums cerrados o conteos. Nunca texto del usuario. */
  observed?: string;
}

export class ObjectiveDefinitionError extends BadRequestException {
  public readonly code: ObjectiveDefinitionCode;
  public readonly detail: ObjectiveDefinitionErrorDetail;

  public constructor(
    code: ObjectiveDefinitionCode,
    detail: ObjectiveDefinitionErrorDetail
  ) {
    super(`objective_definition_v1 ${code}: ${detail.invariant} at ${detail.path}`);
    this.name = 'ObjectiveDefinitionError';
    this.code = code;
    this.detail = detail;
  }
}

export function failDefinition(
  code: ObjectiveDefinitionCode,
  detail: ObjectiveDefinitionErrorDetail
): never {
  throw new ObjectiveDefinitionError(code, detail);
}

// ---------------------------------------------------------------------------
// Errores de la fila persistida, distintos de los del artifact
// ---------------------------------------------------------------------------

export const OBJECTIVE_ROW_CODES = [
  /** No existe, o no pertenece a este usuario. No se distingue: ver el service. */
  'OBJECTIVE_NOT_FOUND',
  /**
   * La fila persistida ya no satisface el contrato del artifact. Es CORRUPCION,
   * no una respuesta: no se repara y no se toca la fila.
   */
  'OBJECTIVE_DEFINITION_CORRUPT',
  /** `row.objectiveType != definition.objectiveType`. */
  'OBJECTIVE_TYPE_MISMATCH',
  /** El Objective a revisar ya no está `active`. */
  'OBJECTIVE_NOT_ACTIVE',
  /** Otra revisión ganó la carrera sobre el mismo predecesor. */
  'OBJECTIVE_REVISION_CONFLICT',
  /** `title` vacío o sólo whitespace. Es metadata de fila, no del artifact. */
  'OBJECTIVE_TITLE_INVALID'
] as const;

export type ObjectiveRowCode = typeof OBJECTIVE_ROW_CODES[number];

export interface ObjectiveRowErrorDetail {
  invariant: string;
  objectiveId?: string;
}

/**
 * Estado HTTP por código.
 *
 * F2.1 hacía que TODO fuese `BadRequestException`, lo que es correcto para un
 * artifact mal formado y equivocado para el resto: "no existe" no es culpa de la
 * forma del request, "ya fue reemplazado" es un conflicto de estado, y una fila
 * corrupta es un fallo de integridad NUESTRO, no del cliente.
 *
 * Se resuelve aquí, junto a la definición de los códigos, en vez de en un mapper
 * de transporte: es la convención del repo, donde los services lanzan
 * directamente `NotFoundException` / `ConflictException` (79 sitios).
 */
const OBJECTIVE_ROW_STATUS: Record<ObjectiveRowCode, HttpStatus> = {
  OBJECTIVE_NOT_FOUND: HttpStatus.NOT_FOUND,
  OBJECTIVE_NOT_ACTIVE: HttpStatus.CONFLICT,
  OBJECTIVE_REVISION_CONFLICT: HttpStatus.CONFLICT,
  OBJECTIVE_TITLE_INVALID: HttpStatus.BAD_REQUEST,
  // Fallos de integridad de la persistencia: el cliente no hizo nada mal.
  OBJECTIVE_DEFINITION_CORRUPT: HttpStatus.INTERNAL_SERVER_ERROR,
  OBJECTIVE_TYPE_MISMATCH: HttpStatus.INTERNAL_SERVER_ERROR
};

export class ObjectiveRowError extends HttpException {
  public readonly code: ObjectiveRowCode;
  public readonly detail: ObjectiveRowErrorDetail;

  public constructor(code: ObjectiveRowCode, detail: ObjectiveRowErrorDetail) {
    const status = OBJECTIVE_ROW_STATUS[code];
    super(
      // En 5xx el cuerpo es genérico: un fallo de integridad no debe describirle
      // al cliente el estado interno. En 4xx viaja el código y el nombre del
      // invariante, que son identificadores fijos y seguros.
      status === HttpStatus.INTERNAL_SERVER_ERROR
        ? { statusCode: status, message: 'No se pudo leer el objetivo solicitado.' }
        : { statusCode: status, message: `objective ${code}`, code, invariant: detail.invariant },
      status
    );
    this.name = 'ObjectiveRowError';
    this.code = code;
    this.detail = detail;
  }
}

export function failObjective(
  code: ObjectiveRowCode,
  detail: ObjectiveRowErrorDetail
): never {
  throw new ObjectiveRowError(code, detail);
}

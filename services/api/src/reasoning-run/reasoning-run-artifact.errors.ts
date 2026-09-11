/**
 * Modelo de error de los artifacts del ReasoningRun — slice F3.1.
 *
 * UN SOLO espacio para los tres artifacts, a diferencia de F2.1 que tenia el
 * suyo. La razon es que los tres responden la MISMA pregunta desde tres angulos
 * —"¿este artifact de etapa es valido y coherente con las etapas anteriores del
 * mismo run?"— y los consume el mismo servicio de slots. Separarlos en tres
 * espacios obligaria a que ese servicio uniera tres uniones de codigos para
 * decir lo mismo.
 *
 * PRIVACIDAD, que aca importa mas que en ningun otro validador del repo. Estos
 * artifacts llevan CITAS LITERALES de documentos del holder: `exactQuote`,
 * `exactExcerpt`, `contextBefore`, `contextAfter`, `normalizedProposition`,
 * `explanation`, los `rationale` del reasoner. Un error NUNCA lleva ninguno de
 * esos valores.
 *
 * Lo que si puede llevar:
 *   - la ruta estructural   `evidenceUnits[3].sourceTrace.charStart`
 *   - el nombre del invariante violado
 *   - tokens de enums cerrados       `PARTIALLY_SUPPORTED`
 *   - identificadores internos       `req_01`, `eu_07`, `src_02`
 *   - conteos y longitudes
 *
 * Los identificadores locales al run son seguros: `eu_07` no dice nada de nadie
 * fuera del run, y sin el un error de referencia cruzada seria inutil para
 * depurar.
 */

import { HttpException, HttpStatus } from '@nestjs/common';

export const REASONING_RUN_ARTIFACT_CODES = [
  /** El input no es un objeto, o una rama no tiene el tipo esperado. */
  'SCHEMA_INVALID',
  /** Aparecio una clave que el contrato no declara, en cualquier nivel. */
  'UNKNOWN_PROPERTY',
  /** `schemaVersion` ausente o distinto del unico soportado por este validador. */
  'SCHEMA_VERSION_UNSUPPORTED',
  /** Un token no pertenece a su vocabulario cerrado congelado. */
  'ENUM_TOKEN_UNSUPPORTED',
  /** Un identificador no respeta el formato congelado (`req_NN`, `eu_NN`, `src_NN`). */
  'IDENTIFIER_FORMAT_INVALID',
  /** Un texto obligatorio esta vacio o es solo whitespace. */
  'TEXT_EMPTY',
  /** Dos elementos comparten un identificador que debe ser unico. */
  'IDENTIFIER_DUPLICATED',
  /** Un span de caracteres es incoherente: negativo, invertido o no entero. */
  'SPAN_INVALID',
  /**
   * Aparecio un campo de deliberacion interna del modelo.
   *
   * Codigo PROPIO y no `UNKNOWN_PROPERTY`: quien manda `chainOfThought` no se
   * equivoco de forma, esta intentando persistir razonamiento privado del modelo
   * en un artifact auditable. El prompt congelado ya prohibe emitirlo; produccion
   * no debe crear el lugar donde guardarlo.
   */
  'CHAIN_OF_THOUGHT_FIELD_NOT_ALLOWED',
  /**
   * Aparecio un score, porcentaje o ranking global.
   *
   * Tambien con codigo propio: la especificacion congelada excluye
   * explicitamente cualquier "82% compatible" o `SUPPORTED` del Objective
   * entero, y confundirlo con una clave desconocida perderia la razon del
   * rechazo.
   */
  'GLOBAL_SCORE_FIELD_NOT_ALLOWED',
  /**
   * Aparecio un campo que el contrato productivo retiro a proposito:
   * `decompositionStatus`, `candidateSegments`, `ambiguityRationale`,
   * `requirementQuote`, `lineageId`, `technicallyVerified`.
   *
   * Se distingue de `UNKNOWN_PROPERTY` porque cada uno tiene una razon
   * documentada, y un implementador que lo mande esta copiando el experimento en
   * vez de el contrato.
   */
  'EXPERIMENTAL_FIELD_NOT_ALLOWED',
  /**
   * `sourceProvenance` no es el unico token congelado de V1.
   *
   * Codigo propio y no `ENUM_TOKEN_UNSUPPORTED` porque el vocabulario de
   * provenance tiene UN solo miembro y una semantica muy precisa
   * —AUTORIDAD DE ASERCION, no mecanismo de creacion—. Un rechazo generico
   * invitaria a "arreglarlo" agregando el token que falte; este dice que el
   * contrato es de un token y por que.
   */
  'SOURCE_PROVENANCE_INVALID',
  /**
   * Falta una declaracion de fuente que deberia existir.
   *
   * Dos formas de la misma falta: una EvidenceUnit cita un `sourceId` que
   * `sources[]` no declara, o el inventario tiene un item INCLUDED sin
   * declaracion. Las dos dejan material del grounding set sin autoridad de
   * asercion fijada.
   */
  'SOURCE_DECLARATION_MISSING',
  /** Dos declaraciones para la misma fuente. */
  'SOURCE_DECLARATION_DUPLICATE',
  /**
   * Se declaro una fuente que el inventario NO incluyo.
   *
   * Distinto de `SOURCE_REFERENCE_NOT_GROUNDED`: aca no se cita la fuente como
   * evidencia, se le atribuye autoridad de asercion a material que quedo fuera
   * del razonamiento.
   */
  'SOURCE_DECLARATION_NOT_INCLUDED',
  /** El artifact referencia un `requirementId` que el Objective congelado no define. */
  'REQUIREMENT_REFERENCE_UNKNOWN',
  /** Falta el analisis/resultado de un Requirement confirmado. */
  'REQUIREMENT_COVERAGE_INCOMPLETE',
  /** El artifact referencia un `evidenceUnitId` que el catalogo no define. */
  'EVIDENCE_UNIT_REFERENCE_UNKNOWN',
  /** El artifact referencia un `runLocalSourceId` que no es de un item INCLUDED. */
  'SOURCE_REFERENCE_NOT_GROUNDED',
  /** El `sourceSha256` de una traza no coincide con el congelado en el inventario. */
  'SOURCE_SHA_MISMATCH',
  /** El inventario del run tiene dos items INCLUDED con el mismo `runLocalSourceId`. */
  'RUN_LOCAL_SOURCE_ID_DUPLICATED',
  /** Un `localFacetKey` se repite dentro del mismo Requirement. */
  'FACET_KEY_DUPLICATED',
  /**
   * Un `qualifier.sourcePhrase` no es cita LITERAL de ningun ancla permitida
   * para su rol.
   *
   * Es la garantia de que un qualifier inventado no sea persistible, y no puede
   * depender de que el prompt lo haya pedido: se verifica contra el snapshot
   * congelado, sin normalizar whitespace y sin matching difuso. Normalizar haria
   * pasar frases que el Objective no dice.
   */
  'QUALIFIER_ANCHOR_NOT_LITERAL',
  /**
   * El `sourcePhrase` de un `MATERIAL_QUALIFIER` o un `STRUCTURAL_WRAPPER`
   * aparece SOLO en `objectiveContext`.
   *
   * Codigo propio y no `QUALIFIER_ANCHOR_NOT_LITERAL` porque el hecho es otro: la
   * cita es literal, pero de la fuente equivocada. El contexto describe el
   * entorno del Objective, no acota el Requirement, asi que no puede fundar un
   * qualifier material.
   */
  'QUALIFIER_ANCHOR_NOT_IN_REQUIREMENT_TEXT'
] as const;

export type ReasoningRunArtifactCode =
  (typeof REASONING_RUN_ARTIFACT_CODES)[number];

export interface ReasoningRunArtifactDetail {
  /** Nombre del invariante, en snake_case. Nunca una frase con contenido. */
  readonly invariant: string;
  /** Ruta estructural dentro del artifact. Nunca un valor de texto libre. */
  readonly path?: string;
  /** Token de enum cerrado, id interno, conteo o longitud. NUNCA texto del holder. */
  readonly observed?: string;
}

/**
 * 500, no 400, y a proposito.
 *
 * Un artifact de etapa invalido NUNCA es culpa de un request: lo produce el
 * pipeline interno o esta corrupto en la base. Devolver 400 le diria al llamante
 * que arregle su input cuando el input no fue suyo.
 */
export class ReasoningRunArtifactError extends HttpException {
  public readonly code: ReasoningRunArtifactCode;
  public readonly invariant: string;
  public readonly path?: string;
  public readonly observed?: string;

  public constructor(
    code: ReasoningRunArtifactCode,
    detail: ReasoningRunArtifactDetail
  ) {
    super(
      `${code}: ${detail.invariant}${detail.path ? ` at ${detail.path}` : ''}`,
      HttpStatus.INTERNAL_SERVER_ERROR
    );
    this.name = 'ReasoningRunArtifactError';
    this.code = code;
    this.invariant = detail.invariant;
    this.path = detail.path;
    this.observed = detail.observed;
  }
}

export function failArtifact(
  code: ReasoningRunArtifactCode,
  detail: ReasoningRunArtifactDetail
): never {
  throw new ReasoningRunArtifactError(code, detail);
}

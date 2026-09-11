/**
 * Contrato del artifact `objective_definition_v1` — slice F2.1.
 *
 * Es el contenido epistemico de un Objective: la oportunidad y sus Requirements.
 * NO es un `Record<string, unknown>` documentado informalmente; cada clave esta
 * tipada y validada en runtime por `objective-definition.validator.ts`.
 *
 * LO QUE ESTE ARTIFACT NO CONTIENE, y por que:
 *
 *   epistemicTarget      \
 *   atomicity             |  son outputs de Objective Analysis, no contenido
 *   evaluability          |  autoritativo del Objective. Aunque ese stage sea
 *   objectiveAnalysisStatus/ evidence-blind, el reasoner los produce DENTRO del
 *                            run y los congela PARA el run. Los persiste el
 *                            futuro ReasoningRun, no el Objective (HD-1).
 *
 *   RequirementFacet         concepto de reasoning con claves locales al run,
 *                            derivado con la evidencia delante. No se persiste.
 *
 *   title                    label de UI: vive en la fila, no en el artifact.
 *
 *   holderId / credentialIds / evidencia / conclusiones / gaps
 *                            el Objective es HOLDER-INDEPENDENT. Describe contra
 *                            que se evalua, nunca como le fue a una persona.
 */

/** Discriminante de dominio. Los MISMOS tokens que la columna `objectiveType`. */
export const OBJECTIVE_TYPES = [
  'EMPLOYMENT',
  'SCHOLARSHIP',
  'ADMISSION',
  'EQUIVALENCE',
  'OTHER'
] as const;

export type ObjectiveTypeToken = typeof OBJECTIVE_TYPES[number];

/** Como entro la oportunidad al sistema. */
export const OBJECTIVE_SOURCE_INPUT_TYPES = [
  /** Alguien pego el texto de la oferta/beca/convocatoria. */
  'PASTED_TEXT',
  /** Alguien escribio los Requirements directamente, sin texto de origen. */
  'DIRECT_STRUCTURED_INPUT'
] as const;

export type ObjectiveSourceInputType = typeof OBJECTIVE_SOURCE_INPUT_TYPES[number];

/** De donde salio ESTE Requirement. */
export const REQUIREMENT_PROVENANCE_KINDS = [
  /** Derivado de `source.originalText`; `sourceQuote` es cita literal de el. */
  'DERIVED_FROM_SOURCE_TEXT',
  /** Escrito directamente por una persona; NO lleva `sourceQuote`. */
  'DIRECT_STRUCTURED_INPUT'
] as const;

export type RequirementProvenanceKind = typeof REQUIREMENT_PROVENANCE_KINDS[number];

export const OBJECTIVE_DEFINITION_SCHEMA_VERSION = 'objective_definition_v1';

export interface ObjectiveDefinitionSource {
  readonly inputType: ObjectiveSourceInputType;
  /**
   * Texto crudo EXACTO, preservado sin trim, sin NFC y sin tocar fines de linea.
   *
   * No es cosmetica: `provenance.sourceQuote` se verifica como subcadena LITERAL
   * de este texto. Normalizarlo al guardar romperia esa verificacion para citas
   * que hoy son validas, y lo haria en silencio.
   */
  readonly originalText: string | null;
}

export interface RequirementProvenance {
  readonly kind: RequirementProvenanceKind;
  readonly sourceQuote: string | null;
}

/**
 * Qualifier: modificador cuya eliminacion cambia materialmente el Requirement
 * (spec congelada §12).
 *
 * En `objective_definition_v1`, `qualifiers` es clave REQUERIDA y `[]` es el
 * UNICO valor aceptado. No es provisional: esta congelado para esta schema
 * version. `requirementText` ya preserva el requisito completo —accion, objeto,
 * contexto, profundidad, temporalidad— sin perdida; estructurar esos modifiers
 * es un juicio de Objective Analysis, no contenido del Objective.
 *
 * Este tipo existe para nombrar la forma que tendria un qualifier estructurado
 * cuando llegue `objective_definition_v2`. Bajo v1 no es instanciable.
 */
export interface RequirementQualifier {
  readonly kind: string;
  readonly value: string;
  readonly sourcePhrase: string | null;
}

export interface ObjectiveRequirement {
  /** Identidad estable DENTRO del artifact: `req_01`, `req_02`, … */
  readonly requirementId: string;
  /** 1..N, estrictamente consecutivo y sin huecos. */
  readonly order: number;
  /** La proposicion evaluable, preservada exactamente como se escribio. */
  readonly requirementText: string;
  readonly provenance: RequirementProvenance;
  readonly qualifiers: readonly RequirementQualifier[];
}

export interface ObjectiveDefinitionV1 {
  readonly schemaVersion: typeof OBJECTIVE_DEFINITION_SCHEMA_VERSION;
  readonly objectiveType: ObjectiveTypeToken;
  /** Contexto no evaluable: rol, institucion, encuadre. Puede ser "". */
  readonly objectiveContext: string;
  readonly source: ObjectiveDefinitionSource;
  /** Longitud >= 1. Un Objective finalizado sin Requirements no es evaluable. */
  readonly requirements: readonly ObjectiveRequirement[];
}

/**
 * Artifact ya verificado: desacoplado del input y profundamente congelado.
 *
 * Misma garantia que `VerifiedSourceExtractionArtifact` en F0.4: quien recibe
 * esto no puede mutarlo, y mutar el input despues no lo afecta.
 */
export type VerifiedObjectiveDefinition = ObjectiveDefinitionV1;

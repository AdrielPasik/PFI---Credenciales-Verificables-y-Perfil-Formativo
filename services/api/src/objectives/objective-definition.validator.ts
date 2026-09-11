/**
 * Validador estructural de `objective_definition_v1` — slice F2.1.
 *
 * Escrito a mano, siguiendo la convencion establecida del repo
 * (`semantic-analysis-artifact.validator.ts`,
 * `source-extraction-artifact.validator.ts`). Sin Ajv, sin Zod, sin dependencias
 * nuevas.
 *
 * DEVUELVE UN SNAPSHOT DESACOPLADO Y PROFUNDAMENTE CONGELADO, igual que F0.4:
 * cada valor se copia campo por campo desde el input, asi que mutar el input
 * despues no puede afectar a lo verificado, y quien recibe el resultado no puede
 * mutarlo.
 *
 * EL BORDE DE PRIVACIDAD, dicho una vez: este validador NUNCA inspecciona el
 * CONTENIDO de `originalText`, `requirementText`, `objectiveContext` ni
 * `sourceQuote` buscando UUIDs, nombres o palabras como "credential". Son texto
 * libre de una oferta real y pueden contener cualquiera de esas cosas
 * legitimamente. La independencia del holder se comprueba SOLO como estructura:
 * claves prohibidas.
 */

import {
  OBJECTIVE_DEFINITION_SCHEMA_VERSION,
  OBJECTIVE_SOURCE_INPUT_TYPES,
  OBJECTIVE_TYPES,
  REQUIREMENT_PROVENANCE_KINDS,
  type ObjectiveDefinitionV1,
  type ObjectiveRequirement,
  type ObjectiveSourceInputType,
  type ObjectiveTypeToken,
  type RequirementProvenanceKind,
  type VerifiedObjectiveDefinition
} from './objective-definition.types';
import { failDefinition } from './objective-definition.errors';

/**
 * Claves de Objective Analysis. Presentes en cualquier nivel se rechazan con un
 * codigo PROPIO, no con `UNKNOWN_PROPERTY`: HD-1 es una frontera epistemica y
 * merece fallar diciendo exactamente eso.
 */
const OBJECTIVE_ANALYSIS_KEYS = new Set([
  'epistemicTarget',
  'epistemicTargetRationale',
  'atomicity',
  'evaluability',
  'objectiveAnalysisStatus',
  'decompositionStatus',
  'facets',
  'requirementFacets'
]);

/**
 * Claves que ligarian el Objective a una persona concreta. Se rechazan como
 * ESTRUCTURA; nunca se buscan dentro del texto.
 */
const HOLDER_SCOPED_KEYS = new Set([
  'holderId',
  'holderUserId',
  'userId',
  'ownerUserId',
  'subjectUserId',
  'credentialId',
  'credentialIds',
  'evidenceId',
  'evidenceIds',
  'evidenceUnits',
  'userEvidence',
  'analysisRunId'
]);

const ROOT_KEYS = new Set([
  'schemaVersion',
  'objectiveType',
  'objectiveContext',
  'source',
  'requirements'
]);
const SOURCE_KEYS = new Set(['inputType', 'originalText']);
const REQUIREMENT_KEYS = new Set([
  'requirementId',
  'order',
  'requirementText',
  'provenance',
  'qualifiers'
]);
const PROVENANCE_KEYS = new Set(['kind', 'sourceQuote']);

/** `req_01`, `req_02`, … — el mismo formato que asigna el reasoner congelado. */
const REQUIREMENT_ID_PATTERN = /^req_\d{2,}$/;

export function requirementIdForOrder(order: number): string {
  return `req_${String(order).padStart(2, '0')}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

/**
 * Rechaza claves desconocidas y, antes, las dos familias prohibidas.
 *
 * El orden importa: `epistemicTarget` tambien es "desconocida", pero informarlo
 * asi perderia la razon real del rechazo.
 */
function assertExactKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  path: string
): void {
  for (const key of Object.keys(value)) {
    if (OBJECTIVE_ANALYSIS_KEYS.has(key)) {
      failDefinition('OBJECTIVE_ANALYSIS_FIELD_NOT_ALLOWED', {
        invariant: 'objective_analysis_is_produced_and_frozen_by_the_reasoning_run',
        path: `${path}.${key}`,
        observed: key
      });
    }
    if (HOLDER_SCOPED_KEYS.has(key)) {
      failDefinition('HOLDER_SCOPED_FIELD_NOT_ALLOWED', {
        invariant: 'objective_definition_must_stay_holder_independent',
        path: `${path}.${key}`,
        observed: key
      });
    }
    if (!allowed.has(key)) {
      failDefinition('UNKNOWN_PROPERTY', {
        invariant: 'contract_declares_no_such_property',
        path: `${path}.${key}`,
        observed: key
      });
    }
  }
}

function expectObject(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    failDefinition('SCHEMA_INVALID', { invariant: 'must_be_object', path });
  }
  return value;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    failDefinition('SCHEMA_INVALID', { invariant: 'must_be_string', path });
  }
  return value;
}

function expectNonBlankString(value: unknown, path: string): string {
  const text = expectString(value, path);
  if (isBlank(text)) {
    failDefinition('TEXT_EMPTY', { invariant: 'must_not_be_blank', path });
  }
  return text;
}

function expectEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string
): T {
  const text = expectString(value, path);
  if (!(allowed as readonly string[]).includes(text)) {
    failDefinition('SCHEMA_INVALID', {
      invariant: 'value_outside_closed_set',
      path,
      // Es un enum cerrado, asi que el valor recibido no puede ser contenido
      // del usuario y es seguro nombrarlo.
      observed: text.slice(0, 64)
    });
  }
  return text as T;
}

// ---------------------------------------------------------------------------
// Qualifiers
// ---------------------------------------------------------------------------

/**
 * `objective_definition_v1` exige `qualifiers: []`. CONGELADO.
 *
 *     OBJECTIVE_DEFINITION_V1_QUALIFIERS: EMPTY_ONLY
 *     QUALIFIER_KIND_CONTRACT:            NONE_IN_V1
 *
 * POR QUE VACIO ES LO CORRECTO, y no una simplificacion provisional.
 *
 * `requirementText` YA preserva el requisito semantico completo. En
 *
 *     "Experiencia practica en APIs REST durante al menos dos años"
 *
 * el qualifier practico ("practica"), la tecnologia ("APIs REST") y el temporal
 * ("al menos dos años") estan todos presentes y sin perdida, aunque
 * `qualifiers` sea `[]`. Extraerlos a una estructura no agrega informacion: la
 * REORGANIZA. Y esa reorganizacion es un juicio semantico que pertenece a
 * Objective Analysis, que F3 debera congelar por cada ReasoningRun.
 *
 * Ademas, ningun contrato congelado define el vocabulario de `kind`: la
 * especificacion v0 §12 lista ocho categorias explicitamente "TIPICAS", y el
 * reasoner B2.4.1 declara `kind` como `{"type": "string"}` libre —en las
 * corridas congeladas emitio 161 tokens distintos, de los cuales uno solo
 * coincide con esas categorias—. Inventar el conjunto seria exactamente lo que
 * F2.0 prohibio.
 *
 * V1 NO SE AMPLIARA. Si alguna vez existe un vocabulario productivo estable,
 * entra por `objective_definition_v2`. Asi un artifact valido hoy sigue siendo
 * valido bajo su propia schema version manana, que es justo lo que permite
 * re-verificar filas historicas sin invalidarlas.
 */
function verifyQualifiers(value: unknown, path: string): readonly never[] {
  if (!Array.isArray(value)) {
    failDefinition('SCHEMA_INVALID', { invariant: 'must_be_array', path });
  }
  if (value.length > 0) {
    failDefinition('QUALIFIERS_NOT_SUPPORTED_IN_V1', {
      invariant: 'objective_definition_v1_requires_an_empty_qualifiers_array',
      path,
      observed: `length=${value.length}`
    });
  }
  return Object.freeze([]);
}

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

function verifyRequirement(
  input: unknown,
  index: number,
  originalText: string | null
): ObjectiveRequirement {
  const path = `definition.requirements[${index}]`;
  const raw = expectObject(input, path);
  assertExactKeys(raw, REQUIREMENT_KEYS, path);

  const expectedOrder = index + 1;
  if (raw.order !== expectedOrder) {
    failDefinition('REQUIREMENT_SEQUENCE_INVALID', {
      invariant: 'order_must_be_one_based_consecutive_without_gaps',
      path: `${path}.order`,
      observed: `expected=${expectedOrder}`
    });
  }

  const requirementId = expectString(raw.requirementId, `${path}.requirementId`);
  if (!REQUIREMENT_ID_PATTERN.test(requirementId)) {
    failDefinition('REQUIREMENT_SEQUENCE_INVALID', {
      invariant: 'requirement_id_must_match_req_NN',
      path: `${path}.requirementId`
    });
  }
  if (requirementId !== requirementIdForOrder(expectedOrder)) {
    failDefinition('REQUIREMENT_SEQUENCE_INVALID', {
      invariant: 'requirement_id_must_agree_with_order',
      path: `${path}.requirementId`,
      observed: `expected=${requirementIdForOrder(expectedOrder)}`
    });
  }

  // Se preserva EXACTAMENTE. No se normaliza: el reasoner hara su propia
  // normalizacion dentro del run, y hacerla aca perderia qualifiers materiales
  // sin que nadie lo pidiera.
  const requirementText = expectNonBlankString(
    raw.requirementText,
    `${path}.requirementText`
  );

  const provenancePath = `${path}.provenance`;
  const provenanceRaw = expectObject(raw.provenance, provenancePath);
  assertExactKeys(provenanceRaw, PROVENANCE_KEYS, provenancePath);

  const kind = expectEnum<RequirementProvenanceKind>(
    provenanceRaw.kind,
    REQUIREMENT_PROVENANCE_KINDS,
    `${provenancePath}.kind`
  );

  let sourceQuote: string | null = null;
  if (kind === 'DERIVED_FROM_SOURCE_TEXT') {
    if (originalText === null) {
      failDefinition('PROVENANCE_INCONSISTENT', {
        invariant: 'derived_provenance_requires_source_original_text',
        path: provenancePath
      });
    }
    sourceQuote = expectNonBlankString(
      provenanceRaw.sourceQuote,
      `${provenancePath}.sourceQuote`
    );
    // LITERAL significa literal. Sin lowercase, sin normalizar whitespace, sin
    // fuzzy. Es el mismo invariante que `REQUIREMENT_QUOTE_INVALID` del reasoner.
    if (!originalText.includes(sourceQuote)) {
      failDefinition('SOURCE_QUOTE_NOT_LITERAL', {
        invariant: 'source_quote_must_be_a_literal_substring_of_original_text',
        path: `${provenancePath}.sourceQuote`
      });
    }
  } else if (provenanceRaw.sourceQuote !== null) {
    failDefinition('PROVENANCE_INCONSISTENT', {
      invariant: 'direct_structured_input_must_not_carry_a_source_quote',
      path: `${provenancePath}.sourceQuote`
    });
  }

  const qualifiers = verifyQualifiers(raw.qualifiers, `${path}.qualifiers`);

  return Object.freeze({
    requirementId,
    order: expectedOrder,
    requirementText,
    provenance: Object.freeze({ kind, sourceQuote }),
    qualifiers
  });
}

// ---------------------------------------------------------------------------
// Entrada publica
// ---------------------------------------------------------------------------

/**
 * Verifica un artifact desconocido y devuelve un snapshot congelado.
 *
 * Levanta `ObjectiveDefinitionError` con un codigo determinista. Nunca devuelve
 * un resultado parcial ni "repara" nada.
 */
export function verifyObjectiveDefinitionArtifact(
  input: unknown
): VerifiedObjectiveDefinition {
  const raw = expectObject(input, 'definition');
  assertExactKeys(raw, ROOT_KEYS, 'definition');

  if (raw.schemaVersion !== OBJECTIVE_DEFINITION_SCHEMA_VERSION) {
    failDefinition('SCHEMA_VERSION_UNSUPPORTED', {
      invariant: 'unsupported_schema_version',
      path: 'definition.schemaVersion'
    });
  }

  const objectiveType = expectEnum<ObjectiveTypeToken>(
    raw.objectiveType,
    OBJECTIVE_TYPES,
    'definition.objectiveType'
  );

  // Puede ser "" a proposito: no toda oportunidad trae encuadre separable.
  const objectiveContext = expectString(
    raw.objectiveContext,
    'definition.objectiveContext'
  );

  const sourceRaw = expectObject(raw.source, 'definition.source');
  assertExactKeys(sourceRaw, SOURCE_KEYS, 'definition.source');

  const inputType = expectEnum<ObjectiveSourceInputType>(
    sourceRaw.inputType,
    OBJECTIVE_SOURCE_INPUT_TYPES,
    'definition.source.inputType'
  );

  let originalText: string | null = null;
  if (inputType === 'PASTED_TEXT') {
    originalText = expectString(sourceRaw.originalText, 'definition.source.originalText');
    if (isBlank(originalText)) {
      failDefinition('SOURCE_INPUT_INCONSISTENT', {
        invariant: 'pasted_text_requires_non_blank_original_text',
        path: 'definition.source.originalText'
      });
    }
  } else if (sourceRaw.originalText !== null) {
    failDefinition('SOURCE_INPUT_INCONSISTENT', {
      invariant: 'direct_structured_input_must_not_carry_original_text',
      path: 'definition.source.originalText'
    });
  }

  if (!Array.isArray(raw.requirements)) {
    failDefinition('SCHEMA_INVALID', {
      invariant: 'must_be_array',
      path: 'definition.requirements'
    });
  }
  if (raw.requirements.length === 0) {
    failDefinition('REQUIREMENTS_EMPTY', {
      invariant: 'a_finalized_objective_needs_at_least_one_requirement',
      path: 'definition.requirements'
    });
  }

  const requirements = raw.requirements.map((item, index) =>
    verifyRequirement(item, index, originalText)
  );

  // Redundante con la comprobacion id<->order, pero barato y explicito: si algun
  // dia esa regla se relaja, la unicidad debe seguir garantizada por si misma.
  const seen = new Set<string>();
  for (const requirement of requirements) {
    if (seen.has(requirement.requirementId)) {
      failDefinition('REQUIREMENT_ID_DUPLICATED', {
        invariant: 'requirement_ids_must_be_unique_within_the_artifact',
        path: `definition.requirements[${requirement.order - 1}].requirementId`
      });
    }
    seen.add(requirement.requirementId);
  }

  return Object.freeze({
    schemaVersion: OBJECTIVE_DEFINITION_SCHEMA_VERSION,
    objectiveType,
    objectiveContext,
    source: Object.freeze({ inputType, originalText }),
    requirements: Object.freeze(requirements)
  });
}

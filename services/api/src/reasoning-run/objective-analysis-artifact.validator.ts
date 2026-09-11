/**
 * Validador estructural de `objective_analysis_v1` — slice F3.1.
 *
 * Verifica la FORMA del artifact. La coherencia con el Objective congelado del
 * run —un item por Requirement confirmado, ni de mas ni de menos— la verifica
 * `verifyObjectiveAnalysisAgainstObjectiveSnapshot` en el verificador cruzado:
 * son dos preguntas distintas y la segunda necesita el snapshot.
 */

import {
  assertExactKeys,
  assertUnique,
  deepFreeze,
  expectArray,
  expectBoolean,
  expectEnum,
  expectIdentifier,
  expectNonBlankString,
  expectObject,
  expectString
} from './reasoning-run-artifact.primitives';
import { failArtifact } from './reasoning-run-artifact.errors';
import {
  ATOMICITY_TOKENS,
  EPISTEMIC_TARGETS,
  OBJECTIVE_ANALYSIS_SCHEMA_VERSION,
  QUALIFIER_ROLES,
  REQUIRED_EVIDENCE_TYPES,
  REQUIREMENT_ID_PATTERN,
  VALIDATION_STATUSES,
  VALIDATION_TAXONOMIES,
  type ObjectiveAnalysisEvaluability,
  type ObjectiveAnalysisQualifier,
  type ObjectiveAnalysisRequirement,
  type StageValidationRecord,
  type VerifiedObjectiveAnalysis
} from './reasoning-run-artifact.types';

const ROOT_KEYS = new Set(['schemaVersion', 'requirements']);
const REQUIREMENT_KEYS = new Set([
  'requirementId',
  'epistemicTarget',
  'epistemicTargetRationale',
  'atomicity',
  'evaluability',
  'qualifiers',
  'normalizedRequirement',
  'validations'
]);
const EVALUABILITY_KEYS = new Set([
  'requiredEvidenceType',
  'formativeEvidenceCapable',
  'rationale'
]);
const QUALIFIER_KEYS = new Set([
  'qualifierId',
  'kind',
  'value',
  'sourcePhrase',
  'role',
  'rationale'
]);
const VALIDATION_KEYS = new Set([
  'taxonomy',
  'code',
  'status',
  'artifactRef',
  'detail',
  'affectsEpistemicState'
]);

/** `q_01`, `q_02`, … cuando el qualifier es MATERIAL_QUALIFIER; `null` si no. */
const QUALIFIER_ID_PATTERN = /^q_\d{2,}$/;

export function verifyStageValidations(
  raw: unknown,
  path: string
): readonly StageValidationRecord[] {
  const items = expectArray(raw, path);
  return Object.freeze(
    items.map((item, index) => {
      const itemPath = `${path}[${index}]`;
      const record = expectObject(item, itemPath);
      assertExactKeys(record, VALIDATION_KEYS, itemPath);
      return Object.freeze({
        taxonomy: expectEnum(
          record.taxonomy,
          VALIDATION_TAXONOMIES,
          `${itemPath}.taxonomy`
        ),
        code: expectNonBlankString(record.code, `${itemPath}.code`),
        status: expectEnum(
          record.status,
          VALIDATION_STATUSES,
          `${itemPath}.status`
        ),
        artifactRef: expectNonBlankString(
          record.artifactRef,
          `${itemPath}.artifactRef`
        ),
        detail: expectString(record.detail, `${itemPath}.detail`),
        affectsEpistemicState: expectBoolean(
          record.affectsEpistemicState,
          `${itemPath}.affectsEpistemicState`
        )
      });
    })
  );
}

function verifyEvaluability(
  raw: unknown,
  path: string
): ObjectiveAnalysisEvaluability {
  const value = expectObject(raw, path);
  assertExactKeys(value, EVALUABILITY_KEYS, path);
  return Object.freeze({
    requiredEvidenceType: expectEnum(
      value.requiredEvidenceType,
      REQUIRED_EVIDENCE_TYPES,
      `${path}.requiredEvidenceType`
    ),
    formativeEvidenceCapable: expectBoolean(
      value.formativeEvidenceCapable,
      `${path}.formativeEvidenceCapable`
    ),
    rationale: expectNonBlankString(value.rationale, `${path}.rationale`)
  });
}

/**
 * `qualifierId` no es libre: el codigo congelado lo asigna SOLO a los
 * `MATERIAL_QUALIFIER` y deja `null` en los contextuales y los wrappers. Es lo
 * que hace que `supportedQualifierIds` del resultado sea siempre una referencia a
 * algo material, y por eso se verifica la correspondencia en vez de aceptar
 * cualquier combinacion.
 */
function verifyQualifier(
  raw: unknown,
  path: string
): ObjectiveAnalysisQualifier {
  const value = expectObject(raw, path);
  assertExactKeys(value, QUALIFIER_KEYS, path);

  const role = expectEnum(value.role, QUALIFIER_ROLES, `${path}.role`);
  const material = role === 'MATERIAL_QUALIFIER';

  let qualifierId: string | null = null;
  if (material) {
    // `null` en un MATERIAL_QUALIFIER es el caso interesante y merece el codigo
    // del invariante, no un generico "esperaba string": lo que esta roto es la
    // correspondencia rol/id, y sin id `supportedQualifierIds` no puede
    // referenciarlo.
    if (value.qualifierId === null) {
      failArtifact('IDENTIFIER_FORMAT_INVALID', {
        invariant: 'a_material_qualifier_must_carry_a_qualifier_id',
        path: `${path}.qualifierId`,
        observed: role
      });
    }
    qualifierId = expectIdentifier(
      value.qualifierId,
      QUALIFIER_ID_PATTERN,
      `${path}.qualifierId`
    );
  } else if (value.qualifierId !== null) {
    failArtifact('IDENTIFIER_FORMAT_INVALID', {
      invariant: 'only_material_qualifiers_carry_a_qualifier_id',
      path: `${path}.qualifierId`,
      observed: role
    });
  }

  return Object.freeze({
    qualifierId,
    kind: expectNonBlankString(value.kind, `${path}.kind`),
    value: expectNonBlankString(value.value, `${path}.value`),
    sourcePhrase: expectNonBlankString(
      value.sourcePhrase,
      `${path}.sourcePhrase`
    ),
    role,
    rationale: expectNonBlankString(value.rationale, `${path}.rationale`)
  });
}

function verifyRequirement(
  raw: unknown,
  path: string
): ObjectiveAnalysisRequirement {
  const value = expectObject(raw, path);
  assertExactKeys(value, REQUIREMENT_KEYS, path);

  const qualifiers = expectArray(value.qualifiers, `${path}.qualifiers`).map(
    (item, index) => verifyQualifier(item, `${path}.qualifiers[${index}]`)
  );

  assertUnique(
    qualifiers
      .map((qualifier) => qualifier.qualifierId)
      .filter((id): id is string => id !== null),
    'IDENTIFIER_DUPLICATED',
    'qualifier_ids_are_unique_within_a_requirement',
    `${path}.qualifiers`
  );

  return Object.freeze({
    requirementId: expectIdentifier(
      value.requirementId,
      REQUIREMENT_ID_PATTERN,
      `${path}.requirementId`
    ),
    epistemicTarget: expectEnum(
      value.epistemicTarget,
      EPISTEMIC_TARGETS,
      `${path}.epistemicTarget`
    ),
    epistemicTargetRationale: expectNonBlankString(
      value.epistemicTargetRationale,
      `${path}.epistemicTargetRationale`
    ),
    atomicity: expectEnum(
      value.atomicity,
      ATOMICITY_TOKENS,
      `${path}.atomicity`
    ),
    evaluability: verifyEvaluability(
      value.evaluability,
      `${path}.evaluability`
    ),
    qualifiers: Object.freeze(qualifiers),
    normalizedRequirement: expectNonBlankString(
      value.normalizedRequirement,
      `${path}.normalizedRequirement`
    ),
    validations: verifyStageValidations(
      value.validations,
      `${path}.validations`
    )
  });
}

/**
 * Devuelve un snapshot desacoplado y profundamente congelado.
 *
 * NO comprueba que los `requirementId` existan en el Objective: eso necesita el
 * snapshot y es responsabilidad del verificador cruzado.
 */
export function verifyObjectiveAnalysisArtifact(
  input: unknown
): VerifiedObjectiveAnalysis {
  const root = expectObject(input, 'objectiveAnalysis');
  assertExactKeys(root, ROOT_KEYS, 'objectiveAnalysis');

  if (root.schemaVersion !== OBJECTIVE_ANALYSIS_SCHEMA_VERSION) {
    failArtifact('SCHEMA_VERSION_UNSUPPORTED', {
      invariant: 'schema_version_must_be_the_single_supported_one',
      path: 'objectiveAnalysis.schemaVersion',
      observed: typeof root.schemaVersion === 'string'
        ? root.schemaVersion.slice(0, 64)
        : typeof root.schemaVersion
    });
  }

  const requirements = expectArray(
    root.requirements,
    'objectiveAnalysis.requirements'
  ).map((item, index) =>
    verifyRequirement(item, `objectiveAnalysis.requirements[${index}]`)
  );

  assertUnique(
    requirements.map((requirement) => requirement.requirementId),
    'IDENTIFIER_DUPLICATED',
    'each_requirement_is_analysed_exactly_once',
    'objectiveAnalysis.requirements'
  );

  return deepFreeze({
    schemaVersion: OBJECTIVE_ANALYSIS_SCHEMA_VERSION,
    requirements: Object.freeze(requirements)
  } as VerifiedObjectiveAnalysis);
}

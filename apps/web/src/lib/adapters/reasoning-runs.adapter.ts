/**
 * Adapters de Analisis de trayectoria — P2.4B.
 *
 * MISMA DISCIPLINA DE WHITESPACE QUE `objectives.adapter.ts`: `excerpt` es
 * material anclado a la fuente congelada del run. Colapsar un espacio aca
 * cambiaria la cita que el holder lee respecto de la que el razonador uso, asi
 * que este modulo valida el tipo y NO toca el contenido.
 *
 * `explanation` NO SE LEE. P2.4A.1 lo saco del transporte; si reapareciera en la
 * respuesta, esta capa simplemente no lo mira y nunca llega a un componente.
 */

import { IncompatiblePayloadError } from '@/lib/errors/api-error';
import {
  CREDENTIAL_CURRENT_STATUS_LABELS,
  EVIDENCE_COVERAGES,
  EVIDENCE_SOURCE_KINDS,
  REASONING_RUN_STATUSES,
  REQUIREMENT_FINAL_STATES,
  RUN_FAILURE_CATEGORIES,
  type EvidenceCoverage,
  type EvidenceSourceKind,
  type ObjectiveSynthesisPositiveConclusionVM,
  type ObjectiveSynthesisSupportingCredentialVM,
  type ObjectiveSynthesisVM,
  type ReasoningEvidenceCredentialVM,
  type ReasoningEvidenceVM,
  type ReasoningRunDetailVM,
  type ReasoningRunStatus,
  type ReasoningRunSummaryVM,
  type RequirementFinalState,
  type RequirementResultVM,
  type RunFailureCategory
} from '@/models/reasoning-runs';

function invalid(path: string, expected: string, value: unknown): never {
  throw new IncompatiblePayloadError('La respuesta del servicio no es compatible.', {
    path,
    expected,
    actualCategory: categoryOf(value)
  });
}

function categoryOf(value: unknown) {
  if (value === undefined) return 'missing' as const;
  if (value === null) return 'null' as const;
  if (Array.isArray(value)) return 'array' as const;
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return type;
  return 'object' as const;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(path, 'object', value);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(path, 'array', value);
  return value;
}

/** String tal cual viene. Sin trim, sin colapsar espacios. */
function verbatimString(value: unknown, path: string): string {
  if (typeof value !== 'string') invalid(path, 'string', value);
  return value;
}

function nullableVerbatimString(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  return verbatimString(value, path);
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string
): T {
  const text = verbatimString(value, path);
  if (!(allowed as readonly string[]).includes(text)) {
    invalid(path, `one of ${allowed.join(', ')}`, value);
  }
  return text as T;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    invalid(path, 'non-negative integer', value);
  }
  return value;
}

/**
 * Pagina OPCIONAL y positiva.
 *
 * `null` es una respuesta legitima y frecuente —toda fuente de texto la tiene
 * asi—, y no se sustituye por 1 ni por "desconocida".
 */
function nullablePageNumber(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    invalid(path, 'positive integer or null', value);
  }
  return value;
}

function isoDateLabel(value: unknown, path: string): string {
  const text = verbatimString(value, path);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) invalid(path, 'ISO date string', value);
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(parsed);
}

function nullableIsoDateLabel(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  return isoDateLabel(value, path);
}

function failureCategory(value: unknown, path: string): RunFailureCategory | null {
  if (value === null || value === undefined) return null;
  return enumValue<RunFailureCategory>(value, RUN_FAILURE_CATEGORIES, path);
}

// ---------------------------------------------------------------------------
// Evidencia
// ---------------------------------------------------------------------------

function credential(
  value: unknown,
  path: string
): ReasoningEvidenceCredentialVM | null {
  // `null` es un desenlace previsto del backend: la cita es confiable aunque la
  // etiqueta de credencial no se haya podido unir. No se inventa ninguna.
  if (value === null || value === undefined) return null;

  const raw = record(value, path);
  const currentStatus = verbatimString(raw.currentStatus, `${path}.currentStatus`);

  return {
    credentialReference: verbatimString(
      raw.credentialReference,
      `${path}.credentialReference`
    ),
    title: verbatimString(raw.title, `${path}.title`),
    credentialType: verbatimString(raw.credentialType, `${path}.credentialType`),
    issuerName: verbatimString(raw.issuerName, `${path}.issuerName`),
    currentStatus,
    // Un estado que no conocemos se muestra tal cual antes que romper la lectura
    // de un resultado historico entero por una etiqueta.
    currentStatusLabel: CREDENTIAL_CURRENT_STATUS_LABELS[currentStatus] ?? currentStatus
  };
}

function evidence(value: unknown, path: string): ReasoningEvidenceVM {
  const raw = record(value, path);
  return {
    excerpt: verbatimString(raw.excerpt, `${path}.excerpt`),
    contextBefore: nullableVerbatimString(raw.contextBefore, `${path}.contextBefore`),
    contextAfter: nullableVerbatimString(raw.contextAfter, `${path}.contextAfter`),
    sectionLabel: nullableVerbatimString(raw.sectionLabel, `${path}.sectionLabel`),
    pageNumber: nullablePageNumber(raw.pageNumber, `${path}.pageNumber`),
    coverage: enumValue<EvidenceCoverage>(
      raw.coverage,
      EVIDENCE_COVERAGES,
      `${path}.coverage`
    ),
    sourceKind: enumValue<EvidenceSourceKind>(
      raw.sourceKind,
      EVIDENCE_SOURCE_KINDS,
      `${path}.sourceKind`
    ),
    credential: credential(raw.credential, `${path}.credential`)
  };
}

function requirementResult(value: unknown, path: string): RequirementResultVM {
  const raw = record(value, path);
  return {
    requirementId: verbatimString(raw.requirementId, `${path}.requirementId`),
    requirementText: verbatimString(raw.requirementText, `${path}.requirementText`),
    finalState: enumValue<RequirementFinalState>(
      raw.finalState,
      REQUIREMENT_FINAL_STATES,
      `${path}.finalState`
    ),
    supportedWeakerClaim: nullableVerbatimString(
      raw.supportedWeakerClaim,
      `${path}.supportedWeakerClaim`
    ),
    // Puede venir vacia, y es un estado normal: INSUFFICIENT_EVIDENCE,
    // NOT_ASSESSABLE y ABSTAIN suelen no tener ninguna.
    evidence: array(raw.evidence, `${path}.evidence`).map((item, index) =>
      evidence(item, `${path}.evidence[${index}]`)
    )
    // `raw.explanation` NO se lee. Ver la nota de cabecera.
  };
}

// ---------------------------------------------------------------------------
// Sintesis determinista del Objective (P2.4C)
// ---------------------------------------------------------------------------

function positiveFinalState(
  value: unknown,
  path: string
): ObjectiveSynthesisPositiveConclusionVM['finalState'] {
  const finalState = enumValue<RequirementFinalState>(
    value,
    REQUIREMENT_FINAL_STATES,
    path
  );
  if (finalState !== 'SUPPORTED' && finalState !== 'PARTIALLY_SUPPORTED') {
    invalid(path, 'SUPPORTED or PARTIALLY_SUPPORTED', value);
  }
  return finalState;
}

function stringArray(value: unknown, path: string): string[] {
  return array(value, path).map((item, index) =>
    verbatimString(item, `${path}[${index}]`)
  );
}

function synthesisSupportingCredential(
  value: unknown,
  path: string
): ObjectiveSynthesisSupportingCredentialVM {
  const raw = record(value, path);
  const display = record(raw.credentialDisplay, `${path}.credentialDisplay`);

  return {
    credentialReference: verbatimString(
      raw.credentialReference,
      `${path}.credentialReference`
    ),
    credentialDisplay: {
      title: verbatimString(display.title, `${path}.credentialDisplay.title`),
      credentialType: verbatimString(
        display.credentialType,
        `${path}.credentialDisplay.credentialType`
      ),
      issuerName: verbatimString(
        display.issuerName,
        `${path}.credentialDisplay.issuerName`
      ),
      currentStatus: verbatimString(
        display.currentStatus,
        `${path}.credentialDisplay.currentStatus`
      )
    },
    supportedRequirementIds: stringArray(
      raw.supportedRequirementIds,
      `${path}.supportedRequirementIds`
    ),
    partiallySupportedRequirementIds: stringArray(
      raw.partiallySupportedRequirementIds,
      `${path}.partiallySupportedRequirementIds`
    )
  };
}

function objectiveSynthesis(value: unknown, path: string): ObjectiveSynthesisVM | null {
  // Los adapters web usan `null` para ausencia compatible y null explicito en
  // campos aditivos. Mantenerlos colapsados permite rolling deploy sin inventar
  // una sintesis para respuestas anteriores.
  if (value === null || value === undefined) return null;

  const raw = record(value, path);
  if (raw.schemaVersion !== 'objective_synthesis_v1') {
    invalid(`${path}.schemaVersion`, 'objective_synthesis_v1', raw.schemaVersion);
  }
  const summary = record(raw.stateSummary, `${path}.stateSummary`);

  return {
    schemaVersion: 'objective_synthesis_v1',
    reasoningRunReference: verbatimString(
      raw.reasoningRunReference,
      `${path}.reasoningRunReference`
    ),
    objectiveReference: verbatimString(raw.objectiveReference, `${path}.objectiveReference`),
    stateSummary: {
      supportedCount: nonNegativeInteger(
        summary.supportedCount,
        `${path}.stateSummary.supportedCount`
      ),
      partiallySupportedCount: nonNegativeInteger(
        summary.partiallySupportedCount,
        `${path}.stateSummary.partiallySupportedCount`
      ),
      insufficientEvidenceCount: nonNegativeInteger(
        summary.insufficientEvidenceCount,
        `${path}.stateSummary.insufficientEvidenceCount`
      ),
      abstainCount: nonNegativeInteger(
        summary.abstainCount,
        `${path}.stateSummary.abstainCount`
      ),
      notAssessableCount: nonNegativeInteger(
        summary.notAssessableCount,
        `${path}.stateSummary.notAssessableCount`
      )
    },
    requirements: array(raw.requirements, `${path}.requirements`).map((item, index) => {
      const requirement = record(item, `${path}.requirements[${index}]`);
      return {
        requirementId: verbatimString(
          requirement.requirementId,
          `${path}.requirements[${index}].requirementId`
        ),
        order: nonNegativeInteger(requirement.order, `${path}.requirements[${index}].order`),
        requirementText: verbatimString(
          requirement.requirementText,
          `${path}.requirements[${index}].requirementText`
        ),
        finalState: enumValue<RequirementFinalState>(
          requirement.finalState,
          REQUIREMENT_FINAL_STATES,
          `${path}.requirements[${index}].finalState`
        )
      };
    }),
    positiveConclusions: array(
      raw.positiveConclusions,
      `${path}.positiveConclusions`
    ).map((item, index) => {
      const conclusion = record(item, `${path}.positiveConclusions[${index}]`);
      return {
        requirementId: verbatimString(
          conclusion.requirementId,
          `${path}.positiveConclusions[${index}].requirementId`
        ),
        requirementText: verbatimString(
          conclusion.requirementText,
          `${path}.positiveConclusions[${index}].requirementText`
        ),
        finalState: positiveFinalState(
          conclusion.finalState,
          `${path}.positiveConclusions[${index}].finalState`
        ),
        supportedWeakerClaim: nullableVerbatimString(
          conclusion.supportedWeakerClaim,
          `${path}.positiveConclusions[${index}].supportedWeakerClaim`
        ),
        supportingCredentialReferences: stringArray(
          conclusion.supportingCredentialReferences,
          `${path}.positiveConclusions[${index}].supportingCredentialReferences`
        )
      };
    }),
    credentialsSupportingPositiveConclusions: array(
      raw.credentialsSupportingPositiveConclusions,
      `${path}.credentialsSupportingPositiveConclusions`
    ).map((item, index) =>
      synthesisSupportingCredential(
        item,
        `${path}.credentialsSupportingPositiveConclusions[${index}]`
      )
    )
  };
}

// ---------------------------------------------------------------------------
// Entradas publicas
// ---------------------------------------------------------------------------

export function adaptReasoningRunSummaries(
  payload: unknown
): ReasoningRunSummaryVM[] {
  return array(payload, 'reasoningRuns').map((value, index) => {
    const path = `reasoningRuns[${index}]`;
    const raw = record(value, path);
    const createdAt = verbatimString(raw.createdAt, `${path}.createdAt`);
    return {
      reasoningRunReference: verbatimString(
        raw.reasoningRunReference,
        `${path}.reasoningRunReference`
      ),
      objectiveReference: verbatimString(
        raw.objectiveReference,
        `${path}.objectiveReference`
      ),
      objectiveTitle: verbatimString(raw.objectiveTitle, `${path}.objectiveTitle`),
      status: enumValue<ReasoningRunStatus>(
        raw.status,
        REASONING_RUN_STATUSES,
        `${path}.status`
      ),
      requirementCount: nonNegativeInteger(
        raw.requirementCount,
        `${path}.requirementCount`
      ),
      failureCategory: failureCategory(raw.failureCategory, `${path}.failureCategory`),
      createdAt,
      createdAtLabel: isoDateLabel(createdAt, `${path}.createdAt`)
    };
  });
}

export function adaptReasoningRunDetail(payload: unknown): ReasoningRunDetailVM {
  const raw = record(payload, 'reasoningRun');
  const status = enumValue<ReasoningRunStatus>(
    raw.status,
    REASONING_RUN_STATUSES,
    'reasoningRun.status'
  );
  const objective = record(raw.objective, 'reasoningRun.objective');

  // El resultado llega SOLO cuando el run completo. En cualquier otro estado es
  // `null`, y forzarlo a un array vacio haria indistinguible "todavia no hay
  // analisis" de "el analisis no encontro nada".
  const rawResult = raw.result;
  let requirementResults: RequirementResultVM[] | null = null;
  if (rawResult !== null && rawResult !== undefined) {
    const result = record(rawResult, 'reasoningRun.result');
    requirementResults = array(
      result.requirementResults,
      'reasoningRun.result.requirementResults'
    ).map((value, index) =>
      requirementResult(value, `reasoningRun.result.requirementResults[${index}]`)
    );
  }

  return {
    reasoningRunReference: verbatimString(
      raw.reasoningRunReference,
      'reasoningRun.reasoningRunReference'
    ),
    status,
    objectiveReference: verbatimString(
      objective.objectiveReference,
      'reasoningRun.objective.objectiveReference'
    ),
    objectiveTitle: verbatimString(objective.title, 'reasoningRun.objective.title'),
    failureCategory: failureCategory(
      raw.failureCategory,
      'reasoningRun.failureCategory'
    ),
    createdAt: verbatimString(raw.createdAt, 'reasoningRun.createdAt'),
    createdAtLabel: isoDateLabel(raw.createdAt, 'reasoningRun.createdAt'),
    completedAtLabel: nullableIsoDateLabel(
      raw.completedAt,
      'reasoningRun.completedAt'
    ),
    requirementResults,
    // Las identidades interiores son metadata transportada: no reemplazan las
    // referencias autoritativas del run exterior ni agregan reconciliacion.
    synthesis: objectiveSynthesis(raw.synthesis, 'reasoningRun.synthesis')
  };
}

import {
  array,
  enumValueOf,
  invalid,
  isoDateLabel,
  nonNegativeIntegerValue,
  nullableIsoDateLabel,
  nullablePageNumber,
  nullableVerbatimString,
  optionalRecordOf,
  record,
  stringArrayOf,
  verbatimString
} from '@/lib/adapters/verbatim';
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
} from '@/types/reasoning-runs';

/**
 * Adapters de Análisis de trayectoria.
 *
 * MISMA DISCIPLINA DE WHITESPACE QUE `objectives.adapter.ts`: `excerpt` es
 * material anclado a la fuente congelada del run. Colapsar un espacio acá
 * cambiaría la cita que la persona lee respecto de la que el razonador usó.
 *
 * `explanation` NO SE LEE. El backend lo sacó del transporte a propósito; si
 * reapareciera en la respuesta, esta capa simplemente no lo mira y nunca llega
 * a un componente.
 */

function failureCategory(
  value: unknown,
  path: string
): RunFailureCategory | null {
  if (value === null || value === undefined) return null;
  return enumValueOf<RunFailureCategory>(value, RUN_FAILURE_CATEGORIES, path);
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
  const raw = optionalRecordOf(value, path);
  if (raw === null) return null;

  const currentStatus = verbatimString(
    raw.currentStatus,
    `${path}.currentStatus`
  );

  return {
    credentialReference: verbatimString(
      raw.credentialReference,
      `${path}.credentialReference`
    ),
    title: verbatimString(raw.title, `${path}.title`),
    credentialType: verbatimString(
      raw.credentialType,
      `${path}.credentialType`
    ),
    issuerName: verbatimString(raw.issuerName, `${path}.issuerName`),
    currentStatus,
    // Un estado que no conocemos se muestra tal cual antes que romper la lectura
    // de un resultado histórico entero por una etiqueta.
    currentStatusLabel:
      CREDENTIAL_CURRENT_STATUS_LABELS[currentStatus] ?? currentStatus
  };
}

function evidence(value: unknown, path: string): ReasoningEvidenceVM {
  const raw = record(value, path);

  return {
    excerpt: verbatimString(raw.excerpt, `${path}.excerpt`),
    contextBefore: nullableVerbatimString(
      raw.contextBefore,
      `${path}.contextBefore`
    ),
    contextAfter: nullableVerbatimString(
      raw.contextAfter,
      `${path}.contextAfter`
    ),
    sectionLabel: nullableVerbatimString(
      raw.sectionLabel,
      `${path}.sectionLabel`
    ),
    pageNumber: nullablePageNumber(raw.pageNumber, `${path}.pageNumber`),
    coverage: enumValueOf<EvidenceCoverage>(
      raw.coverage,
      EVIDENCE_COVERAGES,
      `${path}.coverage`
    ),
    sourceKind: enumValueOf<EvidenceSourceKind>(
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
    requirementText: verbatimString(
      raw.requirementText,
      `${path}.requirementText`
    ),
    finalState: enumValueOf<RequirementFinalState>(
      raw.finalState,
      REQUIREMENT_FINAL_STATES,
      `${path}.finalState`
    ),
    supportedWeakerClaim: nullableVerbatimString(
      raw.supportedWeakerClaim,
      `${path}.supportedWeakerClaim`
    ),
    // Puede venir vacía, y es un estado normal: INSUFFICIENT_EVIDENCE,
    // NOT_ASSESSABLE y ABSTAIN suelen no tener ninguna.
    evidence: array(raw.evidence, `${path}.evidence`).map((item, index) =>
      evidence(item, `${path}.evidence[${index}]`)
    )
    // `raw.explanation` NO se lee. Ver la nota de cabecera.
  };
}

// ---------------------------------------------------------------------------
// Síntesis determinista del Objective
// ---------------------------------------------------------------------------

function positiveFinalState(
  value: unknown,
  path: string
): ObjectiveSynthesisPositiveConclusionVM['finalState'] {
  const finalState = enumValueOf<RequirementFinalState>(
    value,
    REQUIREMENT_FINAL_STATES,
    path
  );

  if (finalState !== 'SUPPORTED' && finalState !== 'PARTIALLY_SUPPORTED') {
    invalid(path, 'SUPPORTED or PARTIALLY_SUPPORTED', value);
  }

  return finalState;
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
    supportedRequirementIds: stringArrayOf(
      raw.supportedRequirementIds,
      `${path}.supportedRequirementIds`
    ),
    partiallySupportedRequirementIds: stringArrayOf(
      raw.partiallySupportedRequirementIds,
      `${path}.partiallySupportedRequirementIds`
    )
  };
}

function objectiveSynthesis(
  value: unknown,
  path: string
): ObjectiveSynthesisVM | null {
  // Ausente (API anterior compatible) y `null` (run no completado) colapsan a
  // `null`. Nunca se fabrica una síntesis.
  const raw = optionalRecordOf(value, path);
  if (raw === null) return null;

  if (raw.schemaVersion !== 'objective_synthesis_v1') {
    invalid(
      `${path}.schemaVersion`,
      'objective_synthesis_v1',
      raw.schemaVersion
    );
  }

  const summary = record(raw.stateSummary, `${path}.stateSummary`);

  return {
    schemaVersion: 'objective_synthesis_v1',
    reasoningRunReference: verbatimString(
      raw.reasoningRunReference,
      `${path}.reasoningRunReference`
    ),
    objectiveReference: verbatimString(
      raw.objectiveReference,
      `${path}.objectiveReference`
    ),
    stateSummary: {
      supportedCount: nonNegativeIntegerValue(
        summary.supportedCount,
        `${path}.stateSummary.supportedCount`
      ),
      partiallySupportedCount: nonNegativeIntegerValue(
        summary.partiallySupportedCount,
        `${path}.stateSummary.partiallySupportedCount`
      ),
      insufficientEvidenceCount: nonNegativeIntegerValue(
        summary.insufficientEvidenceCount,
        `${path}.stateSummary.insufficientEvidenceCount`
      ),
      abstainCount: nonNegativeIntegerValue(
        summary.abstainCount,
        `${path}.stateSummary.abstainCount`
      ),
      notAssessableCount: nonNegativeIntegerValue(
        summary.notAssessableCount,
        `${path}.stateSummary.notAssessableCount`
      )
    },
    requirements: array(raw.requirements, `${path}.requirements`).map(
      (item, index) => {
        const itemPath = `${path}.requirements[${index}]`;
        const requirement = record(item, itemPath);

        return {
          requirementId: verbatimString(
            requirement.requirementId,
            `${itemPath}.requirementId`
          ),
          order: nonNegativeIntegerValue(requirement.order, `${itemPath}.order`),
          requirementText: verbatimString(
            requirement.requirementText,
            `${itemPath}.requirementText`
          ),
          finalState: enumValueOf<RequirementFinalState>(
            requirement.finalState,
            REQUIREMENT_FINAL_STATES,
            `${itemPath}.finalState`
          )
        };
      }
    ),
    positiveConclusions: array(
      raw.positiveConclusions,
      `${path}.positiveConclusions`
    ).map((item, index) => {
      const itemPath = `${path}.positiveConclusions[${index}]`;
      const conclusion = record(item, itemPath);

      return {
        requirementId: verbatimString(
          conclusion.requirementId,
          `${itemPath}.requirementId`
        ),
        requirementText: verbatimString(
          conclusion.requirementText,
          `${itemPath}.requirementText`
        ),
        finalState: positiveFinalState(
          conclusion.finalState,
          `${itemPath}.finalState`
        ),
        supportedWeakerClaim: nullableVerbatimString(
          conclusion.supportedWeakerClaim,
          `${itemPath}.supportedWeakerClaim`
        ),
        supportingCredentialReferences: stringArrayOf(
          conclusion.supportingCredentialReferences,
          `${itemPath}.supportingCredentialReferences`
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
// Entradas públicas
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
      objectiveTitle: verbatimString(
        raw.objectiveTitle,
        `${path}.objectiveTitle`
      ),
      status: enumValueOf<ReasoningRunStatus>(
        raw.status,
        REASONING_RUN_STATUSES,
        `${path}.status`
      ),
      requirementCount: nonNegativeIntegerValue(
        raw.requirementCount,
        `${path}.requirementCount`
      ),
      failureCategory: failureCategory(
        raw.failureCategory,
        `${path}.failureCategory`
      ),
      createdAt,
      createdAtLabel: isoDateLabel(createdAt, `${path}.createdAt`)
    };
  });
}

export function adaptReasoningRunDetail(
  payload: unknown
): ReasoningRunDetailVM {
  const raw = record(payload, 'reasoningRun');
  const status = enumValueOf<ReasoningRunStatus>(
    raw.status,
    REASONING_RUN_STATUSES,
    'reasoningRun.status'
  );
  const objective = record(raw.objective, 'reasoningRun.objective');

  // El resultado llega SÓLO cuando el run completó. En cualquier otro estado es
  // `null`, y forzarlo a un array vacío haría indistinguible "todavía no hay
  // análisis" de "el análisis no encontró nada".
  const rawResult = optionalRecordOf(raw.result, 'reasoningRun.result');
  const requirementResults =
    rawResult === null
      ? null
      : array(
          rawResult.requirementResults,
          'reasoningRun.result.requirementResults'
        ).map((value, index) =>
          requirementResult(
            value,
            `reasoningRun.result.requirementResults[${index}]`
          )
        );

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
    objectiveTitle: verbatimString(
      objective.title,
      'reasoningRun.objective.title'
    ),
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
    synthesis: objectiveSynthesis(raw.synthesis, 'reasoningRun.synthesis')
  };
}

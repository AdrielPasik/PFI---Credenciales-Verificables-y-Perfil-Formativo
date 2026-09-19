/**
 * Adapters del analisis contextual publico.
 *
 * FALLAN CERRADO. Cualquier campo ausente, de otro tipo o con un token fuera del
 * enum levanta `IncompatiblePayloadError`: no hay `as`, no hay defaults
 * silenciosos y no hay "si no vino, asumimos". Un resultado epistemico
 * degradado en silencio afirmaria menos -- o mas -- respaldo del que el analisis
 * produjo.
 *
 * NO SE DERIVA NADA. El estado final de cada requisito, la sintesis, el claim
 * mas debil y las credenciales de respaldo se COPIAN del contrato publico. Lo
 * unico que se agrega son etiquetas de producto (labels de enum y fechas), que
 * son presentacion, no juicio.
 *
 * El texto del objetivo del verificador se copia VERBATIM, igual que en el
 * intake del holder.
 */

import { IncompatiblePayloadError } from '@/lib/errors/api-error';
import { adaptObjectiveProposal } from '@/lib/adapters/objectives.adapter';
import { credentialTypeLabels, type CredentialType } from '@/models/credentials';
import {
  OBJECTIVE_TYPES,
  OBJECTIVE_TYPE_LABELS,
  type ObjectiveTypeToken
} from '@/models/objectives';
import {
  PUBLIC_ANALYSIS_STATES,
  PUBLIC_FAILURE_CATEGORIES,
  PUBLIC_FINAL_STATES,
  PUBLIC_FINAL_STATE_LABELS,
  PUBLIC_SOURCE_KINDS,
  PUBLIC_SOURCE_KIND_LABELS,
  VERIFICATION_REQUEST_STATUSES,
  type CreatedPublicVerificationSessionVM,
  type PublicAnalysisObjectiveVM,
  type PublicAnalysisResultVM,
  type PublicAnalysisStateToken,
  type PublicAnalysisSynthesisVM,
  type PublicFailureCategoryToken,
  type PublicFinalStateToken,
  type PublicRequirementResultVM,
  type PublicSupportingCredentialVM,
  type PublicVerificationSessionVM,
  type VerificationRequestStatusToken
} from '@/models/public-analysis';

/**
 * Copy del aviso temporal. El backend manda un token
 * (`FINAL_STATE_IS_HISTORICAL_...`) y ese token NUNCA se muestra.
 */
export const TEMPORAL_NOTICE_COPY =
  'El análisis refleja la evidencia disponible al momento de su ejecución. El estado que se muestra de cada credencial corresponde a su estado actual.';

const TEMPORAL_NOTICE_TOKEN = 'FINAL_STATE_IS_HISTORICAL_CREDENTIAL_STATUS_IS_CURRENT';
const CREDENTIAL_STATUSES = ['issued', 'revoked'] as const;
const CREDENTIAL_STATUS_LABELS: Record<(typeof CREDENTIAL_STATUSES)[number], string> = {
  issued: 'Vigente',
  revoked: 'Revocada'
};

// ---------------------------------------------------------------------------
// Primitivas
// ---------------------------------------------------------------------------

function categoryOf(value: unknown) {
  if (value === undefined) return 'missing' as const;
  if (value === null) return 'null' as const;
  if (Array.isArray(value)) return 'array' as const;
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return type;
  return 'object' as const;
}

function invalid(path: string, expected: string, value: unknown): never {
  throw new IncompatiblePayloadError('La respuesta del servicio no es compatible.', {
    path,
    expected,
    actualCategory: categoryOf(value)
  });
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path, 'object', value);
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(path, 'array', value);
  return value;
}

/** Sin trim ni normalizacion: el texto del verificador es autoridad literal. */
function verbatimString(value: unknown, path: string): string {
  if (typeof value !== 'string') invalid(path, 'string', value);
  return value;
}

function presentString(value: unknown, path: string): string {
  const text = verbatimString(value, path);
  if (text.trim().length === 0) invalid(path, 'non-empty string', value);
  return text;
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  return presentString(value, path);
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path, 'boolean', value);
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    invalid(path, 'non-negative integer', value);
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  const parsed = nonNegativeInteger(value, path);
  if (parsed === 0) invalid(path, 'positive integer', value);
  return parsed;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    invalid(path, allowed.join(' | '), value);
  }
  return value as T;
}

function dateLabel(value: unknown, path: string): string {
  const raw = presentString(value, path);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) invalid(path, 'ISO date', value);
  return parsed.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function nullableDateLabel(value: unknown, path: string): string | null {
  return value === null || value === undefined ? null : dateLabel(value, path);
}

// ---------------------------------------------------------------------------
// Sesion
// ---------------------------------------------------------------------------

export function adaptPublicVerificationSession(payload: unknown): PublicVerificationSessionVM {
  const value = record(payload, 'session');
  const status = enumValue<VerificationRequestStatusToken>(
    value.status,
    VERIFICATION_REQUEST_STATUSES,
    'session.status'
  );
  const objectiveType = enumValue<ObjectiveTypeToken>(
    value.objectiveType,
    OBJECTIVE_TYPES,
    'session.objectiveType'
  );

  return {
    status,
    objectiveType,
    objectiveTypeLabel: OBJECTIVE_TYPE_LABELS[objectiveType],
    rawObjectiveText: verbatimString(value.rawObjectiveText, 'session.rawObjectiveText'),
    objectiveTitle: nullableString(value.objectiveTitle, 'session.objectiveTitle'),
    // Misma propuesta que el holder: el backend guarda el DTO verificado, no la
    // respuesta cruda del proveedor.
    proposal: value.proposal === null || value.proposal === undefined
      ? null
      : adaptObjectiveProposal(value.proposal),
    proposalInProgress: booleanValue(value.proposalInProgress, 'session.proposalInProgress'),
    confirmedRequirements: confirmedRequirements(value.confirmedObjectiveDefinition),
    expiresAtLabel: nullableDateLabel(value.expiresAt, 'session.expiresAt')
  };
}

/**
 * Del `objective_definition_v1` confirmado solo se lee el TEXTO de cada
 * requisito, en orden. `requirementId`, procedencia, citas y version de schema
 * no se copian: no existe campo de vista para ellos.
 */
function confirmedRequirements(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  const definition = record(value, 'session.confirmedObjectiveDefinition');
  return array(definition.requirements, 'session.confirmedObjectiveDefinition.requirements')
    .map((entry, index) => {
      const path = `session.confirmedObjectiveDefinition.requirements[${index}]`;
      const requirement = record(entry, path);
      return {
        order: positiveInteger(requirement.order, `${path}.order`),
        requirementText: presentString(requirement.requirementText, `${path}.requirementText`)
      };
    })
    .sort((left, right) => left.order - right.order)
    .map((requirement) => requirement.requirementText);
}

export function adaptCreatedPublicVerificationSession(
  payload: unknown
): CreatedPublicVerificationSessionVM {
  const value = record(payload, 'createdSession');
  return {
    requestToken: presentString(value.requestToken, 'createdSession.requestToken'),
    session: adaptPublicVerificationSession(value.session)
  };
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

export function adaptPublicAnalysisResult(payload: unknown): PublicAnalysisResultVM {
  const value = record(payload, 'analysis');
  const state = enumValue<PublicAnalysisStateToken>(
    value.state,
    PUBLIC_ANALYSIS_STATES,
    'analysis.state'
  );

  const result = value.result === null || value.result === undefined
    ? null
    : adaptResultBody(value.result);

  // Coherencia del contrato: un COMPLETED sin resultado -- o un resultado sin
  // COMPLETED -- no se renderiza a medias.
  if ((state === 'COMPLETED') !== (result !== null)) {
    invalid('analysis.result', `${state === 'COMPLETED' ? 'object' : 'null'}`, value.result);
  }

  return {
    state,
    objective: value.objective === null || value.objective === undefined
      ? null
      : adaptObjective(value.objective),
    completedAtLabel: nullableDateLabel(value.completedAt, 'analysis.completedAt'),
    failure: value.failure === null || value.failure === undefined
      ? null
      : adaptFailure(value.failure),
    result
  };
}

function adaptObjective(payload: unknown): PublicAnalysisObjectiveVM {
  const value = record(payload, 'analysis.objective');
  const objectiveType = enumValue<ObjectiveTypeToken>(
    value.objectiveType,
    OBJECTIVE_TYPES,
    'analysis.objective.objectiveType'
  );
  return {
    objectiveType,
    objectiveTypeLabel: OBJECTIVE_TYPE_LABELS[objectiveType],
    title: nullableString(value.title, 'analysis.objective.title'),
    objectiveContext: verbatimString(value.objectiveContext, 'analysis.objective.objectiveContext'),
    requirements: array(value.requirements, 'analysis.objective.requirements').map((entry, index) => {
      const path = `analysis.objective.requirements[${index}]`;
      const requirement = record(entry, path);
      return {
        order: positiveInteger(requirement.order, `${path}.order`),
        requirementText: presentString(requirement.requirementText, `${path}.requirementText`)
      };
    })
  };
}

function adaptFailure(payload: unknown): { category: PublicFailureCategoryToken; retryable: boolean } {
  const value = record(payload, 'analysis.failure');
  return {
    category: enumValue<PublicFailureCategoryToken>(
      value.category,
      PUBLIC_FAILURE_CATEGORIES,
      'analysis.failure.category'
    ),
    retryable: booleanValue(value.retryable, 'analysis.failure.retryable')
  };
}

function adaptResultBody(payload: unknown): NonNullable<PublicAnalysisResultVM['result']> {
  const value = record(payload, 'analysis.result');

  if (value.temporalNotice !== TEMPORAL_NOTICE_TOKEN) {
    // La semantica temporal es parte del contrato. Si cambia, la copy que
    // mostramos dejaria de ser cierta.
    invalid('analysis.result.temporalNotice', TEMPORAL_NOTICE_TOKEN, value.temporalNotice);
  }

  return {
    requirements: array(value.requirements, 'analysis.result.requirements').map(
      (entry, index) => adaptRequirementResult(entry, `analysis.result.requirements[${index}]`)
    ),
    synthesis: adaptSynthesis(value.synthesis),
    temporalNotice: TEMPORAL_NOTICE_COPY
  };
}

function adaptRequirementResult(payload: unknown, path: string): PublicRequirementResultVM {
  const value = record(payload, path);
  const finalState = enumValue<PublicFinalStateToken>(
    value.finalState,
    PUBLIC_FINAL_STATES,
    `${path}.finalState`
  );
  const supporting = array(
    record(value.evidence, `${path}.evidence`).supporting,
    `${path}.evidence.supporting`
  ).map((entry, index) => adaptSupportingCredential(entry, `${path}.evidence.supporting[${index}]`));

  // El backend ya garantiza esto; se verifica igual porque mostrar respaldo bajo
  // un estado no positivo seria la afirmacion mas grave que esta pantalla puede
  // hacer.
  const positive = finalState === 'SUPPORTED' || finalState === 'PARTIALLY_SUPPORTED';
  if (!positive && supporting.length > 0) {
    invalid(`${path}.evidence.supporting`, 'empty array', value);
  }

  return {
    order: positiveInteger(value.order, `${path}.order`),
    requirementText: presentString(value.requirementText, `${path}.requirementText`),
    finalState,
    finalStateLabel: PUBLIC_FINAL_STATE_LABELS[finalState],
    supportedWeakerClaim: nullableString(value.supportedWeakerClaim, `${path}.supportedWeakerClaim`),
    supportingCredentials: supporting
  };
}

function adaptSupportingCredential(payload: unknown, path: string): PublicSupportingCredentialVM {
  const value = record(payload, path);
  const currentStatus = enumValue(value.currentStatus, CREDENTIAL_STATUSES, `${path}.currentStatus`);
  return {
    credentialReference: presentString(value.credentialReference, `${path}.credentialReference`),
    title: presentString(value.title, `${path}.title`),
    credentialTypeLabel: credentialTypeLabel(value.credentialType, `${path}.credentialType`),
    issuerName: presentString(value.issuerName, `${path}.issuerName`),
    currentStatus,
    currentStatusLabel: CREDENTIAL_STATUS_LABELS[currentStatus],
    sourceKindLabels: array(value.sourceKinds, `${path}.sourceKinds`).map((entry, index) =>
      PUBLIC_SOURCE_KIND_LABELS[
        enumValue(entry, PUBLIC_SOURCE_KINDS, `${path}.sourceKinds[${index}]`)
      ]
    ),
    supportingUnitCount: positiveInteger(value.supportingUnitCount, `${path}.supportingUnitCount`)
  };
}

function credentialTypeLabel(value: unknown, path: string): string {
  const types = Object.keys(credentialTypeLabels) as CredentialType[];
  return credentialTypeLabels[enumValue<CredentialType>(value, types, path)];
}

function adaptSynthesis(payload: unknown): PublicAnalysisSynthesisVM {
  const value = record(payload, 'analysis.result.synthesis');
  const summary = record(value.stateSummary, 'analysis.result.synthesis.stateSummary');
  const counts: Array<[PublicFinalStateToken, string]> = [
    ['SUPPORTED', 'supportedCount'],
    ['PARTIALLY_SUPPORTED', 'partiallySupportedCount'],
    ['INSUFFICIENT_EVIDENCE', 'insufficientEvidenceCount'],
    ['NOT_ASSESSABLE', 'notAssessableCount'],
    ['ABSTAIN', 'abstainCount']
  ];

  const stateSummary = counts.map(([state, key]) => ({
    state,
    label: PUBLIC_FINAL_STATE_LABELS[state],
    count: nonNegativeInteger(summary[key], `analysis.result.synthesis.stateSummary.${key}`)
  }));

  return {
    stateSummary,
    totalRequirements: stateSummary.reduce((total, entry) => total + entry.count, 0),
    positiveConclusions: array(
      value.positiveConclusions,
      'analysis.result.synthesis.positiveConclusions'
    ).map((entry, index) => {
      const path = `analysis.result.synthesis.positiveConclusions[${index}]`;
      const conclusion = record(entry, path);
      const finalState = enumValue(
        conclusion.finalState,
        ['SUPPORTED', 'PARTIALLY_SUPPORTED'] as const,
        `${path}.finalState`
      );
      return {
        order: positiveInteger(conclusion.order, `${path}.order`),
        requirementText: presentString(conclusion.requirementText, `${path}.requirementText`),
        finalState,
        finalStateLabel: PUBLIC_FINAL_STATE_LABELS[finalState],
        supportedWeakerClaim: nullableString(
          conclusion.supportedWeakerClaim,
          `${path}.supportedWeakerClaim`
        ),
        supportingCredentialReferences: array(
          conclusion.supportingCredentialReferences,
          `${path}.supportingCredentialReferences`
        ).map((reference, position) =>
          presentString(reference, `${path}.supportingCredentialReferences[${position}]`)
        )
      };
    }),
    supportingCredentials: array(
      value.credentialsSupportingPositiveConclusions,
      'analysis.result.synthesis.credentialsSupportingPositiveConclusions'
    ).map((entry, index) => {
      const path = `analysis.result.synthesis.credentialsSupportingPositiveConclusions[${index}]`;
      const credential = record(entry, path);
      const currentStatus = enumValue(
        credential.currentStatus,
        CREDENTIAL_STATUSES,
        `${path}.currentStatus`
      );
      return {
        credentialReference: presentString(credential.credentialReference, `${path}.credentialReference`),
        title: presentString(credential.title, `${path}.title`),
        credentialTypeLabel: credentialTypeLabel(credential.credentialType, `${path}.credentialType`),
        issuerName: presentString(credential.issuerName, `${path}.issuerName`),
        currentStatus,
        currentStatusLabel: CREDENTIAL_STATUS_LABELS[currentStatus],
        supportedRequirementOrders: array(
          credential.supportedRequirementOrders,
          `${path}.supportedRequirementOrders`
        ).map((order, position) => positiveInteger(order, `${path}.supportedRequirementOrders[${position}]`)),
        partiallySupportedRequirementOrders: array(
          credential.partiallySupportedRequirementOrders,
          `${path}.partiallySupportedRequirementOrders`
        ).map((order, position) =>
          positiveInteger(order, `${path}.partiallySupportedRequirementOrders[${position}]`)
        )
      };
    })
  };
}

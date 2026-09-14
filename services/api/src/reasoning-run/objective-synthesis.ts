/**
 * Read model determinista de síntesis de Objective — P2.4C.
 *
 * F3 decide. Este módulo sólo organiza datos que ya cruzaron la frontera
 * Holder-safe: no recibe artifacts, IDs internos ni dependencias de infraestructura.
 */

import {
  type ObjectiveSynthesisFinalState,
  type ObjectiveSynthesisV1ResponseDto,
  type ReasoningRunObjectiveSnapshotResponseDto,
  type ReasoningRunResultResponseDto
} from './dto/reasoning-run.dto';

const FINAL_STATES = [
  'SUPPORTED',
  'PARTIALLY_SUPPORTED',
  'INSUFFICIENT_EVIDENCE',
  'ABSTAIN',
  'NOT_ASSESSABLE'
] as const;

type FinalState = ObjectiveSynthesisFinalState;
type PositiveFinalState = Extract<FinalState, 'SUPPORTED' | 'PARTIALLY_SUPPORTED'>;

export class ObjectiveSynthesisInvariantError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = 'ObjectiveSynthesisInvariantError';
  }
}

export interface VerifiedObjectiveSynthesisView {
  readonly reasoningRunReference: string;
  readonly objective: ReasoningRunObjectiveSnapshotResponseDto;
  /** Resultado safe ya validado; el builder no consulta ni verifica artifacts. */
  readonly result: ReasoningRunResultResponseDto;
}

function fail(code: string): never {
  throw new ObjectiveSynthesisInvariantError(code);
}

function finalStateOf(value: string): FinalState {
  if (!(FINAL_STATES as readonly string[]).includes(value)) {
    return fail('FINAL_STATE_UNSUPPORTED');
  }
  return value as FinalState;
}

function nonEmptyWeakerClaim(value: string | null): string {
  if (value === null || value.trim().length === 0) {
    return fail('PARTIAL_WEAKER_CLAIM_REQUIRED');
  }
  return value;
}

interface CredentialAggregate {
  readonly credentialReference: string;
  readonly credentialDisplay: {
    title: string;
    credentialType: string;
    issuerName: string;
    currentStatus: string;
  };
  readonly supportedRequirementIds: string[];
  readonly partiallySupportedRequirementIds: string[];
}

/**
 * Construye `objective_synthesis_v1` a partir de la respuesta privada ya segura.
 * Los únicos vínculos Credential ↔ Requirement salen de `evidence[].credential`.
 */
export function buildObjectiveSynthesisV1(
  view: VerifiedObjectiveSynthesisView
): ObjectiveSynthesisV1ResponseDto {
  const requirementById = new Map<string, (typeof view.objective.requirements)[number]>();
  for (const requirement of view.objective.requirements) {
    if (requirementById.has(requirement.requirementId)) {
      fail('DUPLICATE_FROZEN_REQUIREMENT_ID');
    }
    requirementById.set(requirement.requirementId, requirement);
  }

  const resultByRequirementId = new Map<
    string,
    (typeof view.result.requirementResults)[number]
  >();
  for (const result of view.result.requirementResults) {
    if (resultByRequirementId.has(result.requirementId)) {
      fail('DUPLICATE_RESULT_REQUIREMENT_ID');
    }
    if (!requirementById.has(result.requirementId)) {
      fail('RESULT_REQUIREMENT_NOT_IN_FROZEN_OBJECTIVE');
    }
    resultByRequirementId.set(result.requirementId, result);
  }

  if (resultByRequirementId.size !== requirementById.size) {
    fail('COMPLETED_RESULT_REQUIREMENT_SET_INCOMPLETE');
  }

  const counts = {
    supportedCount: 0,
    partiallySupportedCount: 0,
    insufficientEvidenceCount: 0,
    abstainCount: 0,
    notAssessableCount: 0
  };
  const positiveConclusions: ObjectiveSynthesisV1ResponseDto['positiveConclusions'] = [];
  const credentialsByReference = new Map<string, CredentialAggregate>();

  const requirements = view.objective.requirements.map((requirement) => {
    const result = resultByRequirementId.get(requirement.requirementId);
    if (result === undefined) fail('COMPLETED_RESULT_REQUIREMENT_MISSING');

    const finalState = finalStateOf(result.finalState);
    switch (finalState) {
      case 'SUPPORTED':
        counts.supportedCount += 1;
        break;
      case 'PARTIALLY_SUPPORTED':
        counts.partiallySupportedCount += 1;
        break;
      case 'INSUFFICIENT_EVIDENCE':
        counts.insufficientEvidenceCount += 1;
        break;
      case 'ABSTAIN':
        counts.abstainCount += 1;
        break;
      case 'NOT_ASSESSABLE':
        counts.notAssessableCount += 1;
        break;
    }

    if (finalState === 'SUPPORTED' || finalState === 'PARTIALLY_SUPPORTED') {
      if (finalState === 'SUPPORTED' && result.supportedWeakerClaim !== null) {
        fail('SUPPORTED_MUST_NOT_HAVE_WEAKER_CLAIM');
      }

      const credentialReferences: string[] = [];
      const credentialReferencesSeen = new Set<string>();
      for (const evidence of result.evidence) {
        const credential = evidence.credential;
        if (credential === null || credentialReferencesSeen.has(credential.credentialReference)) {
          continue;
        }

        credentialReferencesSeen.add(credential.credentialReference);
        credentialReferences.push(credential.credentialReference);

        let aggregate = credentialsByReference.get(credential.credentialReference);
        if (aggregate === undefined) {
          aggregate = {
            credentialReference: credential.credentialReference,
            credentialDisplay: {
              title: credential.title,
              credentialType: credential.credentialType,
              issuerName: credential.issuerName,
              currentStatus: credential.currentStatus
            },
            supportedRequirementIds: [],
            partiallySupportedRequirementIds: []
          };
          credentialsByReference.set(credential.credentialReference, aggregate);
        }

        const targetIds =
          finalState === 'SUPPORTED'
            ? aggregate.supportedRequirementIds
            : aggregate.partiallySupportedRequirementIds;
        targetIds.push(requirement.requirementId);
      }

      const positiveState: PositiveFinalState = finalState;
      positiveConclusions.push({
        requirementId: requirement.requirementId,
        requirementText: requirement.requirementText,
        finalState: positiveState,
        supportedWeakerClaim:
          positiveState === 'PARTIALLY_SUPPORTED'
            ? nonEmptyWeakerClaim(result.supportedWeakerClaim)
            : null,
        supportingCredentialReferences: credentialReferences
      });
    }

    return {
      requirementId: requirement.requirementId,
      order: requirement.order,
      requirementText: requirement.requirementText,
      finalState
    };
  });

  const total =
    counts.supportedCount +
    counts.partiallySupportedCount +
    counts.insufficientEvidenceCount +
    counts.abstainCount +
    counts.notAssessableCount;
  if (total !== view.objective.requirements.length) {
    fail('STATE_SUMMARY_COUNT_MISMATCH');
  }

  return {
    schemaVersion: 'objective_synthesis_v1',
    reasoningRunReference: view.reasoningRunReference,
    objectiveReference: view.objective.objectiveReference,
    stateSummary: counts,
    requirements,
    positiveConclusions,
    // Map conserva el primer vínculo positivo observado: orden de Requirement y
    // luego orden de evidencia, sin ranking por frecuencia ni por título.
    credentialsSupportingPositiveConclusions: [...credentialsByReference.values()]
  };
}

import { adaptSemanticApprovalSnapshotSummary } from '@/lib/adapters/course-templates.adapter';
import { formatReusableInterpretationDate } from '@/lib/formatters/reusable-semantic-interpretation';
import { IncompatiblePayloadError } from '@/lib/errors/api-error';
import type {
  ApplyReusableSemanticInterpretationResultVM,
  AppliedReusableSemanticInterpretationVM,
  ApprovalDriftStatus,
  ComparableCredentialField,
  DestinationCompatibilityStatus,
  ReusableSemanticInterpretationCandidateVM,
  TemplateContentDriftStatus
} from '@/models/credentials';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new IncompatiblePayloadError();
  }

  return value as Record<string, unknown>;
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new IncompatiblePayloadError();
  }

  return value.trim();
}

function isoDateTime(value: unknown): string {
  const dateTime = requiredString(value);

  if (Number.isNaN(Date.parse(dateTime))) {
    throw new IncompatiblePayloadError();
  }

  return dateTime;
}

function approvalDriftStatus(value: unknown): ApprovalDriftStatus {
  if (
    value === 'none_applied' ||
    value === 'up_to_date' ||
    value === 'different_approval_available'
  ) {
    return value;
  }

  throw new IncompatiblePayloadError();
}

function templateContentDriftStatus(value: unknown): TemplateContentDriftStatus {
  if (
    value === 'matches_approved_source' ||
    value === 'differs_from_approved_source' ||
    value === 'unknown'
  ) {
    return value;
  }

  throw new IncompatiblePayloadError();
}

function destinationCompatibilityStatus(
  value: unknown
): DestinationCompatibilityStatus {
  if (value === 'compatible' || value === 'modified' || value === 'unknown') {
    return value;
  }

  throw new IncompatiblePayloadError();
}

const allowlistedChangedFields: readonly ComparableCredentialField[] = [
  'title',
  'description',
  'competencies',
  'learningOutcomes',
  'skills',
  'hours'
];

function changedFields(value: unknown): ComparableCredentialField[] {
  if (!Array.isArray(value)) {
    throw new IncompatiblePayloadError();
  }

  return value.map((entry) => {
    if (
      typeof entry !== 'string' ||
      !(allowlistedChangedFields as readonly string[]).includes(entry)
    ) {
      throw new IncompatiblePayloadError();
    }

    return entry as ComparableCredentialField;
  });
}

// Resumen allowlisted de una aplicacion (currentApplication de candidate,
// application de apply, o el GET de solo lectura) -- forma identica en los
// tres casos. Nunca lee sourceCredentialId/sourceSemanticAnalysisId/
// appliedByUserId crudo: el backend ya no los expone.
export function adaptAppliedReusableSemanticInterpretation(
  value: unknown
): AppliedReusableSemanticInterpretationVM {
  const applied = asRecord(value);
  const appliedAt = isoDateTime(applied.appliedAt);

  return {
    templateReference: requiredString(applied.templateId),
    templateTitle: requiredString(applied.templateTitle),
    snapshotSummary: adaptSemanticApprovalSnapshotSummary(applied.snapshotSummary),
    appliedAt,
    appliedAtLabel: formatReusableInterpretationDate(appliedAt),
    appliedByDisplayLabel: requiredString(applied.appliedByDisplayLabel),
    approvalDriftStatus: approvalDriftStatus(applied.approvalDriftStatus),
    templateContentStatus: templateContentDriftStatus(applied.templateContentStatus),
    destinationCompatibility: destinationCompatibilityStatus(
      applied.destinationCompatibility
    ),
    changedFields: changedFields(applied.changedFields)
  };
}

// GET .../reusable-semantic-interpretation devuelve 200 + null cuando no
// hay aplicacion active -- nunca 404 por esto (ver api-contracts-v0.md).
export function adaptReusableSemanticInterpretationRead(
  payload: unknown
): AppliedReusableSemanticInterpretationVM | null {
  if (payload === null) {
    return null;
  }

  return adaptAppliedReusableSemanticInterpretation(payload);
}

// GET .../candidate?templateId=... -- las senales top-level comparan
// siempre contra la fuente ACTUAL del template; currentApplication (si
// existe) describe la aplicacion previa, con su propia fuente CONGELADA
// (ver C4b.1b-R). approvalRevision es una precondicion opaca para apply --
// se guarda tal cual, nunca se interpreta ni se muestra.
export function adaptReusableSemanticInterpretationCandidate(
  payload: unknown
): ReusableSemanticInterpretationCandidateVM {
  const candidate = asRecord(payload);
  const approvedAt = isoDateTime(candidate.approvedAt);

  return {
    templateReference: requiredString(candidate.templateId),
    templateTitle: requiredString(candidate.templateTitle),
    snapshotSummary: adaptSemanticApprovalSnapshotSummary(candidate.snapshotSummary),
    approvedAt,
    approvedAtLabel: formatReusableInterpretationDate(approvedAt),
    approvedByDisplayLabel: requiredString(candidate.approvedByDisplayLabel),
    approvalRevision: requiredString(candidate.approvalRevision),
    approvalDriftStatus: approvalDriftStatus(candidate.approvalDriftStatus),
    templateContentStatus: templateContentDriftStatus(candidate.templateContentStatus),
    destinationCompatibility: destinationCompatibilityStatus(
      candidate.destinationCompatibility
    ),
    changedFields: changedFields(candidate.changedFields),
    currentApplication:
      candidate.currentApplication === null
        ? null
        : adaptAppliedReusableSemanticInterpretation(candidate.currentApplication)
  };
}

// POST .../apply -- responde siempre 200 (nunca 201), el resultado se
// comunica por changed/supersededPreviousApplication en el body (ver
// api-contracts-v0.md, desviacion documentada de diseno).
export function adaptApplyReusableSemanticInterpretationResult(
  payload: unknown
): ApplyReusableSemanticInterpretationResultVM {
  const result = asRecord(payload);

  return {
    changed:
      typeof result.changed === 'boolean'
        ? result.changed
        : throwIncompatible(),
    supersededPreviousApplication:
      typeof result.supersededPreviousApplication === 'boolean'
        ? result.supersededPreviousApplication
        : throwIncompatible(),
    application: adaptAppliedReusableSemanticInterpretation(result.application)
  };
}

function throwIncompatible(): never {
  throw new IncompatiblePayloadError();
}

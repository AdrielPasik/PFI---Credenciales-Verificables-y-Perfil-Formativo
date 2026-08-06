import {
  formatAnalysisConfidence,
  formatAnalysisDate,
  formatAnalysisInputMode,
  formatAnalysisRunStatus,
  formatAnalysisSource,
  formatQualityFlag
} from '@/lib/formatters/analysis-runs';
import { IncompatiblePayloadError } from '@/lib/errors/api-error';
import type {
  AnalysisRunInputMode,
  AnalysisRunSourceType,
  AnalysisRunStatus,
  AnalysisRunSemanticSummaryVM,
  AnalysisRunTrigger,
  DocumentAnalysisTriggerResultVM,
  IssuerAnalysisRunVM,
  SemanticAnalysisStatus
} from '@/models/analysis-runs';

const runStatuses = [
  'pending',
  'running',
  'completed',
  'failed',
  'canceled'
] as const;
const inputModes = ['document', 'text', 'combined'] as const;
const triggers = ['manual', 'system'] as const;
const sourceTypes = ['document_evidence', 'text_evidence'] as const;
const semanticStatuses = ['completed', 'partial'] as const;
const qualityFlagMaxLength = 80;
const controlCharacters = /[\u0000-\u001f\u007f]/;

export function adaptLatestIssuerAnalysisRunResponse(
  payload: unknown
): IssuerAnalysisRunVM | null {
  return payload === null ? null : adaptIssuerAnalysisRunResponse(payload);
}

export function adaptIssuerAnalysisRunResponse(
  payload: unknown
): IssuerAnalysisRunVM {
  const record = requiredRecord(payload);
  const status = enumValue(record.status, runStatuses);
  const inputMode = enumValue(record.inputMode, inputModes);
  const trigger = enumValue(record.trigger, triggers);
  const sourceCount = nonNegativeInteger(record.sourceCount);
  const mappedSourceTypes = enumArray(record.sourceTypes, sourceTypes);
  const errorCode = nullableString(record.errorCode);
  const errorMessage = nullableString(record.errorMessage);

  if (sourceCount !== mappedSourceTypes.length) {
    invalidPayload();
  }

  if (status === 'failed') {
    if (
      !safeFailureText(errorCode, 80) ||
      !safeFailureText(errorMessage, 300)
    ) {
      invalidPayload();
    }
  } else if (errorCode !== null || errorMessage !== null) {
    invalidPayload();
  }

  const createdAt = isoDate(record.createdAt);
  const startedAt = nullableIsoDate(record.startedAt);
  const completedAt = nullableIsoDate(record.completedAt);
  const failedAt = nullableIsoDate(record.failedAt);

  return {
    analysisRunReference: nonEmptyString(record.analysisRunId),
    credentialReference: nonEmptyString(record.credentialId),
    status,
    statusLabel: formatAnalysisRunStatus(status),
    inputMode,
    inputModeLabel: formatAnalysisInputMode(inputMode),
    trigger,
    requestedPipelineVersion: nonEmptyString(
      record.requestedPipelineVersion
    ),
    requestedTaxonomyVersion: nonEmptyString(
      record.requestedTaxonomyVersion
    ),
    sourceCount,
    sourceTypes: mappedSourceTypes,
    sourceLabels: mappedSourceTypes.map(formatAnalysisSource),
    createdAt,
    createdAtLabel: formatAnalysisDate(createdAt),
    startedAt,
    startedAtLabel: startedAt ? formatAnalysisDate(startedAt) : null,
    completedAt,
    completedAtLabel: completedAt ? formatAnalysisDate(completedAt) : null,
    failedAt,
    failedAtLabel: failedAt ? formatAnalysisDate(failedAt) : null,
    errorCode,
    errorMessage,
    semanticAnalysis:
      record.semanticAnalysis === null
        ? null
        : adaptSemanticSummary(record.semanticAnalysis)
  };
}

export function adaptDocumentAnalysisTriggerResponse(
  payload: unknown
): DocumentAnalysisTriggerResultVM {
  const record = requiredRecord(payload);
  const status = enumValue(record.status, ['completed'] as const);
  const artifactStatus = enumValue(
    record.artifactStatus,
    semanticStatuses
  );
  const sourceCount = positiveInteger(record.sourceCount);

  return {
    analysisRunReference: nonEmptyString(record.analysisRunId),
    credentialReference: nonEmptyString(record.credentialId),
    status,
    semanticAnalysisReference: nonEmptyString(record.semanticAnalysisId),
    artifactStatus,
    sourceCount,
    completedAt: isoDate(record.completedAt)
  };
}

function adaptSemanticSummary(payload: unknown): AnalysisRunSemanticSummaryVM {
  const record = requiredRecord(payload);
  const status = enumValue(record.status, semanticStatuses);
  const confidence = nullableConfidence(record.confidence);
  const qualityFlags = stringArray(record.qualityFlags).map((flag) => {
    if (
      flag.trim().length === 0 ||
      flag.length > qualityFlagMaxLength ||
      controlCharacters.test(flag)
    ) {
      invalidPayload();
    }

    return flag;
  });
  const analyzedAt = isoDate(record.analyzedAt);

  return {
    semanticAnalysisReference: nonEmptyString(record.semanticAnalysisId),
    status,
    pipelineVersion: nonEmptyString(record.pipelineVersion),
    taxonomyVersion: nonEmptyString(record.taxonomyVersion),
    confidence,
    confidenceLabel: formatAnalysisConfidence(confidence),
    areasCount: nonNegativeInteger(record.areasCount),
    skillsCount: nonNegativeInteger(record.skillsCount),
    conceptsCount: nonNegativeInteger(record.conceptsCount),
    qualityFlags: [...qualityFlags],
    qualityFlagLabels: qualityFlags.map(formatQualityFlag),
    analyzedAt,
    analyzedAtLabel: formatAnalysisDate(analyzedAt)
  };
}

function requiredRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidPayload();
  }

  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalidPayload();
  }

  return value as string;
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') invalidPayload();
  return value as string;
}

function safeFailureText(value: string | null, maxLength: number) {
  return Boolean(
    value &&
      value.trim().length > 0 &&
      value.length <= maxLength &&
      !controlCharacters.test(value)
  );
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    invalidPayload();
  }
  return value as number;
}

function positiveInteger(value: unknown): number {
  const result = nonNegativeInteger(value);
  if (result === 0) invalidPayload();
  return result;
}

function nullableConfidence(value: unknown): number | null {
  if (value === null) return null;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    invalidPayload();
  }
  return value as number;
}

function isoDate(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.includes('T') ||
    !Number.isFinite(Date.parse(value))
  ) {
    invalidPayload();
  }
  return value as string;
}

function nullableIsoDate(value: unknown): string | null {
  return value === null ? null : isoDate(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    invalidPayload();
  }
  return [...(value as string[])];
}

function enumArray<const T extends readonly string[]>(
  value: unknown,
  allowed: T
): T[number][] {
  if (!Array.isArray(value)) invalidPayload();
  return (value as unknown[]).map((item) => enumValue(item, allowed));
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T
): T[number] {
  if (
    typeof value !== 'string' ||
    !(allowed as readonly string[]).includes(value)
  ) {
    invalidPayload();
  }
  return value as T[number];
}

function invalidPayload(): never {
  throw new IncompatiblePayloadError(
    'La respuesta del análisis no cumple el contrato esperado.'
  );
}

export type {
  AnalysisRunInputMode,
  AnalysisRunSourceType,
  AnalysisRunStatus,
  AnalysisRunTrigger,
  SemanticAnalysisStatus
};

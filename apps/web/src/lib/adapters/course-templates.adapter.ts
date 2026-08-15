import { IncompatiblePayloadError } from '@/lib/errors/api-error';
import type {
  CourseTemplateSummaryVM,
  ReusableCredentialType,
  SemanticApprovalSnapshotSummaryVM,
  TemplateSemanticApprovalCandidateVM
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

function nullableString(value: unknown): string | null {
  if (value === null) {
    return null;
  }

  return requiredString(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new IncompatiblePayloadError();
  }

  return value.map((entry) => requiredString(entry));
}

function isoDateTime(value: unknown): string {
  const dateTime = requiredString(value);

  if (Number.isNaN(Date.parse(dateTime))) {
    throw new IncompatiblePayloadError();
  }

  return dateTime;
}

function reusableCredentialType(value: unknown): ReusableCredentialType {
  if (value === 'course' || value === 'certification') {
    return value;
  }

  throw new IncompatiblePayloadError();
}

function templateStatus(value: unknown): 'active' | 'archived' {
  if (value === 'active' || value === 'archived') {
    return value;
  }

  throw new IncompatiblePayloadError();
}

function semanticAnalysisStatus(value: unknown): 'completed' | 'partial' {
  if (value === 'completed' || value === 'partial') {
    return value;
  }

  throw new IncompatiblePayloadError();
}

function nonNegativeInteger(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    Math.floor(value) !== value
  ) {
    throw new IncompatiblePayloadError();
  }

  return value;
}

function requiredBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new IncompatiblePayloadError();
  }

  return value;
}

function nullableConfidence(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new IncompatiblePayloadError();
  }
  return value;
}

function semanticCandidateItems(value: unknown) {
  if (!Array.isArray(value)) throw new IncompatiblePayloadError();
  return value.map((entry) => {
    const item = asRecord(entry);
    return { label: requiredString(item.label), confidence: nullableConfidence(item.confidence) };
  });
}

// C4a.1/C4a.2: allowlist estricto -- solo counts y flags, nunca el
// snapshot/analysisJson completo. Cualquier forma incompatible (falta un
// campo, un tipo incorrecto) se rechaza con IncompatiblePayloadError en vez
// de mostrar datos a medias.
// Exportada (no solo local): C4b.2 reutiliza esta misma logica para el
// snapshotSummary de candidate/apply/read de reusable-semantic-interpretation
// -- es exactamente el mismo shape allowlisted, nunca se duplica.
export function adaptSemanticApprovalSnapshotSummary(
  value: unknown
): SemanticApprovalSnapshotSummaryVM {
  const record = asRecord(value);

  return {
    schema: requiredString(record.schema),
    status: semanticAnalysisStatus(record.status),
    areaCount: nonNegativeInteger(record.areaCount),
    skillCount: nonNegativeInteger(record.skillCount),
    conceptCount: nonNegativeInteger(record.conceptCount),
    hasHoursDistribution: requiredBoolean(record.hasHoursDistribution),
    warningCount: nonNegativeInteger(record.warningCount),
    qualityFlagCount: nonNegativeInteger(record.qualityFlagCount)
  };
}

function nullableSemanticApprovalSnapshotSummary(
  value: unknown
): SemanticApprovalSnapshotSummaryVM | null {
  if (value === null) {
    return null;
  }

  return adaptSemanticApprovalSnapshotSummary(value);
}

// C3b: adapta la respuesta de
// POST /issuers/:issuerId/course-templates/from-credential/:credentialId
// (y, por construccion, la misma forma que devuelve GET/POST/PATCH
// .../course-templates para C3c). issuerId y createdByUserId nunca se
// leen aca -- si el backend no los devuelve (no lo hace) nunca aparecen en
// el VM; si en el futuro los devolviera, este adapter los seguiria
// ignorando porque no forman parte del allowlist.
export function adaptCourseTemplateSummary(
  payload: unknown
): CourseTemplateSummaryVM {
  const template = asRecord(payload);

  return {
    reference: requiredString(template.id),
    credentialType: reusableCredentialType(template.credentialType),
    title: requiredString(template.title),
    description: nullableString(template.description),
    hours: nullableString(template.hours),
    modality: nullableString(template.modality),
    platformName: nullableString(template.platformName),
    externalUrl: nullableString(template.externalUrl),
    certificationCode: nullableString(template.certificationCode),
    expirationDate: nullableString(template.expirationDate),
    providerName: nullableString(template.providerName),
    level: nullableString(template.level),
    skills: stringArray(template.skills),
    competencies: stringArray(template.competencies),
    learningOutcomes: stringArray(template.learningOutcomes),
    status: templateStatus(template.status),
    createdFromCredentialId: nullableString(template.createdFromCredentialId),
    lastSemanticAnalysisId: nullableString(template.lastSemanticAnalysisId),
    approvedSemanticAnalysisId: nullableString(
      template.approvedSemanticAnalysisId
    ),
    approvedSemanticApprovedAt: nullableString(
      template.approvedSemanticApprovedAt
    ),
    approvedSemanticPipelineVersion: nullableString(
      template.approvedSemanticPipelineVersion
    ),
    approvedSemanticTaxonomyVersion: nullableString(
      template.approvedSemanticTaxonomyVersion
    ),
    approvedSemanticSourceCredentialId: nullableString(
      template.approvedSemanticSourceCredentialId
    ),
    approvedSemanticSnapshotSummary: nullableSemanticApprovalSnapshotSummary(
      template.approvedSemanticSnapshotSummary
    ),
    createdAt: isoDateTime(template.createdAt),
    updatedAt: isoDateTime(template.updatedAt)
  };
}

// C3c: GET /issuers/:issuerId/course-templates devuelve un array (no
// { items: [...] }); cada elemento pasa por el mismo allowlist que
// adaptCourseTemplateSummary.
export function adaptCourseTemplateSummaryList(
  payload: unknown
): CourseTemplateSummaryVM[] {
  if (!Array.isArray(payload)) {
    throw new IncompatiblePayloadError();
  }

  return payload.map(adaptCourseTemplateSummary);
}

// C4a.2: adapta la respuesta de
// GET .../course-templates/:templateId/approved-analysis/candidate/from-semantic-analysis/:semanticAnalysisId.
// Nunca lee/expone un snapshot completo -- solo el resumen allowlisted.
export function adaptTemplateSemanticApprovalCandidate(
  payload: unknown
): TemplateSemanticApprovalCandidateVM {
  const candidate = asRecord(payload);

  return {
    semanticAnalysisReference: requiredString(candidate.semanticAnalysisId),
    status: semanticAnalysisStatus(candidate.status),
    pipelineVersion: nullableString(candidate.pipelineVersion),
    taxonomyVersion: nullableString(candidate.taxonomyVersion),
    sourceCredentialReference: nullableString(candidate.sourceCredentialId),
    areas: semanticCandidateItems(candidate.areas),
    skills: semanticCandidateItems(candidate.skills),
    concepts: semanticCandidateItems(candidate.concepts),
    warnings: stringArray(candidate.warnings),
    qualityNotes: stringArray(candidate.qualityNotes),
    summary: adaptSemanticApprovalSnapshotSummary(candidate.summary)
  };
}

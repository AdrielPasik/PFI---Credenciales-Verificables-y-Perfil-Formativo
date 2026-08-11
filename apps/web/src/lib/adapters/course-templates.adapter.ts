import { IncompatiblePayloadError } from '@/lib/errors/api-error';
import type {
  CourseTemplateSummaryVM,
  ReusableCredentialType
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
    createdAt: isoDateTime(template.createdAt),
    updatedAt: isoDateTime(template.updatedAt)
  };
}

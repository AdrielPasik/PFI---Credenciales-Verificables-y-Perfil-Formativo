import type { AuthenticatedApiRequest } from '@/lib/api/api-client';
import { ApiError } from '@/lib/errors/api-error';
import type {
  AcademicProgramSearchCommand,
  CredentialDraftPatchFields,
  CreateCredentialDraftCommand,
  CurriculumAcademicSubjectSearchCommand,
  HolderResolutionCommand,
  UpdateIssuerCredentialDraftCommand
} from '@/models/credentials';

const credentialDraftPatchFields = [
  'achievementName',
  'description',
  'hours',
  'type',
  'completionDate',
  'academicPeriod',
  'programName',
  'grade',
  'providerName',
  'platformName',
  'modality',
  'level',
  'certificationCode',
  'expirationDate',
  'externalUrl',
  'skills',
  'competencies',
  'learningOutcomes'
] as const satisfies readonly (keyof CredentialDraftPatchFields)[];

const curriculumDerivedDraftFields = new Set<
  keyof CredentialDraftPatchFields
>(['achievementName', 'description', 'hours', 'programName']);

function resolveCurriculumReferences(
  command: UpdateIssuerCredentialDraftCommand
) {
  const academicCourseReference = command.academicCourseReference;
  const curriculumReference = command.curriculumReference;
  const hasAcademicCourseReference =
    academicCourseReference !== undefined;
  const hasCurriculumReference = curriculumReference !== undefined;

  if (hasAcademicCourseReference !== hasCurriculumReference) {
    throw new ApiError(
      'La selección curricular requiere una carrera y una asignatura válidas.',
      'http',
      400
    );
  }

  if (!hasAcademicCourseReference || !hasCurriculumReference) {
    return null;
  }

  if (
    typeof academicCourseReference !== 'string' ||
    typeof curriculumReference !== 'string' ||
    academicCourseReference.trim().length === 0 ||
    curriculumReference.trim().length === 0
  ) {
    throw new ApiError(
      'La selección curricular requiere una carrera y una asignatura válidas.',
      'http',
      400
    );
  }

  return {
    academicCourseReference: academicCourseReference.trim(),
    curriculumReference: curriculumReference.trim()
  };
}

function catalogSearchParams(query: string, limit?: number) {
  const params = new URLSearchParams({ query: query.trim() });

  if (limit !== undefined) {
    params.set('limit', String(limit));
  }

  return params.toString();
}

export function searchAcademicProgramsRequest(
  requestAuthenticated: AuthenticatedApiRequest,
  command: AcademicProgramSearchCommand
) {
  const query = catalogSearchParams(command.query, command.limit);

  return requestAuthenticated(
    `/issuers/${encodeURIComponent(command.issuerReference)}/catalog/academic-programs?${query}`,
    { signal: command.signal }
  );
}

export function searchCurriculumAcademicSubjectsRequest(
  requestAuthenticated: AuthenticatedApiRequest,
  command: CurriculumAcademicSubjectSearchCommand
) {
  const query = catalogSearchParams(command.query, command.limit);

  return requestAuthenticated(
    `/issuers/${encodeURIComponent(command.issuerReference)}/catalog/curriculum-versions/${encodeURIComponent(command.curriculumReference)}/academic-subjects?${query}`,
    { signal: command.signal }
  );
}

export function resolveHolderRequest(
  requestAuthenticated: AuthenticatedApiRequest,
  command: HolderResolutionCommand
) {
  return requestAuthenticated(
    `/issuers/${encodeURIComponent(command.issuerReference)}/holders/resolve`,
    {
      method: 'POST',
      body: {
        email: command.email
      }
    }
  );
}

export function createCredentialDraftRequest(
  requestAuthenticated: AuthenticatedApiRequest,
  command: CreateCredentialDraftCommand
) {
  return requestAuthenticated('/credentials/draft', {
    method: 'POST',
    body: {
      issuerId: command.issuerReference,
      subjectUserId: command.holderReference,
      type: command.credentialType,
      title: command.achievementName,
      sourceType: 'manual_issuer',
      credentialSubject: {
        achievement_name: command.achievementName,
        institution_name: command.institutionName
      }
    }
  });
}

export function getIssuerCredentialRequest(
  requestAuthenticated: AuthenticatedApiRequest,
  issuerReference: string,
  credentialReference: string
) {
  return requestAuthenticated(
    `/issuers/${encodeURIComponent(issuerReference)}/credentials/${encodeURIComponent(credentialReference)}`
  );
}

export function patchIssuerCredentialDraftRequest(
  requestAuthenticated: AuthenticatedApiRequest,
  command: UpdateIssuerCredentialDraftCommand
) {
  const curriculumReferences = resolveCurriculumReferences(command);
  const body: Record<string, unknown> = {
    expectedUpdatedAt: command.expectedUpdatedAt
  };

  if (curriculumReferences) {
    Object.assign(body, curriculumReferences);
  }

  for (const field of credentialDraftPatchFields) {
    if (
      curriculumReferences &&
      curriculumDerivedDraftFields.has(field)
    ) {
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(command, field)) {
      body[field] = command[field];
    }
  }

  return requestAuthenticated(
    `/issuers/${encodeURIComponent(command.issuerReference)}/credentials/${encodeURIComponent(command.credentialReference)}/draft`,
    {
      method: 'PATCH',
      body
    }
  );
}

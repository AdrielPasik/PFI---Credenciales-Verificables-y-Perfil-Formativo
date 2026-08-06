import type { AuthenticatedApiRequest } from '@/lib/api/api-client';
import { adaptIssuerCredentialDetail } from '@/lib/adapters/credentials.adapter';
import {
  ApiError,
  IncompatiblePayloadError
} from '@/lib/errors/api-error';
import { validateTextEvidenceDraft } from '@/features/credentials/text-evidence';
import type {
  AcademicProgramSearchCommand,
  CredentialDraftPatchFields,
  CreateAcademicSubjectCurricularDraftCommand,
  CreateCredentialDraftCommand,
  CreateManualCredentialDraftCommand,
  CurriculumAcademicSubjectSearchCommand,
  HolderResolutionCommand,
  IssueIssuerCredentialCommand,
  SubmitCredentialTextEvidenceCommand,
  UploadCredentialDocumentEvidenceCommand,
  UpdateIssuerCredentialDraftCommand
} from '@/models/credentials';

export async function issueIssuerCredentialRequest(
  requestAuthenticated: AuthenticatedApiRequest,
  command: IssueIssuerCredentialCommand
) {
  const issuerReference = command.issuerReference.trim();
  const credentialReference = command.credentialReference.trim();

  if (issuerReference.length === 0 || credentialReference.length === 0) {
    throw new ApiError(
      'La referencia institucional de la credencial no es válida.',
      'http',
      400
    );
  }

  const payload = await requestAuthenticated(
    `/issuers/${encodeURIComponent(issuerReference)}/credentials/${encodeURIComponent(credentialReference)}/issue`,
    { method: 'POST' }
  );
  const detail = adaptIssuerCredentialDetail(payload);

  if (detail.credentialReference !== credentialReference) {
    throw new IncompatiblePayloadError();
  }

  return detail;
}

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

const manualCredentialTypes = new Set(['course', 'certification', 'degree']);

function invalidCreateCommand(): never {
  throw new ApiError(
    'La informaciÃ³n para crear el borrador es invÃ¡lida.',
    'http',
    400
  );
}

export function createManualCredentialDraftRequest(
  requestAuthenticated: AuthenticatedApiRequest,
  command: CreateManualCredentialDraftCommand
) {
  if (!manualCredentialTypes.has(command.credentialType)) {
    invalidCreateCommand();
  }

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

export function createAcademicSubjectCurricularDraftRequest(
  requestAuthenticated: AuthenticatedApiRequest,
  command: CreateAcademicSubjectCurricularDraftCommand
) {
  if (command.credentialType !== 'academic_subject') {
    invalidCreateCommand();
  }

  const academicCourseReference = command.academicCourseReference;
  const curriculumReference = command.curriculumReference;

  if (
    typeof academicCourseReference !== 'string' ||
    typeof curriculumReference !== 'string' ||
    academicCourseReference.trim().length === 0 ||
    curriculumReference.trim().length === 0
  ) {
    invalidCreateCommand();
  }

  return requestAuthenticated('/credentials/draft', {
    method: 'POST',
    body: {
      issuerId: command.issuerReference,
      subjectUserId: command.holderReference,
      type: 'academic_subject',
      sourceType: 'manual_issuer',
      academicCourseReference: academicCourseReference.trim(),
      curriculumReference: curriculumReference.trim()
    }
  });
}

export function createCredentialDraftRequest(
  requestAuthenticated: AuthenticatedApiRequest,
  command: CreateCredentialDraftCommand
) {
  return command.credentialType === 'academic_subject'
    ? createAcademicSubjectCurricularDraftRequest(
        requestAuthenticated,
        command
      )
    : createManualCredentialDraftRequest(requestAuthenticated, command);
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

export function uploadCredentialDocumentEvidenceRequest(
  requestAuthenticated: AuthenticatedApiRequest,
  command: UploadCredentialDocumentEvidenceCommand
) {
  const issuerReference = command.issuerReference.trim();
  const credentialReference = command.credentialReference.trim();

  if (
    issuerReference.length === 0 ||
    credentialReference.length === 0 ||
    typeof File === 'undefined' ||
    !(command.file instanceof File)
  ) {
    throw new ApiError(
      'La evidencia documental seleccionada no es válida.',
      'http',
      400
    );
  }

  const body = new FormData();
  body.append('file', command.file);

  return requestAuthenticated(
    `/issuers/${encodeURIComponent(issuerReference)}/credentials/${encodeURIComponent(credentialReference)}/evidence/documents`,
    {
      method: 'POST',
      body
    }
  );
}

export function submitCredentialTextEvidenceRequest(
  requestAuthenticated: AuthenticatedApiRequest,
  command: SubmitCredentialTextEvidenceCommand
) {
  const issuerReference = command.issuerReference.trim();
  const credentialReference = command.credentialReference.trim();

  if (issuerReference.length === 0 || credentialReference.length === 0) {
    throw new ApiError(
      'La referencia institucional de la evidencia textual no es válida.',
      'http',
      400
    );
  }

  if (
    typeof command.content !== 'string' ||
    (command.label !== null && typeof command.label !== 'string')
  ) {
    throw new ApiError(
      'La evidencia textual ingresada no es válida.',
      'http',
      400
    );
  }

  const validation = validateTextEvidenceDraft(
    command.content,
    command.label
  );

  if (!validation.valid) {
    throw new ApiError(
      'La evidencia textual ingresada no es válida.',
      'http',
      400
    );
  }

  return requestAuthenticated(
    `/issuers/${encodeURIComponent(issuerReference)}/credentials/${encodeURIComponent(credentialReference)}/evidence/texts`,
    {
      method: 'POST',
      body: {
        content: validation.normalizedSubmission.content,
        label: validation.normalizedSubmission.label
      }
    }
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

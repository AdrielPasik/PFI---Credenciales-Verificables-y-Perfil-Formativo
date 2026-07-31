import type { AuthenticatedApiRequest } from '@/lib/api/api-client';
import type {
  CredentialDraftPatchFields,
  CreateCredentialDraftCommand,
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
  const body: Record<string, unknown> = {
    expectedUpdatedAt: command.expectedUpdatedAt
  };

  for (const field of credentialDraftPatchFields) {
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

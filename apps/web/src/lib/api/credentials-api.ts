import type { AuthenticatedApiRequest } from '@/lib/api/api-client';
import type {
  CreateCredentialDraftCommand,
  HolderResolutionCommand
} from '@/models/credentials';

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

export function getCredentialRequest(
  requestAuthenticated: AuthenticatedApiRequest,
  credentialReference: string
) {
  return requestAuthenticated(
    `/credentials/${encodeURIComponent(credentialReference)}`
  );
}

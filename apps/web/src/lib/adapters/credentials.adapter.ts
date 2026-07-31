import { IncompatiblePayloadError } from '@/lib/errors/api-error';
import {
  credentialTypeLabels,
  credentialTypeOptions
} from '@/models/credentials';
import type {
  CreatedCredentialDraftVM,
  CredentialStatus,
  CredentialType,
  HolderSummaryVM,
  IssuerCredentialDetailVM
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
  if (value === null || value === undefined) {
    return null;
  }

  return requiredString(value);
}

function credentialStatus(value: unknown): CredentialStatus {
  if (value === 'draft' || value === 'issued' || value === 'revoked') {
    return value;
  }

  throw new IncompatiblePayloadError();
}

function credentialType(value: unknown): CredentialType {
  if (
    typeof value === 'string' &&
    credentialTypeOptions.includes(value as CredentialType)
  ) {
    return value as CredentialType;
  }

  throw new IncompatiblePayloadError();
}

const statusLabels: Record<CredentialStatus, string> = {
  draft: 'Borrador',
  issued: 'Emitida',
  revoked: 'Revocada'
};

export function adaptHolderResolution(payload: unknown): HolderSummaryVM {
  const holder = asRecord(payload);

  return {
    holderReference: requiredString(holder.id),
    email: requiredString(holder.email).toLowerCase(),
    did: nullableString(holder.did),
    displayLabel: requiredString(holder.displayLabel)
  };
}

export function adaptIssuerCredentialDetail(
  payload: unknown
): IssuerCredentialDetailVM {
  const credential = asRecord(payload);
  const status = credentialStatus(credential.status);
  const type = credentialType(credential.type);
  const credentialSubject = asRecord(credential.credentialSubject);
  const issuer = asRecord(credential.issuer);
  const holder = asRecord(credential.holder);
  const createdAt = requiredString(credential.createdAt);

  if (Number.isNaN(Date.parse(createdAt))) {
    throw new IncompatiblePayloadError();
  }

  return {
    credentialReference: requiredString(credential.id),
    title: requiredString(credential.title),
    draftAchievementName: nullableString(
      credentialSubject.achievement_name
    ),
    type,
    typeLabel: credentialTypeLabels[type],
    status,
    statusLabel: statusLabels[status],
    issuer: {
      displayName: requiredString(issuer.displayName),
      did: nullableString(issuer.did)
    },
    draftInstitutionName: nullableString(
      credentialSubject.institution_name
    ),
    holder: {
      displayLabel: requiredString(holder.displayLabel),
      email: nullableString(holder.email)?.toLowerCase() ?? null,
      did: nullableString(holder.did)
    },
    createdAt
  };
}

export function adaptCreatedCredentialDraft(
  payload: unknown
): CreatedCredentialDraftVM {
  const credential = asRecord(payload);

  return {
    credentialReference: requiredString(credential.id),
    issuerReference: requiredString(credential.issuerId),
    status: credentialStatus(credential.status)
  };
}

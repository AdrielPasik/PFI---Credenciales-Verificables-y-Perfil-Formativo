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
  const createdAt = isoDateTime(credential.createdAt);
  const updatedAt = isoDateTime(credential.updatedAt);

  return {
    credentialReference: requiredString(credential.id),
    title: requiredString(credential.title),
    description: nullableString(credential.description),
    hours: nullableString(credential.hours),
    type,
    typeLabel: credentialTypeLabels[type],
    status,
    statusLabel: statusLabels[status],
    issuer: {
      displayName: requiredString(issuer.displayName),
      did: nullableString(issuer.did)
    },
    credentialSubject: {
      achievementName: nullableString(
        credentialSubject.achievement_name
      ),
      institutionName: nullableString(
        credentialSubject.institution_name
      ),
      completionDate: nullableString(
        credentialSubject.completion_date
      ),
      academicPeriod: nullableString(
        credentialSubject.academic_period
      ),
      programName: nullableString(credentialSubject.program_name),
      grade: nullableString(credentialSubject.grade),
      providerName: nullableString(credentialSubject.provider_name),
      platformName: nullableString(credentialSubject.platform_name),
      modality: nullableString(credentialSubject.modality),
      level: nullableString(credentialSubject.level),
      certificationCode: nullableString(
        credentialSubject.certification_code
      ),
      expirationDate: nullableString(
        credentialSubject.expiration_date
      ),
      externalUrl: nullableString(credentialSubject.external_url),
      skills: stringArray(credentialSubject.skills),
      competencies: stringArray(credentialSubject.competencies),
      learningOutcomes: stringArray(
        credentialSubject.learning_outcomes
      )
    },
    holder: {
      displayLabel: requiredString(holder.displayLabel),
      email: nullableString(holder.email)?.toLowerCase() ?? null,
      did: nullableString(holder.did)
    },
    createdAt,
    updatedAt
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

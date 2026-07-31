import {
  CredentialSourceType,
  CredentialStatus,
  CredentialType,
  Prisma
} from '@prisma/client';

import { buildHolderDisplayLabel } from '../issuers/holder-display-label';
import { IssuerCredentialDetailResponseDto } from './dto/issuer-credential-detail-response.dto';

export interface IssuerCredentialReadRecord {
  id: string;
  status: CredentialStatus;
  type: CredentialType;
  title: string;
  sourceType: CredentialSourceType;
  credentialSubject: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
  issuer: {
    name: string;
    did: string | null;
  };
  subjectUser: {
    email: string | null;
    did: string | null;
    displayName: string | null;
    firstName: string | null;
    lastName: string | null;
  };
}

export function mapIssuerCredentialReadModel(
  credential: IssuerCredentialReadRecord
): IssuerCredentialDetailResponseDto {
  const credentialSubject = toJsonObject(credential.credentialSubject);
  const holderEmail = normalizeOptionalText(
    credential.subjectUser.email
  )?.toLowerCase() ?? null;

  return {
    id: credential.id,
    status: credential.status,
    type: credential.type,
    title: credential.title,
    sourceType: credential.sourceType,
    credentialSubject: {
      achievement_name: readAllowedText(
        credentialSubject,
        'achievement_name'
      ),
      institution_name: readAllowedText(
        credentialSubject,
        'institution_name'
      )
    },
    createdAt: credential.createdAt.toISOString(),
    updatedAt: credential.updatedAt.toISOString(),
    issuer: {
      displayName: credential.issuer.name,
      did: normalizeOptionalText(credential.issuer.did)
    },
    holder: {
      displayLabel: buildHolderDisplayLabel(
        credential.subjectUser.displayName,
        credential.subjectUser.firstName,
        credential.subjectUser.lastName,
        holderEmail
      ),
      email: holderEmail,
      did: normalizeOptionalText(credential.subjectUser.did)
    }
  };
}

function toJsonObject(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, Prisma.JsonValue>;
}

function readAllowedText(
  source: Record<string, Prisma.JsonValue>,
  key: 'achievement_name' | 'institution_name'
): string | null {
  const value = source[key];
  return typeof value === 'string' ? normalizeOptionalText(value) : null;
}

function normalizeOptionalText(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

import { IncompatiblePayloadError } from '@/lib/errors/api-error';
import type { AuthUserVM, CurrentUserVM } from '@/models/auth-session';
import {
  isOperationalIssuerMembership,
  type IssuerAuthorizationStatus,
  type IssuerMembershipRole,
  type IssuerMembershipStatus,
  type IssuerMembershipSummaryVM
} from '@/models/issuer-context';

export interface AdaptedLoginResponse {
  accessToken: string;
  user: AuthUserVM;
}

export interface AdaptedCurrentUser {
  currentUser: CurrentUserVM;
  issuerMemberships: IssuerMembershipSummaryVM[];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new IncompatiblePayloadError();
  }

  return value as Record<string, unknown>;
}

function requiredString(value: unknown) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new IncompatiblePayloadError();
  }

  return value.trim();
}

function nullableString(value: unknown) {
  if (value === null) {
    return null;
  }

  return requiredString(value);
}

function adaptUser(payload: unknown): AuthUserVM {
  const user = asRecord(payload);

  if (user.status !== 'active') {
    throw new IncompatiblePayloadError();
  }

  return {
    userReference: requiredString(user.id),
    email: requiredString(user.email),
    did: nullableString(user.did)
  };
}

const roleLabels: Record<IssuerMembershipRole, string> = {
  admin: 'Administrador',
  operator: 'Operador',
  viewer: 'Solo lectura'
};

const authorizationLabels: Record<IssuerAuthorizationStatus, string> = {
  authorized: 'Autorizada',
  pending: 'Pendiente de autorización',
  revoked: 'Autorización revocada'
};

function adaptRole(value: unknown): IssuerMembershipRole {
  if (value === 'admin' || value === 'operator' || value === 'viewer') {
    return value;
  }

  throw new IncompatiblePayloadError();
}

function adaptMembershipStatus(value: unknown): IssuerMembershipStatus {
  if (value === 'active' || value === 'pending' || value === 'revoked') {
    return value;
  }

  throw new IncompatiblePayloadError();
}

function adaptAuthorizationStatus(
  value: unknown
): IssuerAuthorizationStatus {
  if (value === 'authorized' || value === 'pending' || value === 'revoked') {
    return value;
  }

  throw new IncompatiblePayloadError();
}

function adaptMembership(payload: unknown): IssuerMembershipSummaryVM {
  const membership = asRecord(payload);
  const role = adaptRole(membership.role);
  const status = adaptMembershipStatus(membership.status);
  const issuerAuthorizationStatus = adaptAuthorizationStatus(
    membership.issuerAuthorizationStatus
  );
  const adapted = {
    issuerReference: requiredString(membership.issuerId),
    issuerName: requiredString(membership.issuerName),
    issuerDid: nullableString(membership.issuerDid),
    issuerAuthorizationStatus,
    issuerAuthorizationLabel:
      authorizationLabels[issuerAuthorizationStatus],
    role,
    roleLabel: roleLabels[role],
    status,
    operational: false
  };

  return {
    ...adapted,
    operational: isOperationalIssuerMembership(adapted)
  };
}

export function adaptLoginResponse(payload: unknown): AdaptedLoginResponse {
  const response = asRecord(payload);

  return {
    accessToken: requiredString(response.accessToken),
    user: adaptUser(response.user)
  };
}

export function adaptCurrentUserResponse(
  payload: unknown
): AdaptedCurrentUser {
  const response = asRecord(payload);

  if (!Array.isArray(response.issuerMemberships)) {
    throw new IncompatiblePayloadError();
  }

  return {
    currentUser: adaptUser(response),
    issuerMemberships: response.issuerMemberships.map(adaptMembership)
  };
}

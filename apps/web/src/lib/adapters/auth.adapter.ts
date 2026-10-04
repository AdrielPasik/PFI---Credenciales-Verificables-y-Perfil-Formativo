import { IncompatiblePayloadError } from '@/lib/errors/api-error';
import type {
  AuthUserVM,
  CurrentUserVM,
  UserOnboardingIntent
} from '@/models/auth-session';
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
    did: nullableString(user.did),
    displayLabel: requiredString(user.displayLabel)
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

/**
 * O1: FAIL-SAFE A NULL, y deliberadamente TOLERANTE.
 *
 * Solo los dos literales exactos se mapean; cualquier otra cosa -- ausente,
 * `null`, un valor desconocido de una versión futura del API, un número --
 * resuelve `null`, que el router trata como el espacio personal.
 *
 * POR QUE NO `IncompatiblePayloadError` COMO `adaptRole`. Esa excepción es
 * correcta para `role`/`status` de una membership, donde un valor desconocido
 * significaría que el cliente no entiende un contrato de AUTORIZACIÓN y seguir
 * adelante sería inseguro. Acá es lo contrario: el campo no autoriza nada, es
 * opcional por compatibilidad de deploy, y la consecuencia de leerlo mal es
 * aterrizar en el espacio personal en vez de en la pantalla de acceso
 * institucional pendiente. Invalidar una sesión entera por eso sería
 * desproporcionado. Mismo criterio que `platformAdmin` en S3.
 */
function adaptOnboardingIntent(value: unknown): UserOnboardingIntent | null {
  return value === 'personal' || value === 'institutional' ? value : null;
}

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
    currentUser: {
      ...adaptUser(response),
      // S3: FAIL-CLOSED y deliberadamente TOLERANTE. Solo el booleano `true`
      // habilita la superficie /admin; cualquier otra cosa -- ausente, null,
      // string, 1 -- da `false`.
      //
      // Y no se suma al regimen de `IncompatiblePayloadError` que si aplica a
      // `issuerMemberships`: un API anterior a S3 no manda este campo, y
      // tratarlo como payload incompatible invalidaria sesiones validas por un
      // campo nuevo y opcional. La consecuencia de leerlo mal es no ofrecer un
      // enlace, no perder acceso a nada.
      isPlatformAdmin: response.platformAdmin === true,
      onboardingIntent: adaptOnboardingIntent(response.onboardingIntent)
    },
    issuerMemberships: response.issuerMemberships.map(adaptMembership)
  };
}

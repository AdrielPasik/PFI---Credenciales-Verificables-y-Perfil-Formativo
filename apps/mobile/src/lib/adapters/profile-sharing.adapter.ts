import { invalid, record, requiredString } from '@/lib/adapters/contract';
import { formatDate } from '@/lib/format/display';
import type {
  ProfileShareLinkVM,
  ProfileShareSummaryVM,
  RecoveredProfileShareLinkVM,
  ShareVerificationPolicyVM
} from '@/types/sharing';

/**
 * El backend devuelve una RUTA relativa opaca, no una URL absoluta. Se valida
 * con la misma forma que Holder Web para no aceptar nunca una redirección
 * arbitraria disfrazada de `sharePath`.
 */
const SHARE_PATH_PATTERN = /^\/share\/profile\/[A-Za-z0-9_-]{32,200}$/;

export function adaptProfileShareLink(payload: unknown): ProfileShareLinkVM {
  const value = record(payload, 'profileShare');
  const sharePath = requiredString(value.sharePath, 'profileShare.sharePath');

  if (!SHARE_PATH_PATTERN.test(sharePath)) {
    invalid(
      'profileShare.sharePath',
      'opaque /share/profile/<token> path',
      value.sharePath
    );
  }

  return {
    sharePath,
    expiresAtLabel: optionalDateLabel(
      value.expiresAt,
      'profileShare.expiresAt'
    )
  };
}

const SHARE_STATUS_LABELS = {
  ACTIVE: 'Activo',
  REVOKED: 'Revocado',
  EXPIRED: 'Vencido'
} as const;

const PROFILE_SHARE_SCOPES = new Set(['profile', 'credential', 'credential_and_profile']);

export function adaptProfileShareSummaries(
  payload: unknown
): ProfileShareSummaryVM[] {
  if (!Array.isArray(payload)) {
    invalid('profileShares', 'array', payload);
  }

  return payload.map((entry, index) => {
    const path = `profileShares[${index}]`;
    const value = record(entry, path);
    const status = requiredString(value.status, `${path}.status`);
    if (!(status in SHARE_STATUS_LABELS)) {
      invalid(`${path}.status`, 'ACTIVE, REVOKED, or EXPIRED', value.status);
    }
    const scope = requiredString(value.scope, `${path}.scope`);
    if (!PROFILE_SHARE_SCOPES.has(scope)) {
      invalid(`${path}.scope`, 'profile, credential, or credential_and_profile', value.scope);
    }

    return {
      shareId: requiredString(value.shareId, `${path}.shareId`),
      scope: scope as ProfileShareSummaryVM['scope'],
      status: status as ProfileShareSummaryVM['status'],
      statusLabel: SHARE_STATUS_LABELS[status as keyof typeof SHARE_STATUS_LABELS],
      createdAtLabel: requiredDateLabel(value.createdAt, `${path}.createdAt`),
      expiresAtLabel: optionalDateLabel(value.expiresAt, `${path}.expiresAt`),
      revokedAtLabel: optionalDateLabel(value.revokedAt, `${path}.revokedAt`),
      lastUsedAtLabel: optionalDateLabel(value.lastUsedAt, `${path}.lastUsedAt`),
      supportsContextualVerification: scope === 'profile'
    };
  });
}

export function adaptRecoveredProfileShareLink(
  payload: unknown
): RecoveredProfileShareLinkVM {
  const value = record(payload, 'profileShareLink');
  const sharePath = requiredString(value.sharePath, 'profileShareLink.sharePath');
  if (!SHARE_PATH_PATTERN.test(sharePath)) {
    invalid('profileShareLink.sharePath', 'opaque /share/profile/<token> path', value.sharePath);
  }

  const shareUrl = value.shareUrl === null || value.shareUrl === undefined
    ? null
    : requiredString(value.shareUrl, 'profileShareLink.shareUrl');

  return { sharePath, shareUrl };
}

export function adaptShareVerificationPolicy(
  payload: unknown
): ShareVerificationPolicyVM {
  const value = record(payload, 'shareVerificationPolicy');
  if (typeof value.configured !== 'boolean') {
    invalid('shareVerificationPolicy.configured', 'boolean', value.configured);
  }
  if (typeof value.enabled !== 'boolean') {
    invalid('shareVerificationPolicy.enabled', 'boolean', value.enabled);
  }
  const ids = (raw: unknown, path: string) => {
    if (!Array.isArray(raw)) invalid(path, 'array', raw);
    return raw.map((id, index) => requiredString(id, `${path}[${index}]`));
  };
  return {
    configured: value.configured,
    enabled: value.enabled,
    policyVersion: nonNegativeInteger(value.policyVersion, 'shareVerificationPolicy.policyVersion'),
    authorizedCredentialIds: ids(value.authorizedCredentialIds, 'shareVerificationPolicy.authorizedCredentialIds'),
    effectiveAuthorizedCredentialIds: ids(value.effectiveAuthorizedCredentialIds, 'shareVerificationPolicy.effectiveAuthorizedCredentialIds'),
    updatedAtLabel: optionalDateLabel(value.updatedAt, 'shareVerificationPolicy.updatedAt')
  };
}

function optionalDateLabel(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  const text = requiredString(value, path);

  if (!Number.isFinite(Date.parse(text))) {
    invalid(path, 'ISO date string or null', value);
  }

  return formatDate(text);
}

function requiredDateLabel(value: unknown, path: string): string {
  const label = optionalDateLabel(value, path);
  if (label === null) invalid(path, 'ISO date string', value);
  return label;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    invalid(path, 'non-negative integer', value);
  }
  return value;
}

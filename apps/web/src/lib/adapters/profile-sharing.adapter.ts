import { IncompatiblePayloadError } from '@/lib/errors/api-error';
import { formatDisplayValue } from '@/lib/formatters/display-value';
import type {
  HolderProfileShareVM,
  HolderShareLinkVM,
  ProfileShareLinkVM,
  PublicProfileShareVM,
  ShareStatus,
  ShareVerificationPolicyVM
} from '@/models/profile-sharing';

const SHARE_STATUS_LABELS: Record<ShareStatus, string> = {
  ACTIVE: 'Activo',
  REVOKED: 'Revocado',
  EXPIRED: 'Vencido'
};

const typeLabels = new Set([
  'Asignatura académica',
  'Curso',
  'Certificación',
  'Título académico'
]);

export function adaptProfileShareLink(payload: unknown): ProfileShareLinkVM {
  const value = record(payload);
  const sharePath = requiredString(value.sharePath);
  if (!/^\/share\/profile\/[A-Za-z0-9_-]{32,200}$/.test(sharePath)) invalid();
  return { sharePath, expiresAtLabel: optionalDateLabel(value.expiresAt) };
}

export function adaptPublicProfileShare(payload: unknown): PublicProfileShareVM {
  const value = record(payload);
  const holder = record(value.holder);
  const profile = record(value.profile);
  return {
    holderLabel: nullableString(holder.displayLabel),
    narrative: nullableString(profile.narrative),
    areas: array(profile.areas).slice(0, 6).map((entry) => {
      const area = record(entry);
      const hours = nullableNumber(area.estimatedHours);
      return {
        label: requiredString(area.label),
        estimatedHoursLabel: hours === null ? null : `${formatDisplayValue(hours)} horas estimadas por IA`
      };
    }),
    skills: array(profile.skills).slice(0, 12).map((entry) => requiredString(record(entry).label)),
    concepts: array(profile.concepts).slice(0, 20).map(requiredString),
    totalOfficialHoursLabel: nullableNumber(profile.totalOfficialHours) === null
      ? null
      : `${formatDisplayValue(nullableNumber(profile.totalOfficialHours)!)} horas oficiales declaradas`,
    credentialsCount: nonNegativeInteger(profile.credentialsCount),
    credentials: array(value.credentials).slice(0, 10).map((entry) => {
      const credential = record(entry);
      const typeLabel = requiredString(credential.typeLabel);
      if (!typeLabels.has(typeLabel)) invalid();
      return {
        credentialReference: requiredString(credential.credentialReference),
        title: requiredString(credential.title),
        typeLabel,
        issuerName: requiredString(credential.issuerName),
        issuedAtLabel: optionalDateLabel(credential.issuedAt)
      };
    }),
    // Ausente en un backend anterior se lee como NO habilitado. El default
    // seguro es el unico aceptable para un permiso.
    contextualVerificationEnabled: optionalBoolean(value.contextualVerificationEnabled)
  };
}

/**
 * Recuperacion del enlace propio.
 *
 * Falla cerrado: sin una ruta utilizable no se devuelve nada a medias, porque la
 * UI la usaria para copiar o navegar.
 */
export function adaptHolderShareLink(payload: unknown): HolderShareLinkVM {
  const value = record(payload);
  const sharePath = requiredString(value.sharePath);
  if (!sharePath.startsWith('/share/profile/')) invalid();
  const shareUrl = value.shareUrl === null || value.shareUrl === undefined
    ? null
    : requiredString(value.shareUrl);
  return { shareUrl, sharePath };
}

export function adaptHolderProfileShares(payload: unknown): HolderProfileShareVM[] {
  return array(payload).map((entry) => {
    const share = record(entry);
    const status = requiredString(share.status);
    if (status !== 'ACTIVE' && status !== 'REVOKED' && status !== 'EXPIRED') invalid();
    return {
      shareId: requiredString(share.shareId),
      status,
      statusLabel: SHARE_STATUS_LABELS[status],
      createdAtLabel: requiredDateLabel(share.createdAt),
      expiresAtLabel: optionalDateLabel(share.expiresAt),
      revokedAtLabel: optionalDateLabel(share.revokedAt),
      lastUsedAtLabel: optionalDateLabel(share.lastUsedAt),
      contextualVerificationEnabled: optionalBoolean(share.contextualVerificationEnabled),
      authorizedCredentialCount: nonNegativeInteger(share.authorizedCredentialCount),
      effectiveAuthorizedCredentialCount: nonNegativeInteger(
        share.effectiveAuthorizedCredentialCount
      )
    };
  });
}

export function adaptShareVerificationPolicy(payload: unknown): ShareVerificationPolicyVM {
  const value = record(payload);
  if (typeof value.enabled !== 'boolean') invalid();
  return {
    enabled: value.enabled,
    policyVersion: nonNegativeInteger(value.policyVersion),
    authorizedCredentialIds: array(value.authorizedCredentialIds).map(requiredString),
    effectiveAuthorizedCredentialIds: array(value.effectiveAuthorizedCredentialIds).map(
      requiredString
    )
  };
}

function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); return value as Record<string, unknown>; }
function array(value: unknown): unknown[] { if (!Array.isArray(value)) invalid(); return value; }
function requiredString(value: unknown): string { const normalized = nullableString(value); if (!normalized || normalized.length > 300 || /[\u0000-\u001f\u007f]/.test(normalized)) invalid(); return normalized; }
function nullableString(value: unknown): string | null { if (value === null || value === undefined) return null; if (typeof value !== 'string') invalid(); const normalized = value.trim().replace(/\s+/g, ' '); return normalized || null; }
function nullableNumber(value: unknown): number | null { if (value === null || value === undefined) return null; if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalid(); return value; }
function nonNegativeInteger(value: unknown): number { if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) invalid(); return value; }
function optionalBoolean(value: unknown): boolean { if (value === undefined || value === null) return false; if (typeof value !== 'boolean') invalid(); return value; }
function requiredDateLabel(value: unknown): string { const label = optionalDateLabel(value); if (label === null) invalid(); return label; }
function optionalDateLabel(value: unknown): string | null { if (value === null || value === undefined) return null; const text = requiredString(value); const date = new Date(text); if (Number.isNaN(date.valueOf())) invalid(); return new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' }).format(date); }
function invalid(): never { throw new IncompatiblePayloadError('El perfil compartido no tiene el formato esperado.'); }

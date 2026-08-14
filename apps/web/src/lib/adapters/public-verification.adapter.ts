import { IncompatiblePayloadError } from '@/lib/errors/api-error';
import { formatIntegrityDate } from '@/lib/formatters/credential-integrity';
import type { PublicCredentialVerificationVM } from '@/models/public-verification';

const credentialTypes = ['academic_subject', 'course', 'certification', 'degree'] as const;
const statuses = ['issued', 'revoked'] as const;
const results = ['valid_issued', 'revoked', 'not_verifiable'] as const;

export function adaptPublicCredentialVerification(payload: unknown): PublicCredentialVerificationVM {
  const value = record(payload);
  const issuer = record(value.issuer);
  const holder = record(value.holder);
  const integrity = record(value.integrity);
  const verification = record(value.verification);
  const latestRecord = nullableRecord(integrity.latestBlockchainRecord);

  return {
    credentialReference: requiredString(value.credentialReference),
    status: enumValue(value.status, statuses),
    statusLabel: requiredString(value.statusLabel),
    title: requiredString(value.title),
    type: enumValue(value.type, credentialTypes),
    typeLabel: requiredString(value.typeLabel),
    issuerName: requiredString(issuer.displayName),
    issuerDid: nullableString(issuer.did),
    holderLabel: nullablePresentString(holder.displayLabel),
    holderDid: nullablePresentString(holder.did),
    issuedAtLabel: nullableDateLabel(value.issuedAt),
    revokedAtLabel: nullableDateLabel(value.revokedAt),
    revocationReason: nullableString(value.revocationReason),
    canonicalHashShort: nullableString(value.canonicalHashShort),
    canonicalizationVersion: nullableString(value.canonicalizationVersion),
    integrity: {
      canonicalHashPresent: requiredBoolean(integrity.canonicalHashPresent),
      blockchainRecordsCount: nonNegativeInteger(integrity.blockchainRecordsCount),
      latestBlockchainRecord: latestRecord
        ? {
            networkLabel: requiredString(latestRecord.networkLabel),
            chainId: nonNegativeInteger(latestRecord.chainId),
            txHashShort: nullableString(latestRecord.txHashShort),
            statusLabel: requiredString(latestRecord.statusLabel),
            registeredAtLabel: nullableDateLabel(latestRecord.registeredAt)
          }
        : null
    },
    verification: {
      result: enumValue(verification.result, results),
      summary: requiredString(verification.summary),
      checkedAtLabel: dateLabel(verification.checkedAt)
    }
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function nullableRecord(value: unknown): Record<string, unknown> | null {
  return value === null ? null : record(value);
}
function requiredString(value: unknown): string {
  const normalized = nullableString(value);
  if (!normalized) invalid();
  return normalized;
}
function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') invalid();
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized || null;
}
function nullablePresentString(value: unknown): string | null {
  if (value === undefined) invalid();
  return nullableString(value);
}
function enumValue<T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  const normalized = requiredString(value);
  if (!allowed.includes(normalized)) invalid();
  return normalized as T[number];
}
function requiredBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid();
  return value;
}
function nonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) invalid();
  return value;
}
function dateLabel(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) invalid();
  return formatIntegrityDate(value);
}
function nullableDateLabel(value: unknown): string | null {
  return value === null ? null : dateLabel(value);
}
function invalid(): never {
  throw new IncompatiblePayloadError('La respuesta pública de verificación no cumple el contrato esperado.');
}

import { IncompatiblePayloadError } from '@/lib/errors/api-error';
import type {
  IssuerNetworkHealthVM,
  IssuerTechnicalIdentityVM,
  TechnicalCredentialType,
  TechnicalSignerVM
} from '@/models/issuer-technical-identity';

/**
 * Adapter de la configuracion tecnica (S8c9). ALLOWLIST: se copian solo los
 * campos conocidos, nunca un spread del payload. Si el servidor agregara un
 * campo inesperado (por ejemplo una referencia de secreto), no llega a la UI.
 */

type Json = Record<string, unknown>;

const credentialTypes = ['course', 'academic_subject', 'degree', 'certification'] as const;
const authorizationStatuses = ['pending', 'authorized', 'revoked'] as const;
const identityStatuses = ['unconfigured', 'active', 'rotation_required', 'disabled'] as const;
const signerStatuses = ['active', 'retired', 'compromised'] as const;
const targetModes = ['mock', 'credential_registry'] as const;
const healthStatuses = ['HEALTHY', 'DEGRADED', 'UNAVAILABLE', 'NOT_APPLICABLE_MOCK'] as const;

function fail(field: string): never {
  throw new IncompatiblePayloadError(`Campo incompatible: ${field}.`);
}
function obj(value: unknown, field: string): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(field);
  return value as Json;
}
function str(value: unknown, field: string): string {
  if (typeof value !== 'string') fail(field);
  return value;
}
function nstr(value: unknown, field: string): string | null {
  return value === null ? null : str(value, field);
}
function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') fail(field);
  return value;
}
function nbool(value: unknown, field: string): boolean | null {
  return value === null ? null : bool(value, field);
}
function int(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) fail(field);
  return value;
}
function nint(value: unknown, field: string): number | null {
  return value === null ? null : int(value, field);
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) fail(field);
  return value as T;
}
function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) fail(field);
  return value.map((item, index) => str(item, `${field}[${index}]`));
}

function signer(value: unknown, field: string): TechnicalSignerVM {
  const o = obj(value, field);
  return {
    address: str(o.address, `${field}.address`),
    keyVersion: int(o.keyVersion, `${field}.keyVersion`),
    status: oneOf(o.status, signerStatuses, `${field}.status`)
  };
}

export function adaptIssuerTechnicalIdentity(payload: unknown): IssuerTechnicalIdentityVM {
  const o = obj(payload, 'root');
  const target = obj(o.blockchainTarget, 'blockchainTarget');
  const identity =
    o.technicalIdentity === null ? null : obj(o.technicalIdentity, 'technicalIdentity');

  return {
    issuerId: str(o.issuerId, 'issuerId'),
    issuerName: str(o.issuerName, 'issuerName'),
    authorizationStatus: oneOf(o.authorizationStatus, authorizationStatuses, 'authorizationStatus'),
    allowedCredentialTypes: strings(o.allowedCredentialTypes, 'allowedCredentialTypes').map(
      (value, index) =>
        oneOf<TechnicalCredentialType>(value, credentialTypes, `allowedCredentialTypes[${index}]`)
    ),
    administrativelyAuthorized: bool(o.administrativelyAuthorized, 'administrativelyAuthorized'),
    configurationReady: bool(o.configurationReady, 'configurationReady'),
    hasCredentialCapabilities: bool(o.hasCredentialCapabilities, 'hasCredentialCapabilities'),
    readyToIssue: bool(o.readyToIssue, 'readyToIssue'),
    readinessReasons: strings(o.readinessReasons, 'readinessReasons'),
    technicalIdentity: identity
      ? {
          status: oneOf(identity.status, identityStatuses, 'technicalIdentity.status'),
          did: str(identity.did, 'technicalIdentity.did'),
          didDocumentUrl: nstr(identity.didDocumentUrl, 'technicalIdentity.didDocumentUrl')
        }
      : null,
    assertionSigner:
      o.assertionSigner === null ? null : signer(o.assertionSigner, 'assertionSigner'),
    anchorSigner:
      o.anchorSigner === null
        ? null
        : {
            ...signer(o.anchorSigner, 'anchorSigner'),
            shared: bool(obj(o.anchorSigner, 'anchorSigner').shared, 'anchorSigner.shared')
          },
    blockchainTarget: {
      mode: target.mode === null ? null : oneOf(target.mode, targetModes, 'blockchainTarget.mode'),
      network: nstr(target.network, 'blockchainTarget.network'),
      chainId: nint(target.chainId, 'blockchainTarget.chainId'),
      contractAddress: nstr(target.contractAddress, 'blockchainTarget.contractAddress'),
      deploymentId: nstr(target.deploymentId, 'blockchainTarget.deploymentId')
    }
  };
}

export function adaptIssuerNetworkHealth(payload: unknown): IssuerNetworkHealthVM {
  const o = obj(payload, 'root');
  return {
    status: oneOf(o.status, healthStatuses, 'status'),
    reasons: strings(o.reasons, 'reasons'),
    chainMatched: nbool(o.chainMatched, 'chainMatched'),
    contractCodePresent: nbool(o.contractCodePresent, 'contractCodePresent'),
    latestBlockObserved: nbool(o.latestBlockObserved, 'latestBlockObserved'),
    anchorFunded: nbool(o.anchorFunded, 'anchorFunded'),
    network: nstr(o.network, 'network'),
    chainId: nint(o.chainId, 'chainId'),
    contractAddress: nstr(o.contractAddress, 'contractAddress'),
    latestBlockNumber: nint(o.latestBlockNumber, 'latestBlockNumber'),
    anchorBalanceWei: nstr(o.anchorBalanceWei, 'anchorBalanceWei'),
    checkedAt: str(o.checkedAt, 'checkedAt')
  };
}

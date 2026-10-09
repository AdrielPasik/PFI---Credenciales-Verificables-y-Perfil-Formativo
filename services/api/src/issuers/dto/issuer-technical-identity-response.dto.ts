import {
  type CredentialType,
  type IssuerAuthorizationStatus,
  type IssuerTechnicalIdentityStatus,
  type SignerProfileStatus
} from '@prisma/client';

import { type IssuerReadinessReason } from '../issuer-readiness';

/**
 * Configuracion tecnica del issuer, vista por SU admin -- S8c9.
 *
 * ALLOWLIST. Nunca sale de aca: `secretRef`, clave privada, ruta SSM, campos
 * privados de JWK, URL del RPC, API key, metadata de AWS, ni los ids internos de
 * `SignerProfile`.
 */
export interface IssuerTechnicalIdentityResponseDto {
  issuerId: string;
  issuerName: string;
  authorizationStatus: IssuerAuthorizationStatus;
  /** Politica de plataforma. Solo lectura para el issuer. */
  allowedCredentialTypes: CredentialType[];

  administrativelyAuthorized: boolean;
  /** TECNICA: no incluye autorizacion ni capacidades. */
  configurationReady: boolean;
  hasCredentialCapabilities: boolean;
  /** Las tres de arriba a la vez. No depende del RPC. */
  readyToIssue: boolean;
  readinessReasons: IssuerReadinessReason[];

  technicalIdentity: {
    status: IssuerTechnicalIdentityStatus;
    did: string;
    /** Link al endpoint publico. null si el DID no es de este issuer. */
    didDocumentUrl: string | null;
  } | null;

  assertionSigner: {
    address: string;
    keyVersion: number;
    status: SignerProfileStatus;
  } | null;

  anchorSigner: {
    address: string;
    keyVersion: number;
    status: SignerProfileStatus;
    /** Mas de una identidad tecnica apunta a esta cuenta. */
    shared: boolean;
  } | null;

  blockchainTarget: {
    /** `mock` | `credential_registry` | null si la configuracion es invalida. */
    mode: 'mock' | 'credential_registry' | null;
    network: string | null;
    chainId: number | null;
    contractAddress: string | null;
    deploymentId: string | null;
  };
}

export type IssuerNetworkHealthStatus =
  | 'HEALTHY'
  | 'DEGRADED'
  | 'UNAVAILABLE'
  | 'NOT_APPLICABLE_MOCK';

export type IssuerNetworkHealthReason =
  | 'TARGET_UNCONFIGURED'
  | 'RPC_UNAVAILABLE'
  | 'CHAIN_MISMATCH'
  | 'CONTRACT_CODE_MISSING'
  | 'LATEST_BLOCK_UNAVAILABLE'
  | 'ANCHOR_UNCONFIGURED'
  | 'ANCHOR_BALANCE_UNAVAILABLE'
  | 'ANCHOR_UNFUNDED';

/**
 * Diagnostico EXPLICITO de red. Nunca se persiste y nunca cambia `readyToIssue`
 * ni el estado de la identidad tecnica: una caida del RPC no es un compromiso
 * de clave.
 */
export interface IssuerNetworkHealthResponseDto {
  status: IssuerNetworkHealthStatus;
  reasons: IssuerNetworkHealthReason[];
  chainMatched: boolean | null;
  contractCodePresent: boolean | null;
  latestBlockObserved: boolean | null;
  /** `balance > 0`. No hay umbral configurado en el repo; no se inventa uno. */
  anchorFunded: boolean | null;
  network: string | null;
  chainId: number | null;
  contractAddress: string | null;
  latestBlockNumber: number | null;
  /** Decimal en wei, como string para no perder precision. */
  anchorBalanceWei: string | null;
  checkedAt: string;
}

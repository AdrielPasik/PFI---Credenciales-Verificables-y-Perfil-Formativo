/**
 * Configuracion tecnica del emisor (S8c9). Solo lectura: no hay campos de
 * clave, ni de secreto, ni de ruta de almacenamiento.
 */
export type TechnicalCredentialType =
  | 'course'
  | 'academic_subject'
  | 'degree'
  | 'certification';

export type BlockchainTargetMode = 'mock' | 'credential_registry';

export interface TechnicalSignerVM {
  address: string;
  keyVersion: number;
  status: 'active' | 'retired' | 'compromised';
}

export interface IssuerTechnicalIdentityVM {
  issuerId: string;
  issuerName: string;
  authorizationStatus: 'pending' | 'authorized' | 'revoked';
  allowedCredentialTypes: TechnicalCredentialType[];
  administrativelyAuthorized: boolean;
  configurationReady: boolean;
  hasCredentialCapabilities: boolean;
  readyToIssue: boolean;
  readinessReasons: string[];
  technicalIdentity: {
    status: 'unconfigured' | 'active' | 'rotation_required' | 'disabled';
    did: string;
    didDocumentUrl: string | null;
  } | null;
  assertionSigner: TechnicalSignerVM | null;
  anchorSigner: (TechnicalSignerVM & { shared: boolean }) | null;
  blockchainTarget: {
    mode: BlockchainTargetMode | null;
    network: string | null;
    chainId: number | null;
    contractAddress: string | null;
    deploymentId: string | null;
  };
}

export type NetworkHealthStatus =
  | 'HEALTHY'
  | 'DEGRADED'
  | 'UNAVAILABLE'
  | 'NOT_APPLICABLE_MOCK';

export interface IssuerNetworkHealthVM {
  status: NetworkHealthStatus;
  reasons: string[];
  chainMatched: boolean | null;
  contractCodePresent: boolean | null;
  latestBlockObserved: boolean | null;
  anchorFunded: boolean | null;
  network: string | null;
  chainId: number | null;
  contractAddress: string | null;
  latestBlockNumber: number | null;
  anchorBalanceWei: string | null;
  checkedAt: string;
}

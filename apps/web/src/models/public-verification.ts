import type { CredentialType } from '@/models/credentials';

export type PublicVerificationStatus = 'issued' | 'revoked';
export type PublicVerificationResult =
  | 'valid_issued'
  | 'revoked'
  | 'not_verifiable';

/**
 * Titular AUTORITATIVO del veredicto. Lo decide el servidor con una unica
 * funcion pura; la web NO lo recalcula. `result` (abajo) es solo una proyeccion
 * de compatibilidad con menos resolucion.
 */
export type PublicVerificationHeadline =
  | 'VERIFIED'
  | 'VERIFIED_WITH_LIMITED_EVIDENCE'
  | 'INVALID'
  | 'REVOKED'
  | 'INDETERMINATE';

export type PublicAuthenticityResult = 'VERIFIED' | 'INVALID' | 'INDETERMINATE';

export type PublicBlockchainEvidenceResult =
  | 'REGISTERED'
  | 'PENDING'
  | 'REVOKED_ON_CHAIN'
  | 'NOT_FOUND'
  | 'UNAVAILABLE'
  | 'NOT_APPLICABLE_MOCK'
  | 'REGISTRANT_UNEXPECTED';

export type PublicBlockchainNetwork = 'anvil' | 'base_sepolia';
export type PublicEvidenceMode = 'mock' | 'credential_registry';

/** Firma publica `scope-proof-v1`. Material publico: no es una clave. */
export interface PublicVerificationProofVM {
  cryptosuite: string;
  verificationMethod: string;
  proofValue: string;
}

export interface PublicCredentialVerificationVM {
  credentialReference: string;
  status: PublicVerificationStatus;
  statusLabel: string;
  title: string;
  type: CredentialType;
  typeLabel: string;
  issuerName: string;
  issuerDid: string | null;
  holderLabel: string | null;
  holderDid: string | null;
  issuedAtLabel: string | null;
  revokedAtLabel: string | null;
  revocationReason: string | null;
  canonicalHash: string | null;
  canonicalHashShort: string | null;
  canonicalizationVersion: string | null;
  proof: PublicVerificationProofVM | null;
  integrity: {
    canonicalHashPresent: boolean;
    blockchainRecordsCount: number;
    latestBlockchainRecord: {
      network: PublicBlockchainNetwork;
      networkLabel: string;
      chainId: number;
      /** `mock` = evidencia local simulada, no un registro en una red publica. */
      evidenceMode: PublicEvidenceMode | null;
      txHash: string | null;
      txHashShort: string | null;
      statusLabel: string;
      registeredAtLabel: string | null;
      revokedAtLabel: string | null;
      contractAddress: string | null;
      deploymentId: string | null;
      blockNumber: number | null;
      registrantAddress: string | null;
    } | null;
  };
  verification: {
    result: PublicVerificationResult;
    summary: string;
    checkedAtLabel: string;
    headline: PublicVerificationHeadline;
    authenticity: { result: PublicAuthenticityResult; reason: string };
    blockchainEvidence: { result: PublicBlockchainEvidenceResult; reason: string };
  };
}

export interface PublicVerificationFeedback {
  code: 'invalid_input' | 'not_found' | 'service_unavailable' | 'network' | 'incompatible_response';
  message: string;
}

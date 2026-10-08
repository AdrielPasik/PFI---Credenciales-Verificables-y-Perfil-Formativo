import { BlockchainNetwork, BlockchainRecordStatus, CredentialType } from '@prisma/client';

import {
  type BlockchainEvidence,
  type BlockchainEvidenceReason,
  type CredentialAuthenticity,
  type CredentialAuthenticityReason,
  type PublicCredentialVerificationResult,
  type VerificationCredentialStatus,
  type VerificationHeadline
} from '../verification-outcome';

export { type PublicCredentialVerificationResult };

export interface PublicVerificationIssuerDto {
  displayName: string;
  /**
   * DID LEGACY de `Issuer.did`. Se conserva con su significado original por
   * compatibilidad. NO es el DID tecnico con el que se verifica autenticidad:
   * ese es `technicalDid`.
   */
  did: string | null;
  /**
   * `IssuerTechnicalIdentity.did` -- el DID contra el que se resuelve el
   * documento publico y se verifica la firma. Agregado en S8c7.
   */
  technicalDid: string | null;
}

export interface PublicVerificationHolderDto {
  displayLabel: string | null;
  did: string | null;
}

export interface PublicVerificationBlockchainRecordDto {
  network: BlockchainNetwork;
  networkLabel: string;
  chainId: number;
  txHash: string | null;
  txHashShort: string | null;
  status: BlockchainRecordStatus;
  statusLabel: string;
  registeredAt: string | null;
}

/** Dimension de autenticidad: resultado + motivo con codigo cerrado. */
export interface PublicVerificationAuthenticityDto {
  result: CredentialAuthenticity;
  reason: CredentialAuthenticityReason;
}

/** Dimension de evidencia de blockchain: resultado + motivo cerrado. */
export interface PublicVerificationBlockchainEvidenceDto {
  result: BlockchainEvidence;
  reason: BlockchainEvidenceReason;
}

export interface VerifyCredentialResponseDto {
  credentialReference: string;
  exists: true;
  status: 'issued' | 'revoked';
  statusLabel: string;
  title: string;
  type: CredentialType;
  typeLabel: string;
  issuer: PublicVerificationIssuerDto;
  holder: PublicVerificationHolderDto;
  issuedAt: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  canonicalHash: string | null;
  canonicalHashShort: string | null;
  canonicalizationVersion: string | null;
  integrity: {
    canonicalHashPresent: boolean;
    blockchainRecordsCount: number;
    /**
     * La UNICA fila de evidencia de la credencial, o `null`.
     *
     * `null` cuando no hay ninguna fila Y TAMBIEN cuando hay mas de una: con
     * mas de una, ninguna puede llamarse "la ultima" honestamente -- la tabla
     * no tiene `createdAt`, una fila `pending` tiene `registeredAt` NULL y el
     * orden de UUID no es cronologia. Exponer una fila arbitraria para que la
     * pantalla muestre algo seria presentar un dato elegido al azar como si
     * fuera el vigente.
     */
    latestBlockchainRecord: PublicVerificationBlockchainRecordDto | null;
  };
  verification: {
    /**
     * CAMPO DE COMPATIBILIDAD. Es una proyeccion de `headline`, con menos
     * resolucion, que se conserva porque el cliente web desplegado valida este
     * conjunto cerrado de tres valores.
     *
     * NO es la fuente de verdad y no se calcula por un camino propio: sale
     * exclusivamente de `deriveLegacyVerificationResult(headline)`. Los campos
     * autoritativos son `headline`, `authenticity`, `credentialStatus` y
     * `blockchainEvidence`.
     */
    result: PublicCredentialVerificationResult;
    summary: string;
    checkedAt: string;
    /** AUTORITATIVO. Derivado por una unica funcion pura. */
    headline: VerificationHeadline;
    /** AUTORITATIVO. Firmo una clave autorizada por el DID este payload? */
    authenticity: PublicVerificationAuthenticityDto;
    /** AUTORITATIVO. Vigente o revocada, con revocacion monotonica. */
    credentialStatus: VerificationCredentialStatus;
    /** AUTORITATIVO. Que se puede observar en la cadena ahora mismo. */
    blockchainEvidence: PublicVerificationBlockchainEvidenceDto;
  };
}

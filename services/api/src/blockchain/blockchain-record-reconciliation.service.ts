import { Injectable, Optional } from '@nestjs/common';
import {
  BlockchainRecordStatus,
  CredentialStatus
} from '@prisma/client';

import {
  type BlockchainRecordDeploymentIdentity,
  type CredentialRegistryDeployment,
  CredentialRegistryDeploymentResolver
} from './credential-registry-deployment';
import {
  type CredentialRegistryRecordBoundReader,
  CredentialRegistryReadClient
} from './credential-registry-read-client';

export type BlockchainRecordReconciliationState =
  | 'DB_ISSUED_CHAIN_ACTIVE'
  | 'DB_ISSUED_CHAIN_REVOKED'
  | 'DB_REVOKED_CHAIN_REVOKED'
  | 'DB_REVOKED_CHAIN_ACTIVE'
  | 'CHAIN_RECORD_MISSING'
  | 'DEPLOYMENT_UNRESOLVED'
  | 'MOCK_UNSUPPORTED'
  | 'LEGACY_UNRESOLVABLE'
  | 'CREDENTIAL_CORRELATION_FAILED'
  | 'DB_STATE_UNSUPPORTED';

export interface CredentialReconciliationIdentity {
  status: CredentialStatus;
  canonicalHash: string | null;
  canonicalizationVersion: string | null;
}

export interface BlockchainRecordReconciliationIdentity
  extends BlockchainRecordDeploymentIdentity {
  status: BlockchainRecordStatus;
  canonicalizationVersion: string;
}

export interface BlockchainRecordReconciliationResult {
  state: BlockchainRecordReconciliationState;
  chainRevoked: boolean | null;
  /**
   * Solo esta disponible cuando el record se resolvio y se leyo contra el
   * deployment exacto que lo emitio. Es un dato interno, no un DTO HTTP.
   */
  resolvedDeployment: CredentialRegistryDeployment | null;
  /** Timestamp del contrato, expresado en segundos Unix, si fue revocado. */
  chainRevokedAt: string | null;
}

@Injectable()
export class BlockchainRecordReconciliationService {
  constructor(
    private readonly deploymentResolver: CredentialRegistryDeploymentResolver,
    @Optional()
    private readonly registryReader: CredentialRegistryRecordBoundReader = new CredentialRegistryReadClient()
  ) {}

  async classify(input: {
    credential: CredentialReconciliationIdentity;
    blockchainRecord: BlockchainRecordReconciliationIdentity | null;
  }): Promise<BlockchainRecordReconciliationResult> {
    const record = input.blockchainRecord;

    if (!record) {
      return unresolved('CHAIN_RECORD_MISSING');
    }

    if (
      input.credential.canonicalHash !== record.credentialHash ||
      input.credential.canonicalizationVersion !== record.canonicalizationVersion
    ) {
      return unresolved('CREDENTIAL_CORRELATION_FAILED');
    }

    const resolution = this.deploymentResolver.resolve(record);
    if (resolution.kind === 'mock_unsupported') {
      return unresolved('MOCK_UNSUPPORTED');
    }
    if (resolution.kind === 'deployment_unresolved') {
      return unresolved('DEPLOYMENT_UNRESOLVED');
    }

    const chainState = await this.registryReader.readRecordBoundCredentialState({
      deployment: resolution.deployment,
      record
    });

    if (
      chainState.kind === 'credential_missing' ||
      chainState.kind === 'credential_issuer_mismatch'
    ) {
      return record.network === 'anvil'
        ? unresolved('LEGACY_UNRESOLVABLE')
        : unresolved('CREDENTIAL_CORRELATION_FAILED');
    }

    if (chainState.kind !== 'credential_state') {
      return unresolved('CREDENTIAL_CORRELATION_FAILED');
    }

    if (input.credential.status === CredentialStatus.issued) {
      return {
        state: chainState.status.revoked
          ? 'DB_ISSUED_CHAIN_REVOKED'
          : 'DB_ISSUED_CHAIN_ACTIVE',
        chainRevoked: chainState.status.revoked,
        resolvedDeployment: resolution.deployment,
        chainRevokedAt: chainState.status.revokedAt
      };
    }

    if (input.credential.status === CredentialStatus.revoked) {
      return {
        state: chainState.status.revoked
          ? 'DB_REVOKED_CHAIN_REVOKED'
          : 'DB_REVOKED_CHAIN_ACTIVE',
        chainRevoked: chainState.status.revoked,
        resolvedDeployment: resolution.deployment,
        chainRevokedAt: chainState.status.revokedAt
      };
    }

    return {
      state: 'DB_STATE_UNSUPPORTED',
      chainRevoked: chainState.status.revoked,
      resolvedDeployment: resolution.deployment,
      chainRevokedAt: chainState.status.revokedAt
    };
  }
}

function unresolved(
  state: Exclude<
    BlockchainRecordReconciliationState,
    | 'DB_ISSUED_CHAIN_ACTIVE'
    | 'DB_ISSUED_CHAIN_REVOKED'
    | 'DB_REVOKED_CHAIN_REVOKED'
    | 'DB_REVOKED_CHAIN_ACTIVE'
    | 'DB_STATE_UNSUPPORTED'
  >
): BlockchainRecordReconciliationResult {
  return {
    state,
    chainRevoked: null,
    resolvedDeployment: null,
    chainRevokedAt: null
  };
}

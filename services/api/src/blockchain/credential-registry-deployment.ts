import { Injectable } from '@nestjs/common';
import { BlockchainNetwork } from '@prisma/client';
import { getAddress, isAddress } from 'ethers';

export const ANVIL_CHAIN_ID = 31337;
export const MOCK_REGISTRY_CONTRACT_ADDRESS =
  '0x0000000000000000000000000000000000000001';

export interface BlockchainRecordDeploymentIdentity {
  network: BlockchainNetwork;
  chainId: number;
  contractAddress: string;
  credentialHash: string;
  issuerAddress: string;
}

export interface CredentialRegistryDeployment {
  network: BlockchainNetwork;
  chainId: number;
  rpcUrl: string;
  contractAddress: string;
}

export interface CredentialRegistryDeploymentEnvironment {
  BLOCKCHAIN_EVIDENCE_MODE?: string;
  CREDENTIAL_REGISTRY_RPC_URL?: string;
  CREDENTIAL_REGISTRY_CONTRACT_ADDRESS?: string;
}

export type RecordBoundDeploymentResolution =
  | {
      kind: 'resolved';
      deployment: CredentialRegistryDeployment;
    }
  | {
      kind: 'mock_unsupported';
    }
  | {
      kind: 'deployment_unresolved';
      reason:
        | 'unsupported_network'
        | 'unexpected_chain_id'
        | 'registry_mode_not_enabled'
        | 'missing_rpc_url'
        | 'missing_contract_address'
        | 'invalid_configured_contract_address'
        | 'contract_address_mismatch';
    };

@Injectable()
export class CredentialRegistryDeploymentResolver {
  resolve(
    record: BlockchainRecordDeploymentIdentity,
    environment: CredentialRegistryDeploymentEnvironment = process.env
  ): RecordBoundDeploymentResolution {
    if (isMockBlockchainRecord(record)) {
      return { kind: 'mock_unsupported' };
    }

    if (record.network !== BlockchainNetwork.anvil) {
      return {
        kind: 'deployment_unresolved',
        reason: 'unsupported_network'
      };
    }

    if (record.chainId !== ANVIL_CHAIN_ID) {
      return {
        kind: 'deployment_unresolved',
        reason: 'unexpected_chain_id'
      };
    }

    if (environment.BLOCKCHAIN_EVIDENCE_MODE !== 'credential_registry_anvil') {
      return {
        kind: 'deployment_unresolved',
        reason: 'registry_mode_not_enabled'
      };
    }

    const rpcUrl = normalizeRequiredText(
      environment.CREDENTIAL_REGISTRY_RPC_URL
    );
    if (!rpcUrl) {
      return { kind: 'deployment_unresolved', reason: 'missing_rpc_url' };
    }

    const configuredContractAddress = normalizeAddress(
      environment.CREDENTIAL_REGISTRY_CONTRACT_ADDRESS
    );
    if (!configuredContractAddress) {
      return {
        kind: 'deployment_unresolved',
        reason: environment.CREDENTIAL_REGISTRY_CONTRACT_ADDRESS
          ? 'invalid_configured_contract_address'
          : 'missing_contract_address'
      };
    }

    const recordContractAddress = normalizeAddress(record.contractAddress);
    if (!recordContractAddress || recordContractAddress !== configuredContractAddress) {
      return {
        kind: 'deployment_unresolved',
        reason: 'contract_address_mismatch'
      };
    }

    return {
      kind: 'resolved',
      deployment: {
        network: BlockchainNetwork.anvil,
        chainId: ANVIL_CHAIN_ID,
        rpcUrl,
        contractAddress: configuredContractAddress
      }
    };
  }
}

export function deploymentMatchesBlockchainRecord(
  deployment: CredentialRegistryDeployment,
  record: Pick<
    BlockchainRecordDeploymentIdentity,
    'network' | 'chainId' | 'contractAddress'
  >
): boolean {
  const recordContractAddress = normalizeAddress(record.contractAddress);

  return (
    deployment.network === record.network &&
    deployment.chainId === record.chainId &&
    recordContractAddress !== null &&
    deployment.contractAddress === recordContractAddress
  );
}

export function isMockBlockchainRecord(
  record: Pick<
    BlockchainRecordDeploymentIdentity,
    'network' | 'chainId' | 'contractAddress'
  >
): boolean {
  const contractAddress = normalizeAddress(record.contractAddress);

  return (
    record.network === BlockchainNetwork.anvil &&
    record.chainId === ANVIL_CHAIN_ID &&
    contractAddress === getAddress(MOCK_REGISTRY_CONTRACT_ADDRESS)
  );
}

function normalizeRequiredText(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeAddress(value: string | undefined): string | null {
  if (!value || !isAddress(value)) {
    return null;
  }

  return getAddress(value);
}

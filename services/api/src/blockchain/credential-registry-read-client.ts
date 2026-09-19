import { Injectable, Optional } from '@nestjs/common';
import { Contract, JsonRpcProvider, ZeroAddress, getAddress, isAddress } from 'ethers';

import {
  type BlockchainRecordDeploymentIdentity,
  type CredentialRegistryDeployment,
  deploymentMatchesBlockchainRecord
} from './credential-registry-deployment';

const CREDENTIAL_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

const CREDENTIAL_REGISTRY_READ_ABI = [
  'function getCredentialStatus(bytes32 credentialHash) view returns (bool exists, bool revoked, address issuer, uint256 registeredAt, uint256 revokedAt)'
] as const;

type CredentialRegistryStatusTuple = readonly [
  boolean,
  boolean,
  string,
  bigint,
  bigint
];

type CredentialRegistryStatusStruct = {
  exists: boolean;
  revoked: boolean;
  issuer: string;
  registeredAt: bigint;
  revokedAt: bigint;
};

type RawCredentialRegistryStatus =
  | CredentialRegistryStatusTuple
  | CredentialRegistryStatusStruct;

type CredentialRegistryContractReader = {
  getCredentialStatus(
    credentialHash: string
  ): Promise<RawCredentialRegistryStatus>;
};

type CredentialRegistryNetworkProvider = {
  getNetwork(): Promise<{ chainId: bigint }>;
  getCode(address: string): Promise<string>;
};

type CredentialRegistryReadClientOptions = {
  rpcUrl?: string;
  contractAddress?: string;
  contractReader?: CredentialRegistryContractReader;
  networkProvider?: CredentialRegistryNetworkProvider;
};

type CredentialRegistryReadClientConfig = {
  rpcUrl: string;
  contractAddress: string;
};

export type NormalizedCredentialRegistryStatus = {
  credentialHash: string;
  exists: boolean;
  revoked: boolean;
  issuer: string | null;
  registeredAt: string | null;
  revokedAt: string | null;
};

export interface CredentialRegistryStatusReader {
  getCredentialStatus(
    credentialHash: string
  ): Promise<NormalizedCredentialRegistryStatus>;
}

export type RecordBoundCredentialRegistryReadResult =
  | {
      kind: 'credential_state';
      status: NormalizedCredentialRegistryStatus;
    }
  | {
      kind:
        | 'record_deployment_mismatch'
        | 'rpc_chain_id_mismatch'
        | 'contract_code_missing'
        | 'registry_read_failed'
        | 'credential_missing'
        | 'credential_issuer_mismatch';
    };

export interface CredentialRegistryRecordBoundReader {
  readRecordBoundCredentialState(input: {
    deployment: CredentialRegistryDeployment;
    record: BlockchainRecordDeploymentIdentity;
  }): Promise<RecordBoundCredentialRegistryReadResult>;
}

@Injectable()
export class CredentialRegistryReadClient
  implements CredentialRegistryStatusReader, CredentialRegistryRecordBoundReader
{
  private readonly rpcUrl?: string;
  private readonly contractAddress?: string;
  private readonly contractReader?: CredentialRegistryContractReader;
  private readonly networkProvider?: CredentialRegistryNetworkProvider;

  constructor(@Optional() options: CredentialRegistryReadClientOptions = {}) {
    this.rpcUrl = options.rpcUrl ?? process.env.CREDENTIAL_REGISTRY_RPC_URL;
    this.contractAddress =
      options.contractAddress ??
      process.env.CREDENTIAL_REGISTRY_CONTRACT_ADDRESS;
    this.contractReader = options.contractReader;
    this.networkProvider = options.networkProvider;
  }

  async getCredentialStatus(
    credentialHash: string
  ): Promise<NormalizedCredentialRegistryStatus> {
    const normalizedHash = validateCredentialHash(credentialHash);
    const reader = this.contractReader ?? this.createContractReader({
      rpcUrl: this.rpcUrl,
      contractAddress: this.contractAddress
    });
    const rawStatus = await reader.getCredentialStatus(normalizedHash);

    return normalizeCredentialRegistryStatus(normalizedHash, rawStatus);
  }

  async readRecordBoundCredentialState(input: {
    deployment: CredentialRegistryDeployment;
    record: BlockchainRecordDeploymentIdentity;
  }): Promise<RecordBoundCredentialRegistryReadResult> {
    if (!deploymentMatchesBlockchainRecord(input.deployment, input.record)) {
      return { kind: 'record_deployment_mismatch' };
    }

    const provider =
      this.networkProvider ?? this.createNetworkProvider(input.deployment.rpcUrl);

    let chainId: bigint;
    try {
      chainId = (await provider.getNetwork()).chainId;
    } catch {
      return { kind: 'rpc_chain_id_mismatch' };
    }

    if (chainId !== BigInt(input.deployment.chainId)) {
      return { kind: 'rpc_chain_id_mismatch' };
    }

    let contractCode: string;
    try {
      contractCode = await provider.getCode(input.deployment.contractAddress);
    } catch {
      return { kind: 'contract_code_missing' };
    }

    if (!contractCode || contractCode === '0x') {
      return { kind: 'contract_code_missing' };
    }

    let status: NormalizedCredentialRegistryStatus;
    try {
      const reader =
        this.contractReader ?? this.createContractReader(input.deployment);
      const rawStatus = await reader.getCredentialStatus(
        validateCredentialHash(input.record.credentialHash)
      );
      status = normalizeCredentialRegistryStatus(
        validateCredentialHash(input.record.credentialHash),
        rawStatus
      );
    } catch {
      return { kind: 'registry_read_failed' };
    }

    if (!status.exists) {
      return { kind: 'credential_missing' };
    }

    if (!addressesMatch(status.issuer, input.record.issuerAddress)) {
      return { kind: 'credential_issuer_mismatch' };
    }

    return { kind: 'credential_state', status };
  }

  private createNetworkProvider(rpcUrl: string): CredentialRegistryNetworkProvider {
    return new JsonRpcProvider(rpcUrl);
  }

  private createContractReader(
    input: Partial<CredentialRegistryReadClientConfig>
  ): CredentialRegistryContractReader {
    const config = resolveCredentialRegistryConfig(input);
    const provider = new JsonRpcProvider(config.rpcUrl);
    const contract = new Contract(
      config.contractAddress,
      CREDENTIAL_REGISTRY_READ_ABI,
      provider
    );

    return {
      async getCredentialStatus(credentialHash: string) {
        return (await contract.getCredentialStatus(
          credentialHash
        )) as RawCredentialRegistryStatus;
      }
    };
  }
}

export function validateCredentialHash(credentialHash: string) {
  if (!credentialHash) {
    throw new Error('credentialHash es requerido.');
  }

  if (!CREDENTIAL_HASH_PATTERN.test(credentialHash)) {
    throw new Error(
      'credentialHash debe tener formato 0x seguido por 64 caracteres hexadecimales.'
    );
  }

  return credentialHash.toLowerCase();
}

export function resolveCredentialRegistryConfig(
  input: Partial<CredentialRegistryReadClientConfig>
): CredentialRegistryReadClientConfig {
  if (!input.rpcUrl) {
    throw new Error('CREDENTIAL_REGISTRY_RPC_URL es requerido.');
  }

  if (!input.contractAddress) {
    throw new Error('CREDENTIAL_REGISTRY_CONTRACT_ADDRESS es requerido.');
  }

  if (!isAddress(input.contractAddress)) {
    throw new Error(
      'CREDENTIAL_REGISTRY_CONTRACT_ADDRESS debe ser una direccion Ethereum valida.'
    );
  }

  return {
    rpcUrl: input.rpcUrl,
    contractAddress: getAddress(input.contractAddress)
  };
}

export function normalizeCredentialRegistryStatus(
  credentialHash: string,
  rawStatus: RawCredentialRegistryStatus
): NormalizedCredentialRegistryStatus {
  const status = toCredentialRegistryStatusStruct(rawStatus);

  return {
    credentialHash,
    exists: status.exists,
    revoked: status.revoked,
    issuer:
      status.issuer && status.issuer !== ZeroAddress
        ? getAddress(status.issuer)
        : null,
    registeredAt: normalizeTimestamp(status.registeredAt),
    revokedAt: normalizeTimestamp(status.revokedAt)
  };
}

function toCredentialRegistryStatusStruct(
  rawStatus: RawCredentialRegistryStatus
): CredentialRegistryStatusStruct {
  if (Array.isArray(rawStatus)) {
    const [exists, revoked, issuer, registeredAt, revokedAt] = rawStatus;

    return {
      exists,
      revoked,
      issuer,
      registeredAt,
      revokedAt
    };
  }

  const status = rawStatus as CredentialRegistryStatusStruct;

  return {
    exists: status.exists,
    revoked: status.revoked,
    issuer: status.issuer,
    registeredAt: status.registeredAt,
    revokedAt: status.revokedAt
  };
}

function normalizeTimestamp(value: bigint) {
  return value > 0n ? value.toString(10) : null;
}

function addressesMatch(
  onChainAddress: string | null,
  persistedAddress: string
): boolean {
  if (!onChainAddress || !isAddress(persistedAddress)) {
    return false;
  }

  return onChainAddress === getAddress(persistedAddress);
}

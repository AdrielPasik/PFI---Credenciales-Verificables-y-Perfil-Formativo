import { Injectable } from '@nestjs/common';
import { Contract, JsonRpcProvider, ZeroAddress, getAddress, isAddress } from 'ethers';

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

type CredentialRegistryReadClientOptions = {
  rpcUrl?: string;
  contractAddress?: string;
  contractReader?: CredentialRegistryContractReader;
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

@Injectable()
export class CredentialRegistryReadClient
  implements CredentialRegistryStatusReader
{
  private readonly rpcUrl?: string;
  private readonly contractAddress?: string;
  private readonly contractReader?: CredentialRegistryContractReader;

  constructor(options: CredentialRegistryReadClientOptions = {}) {
    this.rpcUrl = options.rpcUrl ?? process.env.CREDENTIAL_REGISTRY_RPC_URL;
    this.contractAddress =
      options.contractAddress ??
      process.env.CREDENTIAL_REGISTRY_CONTRACT_ADDRESS;
    this.contractReader = options.contractReader;
  }

  async getCredentialStatus(
    credentialHash: string
  ): Promise<NormalizedCredentialRegistryStatus> {
    const normalizedHash = validateCredentialHash(credentialHash);
    const reader = this.contractReader ?? this.createContractReader();
    const rawStatus = await reader.getCredentialStatus(normalizedHash);

    return normalizeCredentialRegistryStatus(normalizedHash, rawStatus);
  }

  private createContractReader(): CredentialRegistryContractReader {
    const config = resolveCredentialRegistryConfig({
      rpcUrl: this.rpcUrl,
      contractAddress: this.contractAddress
    });
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

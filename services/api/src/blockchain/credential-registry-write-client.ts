import { Injectable } from '@nestjs/common';
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  getAddress,
  isAddress
} from 'ethers';

import {
  resolveCredentialRegistryConfig,
  validateCredentialHash
} from './credential-registry-read-client';

const PRIVATE_KEY_PATTERN = /^0x[a-fA-F0-9]{64}$/;

const CREDENTIAL_REGISTRY_WRITE_ABI = [
  'function registerCredential(bytes32 credentialHash)',
  'function revokeCredential(bytes32 credentialHash)'
] as const;

type MinimalTransactionReceipt = {
  status?: number | null;
  blockNumber?: number | null;
};

type MinimalTransactionResponse = {
  hash: string;
  from?: string | null;
  to?: string | null;
  wait(): Promise<MinimalTransactionReceipt | null>;
};

type CredentialRegistryContractWriter = {
  registerCredential(
    credentialHash: string
  ): Promise<MinimalTransactionResponse>;
  revokeCredential(
    credentialHash: string
  ): Promise<MinimalTransactionResponse>;
};

type CredentialRegistryWriteClientOptions = {
  rpcUrl?: string;
  contractAddress?: string;
  privateKey?: string;
  contractWriter?: CredentialRegistryContractWriter;
};

type CredentialRegistryWriteClientConfig = {
  rpcUrl: string;
  contractAddress: string;
  privateKey: string;
};

export type NormalizedCredentialRegistryWriteResult = {
  credentialHash: string;
  transactionHash: string;
  from: string | null;
  to: string | null;
  status: 'success' | 'failed' | 'unknown';
  blockNumber: string | null;
};

@Injectable()
export class CredentialRegistryWriteClient {
  private readonly rpcUrl?: string;
  private readonly contractAddress?: string;
  private readonly privateKey?: string;
  private readonly contractWriter?: CredentialRegistryContractWriter;

  constructor(options: CredentialRegistryWriteClientOptions = {}) {
    this.rpcUrl = options.rpcUrl ?? process.env.CREDENTIAL_REGISTRY_RPC_URL;
    this.contractAddress =
      options.contractAddress ??
      process.env.CREDENTIAL_REGISTRY_CONTRACT_ADDRESS;
    this.privateKey =
      options.privateKey ?? process.env.CREDENTIAL_REGISTRY_PRIVATE_KEY;
    this.contractWriter = options.contractWriter;
  }

  async registerCredential(
    credentialHash: string
  ): Promise<NormalizedCredentialRegistryWriteResult> {
    return this.executeWrite('registerCredential', credentialHash);
  }

  async revokeCredential(
    credentialHash: string
  ): Promise<NormalizedCredentialRegistryWriteResult> {
    return this.executeWrite('revokeCredential', credentialHash);
  }

  private async executeWrite(
    method: keyof CredentialRegistryContractWriter,
    credentialHash: string
  ) {
    const normalizedHash = validateCredentialHash(credentialHash);
    const writer = this.contractWriter ?? this.createContractWriter();
    const transaction = await writer[method](normalizedHash);
    const receipt = await transaction.wait();

    return normalizeCredentialRegistryWriteResult(
      normalizedHash,
      transaction,
      receipt
    );
  }

  private createContractWriter(): CredentialRegistryContractWriter {
    const config = resolveCredentialRegistryWriteConfig({
      rpcUrl: this.rpcUrl,
      contractAddress: this.contractAddress,
      privateKey: this.privateKey
    });
    const provider = new JsonRpcProvider(config.rpcUrl);
    const wallet = new Wallet(config.privateKey, provider);
    const contract = new Contract(
      config.contractAddress,
      CREDENTIAL_REGISTRY_WRITE_ABI,
      wallet
    );

    return {
      async registerCredential(credentialHash: string) {
        return (await contract.registerCredential(
          credentialHash
        )) as MinimalTransactionResponse;
      },
      async revokeCredential(credentialHash: string) {
        return (await contract.revokeCredential(
          credentialHash
        )) as MinimalTransactionResponse;
      }
    };
  }
}

export function validateCredentialRegistryPrivateKey(privateKey: string) {
  if (!privateKey) {
    throw new Error('CREDENTIAL_REGISTRY_PRIVATE_KEY es requerida.');
  }

  if (!PRIVATE_KEY_PATTERN.test(privateKey)) {
    throw new Error(
      'CREDENTIAL_REGISTRY_PRIVATE_KEY debe tener formato 0x seguido por 64 caracteres hexadecimales.'
    );
  }

  return privateKey;
}

export function resolveCredentialRegistryWriteConfig(
  input: Partial<CredentialRegistryWriteClientConfig>
): CredentialRegistryWriteClientConfig {
  const registryConfig = resolveCredentialRegistryConfig({
    rpcUrl: input.rpcUrl,
    contractAddress: input.contractAddress
  });
  const privateKey = validateCredentialRegistryPrivateKey(
    input.privateKey ?? ''
  );

  return {
    rpcUrl: registryConfig.rpcUrl,
    contractAddress: registryConfig.contractAddress,
    privateKey
  };
}

export function normalizeCredentialRegistryWriteResult(
  credentialHash: string,
  transaction: Pick<MinimalTransactionResponse, 'hash' | 'from' | 'to'>,
  receipt: MinimalTransactionReceipt | null
): NormalizedCredentialRegistryWriteResult {
  return {
    credentialHash,
    transactionHash: transaction.hash,
    from: normalizeAddress(transaction.from),
    to: normalizeAddress(transaction.to),
    status: normalizeReceiptStatus(receipt?.status),
    blockNumber:
      typeof receipt?.blockNumber === 'number'
        ? receipt.blockNumber.toString(10)
        : null
  };
}

function normalizeAddress(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  if (!isAddress(value)) {
    return null;
  }

  return getAddress(value);
}

function normalizeReceiptStatus(status: number | null | undefined) {
  if (status === 1) {
    return 'success' as const;
  }

  if (status === 0) {
    return 'failed' as const;
  }

  return 'unknown' as const;
}


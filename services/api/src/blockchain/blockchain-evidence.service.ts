import { Injectable } from '@nestjs/common';
import {
  BlockchainRecordStatus,
  BlockchainNetwork,
  Prisma
} from '@prisma/client';
import { createHash } from 'crypto';

import { resolveCredentialRegistryConfig } from './credential-registry-read-client';
import { CredentialRegistryWriteClient } from './credential-registry-write-client';

type BlockchainEvidenceMode = 'mock' | 'credential_registry_anvil';

@Injectable()
export class BlockchainEvidenceService {
  async createRecord(
    transaction: Prisma.TransactionClient,
    input: {
      credentialId: string;
      credentialHash: string;
      canonicalizationVersion: string;
      issuerAddress: string;
    }
  ) {
    const mode = this.resolveEvidenceMode();

    if (mode === 'mock') {
      return this.createMockRecord(transaction, input);
    }

    return this.createCredentialRegistryAnvilRecord(transaction, input);
  }

  private async createMockRecord(
    transaction: Prisma.TransactionClient,
    input: {
      credentialId: string;
      credentialHash: string;
      canonicalizationVersion: string;
      issuerAddress: string;
    }
  ) {
    const txHash = this.createMockTransactionHash(
      input.credentialId,
      input.credentialHash
    );

    return transaction.blockchainRecord.create({
      data: {
        credentialId: input.credentialId,
        credentialHash: input.credentialHash,
        hashAlgorithm: 'sha-256',
        canonicalizationVersion: input.canonicalizationVersion,
        network: BlockchainNetwork.anvil,
        chainId: 31337,
        contractAddress: '0x0000000000000000000000000000000000000001',
        txHash,
        issuerAddress: input.issuerAddress,
        registeredAt: new Date(),
        status: BlockchainRecordStatus.registered
      }
    });
  }

  private async createCredentialRegistryAnvilRecord(
    transaction: Prisma.TransactionClient,
    input: {
      credentialId: string;
      credentialHash: string;
      canonicalizationVersion: string;
      issuerAddress: string;
    }
  ) {
    if (!input.credentialHash) {
      throw new Error(
        'credentialHash es requerido para registrar evidencia en CredentialRegistry.'
      );
    }

    const contractConfig = resolveCredentialRegistryConfig({
      rpcUrl: process.env.CREDENTIAL_REGISTRY_RPC_URL,
      contractAddress: process.env.CREDENTIAL_REGISTRY_CONTRACT_ADDRESS
    });

    let transactionResult;

    try {
      transactionResult = await this.createWriteClient().registerCredential(
        input.credentialHash
      );
    } catch (error) {
      throw new Error(
        `No se pudo registrar el hash on-chain en CredentialRegistry: ${this.getErrorMessage(
          error
        )}`
      );
    }

    if (transactionResult.status !== 'success') {
      throw new Error(
        `La transaccion de CredentialRegistry no fue exitosa para ${input.credentialHash}.`
      );
    }

    return transaction.blockchainRecord.create({
      data: {
        credentialId: input.credentialId,
        credentialHash: input.credentialHash,
        hashAlgorithm: 'sha-256',
        canonicalizationVersion: input.canonicalizationVersion,
        network: BlockchainNetwork.anvil,
        chainId: 31337,
        contractAddress: contractConfig.contractAddress,
        txHash: transactionResult.transactionHash,
        issuerAddress: transactionResult.from ?? input.issuerAddress,
        registeredAt: new Date(),
        status: BlockchainRecordStatus.registered
      }
    });
  }

  private createMockTransactionHash(credentialId: string, credentialHash: string) {
    return `0x${createHash('sha256')
      .update(`mock-tx:${credentialId}:${credentialHash}`, 'utf8')
      .digest('hex')}`;
  }

  protected createWriteClient() {
    return new CredentialRegistryWriteClient();
  }

  private resolveEvidenceMode(): BlockchainEvidenceMode {
    const rawMode = process.env.BLOCKCHAIN_EVIDENCE_MODE;

    if (!rawMode || rawMode === 'mock') {
      return 'mock';
    }

    if (rawMode === 'credential_registry_anvil') {
      return 'credential_registry_anvil';
    }

    throw new Error(
      `BLOCKCHAIN_EVIDENCE_MODE invalido: ${rawMode}. Valores permitidos: mock, credential_registry_anvil.`
    );
  }

  private getErrorMessage(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }
}

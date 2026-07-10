import { Injectable } from '@nestjs/common';
import {
  BlockchainRecordStatus,
  Prisma
} from '@prisma/client';
import { createHash } from 'crypto';

@Injectable()
export class BlockchainEvidenceService {
  async createMockRecord(
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
        network: 'anvil',
        chainId: 31337,
        contractAddress: '0x0000000000000000000000000000000000000001',
        txHash,
        issuerAddress: input.issuerAddress,
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
}

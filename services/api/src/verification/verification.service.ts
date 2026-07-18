import { Injectable, NotFoundException } from '@nestjs/common';
import {
  BlockchainRecordStatus,
  CredentialStatus
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { SemanticService } from '../semantic/semantic.service';
import {
  type CredentialVerificationStatus,
  type VerifyCredentialResponseDto
} from './dto/verify-credential-response.dto';

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly semanticService: SemanticService
  ) {}

  async getCredentialVerification(
    credentialId: string
  ): Promise<VerifyCredentialResponseDto> {
    const credential = await this.prisma.credential.findUnique({
      where: {
        id: credentialId
      },
      include: {
        blockchainRecords: {
          orderBy: {
            registeredAt: 'desc'
          }
        }
      }
    });

    if (!credential) {
      throw new NotFoundException(`Credential ${credentialId} no existe.`);
    }

    const latestSemanticAnalysis =
      await this.semanticService.getLatestForCredential(credentialId);

    return {
      credentialId: credential.id,
      verificationStatus: this.getVerificationStatus({
        status: credential.status,
        canonicalHash: credential.canonicalHash,
        canonicalizationVersion: credential.canonicalizationVersion,
        blockchainRecords: credential.blockchainRecords.map((record) => ({
          status: record.status
        }))
      }),
      credential: {
        id: credential.id,
        title: credential.title,
        status: credential.status,
        issuedAt: credential.issuedAt
          ? this.serializeDateTime(credential.issuedAt)
          : null,
        revokedAt: credential.revokedAt
          ? this.serializeDateTime(credential.revokedAt)
          : null,
        revocationReason: credential.revocationReason,
        canonicalHash: credential.canonicalHash,
        canonicalizationVersion: credential.canonicalizationVersion
      },
      blockchain: {
        records: credential.blockchainRecords.map((record) => ({
          id: record.id,
          network: record.network,
          chainId: record.chainId,
          transactionHash: record.txHash,
          recordedAt: this.serializeDateTime(record.registeredAt),
          status: record.status
        }))
      },
      semanticAnalysis: {
        latest: latestSemanticAnalysis.latestSemanticAnalysis
          ? {
              id: latestSemanticAnalysis.latestSemanticAnalysis.id,
              schemaVersion:
                latestSemanticAnalysis.latestSemanticAnalysis.schemaVersion,
              status: latestSemanticAnalysis.latestSemanticAnalysis.status,
              pipelineVersion:
                latestSemanticAnalysis.latestSemanticAnalysis.pipelineVersion,
              taxonomyVersion:
                latestSemanticAnalysis.latestSemanticAnalysis.taxonomyVersion,
              confidence:
                latestSemanticAnalysis.latestSemanticAnalysis.confidence,
              areas: latestSemanticAnalysis.latestSemanticAnalysis.areas,
              skills: latestSemanticAnalysis.latestSemanticAnalysis.skills,
              concepts: latestSemanticAnalysis.latestSemanticAnalysis.concepts,
              qualityFlags:
                latestSemanticAnalysis.latestSemanticAnalysis.qualityFlags,
              analyzedAt:
                latestSemanticAnalysis.latestSemanticAnalysis.analyzedAt
            }
          : null
      }
    };
  }

  private getVerificationStatus(input: {
    status: CredentialStatus;
    canonicalHash: string | null;
    canonicalizationVersion: string | null;
    blockchainRecords: Array<{
      status: BlockchainRecordStatus;
    }>;
  }): CredentialVerificationStatus {
    if (input.status === CredentialStatus.revoked) {
      return 'revoked';
    }

    if (input.status === CredentialStatus.draft) {
      return 'draft';
    }

    if (
      input.status === CredentialStatus.issued &&
      input.canonicalHash &&
      input.canonicalizationVersion &&
      input.blockchainRecords.some(
        (record) => record.status === BlockchainRecordStatus.registered
      )
    ) {
      return 'valid';
    }

    return 'incomplete';
  }

  private serializeDateTime(value: Date) {
    return value.toISOString().replace('.000Z', 'Z');
  }
}

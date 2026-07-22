import {
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { CredentialStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { MeCredentialDetailResponseDto } from './dto/me-credential-detail-response.dto';
import { MeCredentialSummaryResponseDto } from './dto/me-credential-summary-response.dto';

const HOLDER_VISIBLE_STATUSES = [
  CredentialStatus.issued,
  CredentialStatus.revoked
] as const;

@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService) {}

  async listCredentialsForUser(
    userId: string
  ): Promise<MeCredentialSummaryResponseDto[]> {
    const credentials = await this.prisma.credential.findMany({
      where: {
        subjectUserId: userId,
        status: {
          in: [...HOLDER_VISIBLE_STATUSES]
        }
      },
      include: {
        issuer: {
          select: {
            id: true,
            name: true,
            did: true
          }
        },
        blockchainRecords: {
          orderBy: {
            registeredAt: 'desc'
          },
          take: 1
        },
        semanticAnalyses: {
          orderBy: {
            analyzedAt: 'desc'
          },
          take: 1
        }
      },
      orderBy: [
        {
          issuedAt: 'desc'
        },
        {
          createdAt: 'desc'
        }
      ]
    });

    return credentials.map((credential) => ({
      id: credential.id,
      title: credential.title,
      type: credential.type,
      status: credential.status,
      issuer: {
        id: credential.issuer.id,
        name: credential.issuer.name,
        did: credential.issuer.did
      },
      issuedAt: credential.issuedAt ? this.serializeDateTime(credential.issuedAt) : null,
      revokedAt: credential.revokedAt
        ? this.serializeDateTime(credential.revokedAt)
        : null,
      canonicalHash: credential.canonicalHash,
      canonicalizationVersion: credential.canonicalizationVersion,
      latestBlockchainRecord: credential.blockchainRecords[0]
        ? {
            id: credential.blockchainRecords[0].id,
            network: credential.blockchainRecords[0].network,
            chainId: credential.blockchainRecords[0].chainId,
            txHash: credential.blockchainRecords[0].txHash,
            status: credential.blockchainRecords[0].status,
            registeredAt: this.serializeDateTime(
              credential.blockchainRecords[0].registeredAt
            )
          }
        : null,
      latestSemanticAnalysis: credential.semanticAnalyses[0]
        ? {
            id: credential.semanticAnalyses[0].id,
            status: credential.semanticAnalyses[0].status,
            confidence: this.toNullableNumber(
              credential.semanticAnalyses[0].confidence
            ),
            analyzedAt: this.serializeDateTime(
              credential.semanticAnalyses[0].analyzedAt
            )
          }
        : null
    }));
  }

  async getCredentialForUser(
    userId: string,
    credentialId: string
  ): Promise<MeCredentialDetailResponseDto> {
    const credential = await this.prisma.credential.findFirst({
      where: {
        id: credentialId,
        subjectUserId: userId,
        status: {
          in: [...HOLDER_VISIBLE_STATUSES]
        }
      },
      include: {
        issuer: {
          select: {
            id: true,
            name: true,
            did: true
          }
        },
        subjectUser: {
          select: {
            id: true,
            did: true,
            email: true,
            displayName: true
          }
        },
        blockchainRecords: {
          orderBy: {
            registeredAt: 'desc'
          }
        },
        semanticAnalyses: {
          orderBy: {
            analyzedAt: 'desc'
          },
          take: 1
        }
      }
    });

    if (!credential) {
      throw new NotFoundException(
        `Credential ${credentialId} no existe para el holder autenticado.`
      );
    }

    return {
      id: credential.id,
      schemaVersion: credential.schemaVersion,
      type: credential.type,
      title: credential.title,
      description: credential.description,
      status: credential.status,
      issuer: {
        id: credential.issuer.id,
        name: credential.issuer.name,
        did: credential.issuer.did
      },
      subject: {
        id: credential.subjectUser.id,
        did: credential.subjectUser.did,
        email: credential.subjectUser.email,
        displayName: credential.subjectUser.displayName
      },
      issuedAt: credential.issuedAt ? this.serializeDateTime(credential.issuedAt) : null,
      revokedAt: credential.revokedAt
        ? this.serializeDateTime(credential.revokedAt)
        : null,
      revocationReason: credential.revocationReason,
      canonicalHash: credential.canonicalHash,
      canonicalizationVersion: credential.canonicalizationVersion,
      credentialSubject: credential.credentialSubject,
      metadata: credential.metadata,
      blockchainRecords: credential.blockchainRecords.map((record) => ({
        id: record.id,
        network: record.network,
        chainId: record.chainId,
        contractAddress: record.contractAddress,
        txHash: record.txHash,
        issuerAddress: record.issuerAddress,
        status: record.status,
        registeredAt: this.serializeDateTime(record.registeredAt),
        revokedAt: record.revokedAt ? this.serializeDateTime(record.revokedAt) : null
      })),
      latestSemanticAnalysis: credential.semanticAnalyses[0]
        ? {
            id: credential.semanticAnalyses[0].id,
            schemaVersion: credential.semanticAnalyses[0].schemaVersion,
            status: credential.semanticAnalyses[0].status,
            pipelineVersion: credential.semanticAnalyses[0].pipelineVersion,
            taxonomyVersion: credential.semanticAnalyses[0].taxonomyVersion,
            confidence: this.toNullableNumber(
              credential.semanticAnalyses[0].confidence
            ),
            areas: credential.semanticAnalyses[0].areas,
            skills: credential.semanticAnalyses[0].skills,
            concepts: credential.semanticAnalyses[0].concepts,
            qualityFlags: credential.semanticAnalyses[0].qualityFlags,
            analyzedAt: this.serializeDateTime(
              credential.semanticAnalyses[0].analyzedAt
            )
          }
        : null
    };
  }

  private serializeDateTime(value: Date) {
    return value.toISOString().replace('.000Z', 'Z');
  }

  private toNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'number') {
      return value;
    }

    if (
      typeof value === 'object' &&
      value !== null &&
      'toString' in value &&
      typeof value.toString === 'function'
    ) {
      const parsed = Number.parseFloat(value.toString());
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return null;
  }
}

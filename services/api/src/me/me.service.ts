import {
  Injectable,
  NotFoundException
} from '@nestjs/common';
import {
  CredentialStatus,
  DocumentEvidenceStatus,
  TextEvidenceStatus
} from '@prisma/client';

import { buildHolderDisplayLabel } from '../issuers/holder-display-label';
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
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        issuedAt: true,
        issuer: {
          select: {
            name: true
          }
        },
        blockchainRecords: {
          orderBy: {
            registeredAt: 'desc'
          },
          take: 1,
          select: {
            id: true,
          }
        },
        semanticAnalyses: {
          orderBy: {
            analyzedAt: 'desc'
          },
          take: 1,
          select: {
            id: true,
          }
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
      issuerName: credential.issuer.name,
      issuedAt: credential.issuedAt ? this.serializeDateTime(credential.issuedAt) : null,
      hasIntegrityEvidence: credential.blockchainRecords.length > 0,
      hasAnalysis: credential.semanticAnalyses.length > 0
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
      select: {
        id: true,
        type: true,
        title: true,
        description: true,
        hours: true,
        status: true,
        issuedAt: true,
        revokedAt: true,
        revocationReason: true,
        canonicalHash: true,
        canonicalizationVersion: true,
        credentialSubject: true,
        issuer: {
          select: {
            name: true,
            did: true
          }
        },
        subjectUser: {
          select: {
            did: true,
            email: true,
            displayName: true,
            firstName: true,
            lastName: true
          }
        },
        blockchainRecords: {
          orderBy: { registeredAt: 'desc' },
          select: {
            network: true,
            chainId: true,
            txHash: true,
            status: true,
            registeredAt: true,
            revokedAt: true
          }
        },
        semanticAnalyses: {
          orderBy: {
            analyzedAt: 'desc'
          },
          take: 1,
          select: {
            status: true,
            confidence: true,
            areas: true,
            skills: true,
            concepts: true,
            qualityFlags: true,
            analyzedAt: true
          }
        },
        documentEvidences: {
          where: { status: DocumentEvidenceStatus.current },
          orderBy: { uploadedAt: 'desc' },
          take: 1,
          select: {
            originalFileName: true,
            mimeType: true,
            sizeBytes: true,
            sha256: true,
            uploadedAt: true
          }
        },
        textEvidences: {
          where: { status: TextEvidenceStatus.current },
          orderBy: { submittedAt: 'desc' },
          take: 1,
          select: {
            label: true,
            content: true,
            sha256: true,
            submittedAt: true
          }
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
      type: credential.type,
      title: credential.title,
      description: credential.description,
      hours: this.toNullableNumber(credential.hours),
      status: credential.status,
      issuer: {
        name: credential.issuer.name,
        did: credential.issuer.did
      },
      subject: {
        did: credential.subjectUser.did,
        email: credential.subjectUser.email,
        displayName: credential.subjectUser.displayName,
        // A1.1: mismo helper compartido que issuer-credential-read.mapper.ts
        // -- antes esta vista (el holder mirando su PROPIA credencial)
        // nunca combinaba firstName/lastName, a diferencia de la vista del
        // issuer para la misma credencial. Self-view: sin riesgo de
        // privacidad nuevo, es el propio dato del holder autenticado.
        displayLabel: buildHolderDisplayLabel(
          credential.subjectUser.displayName,
          credential.subjectUser.firstName,
          credential.subjectUser.lastName,
          credential.subjectUser.email
        )
      },
      issuedAt: credential.issuedAt ? this.serializeDateTime(credential.issuedAt) : null,
      revokedAt: credential.revokedAt
        ? this.serializeDateTime(credential.revokedAt)
        : null,
      revocationReason: credential.revocationReason,
      canonicalHash: credential.canonicalHash,
      canonicalizationVersion: credential.canonicalizationVersion,
      credentialSubject: this.mapCredentialSubject(credential.credentialSubject),
      documentEvidence: credential.documentEvidences[0]
        ? {
            originalFileName: credential.documentEvidences[0].originalFileName,
            mimeType: credential.documentEvidences[0].mimeType,
            sizeBytes: credential.documentEvidences[0].sizeBytes,
            sha256: credential.documentEvidences[0].sha256,
            uploadedAt: this.serializeDateTime(credential.documentEvidences[0].uploadedAt)
          }
        : null,
      textEvidence: credential.textEvidences[0]
        ? this.mapTextEvidence(credential.textEvidences[0])
        : null,
      blockchainRecords: credential.blockchainRecords.map((record) => ({
        network: record.network,
        chainId: record.chainId,
        txHash: record.txHash,
        status: record.status,
        registeredAt: this.serializeDateTime(record.registeredAt),
        revokedAt: record.revokedAt ? this.serializeDateTime(record.revokedAt) : null
      })),
      latestSemanticAnalysis: credential.semanticAnalyses[0]
        ? {
            status: credential.semanticAnalyses[0].status,
            confidence: this.toNullableConfidence(
              credential.semanticAnalyses[0].confidence
            ),
            areas: this.readLabels(credential.semanticAnalyses[0].areas, [
              'area',
              'name',
              'label'
            ]),
            skills: this.readLabels(credential.semanticAnalyses[0].skills, [
              'skill',
              'name',
              'label'
            ]),
            concepts: this.readLabels(credential.semanticAnalyses[0].concepts, [
              'concept',
              'name',
              'label'
            ]),
            qualityFlags: this.readStringArray(
              credential.semanticAnalyses[0].qualityFlags
            ),
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

  private toNullableConfidence(value: unknown): number | null {
    const confidence = this.toNullableNumber(value);
    return confidence !== null && confidence >= 0 && confidence <= 1
      ? confidence
      : null;
  }

  private mapCredentialSubject(value: unknown) {
    const subject = this.isRecord(value) ? value : {};

    return {
      achievementName: this.readString(subject.achievement_name),
      institutionName: this.readString(subject.institution_name),
      completionDate: this.readString(subject.completion_date),
      academicPeriod: this.readString(subject.academic_period),
      programName: this.readString(subject.program_name),
      grade: this.readString(subject.grade),
      providerName: this.readString(subject.provider_name),
      platformName: this.readString(subject.platform_name),
      modality: this.readString(subject.modality),
      level: this.readString(subject.level),
      externalUrl: this.readString(subject.external_url),
      skills: this.readStringArray(subject.skills),
      competencies: this.readStringArray(subject.competencies),
      learningOutcomes: this.readStringArray(subject.learning_outcomes)
    };
  }

  private mapTextEvidence(value: {
    label: string | null;
    content: string;
    sha256: string;
    submittedAt: Date;
  }) {
    const normalized = value.content.trim().replace(/\s+/g, ' ');

    return {
      label: this.readString(value.label),
      preview:
        normalized.length > 240
          ? `${normalized.slice(0, 237)}...`
          : normalized,
      characterCount: Array.from(value.content).length,
      sha256: value.sha256,
      submittedAt: this.serializeDateTime(value.submittedAt)
    };
  }

  private readLabels(value: unknown, fields: string[]) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => {
        if (typeof entry === 'string') {
          return this.readString(entry);
        }

        if (!this.isRecord(entry)) {
          return null;
        }

        for (const field of fields) {
          const label = this.readString(entry[field]);
          if (label) {
            return label;
          }
        }

        return null;
      })
      .filter((label): label is string => label !== null);
  }

  private readStringArray(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => this.readString(entry))
      .filter((entry): entry is string => entry !== null);
  }

  private readString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim().replace(/\s+/g, ' ');
    return normalized.length > 0 ? normalized : null;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}

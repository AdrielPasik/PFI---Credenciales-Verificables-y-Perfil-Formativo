import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import {
  CredentialSourceType,
  CredentialType,
  CredentialStatus,
  Prisma
} from '@prisma/client';

import { BlockchainEvidenceService } from '../blockchain/blockchain-evidence.service';
import { IssuersService } from '../issuers/issuers.service';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialHashingService } from './credential-hashing.service';
import { CreateCredentialDraftDto } from './dto/create-credential-draft.dto';
import { CredentialStatusResponseDto } from './dto/credential-status-response.dto';
import { CredentialSummaryResponseDto } from './dto/credential-summary-response.dto';
import { IssueCredentialDto } from './dto/issue-credential.dto';

@Injectable()
export class CredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issuersService: IssuersService,
    private readonly blockchainEvidenceService: BlockchainEvidenceService,
    private readonly credentialHashingService: CredentialHashingService
  ) {}

  async createDraft(dto: CreateCredentialDraftDto): Promise<CredentialSummaryResponseDto> {
    this.assertNonEmptyString(dto.issuerId, 'issuerId');
    this.assertNonEmptyString(dto.subjectUserId, 'subjectUserId');
    this.assertNonEmptyString(dto.type, 'type');
    this.assertNonEmptyString(dto.title, 'title');
    this.assertNonEmptyString(dto.sourceType, 'sourceType');
    this.assertJsonObject(dto.credentialSubject, 'credentialSubject');
    this.assertEnumValue(CredentialType, dto.type, 'type');
    this.assertEnumValue(CredentialSourceType, dto.sourceType, 'sourceType');
    this.assertOptionalJsonObject(dto.metadata, 'metadata');
    this.assertOptionalJsonObject(dto.rawData, 'rawData');

    if (dto.academicCourseId && dto.externalCourseId) {
      throw new BadRequestException(
        'No se puede enviar academicCourseId y externalCourseId al mismo tiempo.'
      );
    }

    await this.issuersService.getIssuerOrThrow(dto.issuerId);
    await this.getSubjectUserOrThrow(dto.subjectUserId);

    const credential = await this.prisma.credential.create({
      data: {
        issuerId: dto.issuerId,
        subjectUserId: dto.subjectUserId,
        type: dto.type,
        title: dto.title.trim(),
        description: this.normalizeNullableString(dto.description),
        sourceType: dto.sourceType,
        hours: this.toPrismaDecimal(dto.hours, 'hours'),
        academicCourseId: dto.academicCourseId,
        externalCourseId: dto.externalCourseId,
        credentialSubject: dto.credentialSubject as Prisma.InputJsonValue,
        metadata: this.toOptionalJson(dto.metadata),
        rawData: this.toOptionalJson(dto.rawData),
        status: CredentialStatus.draft
      },
      include: {
        blockchainRecords: {
          orderBy: {
            registeredAt: 'desc'
          },
          take: 1
        }
      }
    });

    return this.toCredentialSummaryResponse(credential);
  }

  async issueCredential(
    credentialId: string,
    dto: IssueCredentialDto
  ): Promise<CredentialSummaryResponseDto> {
    this.assertNonEmptyString(credentialId, 'credentialId');
    this.assertNonEmptyString(dto.issuerId, 'issuerId');

    const credential = await this.prisma.credential.findUnique({
      where: {
        id: credentialId
      },
      include: {
        issuer: true,
        subjectUser: true
      }
    });

    if (!credential) {
      throw new NotFoundException(`Credential ${credentialId} no existe.`);
    }

    if (credential.status !== CredentialStatus.draft) {
      throw new ConflictException(
        `La credencial ${credentialId} no esta en estado draft.`
      );
    }

    if (credential.issuerId !== dto.issuerId) {
      throw new BadRequestException(
        `La credencial ${credentialId} no pertenece al issuer ${dto.issuerId}.`
      );
    }

    this.issuersService.assertIssuerCanIssue(credential.issuer);

    if (!credential.subjectUser.did) {
      throw new BadRequestException(
        `El titular ${credential.subjectUserId} no tiene DID configurado.`
      );
    }

    const issuedAt = this.normalizeIssuedAtToSecond(
      dto.issuedAt ? this.parseIssuedAt(dto.issuedAt) : new Date()
    );
    const credentialSubject = this.assertJsonObject(
      credential.credentialSubject,
      'credential.credentialSubject'
    );

    this.assertCredentialSubjectField(
      credentialSubject,
      ['achievement_name', 'achievementName'],
      'credentialSubject.achievement_name'
    );
    this.assertCredentialSubjectField(
      credentialSubject,
      ['institution_name', 'institutionName'],
      'credentialSubject.institution_name'
    );

    const hashResult = this.credentialHashingService.createCanonicalHash({
      schemaVersion: credential.schemaVersion,
      type: credential.type,
      issuerDid: credential.issuer.did!,
      subjectDid: credential.subjectUser.did!,
      title: credential.title,
      description: credential.description,
      issuedAt,
      hours: credential.hours,
      credentialSubject
    });

    const result = await this.prisma.$transaction(async (transaction) => {
      const updatedCredential = await transaction.credential.update({
        where: {
          id: credential.id
        },
        data: {
          status: CredentialStatus.issued,
          issuedAt,
          canonicalHash: hashResult.canonicalHash,
          canonicalizationVersion: hashResult.canonicalizationVersion
        }
      });

      const blockchainRecord = await this.blockchainEvidenceService.createMockRecord(
        transaction,
        {
          credentialId: updatedCredential.id,
          credentialHash: hashResult.canonicalHash,
          canonicalizationVersion: hashResult.canonicalizationVersion,
          issuerAddress: credential.issuer.walletAddress!
        }
      );

      return {
        updatedCredential,
        blockchainRecord
      };
    });

    return this.toCredentialSummaryResponse({
      ...result.updatedCredential,
      blockchainRecords: [result.blockchainRecord]
    });
  }

  async getCredential(credentialId: string): Promise<CredentialSummaryResponseDto> {
    this.assertNonEmptyString(credentialId, 'credentialId');

    const credential = await this.prisma.credential.findUnique({
      where: {
        id: credentialId
      },
      include: {
        blockchainRecords: {
          orderBy: {
            registeredAt: 'desc'
          },
          take: 1
        }
      }
    });

    if (!credential) {
      throw new NotFoundException(`Credential ${credentialId} no existe.`);
    }

    return this.toCredentialSummaryResponse(credential);
  }

  async getCredentialStatus(
    credentialId: string
  ): Promise<CredentialStatusResponseDto> {
    this.assertNonEmptyString(credentialId, 'credentialId');

    const credential = await this.prisma.credential.findUnique({
      where: {
        id: credentialId
      },
      include: {
        blockchainRecords: {
          orderBy: {
            registeredAt: 'desc'
          },
          take: 1
        }
      }
    });

    if (!credential) {
      throw new NotFoundException(`Credential ${credentialId} no existe.`);
    }

    const latestBlockchainRecord = credential.blockchainRecords[0];

    return {
      id: credential.id,
      status: credential.status,
      issuedAt: credential.issuedAt
        ? this.serializeCanonicalDateTime(credential.issuedAt)
        : undefined,
      revokedAt: credential.revokedAt?.toISOString(),
      canonicalHash: credential.canonicalHash ?? undefined,
      canonicalizationVersion: credential.canonicalizationVersion ?? undefined,
      hasBlockchainRecord: Boolean(latestBlockchainRecord),
      blockchainRecordId: latestBlockchainRecord?.id,
      blockchainStatus: latestBlockchainRecord?.status,
      network: latestBlockchainRecord?.network,
      registeredAt: latestBlockchainRecord?.registeredAt.toISOString()
    };
  }

  private async getSubjectUserOrThrow(subjectUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: subjectUserId
      }
    });

    if (!user) {
      throw new NotFoundException(`User ${subjectUserId} no existe.`);
    }

    return user;
  }

  private toCredentialSummaryResponse(
    credential: {
      id: string;
      schemaVersion: string;
      issuerId: string;
      subjectUserId: string;
      type: string;
      title: string;
      description: string | null;
      sourceType: string;
      status: string;
      hours:
        | { toFixed?: (fractionDigits?: number) => string; toString: () => string }
        | null;
      academicCourseId: string | null;
      externalCourseId: string | null;
      credentialSubject: Prisma.JsonValue;
      metadata: Prisma.JsonValue | null;
      createdAt: Date;
      updatedAt: Date;
      issuedAt: Date | null;
      canonicalHash: string | null;
      canonicalizationVersion: string | null;
      blockchainRecords?: Array<{
        id: string;
        network: string;
        chainId: number;
        status: string;
        credentialHash: string;
        hashAlgorithm: string;
        canonicalizationVersion: string;
        contractAddress: string;
        txHash: string;
        issuerAddress: string;
        registeredAt: Date;
      }>;
    }
  ): CredentialSummaryResponseDto {
    const latestBlockchainRecord = credential.blockchainRecords?.[0];

    return {
      id: credential.id,
      schemaVersion: credential.schemaVersion,
      issuerId: credential.issuerId,
      subjectUserId: credential.subjectUserId,
      type: credential.type,
      title: credential.title,
      description: credential.description ?? undefined,
      sourceType: credential.sourceType,
      status: credential.status,
      hours: credential.hours ? this.formatHours(credential.hours) : undefined,
      academicCourseId: credential.academicCourseId ?? undefined,
      externalCourseId: credential.externalCourseId ?? undefined,
      credentialSubject: credential.credentialSubject as Record<string, unknown>,
      metadata: (credential.metadata as Record<string, unknown> | null) ?? null,
      createdAt: credential.createdAt.toISOString(),
      updatedAt: credential.updatedAt.toISOString(),
      issuedAt: credential.issuedAt
        ? this.serializeCanonicalDateTime(credential.issuedAt)
        : undefined,
      canonicalHash: credential.canonicalHash ?? undefined,
      canonicalizationVersion: credential.canonicalizationVersion ?? undefined,
      latestBlockchainRecord: latestBlockchainRecord
        ? {
            id: latestBlockchainRecord.id,
            network: latestBlockchainRecord.network,
            chainId: latestBlockchainRecord.chainId,
            status: latestBlockchainRecord.status,
            credentialHash: latestBlockchainRecord.credentialHash,
            hashAlgorithm: latestBlockchainRecord.hashAlgorithm,
            canonicalizationVersion:
              latestBlockchainRecord.canonicalizationVersion,
            contractAddress: latestBlockchainRecord.contractAddress,
            txHash: latestBlockchainRecord.txHash,
            issuerAddress: latestBlockchainRecord.issuerAddress,
            registeredAt: latestBlockchainRecord.registeredAt.toISOString()
          }
        : undefined
    };
  }

  private assertNonEmptyString(value: unknown, fieldName: string): asserts value is string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException(`${fieldName} es requerido.`);
    }
  }

  private assertJsonObject(value: unknown, fieldName: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException(`${fieldName} debe ser un objeto JSON.`);
    }

    return value as Record<string, unknown>;
  }

  private assertOptionalJsonObject(value: unknown, fieldName: string) {
    if (value === undefined) {
      return;
    }

    this.assertJsonObject(value, fieldName);
  }

  private assertEnumValue<T extends Record<string, string>>(
    enumObject: T,
    value: string,
    fieldName: string
  ) {
    if (!Object.values(enumObject).includes(value)) {
      throw new BadRequestException(`${fieldName} no es un valor valido.`);
    }
  }

  private assertCredentialSubjectField(
    credentialSubject: Record<string, unknown>,
    keys: string[],
    fieldName: string
  ) {
    for (const key of keys) {
      const value = credentialSubject[key];

      if (typeof value === 'string' && value.trim().length > 0) {
        return;
      }
    }

    throw new BadRequestException(`${fieldName} es requerido para emitir.`);
  }

  private toPrismaDecimal(value: unknown, fieldName: string) {
    if (value === null || value === undefined || value === '') {
      return undefined;
    }

    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new BadRequestException(`${fieldName} debe ser un numero valido.`);
      }

      if (value <= 0) {
        throw new BadRequestException(`${fieldName} debe ser mayor a 0.`);
      }

      return new Prisma.Decimal(value);
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();

      if (!trimmed) {
        return undefined;
      }

      try {
        const decimal = new Prisma.Decimal(trimmed);

        if (decimal.lte(0)) {
          throw new BadRequestException(`${fieldName} debe ser mayor a 0.`);
        }

        return decimal;
      } catch {
        if (trimmed) {
          throw new BadRequestException(`${fieldName} debe ser un decimal valido mayor a 0.`);
        }
      }
    }

    throw new BadRequestException(`${fieldName} debe ser numerico.`);
  }

  private toOptionalJson(value: unknown) {
    if (value === undefined) {
      return undefined;
    }

    return value as Prisma.InputJsonValue;
  }

  private normalizeNullableString(value: unknown) {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException('description debe ser string.');
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private parseIssuedAt(value: string) {
    this.assertNonEmptyString(value, 'issuedAt');
    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('issuedAt debe ser una fecha ISO valida.');
    }

    return parsed;
  }

  private normalizeIssuedAtToSecond(value: Date) {
    const normalized = new Date(value.getTime());
    normalized.setUTCMilliseconds(0);
    return normalized;
  }

  private serializeCanonicalDateTime(value: Date) {
    return this.normalizeIssuedAtToSecond(value).toISOString().replace('.000Z', 'Z');
  }

  private formatHours(hours: {
    toFixed?: (fractionDigits?: number) => string;
    toString: () => string;
  }) {
    if (typeof hours.toFixed === 'function') {
      return hours.toFixed(2);
    }

    return hours.toString();
  }
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import {
  CourseStatus,
  CredentialSourceType,
  CredentialType,
  CredentialStatus,
  CurriculumVersionStatus,
  ProgramStatus,
  Prisma,
  UserStatus
} from '@prisma/client';

import { BlockchainEvidenceService } from '../blockchain/blockchain-evidence.service';
import { ensureDidForUser } from '../identity/ensure-did-for-user';
import { IssuersService } from '../issuers/issuers.service';
import { PrismaService } from '../prisma/prisma.service';
import { type AuthenticatedUser } from '../auth/auth.types';
import { CredentialHashingService } from './credential-hashing.service';
import {
  type AcademicCurriculumSelection,
  validateCreateCredentialDraftCurricularSelection
} from './create-credential-draft.validator';
import { CreateCredentialDraftDto } from './dto/create-credential-draft.dto';
import { CredentialStatusResponseDto } from './dto/credential-status-response.dto';
import { CredentialSummaryResponseDto } from './dto/credential-summary-response.dto';
import { IssueCredentialDto } from './dto/issue-credential.dto';

const UADE_ISSUER_DID = 'did:example:issuer-demo';
const ACADEMIC_CREDENTIAL_TYPES = new Set<CredentialType>([
  CredentialType.academic_subject,
  CredentialType.degree
]);

@Injectable()
export class CredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issuersService: IssuersService,
    private readonly blockchainEvidenceService: BlockchainEvidenceService,
    private readonly credentialHashingService: CredentialHashingService
  ) {}

  async createDraft(
    dto: CreateCredentialDraftDto,
    currentUser: AuthenticatedUser
  ): Promise<CredentialSummaryResponseDto> {
    this.assertAuthenticatedUser(currentUser);
    this.assertNonEmptyString(dto.issuerId, 'issuerId');

    await this.issuersService.assertUserCanCreateDraftForIssuer(
      currentUser.id,
      dto.issuerId
    );

    const curricularSelection =
      validateCreateCredentialDraftCurricularSelection(dto);
    this.assertNonEmptyString(dto.subjectUserId, 'subjectUserId');
    this.assertNonEmptyString(dto.type, 'type');
    this.assertNonEmptyString(dto.sourceType, 'sourceType');
    this.assertEnumValue(CredentialType, dto.type, 'type');
    this.assertEnumValue(CredentialSourceType, dto.sourceType, 'sourceType');
    this.assertOptionalJsonObject(dto.metadata, 'metadata');
    this.assertOptionalJsonObject(dto.rawData, 'rawData');

    const issuer = await this.prisma.issuer.findUnique({
      where: { id: dto.issuerId },
      select: { did: true }
    });

    if (!issuer) {
      throw new NotFoundException('No se encontro el emisor solicitado.');
    }

    if (
      issuer.did !== UADE_ISSUER_DID &&
      ACADEMIC_CREDENTIAL_TYPES.has(dto.type)
    ) {
      throw new BadRequestException(
        'Este emisor no puede crear credenciales académicas.'
      );
    }

    const manualTitle = curricularSelection
      ? null
      : this.requireNonEmptyString(dto.title, 'title');
    const inputCredentialSubject = curricularSelection
      ? null
      : this.stripPlatformNameForCourse(
          dto.type,
          this.assertJsonObject(dto.credentialSubject, 'credentialSubject')
        );

    const credential = await this.prisma.$transaction(
      async (transaction) => {
        await this.getSubjectUserOrThrow(transaction, dto.subjectUserId);

        const selectedCourse = curricularSelection
          ? await this.getCurricularAcademicCourseOrThrow(
              transaction,
              dto.issuerId,
              curricularSelection
            )
          : null;
        const credentialSubject = selectedCourse
          ? {
              achievement_name: selectedCourse.name,
              institution_name: selectedCourse.issuerName,
              program_name: selectedCourse.programName
            }
          : inputCredentialSubject!;

        return transaction.credential.create({
          data: {
            issuerId: dto.issuerId,
            subjectUserId: dto.subjectUserId,
            type: dto.type,
            title: selectedCourse?.name ?? manualTitle!,
            description: selectedCourse
              ? selectedCourse.description
              : this.normalizeNullableString(dto.description),
            sourceType: dto.sourceType,
            hours: selectedCourse
              ? selectedCourse.hours
              : this.toPrismaDecimal(dto.hours, 'hours'),
            academicCourseId: selectedCourse?.academicCourseId,
            programCourseId: selectedCourse?.programCourseId,
            externalCourseId: selectedCourse
              ? undefined
              : dto.externalCourseId,
            credentialSubject: credentialSubject as Prisma.InputJsonValue,
            metadata: selectedCourse
              ? undefined
              : this.toOptionalJson(dto.metadata),
            rawData: selectedCourse
              ? undefined
              : this.toOptionalJson(dto.rawData),
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
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      }
    );

    return this.toCredentialSummaryResponse(credential);
  }

  private async getCurricularAcademicCourseOrThrow(
    transaction: Prisma.TransactionClient,
    issuerId: string,
    selection: AcademicCurriculumSelection
  ) {
    const programCourse = await transaction.programCourse.findFirst({
      where: {
        academicCourseId: selection.academicCourseReference,
        curriculumVersionId: selection.curriculumReference,
        academicCourse: {
          issuerId,
          status: CourseStatus.active
        },
        curriculumVersion: {
          status: CurriculumVersionStatus.active,
          program: {
            issuerId,
            status: ProgramStatus.active
          }
        }
      },
      select: {
        id: true,
        academicCourse: {
          select: {
            id: true,
            name: true,
            description: true,
            hours: true,
            issuer: {
              select: {
                name: true
              }
            }
          }
        },
        curriculumVersion: {
          select: {
            program: {
              select: {
                name: true
              }
            }
          }
        }
      }
    });

    if (!programCourse) {
      throw new NotFoundException(
        'No se encontro una asignatura activa dentro de la curricula solicitada.'
      );
    }

    return {
      academicCourseId: programCourse.academicCourse.id,
      programCourseId: programCourse.id,
      name: programCourse.academicCourse.name,
      description: programCourse.academicCourse.description,
      hours: programCourse.academicCourse.hours,
      issuerName: programCourse.academicCourse.issuer.name,
      programName: programCourse.curriculumVersion.program.name
    };
  }

  async issueCredential(
    credentialId: string,
    dto: IssueCredentialDto,
    currentUser: AuthenticatedUser
  ): Promise<CredentialSummaryResponseDto> {
    this.assertNonEmptyString(credentialId, 'credentialId');
    this.assertNonEmptyString(dto.issuerId, 'issuerId');
    this.assertAuthenticatedUser(currentUser);

    const credential = await this.prisma.credential.findUnique({
      where: {
        id: credentialId
      },
      include: {
        issuer: true
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
        `El issuerId del request no coincide con el issuer real de la credencial ${credentialId}.`
      );
    }

    await this.issuersService.assertUserCanIssueForIssuer(
      currentUser.id,
      credential.issuerId
    );
    this.issuersService.assertIssuerCanIssue(credential.issuer);

    // A2.1: provisioning perezoso -- recien se intenta DESPUES de superar
    // autenticacion/autorizacion/estado del issuer, nunca antes (una
    // emision que de todos modos iba a ser rechazada nunca debe tener el
    // side effect de tocar User.did). Si el holder ya tiene DID,
    // ensureDidForUser lo devuelve sin escribir nada (write-once). Se usa
    // EXACTAMENTE el valor devuelto para canonicalization -- nunca
    // credential.subjectUser.did, que pudo haber sido leido ANTES de que
    // el provisioning escribiera en la base (stale read).
    const subjectDid = await ensureDidForUser(
      this.prisma,
      credential.subjectUserId
    );

    if (!subjectDid) {
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
      subjectDid,
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

      const blockchainRecord = await this.blockchainEvidenceService.createRecord(
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

  private async getSubjectUserOrThrow(
    transaction: Prisma.TransactionClient,
    subjectUserId: string
  ) {
    const user = await transaction.user.findFirst({
      where: {
        id: subjectUserId,
        status: UserStatus.active
      },
      select: {
        id: true
      }
    });

    if (!user) {
      throw new NotFoundException('No se encontro un titular activo elegible.');
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

  private requireNonEmptyString(value: unknown, fieldName: string) {
    this.assertNonEmptyString(value, fieldName);
    return value.trim();
  }

  private assertAuthenticatedUser(
    currentUser: AuthenticatedUser | undefined
  ): asserts currentUser is AuthenticatedUser {
    if (!currentUser?.id) {
      throw new ForbiddenException('Usuario autenticado invalido.');
    }
  }

  // C4x fix: `credentialSubject` en createDraft es un JSON crudo sin
  // allowlist por campo (a diferencia del PATCH de borrador, que valida
  // campo por campo). `platformName`/`platform_name` deja de ser un dato
  // libre para `course` -- el emisor activo es la fuente institucional --
  // pero rechazar toda la creacion por esta unica clave seria
  // desproporcionado dado que ningun otro campo se valida en este punto.
  // Se ignora (se descarta) esa clave puntual si llega, en vez de
  // rechazar la creacion completa.
  private stripPlatformNameForCourse(
    type: CredentialType,
    credentialSubject: Record<string, unknown>
  ): Record<string, unknown> {
    if (type !== CredentialType.course || !('platform_name' in credentialSubject)) {
      return credentialSubject;
    }

    const { platform_name: _platformName, ...rest } = credentialSubject;
    return rest;
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

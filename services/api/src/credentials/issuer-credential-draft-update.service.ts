import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException
} from '@nestjs/common';
import {
  CourseStatus,
  CredentialStatus,
  CredentialType,
  Prisma
} from '@prisma/client';

import { type AuthenticatedUser } from '../auth/auth.types';
import { IssuersService } from '../issuers/issuers.service';
import { PrismaService } from '../prisma/prisma.service';
import { type UpdateIssuerCredentialDraftDto } from './dto/update-issuer-credential-draft.dto';
import { IssuerCredentialDetailResponseDto } from './dto/issuer-credential-detail-response.dto';
import {
  issuerCredentialReadSelect,
  mapIssuerCredentialReadModel
} from './issuer-credential-read.mapper';
import { buildUpdatedCredentialSubject } from './issuer-credential-draft-subject';
import { validateIssuerCredentialDraftUpdate } from './issuer-credential-draft-update.validator';

const CREDENTIAL_NOT_FOUND_MESSAGE = 'No se encontro la credencial solicitada.';
const DRAFT_STATE_CONFLICT_MESSAGE =
  'La credencial ya no esta en estado draft y no puede modificarse.';
const DRAFT_VERSION_CONFLICT_MESSAGE =
  'El borrador fue actualizado desde otra sesion. Volve a cargarlo antes de guardar.';
const ACADEMIC_COURSE_NOT_FOUND_MESSAGE =
  'No se encontro una asignatura activa para el issuer solicitado.';

@Injectable()
export class IssuerCredentialDraftUpdateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issuersService: IssuersService
  ) {}

  async updateDraftForIssuer(
    issuerId: string,
    credentialId: string,
    payload: UpdateIssuerCredentialDraftDto,
    currentUser: AuthenticatedUser
  ): Promise<IssuerCredentialDetailResponseDto> {
    await this.issuersService.assertUserCanUpdateDraftForIssuer(
      currentUser.id,
      issuerId
    );

    const update = validateIssuerCredentialDraftUpdate(payload);

    return this.prisma.$transaction(
      async (transaction) => {
        const credential = await transaction.credential.findFirst({
          where: {
            id: credentialId,
            issuerId
          },
          select: issuerCredentialReadSelect
        });

        if (!credential) {
          throw new NotFoundException(CREDENTIAL_NOT_FOUND_MESSAGE);
        }

        if (credential.status !== CredentialStatus.draft) {
          throw new ConflictException(DRAFT_STATE_CONFLICT_MESSAGE);
        }

        if (
          credential.updatedAt.toISOString() !== update.expectedUpdatedAtIso
        ) {
          throw new ConflictException(DRAFT_VERSION_CONFLICT_MESSAGE);
        }

        const currentSubject = toJsonObject(credential.credentialSubject);
        const finalType = update.type.provided
          ? update.type.value!
          : credential.type;
        const selectedAcademicCourse = update.academicCourseReference.provided
          ? await this.getAcademicCourseForSelection(
              transaction,
              issuerId,
              update.academicCourseReference.value!,
              credential.type,
              finalType
            )
          : null;
        const resultingTitle = selectedAcademicCourse
          ? selectedAcademicCourse.name
          : update.achievementName.provided
            ? update.achievementName.value!
            : credential.title;
        const resultingSubject = buildUpdatedCredentialSubject({
          currentSubject,
          finalType,
          resultingTitle,
          issuerName: credential.issuer.name,
          update
        });
        const data: Prisma.CredentialUpdateManyMutationInput = {
          title: resultingTitle,
          credentialSubject: resultingSubject,
          ...(update.type.provided ? { type: finalType } : {}),
          ...(update.description.provided
            ? { description: update.description.value }
            : {}),
          ...(update.hours.provided ? { hours: update.hours.value } : {}),
          ...(selectedAcademicCourse
            ? {
                academicCourseId: selectedAcademicCourse.id,
                description: selectedAcademicCourse.description,
                hours: selectedAcademicCourse.hours
              }
            : update.type.provided && finalType !== CredentialType.academic_subject
              ? { academicCourseId: null }
              : {})
        };

        const result = await transaction.credential.updateMany({
          where: {
            id: credentialId,
            issuerId,
            status: CredentialStatus.draft,
            updatedAt: credential.updatedAt
          },
          data
        });

        if (result.count !== 1) {
          throw new ConflictException(DRAFT_VERSION_CONFLICT_MESSAGE);
        }

        const updatedCredential = await transaction.credential.findFirst({
          where: {
            id: credentialId,
            issuerId
          },
          select: issuerCredentialReadSelect
        });

        if (!updatedCredential) {
          throw new InternalServerErrorException(
            'No se pudo recuperar el borrador actualizado.'
          );
        }

        return mapIssuerCredentialReadModel(updatedCredential);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      }
    );
  }

  private async getAcademicCourseForSelection(
    transaction: Prisma.TransactionClient,
    issuerId: string,
    academicCourseReference: string,
    currentType: CredentialType,
    finalType: CredentialType
  ) {
    if (
      currentType !== CredentialType.academic_subject ||
      finalType !== CredentialType.academic_subject
    ) {
      throw new BadRequestException(
        'academicCourseReference solo puede seleccionarse para un draft academic_subject.'
      );
    }

    const academicCourse = await transaction.academicCourse.findFirst({
      where: {
        id: academicCourseReference,
        issuerId,
        status: CourseStatus.active
      },
      select: {
        id: true,
        name: true,
        description: true,
        hours: true
      }
    });

    if (!academicCourse) {
      throw new NotFoundException(ACADEMIC_COURSE_NOT_FOUND_MESSAGE);
    }

    return academicCourse;
  }
}

function toJsonObject(value: Prisma.JsonValue): Prisma.InputJsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InternalServerErrorException(
      'El borrador no tiene un credentialSubject compatible.'
    );
  }

  return value as Prisma.InputJsonObject;
}

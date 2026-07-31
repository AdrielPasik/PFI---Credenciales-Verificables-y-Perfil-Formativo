import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException
} from '@nestjs/common';
import { CredentialStatus, Prisma } from '@prisma/client';

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
        const resultingTitle = update.achievementName.provided
          ? update.achievementName.value!
          : credential.title;
        const finalType = update.type.provided
          ? update.type.value!
          : credential.type;
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
          ...(update.hours.provided ? { hours: update.hours.value } : {})
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
}

function toJsonObject(value: Prisma.JsonValue): Prisma.InputJsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InternalServerErrorException(
      'El borrador no tiene un credentialSubject compatible.'
    );
  }

  return value as Prisma.InputJsonObject;
}

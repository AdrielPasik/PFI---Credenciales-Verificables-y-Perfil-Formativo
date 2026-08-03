import {
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import {
  CredentialStatus,
  Prisma,
  TextEvidenceStatus
} from '@prisma/client';

import { type AuthenticatedUser } from '../auth/auth.types';
import { IssuersService } from '../issuers/issuers.service';
import { PrismaService } from '../prisma/prisma.service';
import { TextEvidenceResponseDto } from './dto/text-evidence-response.dto';
import {
  mapTextEvidenceResponse,
  textEvidenceResponseSelect
} from './text-evidence.mapper';
import { validateTextEvidenceBody } from './text-evidence.validator';

const CREDENTIAL_NOT_FOUND_MESSAGE = 'No se encontro la credencial solicitada.';

@Injectable()
export class TextEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issuersService: IssuersService
  ) {}

  async submitCurrentText(
    issuerId: string,
    credentialId: string,
    currentUser: AuthenticatedUser,
    body: unknown
  ): Promise<TextEvidenceResponseDto> {
    await this.issuersService.assertUserCanSubmitTextEvidenceForIssuer(
      currentUser.id,
      issuerId
    );

    const credential = await this.prisma.credential.findFirst({
      where: {
        id: credentialId,
        issuerId
      },
      select: {
        id: true,
        status: true
      }
    });

    if (!credential) {
      throw new NotFoundException(CREDENTIAL_NOT_FOUND_MESSAGE);
    }

    if (credential.status !== CredentialStatus.draft) {
      throw new ConflictException(
        'La evidencia textual solo puede reemplazarse en un borrador.'
      );
    }

    const input = validateTextEvidenceBody(body);

    const evidence = await this.prisma.$transaction(
      async (transaction) => {
        const transactionalCredential =
          await transaction.credential.findFirst({
            where: {
              id: credentialId,
              issuerId
            },
            select: {
              id: true,
              status: true
            }
          });

        if (!transactionalCredential) {
          throw new NotFoundException(CREDENTIAL_NOT_FOUND_MESSAGE);
        }

        if (transactionalCredential.status !== CredentialStatus.draft) {
          throw new ConflictException(
            'La evidencia textual solo puede reemplazarse en un borrador.'
          );
        }

        const replacedAt = new Date();

        await transaction.textEvidence.updateMany({
          where: {
            credentialId: transactionalCredential.id,
            status: TextEvidenceStatus.current
          },
          data: {
            status: TextEvidenceStatus.replaced,
            replacedAt
          }
        });

        return transaction.textEvidence.create({
          data: {
            credentialId: transactionalCredential.id,
            submittedByUserId: currentUser.id,
            label: input.label,
            content: input.content,
            sha256: input.sha256,
            status: TextEvidenceStatus.current
          },
          select: textEvidenceResponseSelect
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      }
    );

    return mapTextEvidenceResponse(evidence);
  }
}

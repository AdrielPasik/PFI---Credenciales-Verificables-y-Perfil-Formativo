import { Injectable, NotFoundException } from '@nestjs/common';

import { type AuthenticatedUser } from '../auth/auth.types';
import { IssuersService } from '../issuers/issuers.service';
import { PrismaService } from '../prisma/prisma.service';
import { IssuerCredentialDetailResponseDto } from './dto/issuer-credential-detail-response.dto';
import { mapIssuerCredentialReadModel } from './issuer-credential-read.mapper';

const CREDENTIAL_NOT_FOUND_MESSAGE = 'No se encontro la credencial solicitada.';

@Injectable()
export class IssuerCredentialReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issuersService: IssuersService
  ) {}

  async getCredentialForIssuer(
    issuerId: string,
    credentialId: string,
    currentUser: AuthenticatedUser
  ): Promise<IssuerCredentialDetailResponseDto> {
    await this.issuersService.assertUserCanReadCredentialsForIssuer(
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
        status: true,
        type: true,
        title: true,
        sourceType: true,
        credentialSubject: true,
        createdAt: true,
        updatedAt: true,
        issuer: {
          select: {
            name: true,
            did: true
          }
        },
        subjectUser: {
          select: {
            email: true,
            did: true,
            displayName: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    if (!credential) {
      throw new NotFoundException(CREDENTIAL_NOT_FOUND_MESSAGE);
    }

    return mapIssuerCredentialReadModel(credential);
  }
}

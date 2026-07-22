import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import {
  Issuer,
  IssuerAuthorizationStatus,
  IssuerMembershipRole,
  IssuerMembershipStatus
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class IssuersService {
  constructor(private readonly prisma: PrismaService) {}

  async getIssuerOrThrow(issuerId: string) {
    const issuer = await this.prisma.issuer.findUnique({
      where: {
        id: issuerId
      }
    });

    if (!issuer) {
      throw new NotFoundException(`Issuer ${issuerId} no existe.`);
    }

    return issuer;
  }

  async assertUserCanIssueForIssuer(userId: string, issuerId: string) {
    const membership = await this.prisma.issuerMembership.findUnique({
      where: {
        userId_issuerId: {
          userId,
          issuerId
        }
      }
    });

    if (!membership) {
      throw new ForbiddenException(
        `El usuario ${userId} no tiene membresia para emitir sobre el issuer ${issuerId}.`
      );
    }

    if (membership.status !== IssuerMembershipStatus.active) {
      throw new ForbiddenException(
        `La membresia del usuario ${userId} para el issuer ${issuerId} no esta activa.`
      );
    }

    if (
      membership.role !== IssuerMembershipRole.admin &&
      membership.role !== IssuerMembershipRole.operator
    ) {
      throw new ForbiddenException(
        `El rol ${membership.role} no tiene permisos para emitir sobre el issuer ${issuerId}.`
      );
    }

    return membership;
  }

  assertIssuerCanIssue(issuer: Issuer) {
    if (issuer.authorizationStatus !== IssuerAuthorizationStatus.authorized) {
      throw new BadRequestException(
        `El issuer ${issuer.id} no esta autorizado para emitir.`
      );
    }

    if (!issuer.walletAddress) {
      throw new BadRequestException(
        `El issuer ${issuer.id} no tiene walletAddress configurado.`
      );
    }

    if (!issuer.did) {
      throw new BadRequestException(`El issuer ${issuer.id} no tiene DID configurado.`);
    }
  }
}

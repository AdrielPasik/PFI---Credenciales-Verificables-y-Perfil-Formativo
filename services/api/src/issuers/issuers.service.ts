import {
  BadRequestException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import {
  Issuer,
  IssuerAuthorizationStatus
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

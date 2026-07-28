import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException
} from '@nestjs/common';
import { UserStatus } from '@prisma/client';

import { type AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { HolderSummaryResponseDto } from './dto/holder-summary-response.dto';
import { IssuersService } from './issuers.service';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOLDER_NOT_FOUND_MESSAGE =
  'No se encontro un titular elegible con el email indicado.';

@Injectable()
export class IssuerHolderResolutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issuersService: IssuersService
  ) {}

  async resolveHolder(
    issuerId: string,
    email: unknown,
    currentUser: AuthenticatedUser
  ): Promise<HolderSummaryResponseDto> {
    await this.issuersService.assertUserCanResolveHolderForIssuer(
      currentUser.id,
      issuerId
    );

    const normalizedEmail = this.normalizeAndValidateEmail(email);
    const matches = await this.prisma.user.findMany({
      where: {
        email: {
          equals: normalizedEmail,
          mode: 'insensitive'
        }
      },
      select: {
        id: true,
        email: true,
        did: true,
        displayName: true,
        firstName: true,
        lastName: true,
        status: true
      },
      take: 2
    });

    if (matches.length > 1) {
      throw new InternalServerErrorException(
        'No se pudo resolver el titular por una inconsistencia de datos.'
      );
    }

    const holder = matches[0];
    const holderEmail = this.normalizeStoredEmail(holder?.email);

    if (
      !holder ||
      holder.status !== UserStatus.active ||
      holderEmail === null
    ) {
      throw new NotFoundException(HOLDER_NOT_FOUND_MESSAGE);
    }

    return {
      id: holder.id,
      email: holderEmail,
      did: holder.did,
      displayLabel: this.buildDisplayLabel(
        holder.displayName,
        holder.firstName,
        holder.lastName,
        holderEmail
      )
    };
  }

  private normalizeAndValidateEmail(email: unknown): string {
    if (typeof email !== 'string') {
      throw new BadRequestException('email debe ser un string valido.');
    }

    const normalized = email.trim().toLowerCase();

    if (!normalized || !EMAIL_PATTERN.test(normalized)) {
      throw new BadRequestException('email debe tener un formato valido.');
    }

    return normalized;
  }

  private normalizeStoredEmail(email: string | null | undefined): string | null {
    if (typeof email !== 'string') {
      return null;
    }

    const normalized = email.trim().toLowerCase();
    return normalized && EMAIL_PATTERN.test(normalized) ? normalized : null;
  }

  private buildDisplayLabel(
    displayName: string | null,
    firstName: string | null,
    lastName: string | null,
    email: string
  ): string {
    const normalizedDisplayName = this.normalizeLabelPart(displayName);

    if (normalizedDisplayName) {
      return normalizedDisplayName;
    }

    const normalizedFirstName = this.normalizeLabelPart(firstName);
    const normalizedLastName = this.normalizeLabelPart(lastName);

    if (normalizedFirstName && normalizedLastName) {
      return `${normalizedFirstName} ${normalizedLastName}`;
    }

    return normalizedFirstName ?? normalizedLastName ?? email;
  }

  private normalizeLabelPart(value: string | null): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim().replace(/\s+/g, ' ');
    return normalized || null;
  }
}

import {
  BadGatewayException,
  HttpException,
  Injectable,
  NotFoundException
} from '@nestjs/common';

import { type AuthenticatedUser } from '../auth/auth.types';
import { AutomaticCourseTextAnalysisService } from '../analysis-run/automatic-course-text-analysis.service';
import { AutomaticDocumentAnalysisService } from '../analysis-run/automatic-document-analysis.service';
import { IssuersService } from '../issuers/issuers.service';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialsService } from './credentials.service';
import { IssuerCredentialDetailResponseDto } from './dto/issuer-credential-detail-response.dto';
import { IssuerCredentialReadService } from './issuer-credential-read.service';

const CREDENTIAL_NOT_FOUND_MESSAGE = 'No se encontro la credencial solicitada.';
const ISSUANCE_FAILED_MESSAGE =
  'No se pudo completar la emision de la credencial. Intentelo nuevamente.';

@Injectable()
export class IssuerCredentialIssueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issuersService: IssuersService,
    private readonly credentialsService: CredentialsService,
    private readonly issuerCredentialReadService: IssuerCredentialReadService,
    private readonly automaticDocumentAnalysisService: AutomaticDocumentAnalysisService,
    private readonly automaticCourseTextAnalysisService: AutomaticCourseTextAnalysisService
  ) {}

  async issueForIssuer(
    issuerId: string,
    credentialId: string,
    currentUser: AuthenticatedUser
  ): Promise<IssuerCredentialDetailResponseDto> {
    await this.issuersService.assertUserCanIssueCredentialForIssuer(
      currentUser.id,
      issuerId
    );

    const scopedCredential = await this.prisma.credential.findFirst({
      where: {
        id: credentialId,
        issuerId
      },
      select: {
        id: true
      }
    });

    if (!scopedCredential) {
      throw new NotFoundException(CREDENTIAL_NOT_FOUND_MESSAGE);
    }

    try {
      await this.credentialsService.issueCredential(
        credentialId,
        { issuerId },
        currentUser
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new BadGatewayException(ISSUANCE_FAILED_MESSAGE);
    }

    try {
      await this.automaticDocumentAnalysisService.analyzeIssuedCredentialIfEligible(
        credentialId
      );
    } catch {
      // Automatic analysis is best-effort and must never roll back issuance.
    }

    // C2b.3: analisis textual automatico solo para `course` sin PDF vigente.
    // AutomaticCourseTextAnalysisService hace su propio chequeo de PDF
    // vigente (nunca corre si el documental ya aplico) y ya atrapa/loguea
    // sus propios errores; este try/catch es una segunda red de seguridad,
    // no la unica -- nunca debe revertir la emision.
    try {
      await this.automaticCourseTextAnalysisService.analyzeIssuedCourseIfEligible(
        credentialId,
        currentUser.id
      );
    } catch {
      // Automatic analysis is best-effort and must never roll back issuance.
    }

    return this.issuerCredentialReadService.getCredentialForIssuer(
      issuerId,
      credentialId,
      currentUser
    );
  }
}

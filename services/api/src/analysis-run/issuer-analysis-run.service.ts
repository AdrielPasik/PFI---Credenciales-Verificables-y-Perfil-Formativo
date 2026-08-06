import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import {
  AnalysisRunInputMode,
  AnalysisRunTrigger,
  CredentialStatus
} from '@prisma/client';

import { IssuersService } from '../issuers/issuers.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnalysisRunExecutionService } from './analysis-run-execution.service';
import { AnalysisRunService } from './analysis-run.service';
import { IssuerDocumentAnalysisResponseDto } from './dto/issuer-document-analysis-response.dto';

const BACKEND_CONTROLLED_VERSION = 'unversioned_current';
const CREDENTIAL_NOT_FOUND_MESSAGE = 'No se encontro la credencial solicitada.';
const EXECUTION_FAILED_MESSAGE = 'No se pudo completar el analisis documental.';

@Injectable()
export class IssuerAnalysisRunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issuersService: IssuersService,
    private readonly analysisRunService: AnalysisRunService,
    private readonly executionService: AnalysisRunExecutionService
  ) {}

  async triggerDocumentAnalysis(
    issuerId: string,
    credentialId: string,
    requestedByUserId: string
  ): Promise<IssuerDocumentAnalysisResponseDto> {
    await this.issuersService.assertUserCanRunDocumentAnalysisForIssuer(
      requestedByUserId,
      issuerId
    );

    const credential = await this.prisma.credential.findFirst({
      where: { id: credentialId, issuerId },
      select: { id: true, status: true }
    });
    if (!credential) {
      throw new NotFoundException(CREDENTIAL_NOT_FOUND_MESSAGE);
    }
    if (credential.status !== CredentialStatus.draft) {
      throw new ConflictException(
        'Solo una credencial en borrador puede analizarse.'
      );
    }

    const pending = await this.analysisRunService.createPendingRun({
      credentialId: credential.id,
      requestedByUserId,
      inputMode: AnalysisRunInputMode.document,
      trigger: AnalysisRunTrigger.manual,
      requestedPipelineVersion: BACKEND_CONTROLLED_VERSION,
      requestedTaxonomyVersion: BACKEND_CONTROLLED_VERSION
    });

    try {
      const completed =
        await this.executionService.executePendingDocumentRun(
          pending.runReference
        );
      return {
        analysisRunId: completed.runReference,
        credentialId: completed.credentialReference,
        status: completed.status,
        semanticAnalysisId: completed.semanticAnalysisReference,
        artifactStatus: completed.artifactStatus,
        sourceCount: completed.sourceCount,
        completedAt: completed.completedAt
      };
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new ServiceUnavailableException(EXECUTION_FAILED_MESSAGE);
    }
  }
}

import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { IssuerDocumentAnalysisResponseDto } from './dto/issuer-document-analysis-response.dto';
import { IssuerAnalysisRunStatusResponseDto } from './dto/issuer-analysis-run-status-response.dto';
import { IssuerTextAnalysisResponseDto } from './dto/issuer-text-analysis-response.dto';
import { IssuerAnalysisRunReadService } from './issuer-analysis-run-read.service';
import { IssuerAnalysisRunService } from './issuer-analysis-run.service';

@Controller('issuers/:issuerId/credentials/:credentialId/analysis-runs')
export class IssuerAnalysisRunController {
  constructor(
    private readonly issuerAnalysisRunService: IssuerAnalysisRunService,
    private readonly issuerAnalysisRunReadService: IssuerAnalysisRunReadService
  ) {}

  @Get('latest')
  @UseGuards(AuthGuard)
  getLatestAnalysisRun(
    @Param('issuerId') issuerId: string,
    @Param('credentialId') credentialId: string,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<IssuerAnalysisRunStatusResponseDto | null> {
    return this.issuerAnalysisRunReadService.getLatestForCredential(
      issuerId,
      credentialId,
      currentUser.id
    );
  }

  @Get(':analysisRunId')
  @UseGuards(AuthGuard)
  getAnalysisRunById(
    @Param('issuerId') issuerId: string,
    @Param('credentialId') credentialId: string,
    @Param('analysisRunId') analysisRunId: string,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<IssuerAnalysisRunStatusResponseDto> {
    return this.issuerAnalysisRunReadService.getById(
      issuerId,
      credentialId,
      analysisRunId,
      currentUser.id
    );
  }

  @Post('document')
  @UseGuards(AuthGuard)
  triggerDocumentAnalysis(
    @Param('issuerId') issuerId: string,
    @Param('credentialId') credentialId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() _untrustedBody: unknown
  ): Promise<IssuerDocumentAnalysisResponseDto> {
    return this.issuerAnalysisRunService.triggerDocumentAnalysis(
      issuerId,
      credentialId,
      currentUser.id
    );
  }

  @Post('text')
  @UseGuards(AuthGuard)
  triggerTextAnalysis(
    @Param('issuerId') issuerId: string,
    @Param('credentialId') credentialId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() _untrustedBody: unknown
  ): Promise<IssuerTextAnalysisResponseDto> {
    return this.issuerAnalysisRunService.triggerTextAnalysis(
      issuerId,
      credentialId,
      currentUser.id
    );
  }
}

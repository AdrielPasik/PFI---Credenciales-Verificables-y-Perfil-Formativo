import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { IssuerDocumentAnalysisResponseDto } from './dto/issuer-document-analysis-response.dto';
import { IssuerAnalysisRunService } from './issuer-analysis-run.service';

@Controller('issuers/:issuerId/credentials/:credentialId/analysis-runs')
export class IssuerAnalysisRunController {
  constructor(
    private readonly issuerAnalysisRunService: IssuerAnalysisRunService
  ) {}

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
}

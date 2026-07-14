import { Controller, Get, Param } from '@nestjs/common';

import { CredentialLatestSemanticAnalysisResponseDto } from './dto/latest-semantic-analysis-response.dto';
import { SemanticService } from './semantic.service';

@Controller('credentials/:id/semantic-analysis')
export class SemanticController {
  constructor(private readonly semanticService: SemanticService) {}

  @Get('latest')
  getLatestForCredential(
    @Param('id') credentialId: string
  ): Promise<CredentialLatestSemanticAnalysisResponseDto> {
    return this.semanticService.getLatestForCredential(credentialId);
  }
}

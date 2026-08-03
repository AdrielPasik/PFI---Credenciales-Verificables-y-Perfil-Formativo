import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { TextEvidenceResponseDto } from './dto/text-evidence-response.dto';
import { TextEvidenceService } from './text-evidence.service';

@UseGuards(AuthGuard)
@Controller('issuers/:issuerId/credentials/:credentialId/evidence/texts')
export class TextEvidenceController {
  constructor(private readonly textEvidenceService: TextEvidenceService) {}

  @Post()
  submitText(
    @Param('issuerId') issuerId: string,
    @Param('credentialId') credentialId: string,
    @Body() body: unknown,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<TextEvidenceResponseDto> {
    return this.textEvidenceService.submitCurrentText(
      issuerId,
      credentialId,
      currentUser,
      body
    );
  }
}

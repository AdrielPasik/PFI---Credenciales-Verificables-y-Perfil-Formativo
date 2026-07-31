import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { IssuerCredentialDetailResponseDto } from './dto/issuer-credential-detail-response.dto';
import { UpdateIssuerCredentialDraftDto } from './dto/update-issuer-credential-draft.dto';
import { IssuerCredentialDraftUpdateService } from './issuer-credential-draft-update.service';

@Controller('issuers/:issuerId/credentials')
export class IssuerCredentialDraftUpdateController {
  constructor(
    private readonly issuerCredentialDraftUpdateService: IssuerCredentialDraftUpdateService
  ) {}

  @Patch(':credentialId/draft')
  @UseGuards(AuthGuard)
  updateDraft(
    @Param('issuerId') issuerId: string,
    @Param('credentialId') credentialId: string,
    @Body() dto: UpdateIssuerCredentialDraftDto,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<IssuerCredentialDetailResponseDto> {
    return this.issuerCredentialDraftUpdateService.updateDraftForIssuer(
      issuerId,
      credentialId,
      dto,
      currentUser
    );
  }
}

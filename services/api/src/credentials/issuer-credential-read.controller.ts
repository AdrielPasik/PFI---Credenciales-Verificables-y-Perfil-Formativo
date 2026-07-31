import { Controller, Get, Param, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { IssuerCredentialDetailResponseDto } from './dto/issuer-credential-detail-response.dto';
import { IssuerCredentialReadService } from './issuer-credential-read.service';

@Controller('issuers/:issuerId/credentials')
export class IssuerCredentialReadController {
  constructor(
    private readonly issuerCredentialReadService: IssuerCredentialReadService
  ) {}

  @Get(':credentialId')
  @UseGuards(AuthGuard)
  getCredential(
    @Param('issuerId') issuerId: string,
    @Param('credentialId') credentialId: string,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<IssuerCredentialDetailResponseDto> {
    return this.issuerCredentialReadService.getCredentialForIssuer(
      issuerId,
      credentialId,
      currentUser
    );
  }
}

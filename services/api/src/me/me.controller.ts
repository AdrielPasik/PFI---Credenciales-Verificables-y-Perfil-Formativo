import { Controller, Get, Param, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { MeCredentialDetailResponseDto } from './dto/me-credential-detail-response.dto';
import { MeCredentialSummaryResponseDto } from './dto/me-credential-summary-response.dto';
import { MeService } from './me.service';

@UseGuards(AuthGuard)
@Controller('me')
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Get('credentials')
  listCredentials(
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<MeCredentialSummaryResponseDto[]> {
    return this.meService.listCredentialsForUser(currentUser.id);
  }

  @Get('credentials/:id')
  getCredential(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') credentialId: string
  ): Promise<MeCredentialDetailResponseDto> {
    return this.meService.getCredentialForUser(currentUser.id, credentialId);
  }
}

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards
} from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { IssuerCredentialRevocationResponseDto } from './dto/issuer-credential-revocation-response.dto';
import { IssuerCredentialRevocationService } from './issuer-credential-revocation.service';

@Controller('issuers/:issuerId/credentials')
export class IssuerCredentialRevocationController {
  constructor(
    private readonly issuerCredentialRevocationService: IssuerCredentialRevocationService
  ) {}

  @Post(':credentialId/revoke')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  revokeCredential(
    @Param('issuerId') issuerId: string,
    @Param('credentialId') credentialId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() body: unknown
  ): Promise<IssuerCredentialRevocationResponseDto> {
    return this.issuerCredentialRevocationService.revokeForIssuer(
      issuerId,
      credentialId,
      currentUser,
      body
    );
  }
}

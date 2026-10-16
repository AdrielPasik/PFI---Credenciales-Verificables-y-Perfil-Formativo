import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';

import { CreateCredentialDraftDto } from './dto/create-credential-draft.dto';
import { CredentialStatusResponseDto } from './dto/credential-status-response.dto';
import { CredentialSummaryResponseDto } from './dto/credential-summary-response.dto';
import { IssueCredentialDto } from './dto/issue-credential.dto';
import { CredentialsService } from './credentials.service';

@Controller('credentials')
export class CredentialsController {
  constructor(private readonly credentialsService: CredentialsService) {}

  @Post('draft')
  @UseGuards(AuthGuard)
  createDraft(
    @Body() dto: CreateCredentialDraftDto,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<CredentialSummaryResponseDto> {
    return this.credentialsService.createDraft(dto, currentUser);
  }

  @Post(':id/issue')
  @UseGuards(AuthGuard)
  issueCredential(
    @Param('id') credentialId: string,
    @Body() dto: IssueCredentialDto,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<CredentialSummaryResponseDto> {
    return this.credentialsService.issueCredential(credentialId, dto, currentUser);
  }

  // S8: estas dos lecturas eran PUBLICAS (filtraban contenido de credenciales y
  // borradores a quien conociera el UUID). Ahora exigen sesion y pertenencia:
  // titular de una credencial ya emitida, o miembro activo admin/operator del
  // issuer duenio. La verificacion publica de terceros es
  // `GET /verify/credentials/:id`, que NO se toca.
  @Get(':id')
  @UseGuards(AuthGuard)
  getCredential(
    @Param('id') credentialId: string,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<CredentialSummaryResponseDto> {
    return this.credentialsService.getCredential(credentialId, currentUser);
  }

  @Get(':id/status')
  @UseGuards(AuthGuard)
  getCredentialStatus(
    @Param('id') credentialId: string,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<CredentialStatusResponseDto> {
    return this.credentialsService.getCredentialStatus(
      credentialId,
      currentUser
    );
  }
}

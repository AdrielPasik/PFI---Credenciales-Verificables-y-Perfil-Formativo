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
  createDraft(@Body() dto: CreateCredentialDraftDto): Promise<CredentialSummaryResponseDto> {
    return this.credentialsService.createDraft(dto);
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

  @Get(':id')
  getCredential(@Param('id') credentialId: string): Promise<CredentialSummaryResponseDto> {
    return this.credentialsService.getCredential(credentialId);
  }

  @Get(':id/status')
  getCredentialStatus(
    @Param('id') credentialId: string
  ): Promise<CredentialStatusResponseDto> {
    return this.credentialsService.getCredentialStatus(credentialId);
  }
}

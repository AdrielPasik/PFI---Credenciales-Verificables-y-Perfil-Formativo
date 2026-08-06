import {
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
import { IssuerCredentialDetailResponseDto } from './dto/issuer-credential-detail-response.dto';
import { IssuerCredentialIssueService } from './issuer-credential-issue.service';

@Controller('issuers/:issuerId/credentials')
export class IssuerCredentialIssueController {
  constructor(
    private readonly issuerCredentialIssueService: IssuerCredentialIssueService
  ) {}

  @Post(':credentialId/issue')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  issueCredential(
    @Param('issuerId') issuerId: string,
    @Param('credentialId') credentialId: string,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<IssuerCredentialDetailResponseDto> {
    return this.issuerCredentialIssueService.issueForIssuer(
      issuerId,
      credentialId,
      currentUser
    );
  }
}

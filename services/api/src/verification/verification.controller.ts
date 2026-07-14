import { Controller, Get, Param } from '@nestjs/common';

import { VerifyCredentialResponseDto } from './dto/verify-credential-response.dto';
import { VerificationService } from './verification.service';

@Controller('verify/credentials')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @Get(':id')
  getCredentialVerification(
    @Param('id') credentialId: string
  ): Promise<VerifyCredentialResponseDto> {
    return this.verificationService.getCredentialVerification(credentialId);
  }
}

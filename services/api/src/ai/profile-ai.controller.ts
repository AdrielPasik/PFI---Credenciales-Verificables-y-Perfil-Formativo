import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { type CurrentProfileResponseDto } from '../profiles/dto/current-profile-response.dto';
import { AiIntegrationService } from './ai-integration.service';
import { BuildProfileFromAiDto } from './dto/build-profile-from-ai.dto';

@UseGuards(AuthGuard)
@Controller('me/profile')
export class ProfileAiController {
  constructor(private readonly aiIntegrationService: AiIntegrationService) {}

  @Post('build-from-ai')
  async buildFromAi(
    @Body() dto: BuildProfileFromAiDto,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<CurrentProfileResponseDto> {
    const result = await this.aiIntegrationService.buildProfileForUser(
      currentUser.id,
      dto?.credentialIds
    );

    return result.persisted;
  }
}

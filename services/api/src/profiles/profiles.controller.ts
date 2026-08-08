import { Controller, Get, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { type HolderCurrentProfileResponseDto } from './dto/current-profile-response.dto';
import { FormativeProfileService } from './formative-profile.service';
import { mapHolderCurrentProfileResponse } from './holder-current-profile.mapper';

@UseGuards(AuthGuard)
@Controller('me/profile')
export class ProfilesController {
  constructor(
    private readonly formativeProfileService: FormativeProfileService
  ) {}

  @Get('current')
  getCurrentProfile(
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<HolderCurrentProfileResponseDto> {
    return this.formativeProfileService
      .getCurrentForUser(currentUser.id)
      .then(mapHolderCurrentProfileResponse);
  }

  @Post('rebuild')
  rebuildProfile(
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<HolderCurrentProfileResponseDto> {
    return this.formativeProfileService
      .rebuildForUser(currentUser.id)
      .then(mapHolderCurrentProfileResponse);
  }
}

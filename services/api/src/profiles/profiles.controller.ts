import { Controller, Get, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { CurrentProfileResponseDto } from './dto/current-profile-response.dto';
import { FormativeProfileService } from './formative-profile.service';

@UseGuards(AuthGuard)
@Controller('me/profile')
export class ProfilesController {
  constructor(
    private readonly formativeProfileService: FormativeProfileService
  ) {}

  @Get('current')
  getCurrentProfile(
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<CurrentProfileResponseDto> {
    return this.formativeProfileService.getCurrentForUser(currentUser.id);
  }

  @Post('rebuild')
  rebuildProfile(
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<CurrentProfileResponseDto> {
    return this.formativeProfileService.rebuildForUser(currentUser.id);
  }
}

import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  type CreateProfileShareResponseDto,
  type PublicProfileShareResponseDto,
  ProfileSharingService
} from './profile-sharing.service';

@UseGuards(AuthGuard)
@Controller('me/profile')
export class MyProfileSharingController {
  constructor(private readonly sharing: ProfileSharingService) {}

  @Post('share')
  createProfileShare(
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<CreateProfileShareResponseDto> {
    return this.sharing.createForUser(currentUser.id);
  }
}

@Controller('share/profile')
export class PublicProfileSharingController {
  constructor(private readonly sharing: ProfileSharingService) {}

  @Get(':token')
  getSharedProfile(
    @Param('token') token: string
  ): Promise<PublicProfileShareResponseDto> {
    return this.sharing.getPublicProfile(token);
  }
}

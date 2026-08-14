import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ProfilesModule } from '../profiles/profiles.module';
import {
  MyProfileSharingController,
  PublicProfileSharingController
} from './profile-sharing.controller';
import { ProfileSharingService } from './profile-sharing.service';

@Module({
  imports: [AuthModule, ProfilesModule],
  controllers: [MyProfileSharingController, PublicProfileSharingController],
  providers: [ProfileSharingService]
})
export class ProfileSharingModule {}

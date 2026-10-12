import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ProfileEmbeddingCompositionService } from '../profile-embedding/profile-embedding-composition.service';
import { FormativeProfileService } from './formative-profile.service';
import { ProfilesController } from './profiles.controller';

@Module({
  imports: [AuthModule],
  controllers: [ProfilesController],
  providers: [FormativeProfileService, ProfileEmbeddingCompositionService],
  exports: [FormativeProfileService]
})
export class ProfilesModule {}

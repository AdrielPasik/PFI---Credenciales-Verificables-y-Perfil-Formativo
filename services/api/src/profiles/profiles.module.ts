import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { FormativeProfileService } from './formative-profile.service';
import { ProfilesController } from './profiles.controller';

@Module({
  imports: [AuthModule],
  controllers: [ProfilesController],
  providers: [FormativeProfileService]
})
export class ProfilesModule {}

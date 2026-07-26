import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { IssuersModule } from '../issuers/issuers.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { SemanticModule } from '../semantic/semantic.module';
import { CredentialAiController } from './credential-ai.controller';
import { AiIntegrationService } from './ai-integration.service';
import { AiServiceClient } from './ai-service.client';
import { ProfileAiController } from './profile-ai.controller';

@Module({
  imports: [AuthModule, IssuersModule, SemanticModule, ProfilesModule],
  controllers: [CredentialAiController, ProfileAiController],
  providers: [AiServiceClient, AiIntegrationService],
  exports: [AiServiceClient, AiIntegrationService]
})
export class AiModule {}

import { Module } from '@nestjs/common';

import { ProfilesModule } from '../profiles/profiles.module';
import { SemanticModule } from '../semantic/semantic.module';
import { AiIntegrationService } from './ai-integration.service';
import { AiServiceClient } from './ai-service.client';

@Module({
  imports: [SemanticModule, ProfilesModule],
  providers: [AiServiceClient, AiIntegrationService],
  exports: [AiServiceClient, AiIntegrationService]
})
export class AiModule {}

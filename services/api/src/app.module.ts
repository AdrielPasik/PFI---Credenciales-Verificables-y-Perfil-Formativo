import { Module } from '@nestjs/common';

import { AiModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { BlockchainModule } from './blockchain/blockchain.module';
import { CatalogModule } from './catalog/catalog.module';
import { CredentialsModule } from './credentials/credentials.module';
import { DocumentEvidenceModule } from './document-evidence/document-evidence.module';
import { HealthController } from './health/health.controller';
import { IssuersModule } from './issuers/issuers.module';
import { MeModule } from './me/me.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProfilesModule } from './profiles/profiles.module';
import { SemanticModule } from './semantic/semantic.module';
import { TextEvidenceModule } from './text-evidence/text-evidence.module';
import { VerificationModule } from './verification/verification.module';

@Module({
  imports: [
    PrismaModule,
    AiModule,
    AuthModule,
    MeModule,
    ProfilesModule,
    IssuersModule,
    BlockchainModule,
    CatalogModule,
    SemanticModule,
    DocumentEvidenceModule,
    TextEvidenceModule,
    CredentialsModule,
    VerificationModule
  ],
  controllers: [HealthController]
})
export class AppModule {}

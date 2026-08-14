import { Module } from '@nestjs/common';

import { AiModule } from './ai/ai.module';
import { AnalysisRunModule } from './analysis-run/analysis-run.module';
import { AuthModule } from './auth/auth.module';
import { BlockchainModule } from './blockchain/blockchain.module';
import { CatalogModule } from './catalog/catalog.module';
import { CredentialsModule } from './credentials/credentials.module';
import { DocumentEvidenceModule } from './document-evidence/document-evidence.module';
import { HealthController } from './health/health.controller';
import { IssuerCourseTemplatesModule } from './issuer-course-templates/issuer-course-templates.module';
import { IssuersModule } from './issuers/issuers.module';
import { MeModule } from './me/me.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProfilesModule } from './profiles/profiles.module';
import { ProfileSharingModule } from './profile-sharing/profile-sharing.module';
import { SemanticModule } from './semantic/semantic.module';
import { TextEvidenceModule } from './text-evidence/text-evidence.module';
import { VerificationModule } from './verification/verification.module';

@Module({
  imports: [
    PrismaModule,
    AnalysisRunModule,
    AiModule,
    AuthModule,
    MeModule,
    ProfilesModule,
    ProfileSharingModule,
    IssuersModule,
    BlockchainModule,
    CatalogModule,
    SemanticModule,
    DocumentEvidenceModule,
    TextEvidenceModule,
    CredentialsModule,
    IssuerCourseTemplatesModule,
    VerificationModule
  ],
  controllers: [HealthController]
})
export class AppModule {}

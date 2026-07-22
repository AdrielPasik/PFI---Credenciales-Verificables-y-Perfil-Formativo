import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module';
import { BlockchainModule } from './blockchain/blockchain.module';
import { CredentialsModule } from './credentials/credentials.module';
import { HealthController } from './health/health.controller';
import { IssuersModule } from './issuers/issuers.module';
import { MeModule } from './me/me.module';
import { PrismaModule } from './prisma/prisma.module';
import { SemanticModule } from './semantic/semantic.module';
import { VerificationModule } from './verification/verification.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    MeModule,
    IssuersModule,
    BlockchainModule,
    SemanticModule,
    CredentialsModule,
    VerificationModule
  ],
  controllers: [HealthController]
})
export class AppModule {}

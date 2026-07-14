import { Module } from '@nestjs/common';

import { BlockchainModule } from './blockchain/blockchain.module';
import { CredentialsModule } from './credentials/credentials.module';
import { HealthController } from './health/health.controller';
import { IssuersModule } from './issuers/issuers.module';
import { PrismaModule } from './prisma/prisma.module';
import { SemanticModule } from './semantic/semantic.module';
import { VerificationModule } from './verification/verification.module';

@Module({
  imports: [
    PrismaModule,
    IssuersModule,
    BlockchainModule,
    SemanticModule,
    CredentialsModule,
    VerificationModule
  ],
  controllers: [HealthController]
})
export class AppModule {}

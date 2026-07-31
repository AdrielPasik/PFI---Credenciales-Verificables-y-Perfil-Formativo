import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { IssuersModule } from '../issuers/issuers.module';
import { CredentialHashingService } from './credential-hashing.service';
import { CredentialsController } from './credentials.controller';
import { CredentialsService } from './credentials.service';
import { IssuerCredentialReadController } from './issuer-credential-read.controller';
import { IssuerCredentialReadService } from './issuer-credential-read.service';

@Module({
  imports: [AuthModule, IssuersModule, BlockchainModule],
  controllers: [CredentialsController, IssuerCredentialReadController],
  providers: [
    CredentialsService,
    CredentialHashingService,
    IssuerCredentialReadService
  ],
  exports: [CredentialsService]
})
export class CredentialsModule {}

import { Module } from '@nestjs/common';

import { BlockchainModule } from '../blockchain/blockchain.module';
import { IssuersModule } from '../issuers/issuers.module';
import { CredentialHashingService } from './credential-hashing.service';
import { CredentialsController } from './credentials.controller';
import { CredentialsService } from './credentials.service';

@Module({
  imports: [IssuersModule, BlockchainModule],
  controllers: [CredentialsController],
  providers: [CredentialsService, CredentialHashingService],
  exports: [CredentialsService]
})
export class CredentialsModule {}

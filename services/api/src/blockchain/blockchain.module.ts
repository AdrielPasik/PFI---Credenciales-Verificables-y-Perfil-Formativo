import { Module } from '@nestjs/common';

import { BlockchainEvidenceService } from './blockchain-evidence.service';
import { CredentialRegistryReadClient } from './credential-registry-read-client';

@Module({
  providers: [BlockchainEvidenceService, CredentialRegistryReadClient],
  exports: [BlockchainEvidenceService, CredentialRegistryReadClient]
})
export class BlockchainModule {}

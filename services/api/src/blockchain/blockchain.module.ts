import { Module } from '@nestjs/common';

import { BlockchainEvidenceService } from './blockchain-evidence.service';
import { BlockchainRecordReconciliationService } from './blockchain-record-reconciliation.service';
import { CredentialRegistryDeploymentResolver } from './credential-registry-deployment';
import { CredentialRegistryReadClient } from './credential-registry-read-client';
import { CredentialRegistryWriteClient } from './credential-registry-write-client';

@Module({
  providers: [
    BlockchainEvidenceService,
    CredentialRegistryDeploymentResolver,
    CredentialRegistryReadClient,
    CredentialRegistryWriteClient,
    BlockchainRecordReconciliationService
  ],
  exports: [
    BlockchainEvidenceService,
    CredentialRegistryDeploymentResolver,
    CredentialRegistryReadClient,
    CredentialRegistryWriteClient,
    BlockchainRecordReconciliationService
  ]
})
export class BlockchainModule {}

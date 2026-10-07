import { Module } from '@nestjs/common';

import { BlockchainEvidenceService } from './blockchain-evidence.service';
import { BlockchainRecordReconciliationService } from './blockchain-record-reconciliation.service';
import { CredentialRegistryDeploymentResolver } from './credential-registry-deployment';
import { CredentialRegistryPreflight } from './credential-registry-preflight';
import { CredentialRegistryReadClient } from './credential-registry-read-client';
import { CredentialRegistryWriteClient } from './credential-registry-write-client';

@Module({
  providers: [
    BlockchainEvidenceService,
    CredentialRegistryDeploymentResolver,
    CredentialRegistryPreflight,
    CredentialRegistryReadClient,
    CredentialRegistryWriteClient,
    BlockchainRecordReconciliationService
  ],
  exports: [
    BlockchainEvidenceService,
    CredentialRegistryDeploymentResolver,
    CredentialRegistryPreflight,
    CredentialRegistryReadClient,
    CredentialRegistryWriteClient,
    BlockchainRecordReconciliationService
  ]
})
export class BlockchainModule {}

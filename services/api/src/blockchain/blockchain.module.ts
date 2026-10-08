import { Module } from '@nestjs/common';

import { AnchorWriteCoordinator } from './anchor-write-coordinator';
import { BlockchainEvidenceService } from './blockchain-evidence.service';
import { BlockchainRecordReconciliationService } from './blockchain-record-reconciliation.service';
import { BlockchainRegistrationReconciliationService } from './blockchain-registration-reconciliation.service';
import { BlockchainRegistrationService } from './blockchain-registration.service';
import { CredentialRegistryDeploymentResolver } from './credential-registry-deployment';
import { CredentialRegistryPreflight } from './credential-registry-preflight';
import { CredentialRegistryReadClient } from './credential-registry-read-client';
import { CredentialRegistryWriteClient } from './credential-registry-write-client';
import { SigningModule } from '../signing/signing.module';

/**
 * S8c6: el ciclo de vida de registracion consume el signer de ANCLAJE que
 * `SigningModule` exporta desde S8c2. Importarlo no dispara ninguna lectura de
 * secreto en el arranque: el almacen SSM es perezoso y nadie llama a
 * `resolve*` hasta que entra una emision en modo real.
 */
@Module({
  imports: [SigningModule],
  providers: [
    AnchorWriteCoordinator,
    BlockchainRegistrationService,
    BlockchainRegistrationReconciliationService,
    BlockchainEvidenceService,
    CredentialRegistryDeploymentResolver,
    CredentialRegistryPreflight,
    CredentialRegistryReadClient,
    CredentialRegistryWriteClient,
    BlockchainRecordReconciliationService
  ],
  exports: [
    AnchorWriteCoordinator,
    BlockchainRegistrationService,
    BlockchainRegistrationReconciliationService,
    BlockchainEvidenceService,
    CredentialRegistryDeploymentResolver,
    CredentialRegistryPreflight,
    CredentialRegistryReadClient,
    CredentialRegistryWriteClient,
    BlockchainRecordReconciliationService
  ]
})
export class BlockchainModule {}

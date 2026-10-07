import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AnalysisRunModule } from '../analysis-run/analysis-run.module';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { IssuersModule } from '../issuers/issuers.module';
import { SigningModule } from '../signing/signing.module';
import { CredentialHashingService } from './credential-hashing.service';
import { CredentialProofService } from './credential-proof.service';
import { CredentialsController } from './credentials.controller';
import { CredentialsService } from './credentials.service';
import { IssuerCredentialDraftUpdateController } from './issuer-credential-draft-update.controller';
import { IssuerCredentialDraftUpdateService } from './issuer-credential-draft-update.service';
import { IssuerCredentialIssueController } from './issuer-credential-issue.controller';
import { IssuerCredentialIssueService } from './issuer-credential-issue.service';
import { IssuerCredentialRevocationController } from './issuer-credential-revocation.controller';
import { IssuerCredentialRevocationService } from './issuer-credential-revocation.service';
import { IssuerCredentialReadController } from './issuer-credential-read.controller';
import { IssuerCredentialReadService } from './issuer-credential-read.service';

/**
 * S8c4: la emision pasa a ser el PRIMER consumidor de produccion de
 * `IssuerSignerResolver`, que `SigningModule` ya exportaba desde S8c2.
 *
 * Importarlo no dispara ninguna lectura de secreto en el arranque: el
 * almacen SSM se construye de forma perezosa y nadie llama a `resolve*` hasta
 * que entra un pedido de emision. El `signing.structure.test.ts` congela que
 * el resolver siga consumiendose SOLO desde aca.
 */
@Module({
  imports: [
    AnalysisRunModule,
    AuthModule,
    IssuersModule,
    BlockchainModule,
    SigningModule
  ],
  controllers: [
    CredentialsController,
    IssuerCredentialIssueController,
    IssuerCredentialRevocationController,
    IssuerCredentialReadController,
    IssuerCredentialDraftUpdateController
  ],
  providers: [
    CredentialsService,
    CredentialHashingService,
    CredentialProofService,
    IssuerCredentialIssueService,
    IssuerCredentialRevocationService,
    IssuerCredentialReadService,
    IssuerCredentialDraftUpdateService
  ],
  exports: [CredentialsService]
})
export class CredentialsModule {}

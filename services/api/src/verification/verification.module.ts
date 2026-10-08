import { Module } from '@nestjs/common';

import { CredentialRegistryDeploymentResolver } from '../blockchain/credential-registry-deployment';
import { CredentialHashingService } from '../credentials/credential-hashing.service';
import { IdentityModule } from '../identity/identity.module';
import { CredentialAuthenticityVerifier } from './credential-authenticity.verifier';
import { CredentialBlockchainEvidenceReader } from './credential-blockchain-evidence.reader';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

/**
 * Verificacion publica de credenciales -- S8c7.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTE MODULO NO IMPORTA
 * ---------------------------------------------------------------------------
 *
 * No importa `SigningModule`, ni `BlockchainModule`, ni `CredentialsModule`.
 * No es una omision: es la propiedad que se quiere.
 *
 *   sin SigningModule    -> no existe el camino a `IssuerSignerResolver` ni al
 *                           almacen de secretos, asi que el verificador no
 *                           puede resolver una clave privada ni aunque alguien
 *                           lo intente mas adelante;
 *   sin BlockchainModule -> no entra el coordinador de escrituras, ni el write
 *                           client, ni los servicios de reconciliacion que
 *                           MUTAN la base. El verificador no puede enviar una
 *                           transaccion ni finalizar un intent;
 *   sin CredentialsModule
 *                        -> no entran los servicios de emision ni de
 *                           revocacion.
 *
 * `CredentialHashingService` y `CredentialRegistryDeploymentResolver` se
 * proveen directamente porque son puros y sin dependencias. Que haya otra
 * instancia en otro modulo no duplica la IMPLEMENTACION: canon_v2 y la
 * resolucion de deployment siguen teniendo un solo codigo, que es lo que
 * importa.
 *
 * `IdentityModule` si se importa: de ahi sale el resolver del DID Document, el
 * MISMO que publica `GET /did/issuers/:issuerId/did.json`. Asi el verificador
 * obtiene el documento por inyeccion y nunca por un HTTP de la API contra si
 * misma. Ese modulo tampoco tiene acceso a secretos.
 */
@Module({
  imports: [IdentityModule],
  controllers: [VerificationController],
  providers: [
    VerificationService,
    CredentialAuthenticityVerifier,
    CredentialBlockchainEvidenceReader,
    CredentialHashingService,
    CredentialRegistryDeploymentResolver
  ]
})
export class VerificationModule {}

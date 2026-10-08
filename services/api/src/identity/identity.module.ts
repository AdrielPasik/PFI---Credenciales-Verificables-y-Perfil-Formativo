import { Module } from '@nestjs/common';

import { DidController } from './did.controller';
import { IssuerDidController } from './issuer-did.controller';
import { IssuerDidDocumentResolver } from './issuer-did-document.resolver';

/**
 * Los DOS planos de identidad publica, uno al lado del otro y nunca mezclados:
 *
 *   DidController        /did/users/:userId/did.json      documento id-only
 *   IssuerDidController  /did/issuers/:issuerId/did.json  JsonWebKey +
 *                                                         assertionMethod
 *
 * El documento del holder NO gana claves porque el del issuer las tenga.
 * Ambos son publicos y de solo lectura.
 *
 * S8c7 exporta `IssuerDidDocumentResolver`: el verificador publico de
 * credentials necesita EL MISMO documento que publica el endpoint, y lo obtiene
 * por inyeccion -- nunca por un HTTP de la API contra si misma.
 */
@Module({
  controllers: [DidController, IssuerDidController],
  providers: [IssuerDidDocumentResolver],
  exports: [IssuerDidDocumentResolver]
})
export class IdentityModule {}

import { Module } from '@nestjs/common';

import { DidController } from './did.controller';
import { IssuerDidController } from './issuer-did.controller';

/**
 * Los DOS planos de identidad publica, uno al lado del otro y nunca mezclados:
 *
 *   DidController        /did/users/:userId/did.json      documento id-only
 *   IssuerDidController  /did/issuers/:issuerId/did.json  JsonWebKey +
 *                                                         assertionMethod
 *
 * El documento del holder NO gana claves porque el del issuer las tenga.
 * Ambos son publicos y de solo lectura.
 */
@Module({
  controllers: [DidController, IssuerDidController]
})
export class IdentityModule {}

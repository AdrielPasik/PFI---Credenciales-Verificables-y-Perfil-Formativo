import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards
} from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  type IssuerCredentialReconciliationResponseDto,
  IssuerCredentialBlockchainReconciliationService
} from './issuer-credential-blockchain-reconciliation.service';

/**
 * Reconciliacion de una registracion pendiente. Sin body: el llamador no elige
 * contrato, red, bloque ni rango. Nunca transmite una transaccion.
 */
@Controller('issuers/:issuerId/credentials')
export class IssuerCredentialBlockchainReconciliationController {
  constructor(
    private readonly reconciliationService: IssuerCredentialBlockchainReconciliationService
  ) {}

  @Post(':credentialId/blockchain/reconcile')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  reconcile(
    @Param('issuerId') issuerId: string,
    @Param('credentialId') credentialId: string,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<IssuerCredentialReconciliationResponseDto> {
    return this.reconciliationService.reconcileForIssuer(
      issuerId,
      credentialId,
      currentUser
    );
  }
}

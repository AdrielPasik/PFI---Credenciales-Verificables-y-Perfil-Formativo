import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Put, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  ProfileSharingService,
  type CreateProfileShareResponseDto,
  type HolderProfileShareListItemDto,
  type HolderShareLinkDto,
  type PublicProfileShareResponseDto
} from './profile-sharing.service';
import {
  type ShareVerificationPolicyStateDto,
  ShareVerificationPolicyService
} from './share-verification-policy.service';

@UseGuards(AuthGuard)
@Controller('me/profile')
export class MyProfileSharingController {
  constructor(
    private readonly sharing: ProfileSharingService,
    private readonly verificationPolicy: ShareVerificationPolicyService
  ) {}

  @Post('share')
  createProfileShare(
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<CreateProfileShareResponseDto> {
    return this.sharing.createForUser(currentUser.id);
  }

  @Get('shares')
  listProfileShares(
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<HolderProfileShareListItemDto[]> {
    return this.sharing.listForUser(currentUser.id);
  }

  /**
   * `shareId` es un id de base usado bajo AuthGuard y acotado al dueño en la
   * consulta. NO es una autoridad publica: el token opaco sigue siendo lo unico
   * que abre el enlace, y nunca se devuelve por aca.
   */
  @Post('shares/:shareId/revoke')
  @HttpCode(HttpStatus.OK)
  revokeProfileShare(
    @Param('shareId') shareId: string,
    @CurrentUser() currentUser: AuthenticatedUser
  ) {
    return this.sharing.revokeForUser(currentUser.id, shareId);
  }

  /**
   * Recuperacion del enlace utilizable, SOLO para su dueno.
   *
   * POST y no GET a proposito: la respuesta lleva un bearer (el token del
   * enlace), asi que no debe quedar en cache, ni en historial, ni ser
   * prefetcheable. `Cache-Control: no-store` lo hace explicito.
   */
  @Post('shares/:shareId/link')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  recoverProfileShareLink(
    @Param('shareId') shareId: string,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<HolderShareLinkDto> {
    return this.sharing.recoverLinkForUser(currentUser.id, shareId);
  }

  /**
   * PUT porque el body describe el conjunto COMPLETO de autorizacion, no un
   * delta: reenviar el mismo estado es idempotente y no mueve `policyVersion`.
   */
  @Put('shares/:shareId/verification-policy')
  @HttpCode(HttpStatus.OK)
  replaceVerificationPolicy(
    @Param('shareId') shareId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() body: unknown
  ): Promise<ShareVerificationPolicyStateDto> {
    return this.verificationPolicy.replaceForShare(currentUser.id, shareId, body);
  }
}

@Controller('share/profile')
export class PublicProfileSharingController {
  constructor(private readonly sharing: ProfileSharingService) {}

  @Get(':token')
  getSharedProfile(
    @Param('token') token: string
  ): Promise<PublicProfileShareResponseDto> {
    return this.sharing.getPublicProfile(token);
  }
}

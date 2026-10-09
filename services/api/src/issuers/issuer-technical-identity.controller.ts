import {
  Controller,
  Get,
  Header,
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
  type IssuerNetworkHealthResponseDto,
  type IssuerTechnicalIdentityResponseDto
} from './dto/issuer-technical-identity-response.dto';
import { IssuerTechnicalIdentityService } from './issuer-technical-identity.service';

/**
 * Configuracion tecnica del issuer -- S8c9.
 *
 * Autenticado, y SOLO para el admin activo del issuer. No es publico, y ningun
 * PlatformAdmin la saltea. No hay ninguna ruta de provisioning ni de rotacion
 * de claves: eso es exclusivamente herramienta de operacion.
 */
@Controller('issuers/:issuerId/technical-identity')
@UseGuards(AuthGuard)
export class IssuerTechnicalIdentityController {
  constructor(private readonly service: IssuerTechnicalIdentityService) {}

  /** DB/configuracion unicamente. Nunca dispara el diagnostico de red. */
  @Get()
  @Header('Cache-Control', 'no-store')
  read(
    @Param('issuerId') issuerId: string,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<IssuerTechnicalIdentityResponseDto> {
    return this.service.read(issuerId, currentUser.id);
  }

  /** Diagnostico EXPLICITO de red. Solo se ejecuta cuando se pide. */
  @Post('network-health')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  networkHealth(
    @Param('issuerId') issuerId: string,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<IssuerNetworkHealthResponseDto> {
    return this.service.networkHealth(issuerId, currentUser.id);
  }
}

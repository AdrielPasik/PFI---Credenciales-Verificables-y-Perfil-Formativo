import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards
} from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { type AdminUserResolutionResponseDto } from './dto/admin-user-resolution-response.dto';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformAdminUserResolutionService } from './platform-admin-user-resolution.service';
import { mapResolvePlatformAdminUserRequest } from './resolve-platform-admin-user.validator';

/**
 * Resolucion administrativa de un User por email -- slice S4.
 *
 *     POST /admin/users/resolve
 *
 * POR QUE `POST` SI NO MUTA NADA. Es una resolucion con body, no una coleccion
 * direccionable: el email es un dato personal y no debe viajar en la URL (ni en
 * query string, ni en path, ni en logs de acceso, ni en el Referer). El
 * precedente exacto del repo es `POST /issuers/:issuerId/holders/resolve`, que
 * resuelve un titular por email con `@HttpCode(200)` y tampoco escribe nada.
 *
 * `@HttpCode(200)` explicito: Nest responderia 201 por defecto en un `@Post`, y
 * 201 mentiria -- aca no se crea nada.
 *
 * AUTORIZACION. `@UseGuards(AuthGuard, PlatformAdminGuard)` en ESE orden, para
 * que un request sin token valido resuelva 401 antes del 403 de plataforma. El
 * actor sale de `request.user.id`, que setea `AuthGuard` tras verificar la firma
 * y releer el User de la base.
 *
 * EL BODY NO LLEVA AUTORIDAD. El controller no lee `@CurrentUser()` y no se lo
 * pasa al service: no hace falta, porque la autorizacion ya ocurrio en los
 * guards y la operacion no depende de QUIEN pregunta. Lo unico que cruza al
 * service es el email normalizado que devuelve el validador -- nunca el objeto
 * del body, nunca un spread.
 *
 * NO ES BUSQUEDA. Resolucion exacta de un email conocido: sin matching parcial,
 * sin autocomplete, sin listados y sin multiples candidatos.
 */
@UseGuards(AuthGuard, PlatformAdminGuard)
@Controller('admin/users')
export class PlatformAdminUserResolutionController {
  constructor(
    private readonly userResolutionService: PlatformAdminUserResolutionService
  ) {}

  // `async` siguiendo la convencion de `objectives.controller.ts`: asi un
  // rechazo del validador sale como promesa rechazada y no como throw
  // sincronico. Nest trata los dos igual, pero la promesa es la unica forma
  // consistente de observarlo desde un test.
  @Post('resolve')
  @HttpCode(HttpStatus.OK)
  public async resolveUser(
    // `unknown` a proposito: sin `ValidationPipe` en este repo, tiparlo como
    // DTO daria una falsa sensacion de que algo lo comprobo. Quien lo comprueba
    // es el validador de la linea siguiente.
    @Body() body: unknown
  ): Promise<AdminUserResolutionResponseDto> {
    const email = mapResolvePlatformAdminUserRequest(body);
    return this.userResolutionService.resolveUserByEmail(email);
  }
}

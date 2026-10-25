import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards
} from '@nestjs/common';

import {
  PasswordResetRequestThrottlerGuard,
  PasswordResetTokenThrottlerGuard
} from './password-reset-throttler.guard';
import { PasswordResetService } from './password-reset.service';

/**
 * Recuperacion de contrasena. TODAS las rutas son PUBLICAS a proposito: no llevan
 * `AuthGuard`, porque la persona que olvido su contrasena no tiene sesion. La
 * autorizacion es la posesion del token; el limite por IP corre antes que el handler.
 *
 * Los bodies llegan como `unknown` (no hay `ValidationPipe` en este repo) y se validan
 * a mano en el servicio. En Express 5 un POST sin body deja `req.body` en
 * `undefined`: tambien se rechaza como entrada invalida.
 *
 * `Cache-Control: no-store` en cada handler (`@Header` es de metodo, no de clase): la
 * respuesta lleva estado de seguridad sensible al tiempo y no debe quedar en caches
 * intermedias.
 *
 * Ninguna respuesta incluye el token, su hash, el email, ids ni `expiresAt`.
 */
@Controller('auth/password-reset')
export class PasswordResetController {
  constructor(private readonly passwordReset: PasswordResetService) {}

  /**
   * 202: se recibio el pedido. NO significa que se haya enviado un correo, ni que la
   * cuenta exista. La respuesta es identica en todos los casos de exito.
   */
  @Post('request')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  @UseGuards(PasswordResetRequestThrottlerGuard)
  request(@Body() body: unknown): { status: 'requested' } {
    return this.passwordReset.requestReset(body);
  }

  /** Solo lectura. No consume el token. */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @UseGuards(PasswordResetTokenThrottlerGuard)
  verify(@Body() body: unknown): Promise<{ status: 'valid' }> {
    return this.passwordReset.verifyToken(body);
  }

  /** Consume el token y cambia la contrasena. No emite ningun JWT. */
  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @UseGuards(PasswordResetTokenThrottlerGuard)
  confirm(@Body() body: unknown): Promise<{ status: 'password_reset' }> {
    return this.passwordReset.confirmReset(body);
  }
}

/**
 * Superficie publica de la sesion de verificador — intake y revision de requisitos.
 *
 *     POST /share/profile/:shareToken/verification-requests           crear borrador
 *     POST /share/profile/:shareToken/verification-requests/propose   proponer requisitos
 *     GET  /share/profile/:shareToken/verification-session            leer la sesion
 *     PUT  /share/profile/:shareToken/verification-requirements       confirmar requisitos
 *     POST /share/profile/:shareToken/verification-execute            congelar + ejecutar F3
 *     GET  /share/profile/:shareToken/verification-result             estado / resultado seguro
 *
 * SIN AuthGuard: el verificador es anonimo. La autoridad son dos tokens opacos:
 *
 *   token del ENLACE   en el path, como ya lo esta `/share/profile/:token`
 *   token de SESION    en el header `X-Verification-Request-Token`, nunca en la URL
 *
 * Este controller NO inyecta el servicio de congelamiento: crear un run solo es
 * posible a traves de `VerificationExecutionService`, que antes toma el lease del
 * enlace y cuenta la cuota.
 */

import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';

import { VerificationConfirmationService } from './verification-confirmation.service';
import { VerificationExecutionService } from './verification-execution.service';
import { VerificationProposalService } from './verification-proposal.service';
import {
  type CreatedVerificationRequest,
  VerificationRequestService
} from './verification-request.service';
import { type PublicVerificationResultDto } from './verification-result.projection';
import { VerificationResultService } from './verification-result.service';
import { type VerificationSessionDto } from './verification-session.projection';
import { readRequestTokenHeader } from './verification-session.token';

@Controller('share/profile/:shareToken')
export class PublicVerificationController {
  constructor(
    private readonly requests: VerificationRequestService,
    private readonly proposals: VerificationProposalService,
    private readonly confirmations: VerificationConfirmationService,
    private readonly executions: VerificationExecutionService,
    private readonly results: VerificationResultService
  ) {}

  /** `201`: se crea una sesion. El token de sesion viaja UNA vez, en este body. */
  @Post('verification-requests')
  @HttpCode(HttpStatus.CREATED)
  createRequest(
    @Param('shareToken') shareToken: string,
    @Body() body: unknown
  ): Promise<CreatedVerificationRequest> {
    return this.requests.createDraft(shareToken, body);
  }

  /**
   * `200`, idempotente: si la propuesta ya existe se devuelve la misma sin llamar
   * al proveedor ni consumir cuota.
   */
  @Post('verification-requests/propose')
  @HttpCode(HttpStatus.OK)
  propose(
    @Param('shareToken') shareToken: string,
    @Headers() headers: Record<string, unknown>
  ): Promise<VerificationSessionDto> {
    return this.proposals.propose(shareToken, readRequestTokenHeader(headers));
  }

  @Get('verification-session')
  readSession(
    @Param('shareToken') shareToken: string,
    @Headers() headers: Record<string, unknown>
  ): Promise<VerificationSessionDto> {
    return this.requests.readSession(shareToken, readRequestTokenHeader(headers));
  }

  /** `PUT`: el body es el conjunto COMPLETO revisado; reenviar lo mismo es idempotente. */
  @Put('verification-requirements')
  @HttpCode(HttpStatus.OK)
  confirm(
    @Param('shareToken') shareToken: string,
    @Headers() headers: Record<string, unknown>,
    @Body() body: unknown
  ): Promise<VerificationSessionDto> {
    return this.confirmations.confirm(shareToken, readRequestTokenHeader(headers), body);
  }

  /**
   * `200` con el estado resultante. Idempotente por token de sesion: repetirlo
   * nunca crea un segundo run; solo reanuda uno que quedo entre intentos.
   */
  @Post('verification-execute')
  @HttpCode(HttpStatus.OK)
  execute(
    @Param('shareToken') shareToken: string,
    @Headers() headers: Record<string, unknown>
  ): Promise<PublicVerificationResultDto> {
    return this.executions.execute(shareToken, readRequestTokenHeader(headers));
  }

  @Get('verification-result')
  readResult(
    @Param('shareToken') shareToken: string,
    @Headers() headers: Record<string, unknown>
  ): Promise<PublicVerificationResultDto> {
    return this.results.readResult(shareToken, readRequestTokenHeader(headers));
  }
}

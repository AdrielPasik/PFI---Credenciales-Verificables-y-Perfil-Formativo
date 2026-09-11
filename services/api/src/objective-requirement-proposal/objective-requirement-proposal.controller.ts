/**
 * Superficie privada de la propuesta de Requirements — slice P2.2.
 *
 *     POST /me/objective-requirement-proposals
 *
 * Sin `GET`, sin `PATCH`, sin `DELETE`: no hay nada que listar, editar ni borrar
 * porque no se persiste nada. El plural del recurso describe la acción —pedir una
 * propuesta— y no una colección almacenada.
 *
 * NO CREA UN OBJECTIVE. La confirmación vive en `POST /me/objectives`, que este
 * controller no llama ni puede llamar: `ObjectivesService` no está en su módulo.
 *
 * AUTORIDAD. La identidad sale exclusivamente del JWT, igual que el resto de
 * `/me`. Como esta etapa no lee ni escribe filas del holder, no hay ownership que
 * comprobar más allá de estar autenticado: el texto a analizar lo trae el propio
 * pedido.
 *
 * ERRORES SEGUROS. El cuerpo que ve el holder lleva sólo una categoría cerrada.
 * Nunca menciona al proveedor, ni un id de modelo, ni configuración, ni el prompt,
 * ni el detalle interno del fallo.
 */

import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  PayloadTooLargeException,
  Post,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UseGuards
} from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import {
  type ObjectiveRequirementProposalResponseDto
} from './dto/objective-requirement-proposal.dto';
import { ObjectiveRequirementProposalError } from './objective-requirement-proposal.errors';
import {
  mapObjectiveRequirementProposalRequest
} from './objective-requirement-proposal.request.validator';
import { ObjectiveRequirementProposalService } from './objective-requirement-proposal.service';

@UseGuards(AuthGuard)
@Controller('me/objective-requirement-proposals')
export class ObjectiveRequirementProposalController {
  public constructor(
    private readonly proposalService: ObjectiveRequirementProposalService
  ) {}

  /**
   * `200` y no `201`: no se creó ningún recurso. Devolver `201` afirmaría que hay
   * algo persistido que se puede volver a pedir, y no lo hay.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  public async propose(
    @Body() body: unknown
  ): Promise<ObjectiveRequirementProposalResponseDto> {
    // El cuerpo llega como `unknown` a propósito: no hay `ValidationPipe` en este
    // repo, así que tiparlo como DTO daría una falsa sensación de que algo lo
    // comprobó. Quien lo comprueba es el validador.
    try {
      const input = mapObjectiveRequirementProposalRequest(body);
      return await this.proposalService.propose(input);
    } catch (error: unknown) {
      throw this.toHttpException(error);
    }
  }

  private toHttpException(error: unknown): Error {
    if (!(error instanceof ObjectiveRequirementProposalError)) {
      // Un fallo no tipado no se describe: se reporta como indisponibilidad. Todo
      // lo demás filtraría detalle interno.
      return new ServiceUnavailableException({
        code: 'TEMPORARILY_UNAVAILABLE',
        message: 'No se pudo generar la propuesta en este momento.'
      });
    }

    switch (error.code) {
      case 'INVALID_OBJECTIVE_INPUT':
        return new BadRequestException({
          code: error.code,
          message: 'El Objective enviado no es valido.'
        });
      case 'OBJECTIVE_TOO_LARGE':
        return new PayloadTooLargeException({
          code: error.code,
          message: 'El Objective es demasiado extenso para analizarlo de una vez.'
        });
      case 'UNABLE_TO_PRODUCE_PROPOSAL':
        return new UnprocessableEntityException({
          code: error.code,
          message: 'No se pudo producir una propuesta confiable para este Objective.'
        });
      case 'TEMPORARILY_UNAVAILABLE':
        return new ServiceUnavailableException({
          code: error.code,
          message: 'El servicio no esta disponible en este momento. Intenta de nuevo.'
        });
    }
  }
}

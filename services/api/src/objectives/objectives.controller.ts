/**
 * Superficie privada de Objectives — slice F2.2.
 *
 *     POST /me/objectives
 *     GET  /me/objectives
 *     GET  /me/objectives/:objectiveId
 *     POST /me/objectives/:objectiveId/revisions
 *
 * Sin `PATCH`, sin `PUT`, sin `DELETE`: una fila finalizada no se edita, y una
 * revision crea SIEMPRE una fila nueva inmutable.
 *
 * AUTORIDAD. `ownerUserId` sale EXCLUSIVAMENTE de `currentUser.id`. No se acepta
 * `ownerUserId`, `userId` ni `holderId` desde body, query, path ni headers — el
 * validador de request los rechaza explicitamente.
 *
 * Y no hay un segundo gate de rol: la autoridad congelada por F2 es
 * `USER_OWNED`, no "holder". Un JWT valido basta como raiz de identidad, sujeto
 * unicamente al ownership del Objective concreto. `holder-independent` describe
 * el CONTENIDO epistemico del Objective, no un requisito de autorizacion.
 *
 * SIN PRISMA AQUI. El controller habla solo con `ObjectivesService`: nada de
 * queries, transacciones, builder ni validator de artifact. La autoridad de
 * dominio se quedo en F2.1.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import { ObjectiveType } from '@prisma/client';

import { AuthGuard } from '../auth/auth.guard';
import { type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  type ObjectiveDetailResponseDto,
  type ObjectiveSummaryResponseDto
} from './dto/objective.dto';
import { mapObjectiveDetail, mapObjectiveSummary } from './objective.mapper';
import { mapCreateObjectiveRequest } from './objective-request.validator';
import { ObjectivesService } from './objectives.service';

@UseGuards(AuthGuard)
@Controller('me/objectives')
export class ObjectivesController {
  public constructor(private readonly objectivesService: ObjectivesService) {}

  /** 201 por defecto en Nest, que es la convencion del repo para POST. */
  @Post()
  public async create(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() body: unknown
  ): Promise<ObjectiveDetailResponseDto> {
    // El cuerpo llega como `unknown` a proposito: no hay `ValidationPipe` en
    // este repo, asi que tiparlo como DTO daria una falsa sensacion de que algo
    // lo comprobo. Quien lo comprueba es el validador de la linea siguiente.
    const input = mapCreateObjectiveRequest(body);
    const objective = await this.objectivesService.createForUser(currentUser.id, input);
    return mapObjectiveDetail(objective);
  }

  @Get()
  public async list(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query('objectiveType') objectiveType?: string
  ): Promise<ObjectiveSummaryResponseDto[]> {
    // Unico filtro de V1. Un valor fuera del enum se rechaza en vez de
    // ignorarse: devolver la lista completa ante un filtro invalido haria creer
    // al cliente que filtro.
    const objectives = await this.objectivesService.listForUser(currentUser.id, {
      objectiveType: this.parseObjectiveTypeFilter(objectiveType)
    });
    return objectives.map(mapObjectiveSummary);
  }

  @Get(':objectiveId')
  public async get(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('objectiveId') objectiveId: string
  ): Promise<ObjectiveDetailResponseDto> {
    // El service consulta por `id + ownerUserId`, asi que un Objective ajeno y
    // uno inexistente producen el MISMO 404. No se convierte en 403: eso
    // reintroduciria el oraculo de existencia que F2.1 evito.
    const objective = await this.objectivesService.getForUser(currentUser.id, objectiveId);
    return mapObjectiveDetail(objective);
  }

  @Post(':objectiveId/revisions')
  public async createRevision(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('objectiveId') objectiveId: string,
    @Body() body: unknown
  ): Promise<ObjectiveDetailResponseDto> {
    // El predecesor lo determina el PATH. El cuerpo no lleva
    // `supersedesObjectiveId` y el validador lo rechaza si aparece.
    const input = mapCreateObjectiveRequest(body);
    const objective = await this.objectivesService.createRevisionForUser(
      currentUser.id,
      objectiveId,
      input
    );
    return mapObjectiveDetail(objective);
  }

  private parseObjectiveTypeFilter(value: string | undefined): ObjectiveType | undefined {
    if (value === undefined || value === '') {
      return undefined;
    }
    if (!Object.values(ObjectiveType).includes(value as ObjectiveType)) {
      // Mismo estilo que el resto de validaciones del repo: mensaje corto, sin
      // ecoar mas de lo necesario.
      throw new BadRequestException(
        `objectiveType debe ser uno de: ${Object.values(ObjectiveType).join(', ')}.`
      );
    }
    return value as ObjectiveType;
  }
}

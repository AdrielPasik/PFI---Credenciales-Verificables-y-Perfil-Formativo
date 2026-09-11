/**
 * Superficie privada de ReasoningRuns — slice F3.7.
 *
 *     POST /me/reasoning-runs
 *     GET  /me/reasoning-runs
 *     GET  /me/reasoning-runs/:reasoningRunId
 *     POST /me/reasoning-runs/:reasoningRunId/execute
 *
 * Sin `PATCH`, `PUT` ni `DELETE`: un run es una observación fechada e inmutable.
 * Sin `/retry`, `/cancel`, `/reset` ni `/force-complete`: reintentar es volver a
 * llamar a `execute` sobre un run propio que quedó `pending`, y no existe forma
 * segura de recuperar uno que quedó `running` — eso lo congeló F3.6 como
 * `NON_RECOVERABLE_RUNNING_CLAIM`, y la respuesta de producto es crear un run
 * nuevo, no rescatar el viejo.
 *
 * AUTORIDAD. `ownerUserId` sale EXCLUSIVAMENTE de `currentUser.id`. El validador
 * de request rechaza explícitamente cualquier intento de aportarlo, igual que en
 * `/me/objectives`.
 *
 * SIN PRISMA Y SIN DOMINIO AQUÍ. El controller extrae el principal, valida forma
 * y delega. La resolución acotada por dueño, la reverificación de la historia y
 * la traducción de desenlaces viven en `ReasoningRunPrivateService`; la ejecución
 * vive en `ReasoningRunExecutionService`. Este archivo no conoce proveedor,
 * modelo, prompt, plan ni etapas.
 *
 * EJECUCIÓN SÍNCRONA EN V1. El repositorio no tiene cola, worker ni job runner, y
 * no se inventa uno acá: `POST /execute` espera el desenlace real. La latencia
 * crece con la cantidad de Requirements, porque el razonamiento contextual hace
 * una llamada por Requirement. Está documentado como limitación, no disfrazado
 * con un `202 Accepted` que prometería un procesamiento en segundo plano que no
 * existe.
 */

import {
  Body,
  Controller,
  Get,
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
  type ReasoningRunDetailResponseDto,
  type ReasoningRunSummaryResponseDto
} from './dto/reasoning-run.dto';
import { mapCreateReasoningRunRequest } from './reasoning-run-request.validator';
import { ReasoningRunPrivateService } from './reasoning-run-private.service';

@UseGuards(AuthGuard)
@Controller('me/reasoning-runs')
export class ReasoningRunsController {
  public constructor(private readonly runs: ReasoningRunPrivateService) {}

  /**
   * 201 por defecto en Nest, que es la convención del repo para POST.
   *
   * Congela el universo de evidencia y NO ejecuta: la respuesta puede traer
   * `status: pending` o, si el inventario quedó bloqueado, `status: failed`. En
   * los dos casos el recurso existe y la creación fue exitosa.
   */
  @Post()
  public async create(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() body: unknown
  ): Promise<ReasoningRunDetailResponseDto> {
    // `unknown` a propósito: sin `ValidationPipe` en el repo, tiparlo como DTO
    // daría la falsa sensación de que algo lo comprobó.
    const { objectiveId } = mapCreateReasoningRunRequest(body);
    return this.runs.createForUser(currentUser.id, objectiveId);
  }

  @Get()
  public async list(
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<readonly ReasoningRunSummaryResponseDto[]> {
    return this.runs.listForUser(currentUser.id);
  }

  @Get(':reasoningRunId')
  public async get(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('reasoningRunId') reasoningRunId: string
  ): Promise<ReasoningRunDetailResponseDto> {
    // El service consulta por `id + ownerUserId`, así que un run ajeno y uno
    // inexistente producen el MISMO 404.
    return this.runs.getForUser(currentUser.id, reasoningRunId);
  }

  /**
   * 200, no 201: no se crea un recurso nuevo, se lleva adelante el que ya existe.
   *
   * Repetirlo sobre un run ya `completed` devuelve el mismo resultado persistido
   * con cero llamadas al proveedor, así que no es un error.
   */
  @Post(':reasoningRunId/execute')
  @HttpCode(HttpStatus.OK)
  public async execute(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('reasoningRunId') reasoningRunId: string
  ): Promise<ReasoningRunDetailResponseDto> {
    return this.runs.executeForUser(currentUser.id, reasoningRunId);
  }
}

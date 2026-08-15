import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ApplyReusableSemanticInterpretationDto } from './dto/apply-reusable-semantic-interpretation.dto';
import { ReusableSemanticInterpretationApplyResponseDto } from './dto/reusable-semantic-interpretation-apply-response.dto';
import { ReusableSemanticInterpretationAppliedSummaryDto } from './dto/reusable-semantic-interpretation-applied-summary.dto';
import { ReusableSemanticInterpretationCandidateResponseDto } from './dto/reusable-semantic-interpretation-candidate-response.dto';
import { ReusableSemanticInterpretationService } from './reusable-semantic-interpretation.service';

// C4b.1b: issuer-facing candidate/apply/read de la aplicacion de una
// interpretacion semantica aprobada (ver docs/architecture/
// approved-semantic-interpretation-application-v0.md, v0.2). Explicit
// post-issuance apply -- nunca durante ni antes de emitir.
@Controller('issuers/:issuerId/credentials/:credentialId/reusable-semantic-interpretation')
export class ReusableSemanticInterpretationController {
  constructor(
    private readonly reusableSemanticInterpretationService: ReusableSemanticInterpretationService
  ) {}

  @Get('candidate')
  @UseGuards(AuthGuard)
  getCandidate(
    @Param('issuerId') issuerId: string,
    @Param('credentialId') credentialId: string,
    @Query('templateId') templateId: string | undefined,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<ReusableSemanticInterpretationCandidateResponseDto> {
    return this.reusableSemanticInterpretationService.getCandidateForIssuer(
      issuerId,
      credentialId,
      templateId,
      currentUser
    );
  }

  // 200 uniforme para las tres salidas posibles (primera aplicacion,
  // supersede, idempotente) -- mismo patron ya usado en este repo para
  // endpoints de accion/operacion (ej. issuer-credential-issue.controller.ts),
  // en vez de variar el status code por resultado. El cuerpo de la
  // respuesta (changed/supersededPreviousApplication) ya comunica el
  // resultado sin ambiguedad.
  @Post('apply')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  apply(
    @Param('issuerId') issuerId: string,
    @Param('credentialId') credentialId: string,
    @Body() dto: ApplyReusableSemanticInterpretationDto,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<ReusableSemanticInterpretationApplyResponseDto> {
    return this.reusableSemanticInterpretationService.applyForIssuer(
      issuerId,
      credentialId,
      currentUser,
      dto
    );
  }

  @Get()
  @UseGuards(AuthGuard)
  getActive(
    @Param('issuerId') issuerId: string,
    @Param('credentialId') credentialId: string,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<ReusableSemanticInterpretationAppliedSummaryDto | null> {
    return this.reusableSemanticInterpretationService.getActiveForIssuer(
      issuerId,
      credentialId,
      currentUser
    );
  }
}

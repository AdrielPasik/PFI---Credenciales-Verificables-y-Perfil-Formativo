import { Module } from '@nestjs/common';

import { AiServiceClient } from '../ai/ai-service.client';
import { AiModule } from '../ai/ai.module';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectiveRequirementProposalService } from '../objective-requirement-proposal/objective-requirement-proposal.service';
import { SourceExtractionSlotService } from '../source-extraction/source-extraction-slot.service';
import { PublicVerificationController } from './public-verification.controller';
import { VerificationConfirmationService } from './verification-confirmation.service';
import { VerificationExecutionService } from './verification-execution.service';
import { VerificationProposalService } from './verification-proposal.service';
import { VerificationRequestService } from './verification-request.service';
import { VerificationResultService } from './verification-result.service';
import { VERIFICATION_RUN_ENGINE, buildVerificationRunEngine } from './verification-run-engine';
import { VerificationRunFreezeService } from './verification-run-freeze.service';

/**
 * Verificacion contextual publica.
 *
 * UN controller: intake, revision de requisitos, ejecucion y resultado. El
 * servicio de congelamiento se provee pero ningun controller lo inyecta (guarda
 * estructural): solo `VerificationExecutionService` crea runs.
 *
 * El motor F3 entra por una FACTORY sobre la tabla `VerificationRun`, no
 * registrando las clases del holder con un token de tabla en este modulo.
 *
 * `ObjectiveRequirementProposalService` se PROVEE aca en lugar de exportarlo desde
 * el modulo del holder: ese modulo mantiene su grafo cerrado (sin Prisma, sin
 * Objectives) y no hace falta abrirlo. El servicio no tiene estado.
 */
@Module({
  imports: [AiModule],
  controllers: [PublicVerificationController],
  providers: [
    VerificationRequestService,
    VerificationProposalService,
    VerificationConfirmationService,
    VerificationRunFreezeService,
    VerificationResultService,
    VerificationExecutionService,
    {
      provide: VERIFICATION_RUN_ENGINE,
      useFactory: buildVerificationRunEngine,
      inject: [PrismaService, AiServiceClient, SourceExtractionSlotService]
    },
    ObjectiveRequirementProposalService,
    SourceExtractionSlotService
  ],
  exports: [VerificationRequestService, VerificationRunFreezeService]
})
export class PublicVerificationModule {}

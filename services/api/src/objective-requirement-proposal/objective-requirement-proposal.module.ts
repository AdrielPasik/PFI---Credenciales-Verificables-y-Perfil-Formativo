import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { ObjectiveRequirementProposalController } from './objective-requirement-proposal.controller';
import { ObjectiveRequirementProposalService } from './objective-requirement-proposal.service';

/**
 * P2.2 — propuesta transitoria de Requirements.
 *
 * Importa exactamente dos módulos: `AuthModule` para el `AuthGuard` y `AiModule`
 * para el cliente del AI service.
 *
 * NO importa `ObjectivesModule` NI `PrismaModule`, y la ausencia es deliberada:
 * un módulo que no puede alcanzar el servicio de Objectives no puede crear un
 * Objective por accidente, y uno que no puede alcanzar Prisma no puede escribir.
 * El invariante queda sostenido por el grafo de dependencias, no por disciplina.
 *
 * No exporta nada: nadie fuera de acá inyecta el servicio de propuesta.
 */
@Module({
  imports: [AuthModule, AiModule],
  controllers: [ObjectiveRequirementProposalController],
  providers: [ObjectiveRequirementProposalService]
})
export class ObjectiveRequirementProposalModule {}

import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { SourceExtractionSlotService } from '../source-extraction/source-extraction-slot.service';
import { ReasoningRunArtifactSlotService } from './reasoning-run-artifact-slot.service';
import { ReasoningRunInputFreezeService } from './reasoning-run-input-freeze.service';
import { ReasoningRunContextualReasoningService } from './reasoning-run-contextual-reasoning.service';
import { ReasoningRunEvidenceUnitsService } from './reasoning-run-evidence-units.service';
import { ReasoningRunExecutionClaimService } from './reasoning-run-execution-claim.service';
import { ReasoningRunExecutionService } from './reasoning-run-execution.service';
import { ReasoningRunGroundingLoader } from './reasoning-run-grounding.loader';
import { ReasoningRunObjectiveAnalysisService } from './reasoning-run-objective-analysis.service';
import { ReasoningRunPrivateService } from './reasoning-run-private.service';
import { ReasoningRunsController } from './reasoning-runs.controller';

/**
 * F3.2 — delta mínimo de wiring.
 *
 * Sin controller: F3.2 no expone superficie HTTP, y la API privada sigue siendo
 * F3.7. Sin `imports`: la única dependencia externa de los dos servicios es
 * `PrismaService`, y `PrismaModule` es `@Global()`.
 *
 * SOBRE `SourceExtractionSlotService`, que se provee acá además de en
 * `AnalysisRunModule`. El comentario de F1.6 en aquel módulo decía que un
 * `SourceExtractionModule` se crearía "cuando exista un segundo consumidor fuera
 * de aquí". Ese consumidor ya existe —es este slice—, pero consolidarlo
 * significaría mover tres providers y reescribir el wiring congelado de F1.6, que
 * está fuera del alcance de F3.2.
 *
 * Proveerlo dos veces es correcto mientras tanto: el servicio no tiene estado
 * —sólo `PrismaService` inyectado— así que dos instancias son equivalentes. Queda
 * anotado como el momento natural para crear `SourceExtractionModule`, no como un
 * descuido.
 *
 * No se exporta nada: por ahora nadie fuera de este módulo inyecta estos
 * servicios. F3.7 exportará lo que necesite su controller.
 *
 * F3.3B SÍ importa `AiModule`, y ahí el caso es distinto del anterior: ese módulo
 * existe y ya exporta `AiServiceClient`, igual que lo consume `AnalysisRunModule`.
 * Proveer el cliente localmente habría duplicado un provider que tiene dueño —y
 * habría dejado sin resolver su `AiServiceInternalAuth`—. Cuando existe el módulo
 * compartido, se importa; el caso de `SourceExtractionSlotService` es una
 * excepción precisamente porque ese módulo NO existe.
 */
@Module({
  // F3.7: `AuthModule` entra por el `AuthGuard` del controller, igual que en
  // `ObjectivesModule`. `PrismaModule` es @Global().
  imports: [AiModule, AuthModule],
  controllers: [ReasoningRunsController],
  providers: [
    SourceExtractionSlotService,
    ReasoningRunArtifactSlotService,
    ReasoningRunInputFreezeService,
    ReasoningRunObjectiveAnalysisService,
    ReasoningRunGroundingLoader,
    ReasoningRunEvidenceUnitsService,
    ReasoningRunContextualReasoningService,
    ReasoningRunExecutionClaimService,
    ReasoningRunExecutionService,
    ReasoningRunPrivateService
  ]
})
export class ReasoningRunModule {}

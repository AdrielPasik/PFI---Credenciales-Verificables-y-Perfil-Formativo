import { Module } from '@nestjs/common';

import { AnalysisRunModule } from '../analysis-run/analysis-run.module';
import { AuthModule } from '../auth/auth.module';
import { IssuersModule } from '../issuers/issuers.module';
import { ReusableSemanticInterpretationController } from './reusable-semantic-interpretation.controller';
import { ReusableSemanticInterpretationService } from './reusable-semantic-interpretation.service';

@Module({
  // C5b.1: AnalysisRunModule exporta AutomaticProfileRebuildService --
  // reutilizado para disparar el mismo rebuild best-effort del perfil tras
  // un apply exitoso, sin duplicar logica de try/catch/logging.
  imports: [AnalysisRunModule, AuthModule, IssuersModule],
  controllers: [ReusableSemanticInterpretationController],
  providers: [ReusableSemanticInterpretationService]
})
export class ReusableSemanticInterpretationModule {}

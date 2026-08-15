import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { DocumentEvidenceModule } from '../document-evidence/document-evidence.module';
import { IssuersModule } from '../issuers/issuers.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { SemanticModule } from '../semantic/semantic.module';
import { TextEvidenceModule } from '../text-evidence/text-evidence.module';
import { AnalysisRunBackfillService } from './analysis-run-backfill.service';
import { AnalysisRunExecutionService } from './analysis-run-execution.service';
import { AnalysisRunService } from './analysis-run.service';
import { AutomaticCourseTextAnalysisService } from './automatic-course-text-analysis.service';
import { AutomaticDocumentAnalysisService } from './automatic-document-analysis.service';
import { AutomaticProfileRebuildService } from './automatic-profile-rebuild.service';
import { IssuerAnalysisRunController } from './issuer-analysis-run.controller';
import { IssuerAnalysisRunReadService } from './issuer-analysis-run-read.service';
import { IssuerAnalysisRunService } from './issuer-analysis-run.service';

@Module({
  imports: [
    AiModule,
    AuthModule,
    DocumentEvidenceModule,
    IssuersModule,
    // Ya importado para AnalysisRunBackfillService; C2b.4 agrega un
    // segundo consumidor: AutomaticProfileRebuildService.
    ProfilesModule,
    SemanticModule,
    // C2b.3: AutomaticCourseTextAnalysisService reusa
    // TextEvidenceService.ensureSystemGeneratedCurrentTextEvidenceForCredential.
    TextEvidenceModule
  ],
  controllers: [IssuerAnalysisRunController],
  providers: [
    AnalysisRunService,
    AnalysisRunExecutionService,
    AutomaticDocumentAnalysisService,
    AutomaticCourseTextAnalysisService,
    // C2b.4: usado dentro de este modulo por
    // AutomaticDocumentAnalysisService/AutomaticCourseTextAnalysisService.
    // C5b.1 lo exporta ademas para que
    // ReusableSemanticInterpretationModule dispare el mismo rebuild
    // best-effort tras un apply -- ver comentario en `exports` abajo.
    AutomaticProfileRebuildService,
    // IA-Q1c: herramienta interna de backfill/reanalysis, sin controller
    // asociado -- no crea ningun endpoint HTTP nuevo.
    AnalysisRunBackfillService,
    IssuerAnalysisRunReadService,
    IssuerAnalysisRunService
  ],
  exports: [
    AnalysisRunService,
    AnalysisRunExecutionService,
    AutomaticDocumentAnalysisService,
    AutomaticCourseTextAnalysisService,
    AnalysisRunBackfillService,
    // C5b.1: segundo consumidor fuera de este modulo --
    // ReusableSemanticInterpretationService reutiliza el mismo mecanismo
    // best-effort ya usado por el analisis automatico, en vez de duplicar
    // logica de rebuild/try-catch/logging.
    AutomaticProfileRebuildService
  ]
})
export class AnalysisRunModule {}

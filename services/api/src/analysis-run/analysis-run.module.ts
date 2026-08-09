import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { DocumentEvidenceModule } from '../document-evidence/document-evidence.module';
import { IssuersModule } from '../issuers/issuers.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { SemanticModule } from '../semantic/semantic.module';
import { AnalysisRunBackfillService } from './analysis-run-backfill.service';
import { AnalysisRunExecutionService } from './analysis-run-execution.service';
import { AnalysisRunService } from './analysis-run.service';
import { AutomaticDocumentAnalysisService } from './automatic-document-analysis.service';
import { IssuerAnalysisRunController } from './issuer-analysis-run.controller';
import { IssuerAnalysisRunReadService } from './issuer-analysis-run-read.service';
import { IssuerAnalysisRunService } from './issuer-analysis-run.service';

@Module({
  imports: [
    AiModule,
    AuthModule,
    DocumentEvidenceModule,
    IssuersModule,
    ProfilesModule,
    SemanticModule
  ],
  controllers: [IssuerAnalysisRunController],
  providers: [
    AnalysisRunService,
    AnalysisRunExecutionService,
    AutomaticDocumentAnalysisService,
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
    AnalysisRunBackfillService
  ]
})
export class AnalysisRunModule {}

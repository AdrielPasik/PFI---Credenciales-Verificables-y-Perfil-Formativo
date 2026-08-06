import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { DocumentEvidenceModule } from '../document-evidence/document-evidence.module';
import { SemanticModule } from '../semantic/semantic.module';
import { AnalysisRunExecutionService } from './analysis-run-execution.service';
import { AnalysisRunService } from './analysis-run.service';

@Module({
  imports: [AiModule, DocumentEvidenceModule, SemanticModule],
  providers: [AnalysisRunService, AnalysisRunExecutionService],
  exports: [AnalysisRunService, AnalysisRunExecutionService]
})
export class AnalysisRunModule {}

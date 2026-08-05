import { Module } from '@nestjs/common';

import { AnalysisRunService } from './analysis-run.service';

@Module({
  providers: [AnalysisRunService],
  exports: [AnalysisRunService]
})
export class AnalysisRunModule {}

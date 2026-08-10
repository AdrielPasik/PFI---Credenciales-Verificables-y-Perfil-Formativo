import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { IssuersModule } from '../issuers/issuers.module';
import { TextEvidenceController } from './text-evidence.controller';
import { TextEvidenceService } from './text-evidence.service';

@Module({
  imports: [AuthModule, IssuersModule],
  controllers: [TextEvidenceController],
  providers: [TextEvidenceService],
  // C2b.3: AutomaticCourseTextAnalysisService (analysis-run module) reusa
  // ensureSystemGeneratedCurrentTextEvidenceForCredential en vez de
  // duplicar la logica de creacion/normalizacion de TextEvidence.
  exports: [TextEvidenceService]
})
export class TextEvidenceModule {}

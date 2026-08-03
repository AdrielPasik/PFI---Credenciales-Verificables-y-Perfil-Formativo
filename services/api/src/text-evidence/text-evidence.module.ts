import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { IssuersModule } from '../issuers/issuers.module';
import { TextEvidenceController } from './text-evidence.controller';
import { TextEvidenceService } from './text-evidence.service';

@Module({
  imports: [AuthModule, IssuersModule],
  controllers: [TextEvidenceController],
  providers: [TextEvidenceService]
})
export class TextEvidenceModule {}

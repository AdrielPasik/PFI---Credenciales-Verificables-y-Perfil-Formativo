import { Module } from '@nestjs/common';

import { SemanticModule } from '../semantic/semantic.module';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

@Module({
  imports: [SemanticModule],
  controllers: [VerificationController],
  providers: [VerificationService]
})
export class VerificationModule {}

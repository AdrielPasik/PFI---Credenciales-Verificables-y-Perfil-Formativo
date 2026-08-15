import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { IssuersModule } from '../issuers/issuers.module';
import { ReusableSemanticInterpretationController } from './reusable-semantic-interpretation.controller';
import { ReusableSemanticInterpretationService } from './reusable-semantic-interpretation.service';

@Module({
  imports: [AuthModule, IssuersModule],
  controllers: [ReusableSemanticInterpretationController],
  providers: [ReusableSemanticInterpretationService]
})
export class ReusableSemanticInterpretationModule {}

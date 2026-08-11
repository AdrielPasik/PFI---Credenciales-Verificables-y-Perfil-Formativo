import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { IssuersModule } from '../issuers/issuers.module';
import { IssuerCourseTemplatesController } from './issuer-course-templates.controller';
import { IssuerCourseTemplatesService } from './issuer-course-templates.service';

@Module({
  imports: [AuthModule, IssuersModule],
  controllers: [IssuerCourseTemplatesController],
  providers: [IssuerCourseTemplatesService]
})
export class IssuerCourseTemplatesModule {}

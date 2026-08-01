import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { IssuersModule } from '../issuers/issuers.module';
import { AcademicCatalogController } from './academic-catalog.controller';
import { AcademicCatalogService } from './academic-catalog.service';

@Module({
  imports: [AuthModule, IssuersModule],
  controllers: [AcademicCatalogController],
  providers: [AcademicCatalogService]
})
export class CatalogModule {}

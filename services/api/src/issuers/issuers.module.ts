import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { IssuerHolderResolutionController } from './issuer-holder-resolution.controller';
import { IssuerHolderResolutionService } from './issuer-holder-resolution.service';
import { IssuerReadinessService } from './issuer-readiness.service';
import { IssuerTechnicalIdentityController } from './issuer-technical-identity.controller';
import { IssuerTechnicalIdentityService } from './issuer-technical-identity.service';
import { IssuersService } from './issuers.service';

@Module({
  imports: [AuthModule],
  controllers: [IssuerHolderResolutionController, IssuerTechnicalIdentityController],
  providers: [
    IssuersService,
    IssuerHolderResolutionService,
    IssuerReadinessService,
    IssuerTechnicalIdentityService
  ],
  exports: [IssuersService, IssuerReadinessService]
})
export class IssuersModule {}

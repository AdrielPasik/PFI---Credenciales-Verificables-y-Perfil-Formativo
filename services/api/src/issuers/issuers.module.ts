import { Module } from '@nestjs/common';

import { IssuerHolderResolutionController } from './issuer-holder-resolution.controller';
import { IssuerHolderResolutionService } from './issuer-holder-resolution.service';
import { IssuersService } from './issuers.service';

@Module({
  controllers: [IssuerHolderResolutionController],
  providers: [IssuersService, IssuerHolderResolutionService],
  exports: [IssuersService]
})
export class IssuersModule {}

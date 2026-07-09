import { Module } from '@nestjs/common';

import { IssuersService } from './issuers.service';

@Module({
  providers: [IssuersService],
  exports: [IssuersService]
})
export class IssuersModule {}
